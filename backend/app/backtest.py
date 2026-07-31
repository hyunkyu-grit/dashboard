"""Backtest: enter a position on a past date, revalue it every day since.

[OWNER, 2026-07-31] "며칠부터 며칠사이에 어떤 포지션으로 들어갔을 때 현재 기준
또는 특정일자까지 손익이 어떻게 움직였을 것이다."

WHAT THIS IS. On the entry date the position is struck at that day's own par
rates, so it is worth ~nothing. Every business day after, the swap is revalued
on THAT day's bootstrapped curve, and the P&L is the change in dirty NPV plus
the cash the position has actually settled along the way. Full revaluation, not
a DV01 approximation [OWNER chose "재평가 + 캐리까지"], which means the number
carries roll-down and carry rather than only the parallel rate move.

WHY IT IS NOT `Δrate × DV01 × notional`. That approximation is first-order in
the rate and blind to the passage of time: it cannot see that a 10Y entered a
year ago is a 9Y today, and it books no coupon. Over a few days the two agree
closely — `test_backtest.py` asserts they do, which is the cheapest available
check that the revaluation is not wildly wrong — and over a year they should
not, which is the whole reason for choosing revaluation.

THE DIRTY + SETTLED-CASH BASIS. A swap's dirty NPV drops by the coupon on every
payment date, because the flow leaves the valuation schedule the moment it is
paid. Marking P&L on NPV alone therefore draws a sawtooth that is pure
accounting artefact — the desk RECEIVED that money. So the series is
`ΔdirtyNPV + cumulative settled cash`, which is continuous across coupon dates.
The frozen engine reached the same convention (its s13 note); `settled_cash_between`
is ported from it.

LEG CONSTRUCTION. An outright is one swap. A spread is two and a butterfly is
three, weighted **DV01-neutral at the entry curve** [OWNER] so the quoted value
(r_long − r_short, 2·r_belly − r_short − r_long) is the P&L driver — the same
weighting `app/dv01.py` already serves to the table. The user's notional applies
to the reference leg (the longest for a spread, the belly for a fly) and the
others follow from it.

NO LOOK-AHEAD. Curves are bootstrapped from the row AT each date, and floating
periods take the CD91 print of F(R) = reset − 1 Seoul business day via the
ported `select_fixing`, which refuses a fixing dated after the valuation date.
A backtest that peeks is worse than no backtest.
"""

from __future__ import annotations

import datetime as dt
from bisect import bisect_left, bisect_right
from dataclasses import dataclass

import numpy as np

from .curves import TENOR_T, par_rates_at_index
from .dataset import Dataset
from .derive import derived_ids
from .engine_port import bootstrap_zero_curve
from .dv01 import pv01
from .valuation_port import CurveBundle, VanillaSwap, settled_cash_between, value_booked_trade

# The CD91 series IS the 3M curve node (dataset._tenor_id), and it is the
# floating leg every KRW CD-IRS pays. One name for the coupling.
CD_TENOR = "3M"

# How many points the P&L line is downsampled to before it is served. A
# ten-year backtest is ~2,600 business days and the chart is ~1,100px wide, so
# every point beyond this is a number nobody can see (§20).
MAX_POINTS = 400


class BacktestError(Exception):
    """The request cannot be run — a bad instrument, or dates outside the data."""


@dataclass
class Leg:
    tenor: str
    """+1 = pay fixed on this leg, -1 = receive fixed."""
    sign: int
    notional: float
    entry_rate: float  # decimal
    dv01: float        # per unit notional, at the entry curve


def _legs_for(series_id: str) -> list[tuple[str, int]]:
    """(tenor, sign) per leg, sign relative to a `+1` position in the quoted
    value. A spread `A-B` is quoted r_B − r_A, so it is long B / short A; a fly
    `A-B-C` is 2·r_B − r_A − r_C, so it is 2 belly against the wings."""
    parts = series_id.split("-")
    if len(parts) == 1:
        return [(parts[0], +1)]
    if len(parts) == 2:
        return [(parts[1], +1), (parts[0], -1)]
    if len(parts) == 3:
        return [(parts[1], +1), (parts[0], -1), (parts[2], -1)]
    raise BacktestError(f"cannot build legs for {series_id!r}")


