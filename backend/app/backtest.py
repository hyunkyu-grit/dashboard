"""Backtest: enter a position on a past date, revalue it every day since.

[OWNER, 2026-07-31] "며칠부터 며칠사이에 어떤 포지션으로 들어갔을 때 현재 기준
또는 특정일자까지 손익이 어떻게 움직였을 것이다."

A BOOK, NOT ONE TRADE [OWNER, 2026-07-31]. Several positions, each with its
own instrument, side, size, entry date AND exit date — you leg into things on
different days and out of them on different days. The published line is the
book total; each position also reports its own P&L so the total can be read
back to what made it.

A closed position stops moving. After its exit its contribution is FROZEN at
the P&L it had on that date, so it keeps counting toward the book total (that
money was made) without responding to a market it is no longer in. A position
that kept marking after it was closed is the classic way a backtest flatters
itself, so it is asserted rather than assumed.

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

# A book, not a portfolio system. Past this the sheet is unreadable and each
# extra position is another full daily revaluation pass.
MAX_POSITIONS = 12


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


@dataclass
class Position:
    """One line of the book, as the caller states it."""

    series_id: str
    direction: int
    notional: float
    entry: dt.date
    exit: dt.date | None = None


def _run_one(
    dataset: Dataset, pos: Position, sample: list[int]
) -> tuple[dict, dict[int, float]]:
    """One position: its record, and its P&L at each sampled index.

    A position contributes NOTHING before its entry and stays FROZEN at its
    closing P&L after its exit. Both matter: a position that started paying
    before it was opened would be free money, and one that kept marking after
    it was closed is the classic way a backtest flatters itself.
    """
    if pos.direction not in (1, -1):
        raise BacktestError("direction must be +1 or -1")
    if pos.notional <= 0:
        raise BacktestError("notional must be positive")

    known = {sid for sid, _k, _l in derived_ids()} | set(dataset.series)
    if pos.series_id not in known:
        raise BacktestError(f"unknown instrument {pos.series_id!r}")

    dates = dataset.dates
    entry_i = _index_on_or_after(dates, pos.entry)
    exit_i = _index_on_or_before(dates, pos.exit) if pos.exit else len(dates) - 1
    if exit_i <= entry_i:
        raise BacktestError(
            f"{pos.series_id}: the exit date must be after the entry date"
        )

    legs = _build_legs(dataset, pos.series_id, pos.notional, entry_i)
    for leg in legs:
        leg.sign *= pos.direction

    entry_date = dates[entry_i]
    base = _value_on(legs, dataset, entry_i, entry_date, _cd_fixings(dataset, entry_i))

    # Valued only on the sampled dates INSIDE its own life, plus its exit — so
    # the frozen tail is the real closing figure, not the last sample before it.
    live = [i for i in sample if entry_i <= i <= exit_i]
    if exit_i not in live:
        live.append(exit_i)

    own: dict[int, float] = {}
    cash_at: dict[int, float] = {}
    npv_at: dict[int, float] = {}
    last = 0.0
    for i in live:
        fx = _cd_fixings(dataset, i)
        npv = _value_on(legs, dataset, i, entry_date, fx)
        cash = _settled_to(legs, entry_date, dates[i], fx)
        own[i] = last = npv - base + cash
        cash_at[i] = cash
        npv_at[i] = npv

    series = {}
    for i in sample:
        if i < entry_i:
            series[i] = 0.0            # not yet on
        elif i > exit_i:
            series[i] = last           # closed: frozen, still counted
        else:
            series[i] = own[i]

    record = {
        "id": pos.series_id,
        "direction": pos.direction,
        "notional": pos.notional,
        "entry": entry_date.isoformat(),
        "exit": dates[exit_i].isoformat(),
        "closed": pos.exit is not None and exit_i < len(dates) - 1,
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
        "entryValue": _quoted_value(dataset, pos.series_id, entry_i),
        "exitValue": _quoted_value(dataset, pos.series_id, exit_i),
        "pnl": round(last, 0),
        # Closing scalars, not paths. The sheet shows accumulated carry per
        # position; shipping a full npv/cash series for each would be 12 × 400
        # × 2 numbers to draw one total line. `trace()` below reconstructs the
        # path when something needs to look at it.
        "cash": round(cash_at.get(exit_i, 0.0), 0),
        "npv": round(npv_at.get(exit_i, 0.0), 0),
    }
    return record, series


def trace(dataset: Dataset, pos: Position) -> list[dict]:
    """One position's full daily path: pnl, npv and settled cash per date.

    Not served by any endpoint — the sheet draws the book total and needs only
    closing scalars per position, and shipping this for a dozen positions would
    be thousands of numbers to draw one line. It exists because the properties
    worth asserting about this engine (cash steps only on payment dates, and
    each step equal to the real net coupon) are properties of the PATH, and a
    test that cannot see the path cannot check them.
    """
    dates = dataset.dates
    entry_i = _index_on_or_after(dates, pos.entry)
    exit_i = _index_on_or_before(dates, pos.exit) if pos.exit else len(dates) - 1
    legs = _build_legs(dataset, pos.series_id, pos.notional, entry_i)
    for leg in legs:
        leg.sign *= pos.direction
    entry_date = dates[entry_i]
    base = _value_on(legs, dataset, entry_i, entry_date, _cd_fixings(dataset, entry_i))

    out = []
    for i in _thin(list(range(entry_i, exit_i + 1)), MAX_POINTS):
        fx = _cd_fixings(dataset, i)
        npv = _value_on(legs, dataset, i, entry_date, fx)
        cash = _settled_to(legs, entry_date, dates[i], fx)
        out.append(
            {"t": dates[i].isoformat(), "pnl": round(npv - base + cash, 0),
             "npv": round(npv, 0), "cash": round(cash, 0)}
        )
    return out


def run_backtest(dataset: Dataset, positions: list[Position]) -> dict:
    """Revalue a BOOK of positions daily and sum them.

    The book's window is the earliest entry to the latest exit, and every
    position is sampled on the same dates so the totals add up point for point
    — sampling each on its own grid and summing would compare figures from
    different days.
    """
    if not positions:
        raise BacktestError("at least one position is required")
    if len(positions) > MAX_POSITIONS:
        raise BacktestError(f"at most {MAX_POSITIONS} positions")

    dates = dataset.dates
    first = min(_index_on_or_after(dates, p.entry) for p in positions)
    last = max(
        _index_on_or_before(dates, p.exit) if p.exit else len(dates) - 1
        for p in positions
    )
    sample = _thin(list(range(first, last + 1)), MAX_POINTS)

    records = []
    series: list[dict[int, float]] = []
    for pos in positions:
        rec, own = _run_one(dataset, pos, sample)
        records.append(rec)
        series.append(own)

    points = [
        {
            "t": dates[i].isoformat(),
            "pnl": round(sum(s[i] for s in series), 0),
        }
        for i in sample
    ]
    pnls = [p["pnl"] for p in points]
    return {
        "positions": records,
        "from": dates[first].isoformat(),
        "to": dates[last].isoformat(),
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