def _index_on_or_after(dates: list[dt.date], d: dt.date) -> int:
    i = bisect_left(dates, d)
    if i >= len(dates):
        raise BacktestError(f"{d} is after the last observation ({dates[-1]})")
    return i


def _index_on_or_before(dates: list[dt.date], d: dt.date) -> int:
    i = bisect_right(dates, d) - 1
    if i < 0:
        raise BacktestError(f"{d} is before the first observation ({dates[0]})")
    return i


def _curve_at(dataset: Dataset, i: int) -> np.ndarray:
    return bootstrap_zero_curve(par_rates_at_index(dataset, i))


def _cd_fixings(dataset: Dataset, upto: int) -> dict[dt.date, float]:
    """{date: decimal CD91} up to and including index `upto`. Bounded on
    purpose: handing the whole history to a valuation dated earlier would let
    `select_fixing`'s no-look-ahead guard be the only thing standing between us
    and a fixing from the future. Two guards are better than one."""
    vals = dataset.series[CD_TENOR]
    return {
        d: v / 100.0
        for d, v in zip(dataset.dates[: upto + 1], vals[: upto + 1])
        if v is not None
    }


def _build_legs(
    dataset: Dataset, series_id: str, notional: float, entry_i: int
) -> list[Leg]:
    """Struck at the entry date's own par rates, weighted DV01-neutral."""
    zc = _curve_at(dataset, entry_i)
    specs = _legs_for(series_id)

    built: list[Leg] = []
    for tenor, sign in specs:
        if tenor not in TENOR_T:
            raise BacktestError(f"unknown tenor {tenor!r}")
        rate = dataset.series.get(tenor, [None])[entry_i]
        if rate is None:
            raise BacktestError(f"no {tenor} rate on {dataset.dates[entry_i]}")
        built.append(
            Leg(
                tenor=tenor,
                sign=sign,
                notional=0.0,  # set below
                entry_rate=rate / 100.0,
                dv01=pv01(zc, TENOR_T[tenor]),
            )
        )

    # The reference leg carries the user's notional; the others are scaled so
    # each leg's DV01 contribution matches it — that is what makes the quoted
    # spread/fly value the P&L driver rather than a lopsided rate bet.
    ref = built[0]
    ref.notional = notional
    ref_dv = ref.dv01 * notional
    for leg in built[1:]:
        # a fly's belly carries twice the wings' weight (2·belly − wings)
        share = 0.5 if len(built) == 3 else 1.0
        leg.notional = (ref_dv * share) / leg.dv01 if leg.dv01 else 0.0
    return built


def _value_on(
    legs: list[Leg],
    dataset: Dataset,
    i: int,
    entry_date: dt.date,
    fixings: dict[dt.date, float],
) -> float:
    """Total dirty NPV of the position on the row at index `i`."""
    curve = CurveBundle(dataset.dates[i], _curve_at(dataset, i), [])
    total = 0.0
    for leg in legs:
        swap = VanillaSwap(
            tenor_years=int(round(TENOR_T[leg.tenor])) or 1,
            notional=leg.notional,
            fixed_rate=leg.entry_rate,
            pay_fixed=leg.sign > 0,
            trade_date=entry_date,
        )
        total += value_booked_trade(swap, curve, fixings).dirty_npv
    return total


def _settled_to(
    legs: list[Leg],
    entry_date: dt.date,
    upto: dt.date,
    fixings: dict[dt.date, float],
) -> float:
    total = 0.0
    for leg in legs:
        swap = VanillaSwap(
            tenor_years=int(round(TENOR_T[leg.tenor])) or 1,
            notional=leg.notional,
            fixed_rate=leg.entry_rate,
            pay_fixed=leg.sign > 0,
            trade_date=entry_date,
        )
        total += settled_cash_between(swap, fixings, entry_date, upto)
    return total


def _thin(idx: list[int], keep: int) -> list[int]:
    """Evenly thin an index list to at most `keep`, always keeping the ends."""
    if len(idx) <= keep:
        return idx
    step = (len(idx) - 1) / (keep - 1)
    out = sorted({idx[round(k * step)] for k in range(keep)})
    if out[-1] != idx[-1]:
        out.append(idx[-1])
    return out


def run_backtest(
    dataset: Dataset,
    series_id: str,
    direction: int,
    notional: float,
    entry: dt.date,
    exit_: dt.date | None = None,
) -> dict:
    """Revalue `series_id` daily from `entry` to `exit_` (default: the data's
    last date). `direction` is +1 for a position long the quoted value — pay
    fixed on an outright, a steepener on a spread — and -1 for the other side.
    """
    if direction not in (1, -1):
        raise BacktestError("direction must be +1 or -1")
    if notional <= 0:
        raise BacktestError("notional must be positive")

    known = {sid for sid, _k, _l in derived_ids()} | set(dataset.series)
    if series_id not in known:
        raise BacktestError(f"unknown instrument {series_id!r}")

    dates = dataset.dates
    entry_i = _index_on_or_after(dates, entry)
    exit_i = _index_on_or_before(dates, exit_) if exit_ else len(dates) - 1
    if exit_i <= entry_i:
        raise BacktestError("the exit date must be after the entry date")

    legs = _build_legs(dataset, series_id, notional, entry_i)
    for leg in legs:
        leg.sign *= direction

    entry_date = dates[entry_i]
    # Struck at par on the entry curve, so this is ~0; subtracting it rather
    # than assuming zero is what keeps the line honest when it is not (a
    # forward-starting leg, or an interpolated tenor off its own node).
    base_fixings = _cd_fixings(dataset, entry_i)
    base_npv = _value_on(legs, dataset, entry_i, entry_date, base_fixings)

    sampled = _thin(list(range(entry_i, exit_i + 1)), MAX_POINTS)
    points = []
    for i in sampled:
        d = dates[i]
        fx = _cd_fixings(dataset, i)
        npv = _value_on(legs, dataset, i, entry_date, fx)
        cash = _settled_to(legs, entry_date, d, fx)
        points.append(
            {
                "t": d.isoformat(),
                # dirty + settled cash, so coupon dates do not saw the line
                "pnl": round(npv - base_npv + cash, 0),
                "npv": round(npv, 0),
                "cash": round(cash, 0),
            }
        )

    quoted = _quoted_value(dataset, series_id, entry_i), _quoted_value(dataset, series_id, exit_i)
    pnls = [p["pnl"] for p in points]
    return {
        "id": series_id,
        "direction": direction,
        "notional": notional,
        "entry": entry_date.isoformat(),
        "exit": dates[exit_i].isoformat(),
        "legs": [
            {
                "tenor": leg.tenor,
                "side": "pay" if leg.sign > 0 else "receive",
                "notional": round(leg.notional, 0),
                "entryRate": round(leg.entry_rate * 100, 4),
                "dv01": round(leg.dv01, 6),
            }
            for leg in legs
        ],
        "entryValue": quoted[0],
        "exitValue": quoted[1],
        "points": points,
        "pnl": pnls[-1] if pnls else 0.0,
        "maxProfit": max(pnls) if pnls else 0.0,
        "maxLoss": min(pnls) if pnls else 0.0,
    }


def _quoted_value(dataset: Dataset, series_id: str, i: int) -> float | None:
    """The instrument's own quoted number on that row — % for an outright, bp
    for a spread/fly. Read for display beside the P&L, never used to compute
    it: the P&L comes from revaluation and these two are allowed to tell
    slightly different stories (that difference IS carry and roll)."""
    from .derive import series_values

    try:
        vals = series_values(dataset, series_id)
    except KeyError:
        return None
    v = vals[i]
    return None if v is None else round(v, 4)
