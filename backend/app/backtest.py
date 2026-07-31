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
from .engine_port import bootstrap_zero_curve, next_kr_business_day
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


def _validate(dataset: Dataset, pos: Position) -> None:
    """Everything that makes a position unrunnable, as a 422 rather than a
    stray KeyError from somewhere deeper."""
    if pos.direction not in (1, -1):
        raise BacktestError("direction must be +1 or -1")
    if pos.notional <= 0:
        raise BacktestError("notional must be positive")
    known = {sid for sid, _k, _l in derived_ids()} | set(dataset.series)
    if pos.series_id not in known:
        raise BacktestError(f"unknown instrument {pos.series_id!r}")
    for tenor, _sign in _legs_for(pos.series_id):
        if tenor not in TENOR_T:
            raise BacktestError(f"unknown tenor {tenor!r}")


def _maturity_of(entry: dt.date, tenor: str) -> dt.date:
    """When a swap struck on `entry` for `tenor` actually ends.

    Mirrors the ported `VanillaSwap.to_irs_trade`: spot is T+1 business days and
    the raw termination is that plus `round(years * 365)` calendar days. Derived
    rather than built, because this is asked once per leg per RUN while the
    trade object is built once per leg per DATE."""
    return next_kr_business_day(entry) + dt.timedelta(
        days=round(TENOR_T[tenor] * 365)
    )


def _span_of(dataset: Dataset, pos: Position) -> tuple[int, int, bool]:
    """(first index, last index, ended at maturity) for the position's real life.

    A SWAP ENDS AT ITS MATURITY, whatever exit was asked for. Without this a 9M
    entered in 2020 was reported as held to 2026 — six years of "position" for a
    trade that ceased to exist after nine months. The P&L was already frozen
    (there is nothing left to value), so the FIGURE was right and the story was
    wrong: the period read six years and the daily change read 0원 for five of
    them, which is what made the readout look broken.

    The cap lives HERE rather than inside `_run_one` because the book's window
    is built from these spans too — computing the window from the requested exit
    while capping separately let the period column say 만기 while the chart drew
    a flat line past it. The longest leg decides, since that is when the package
    is finally done.
    """
    # Validated HERE because this is the first thing to touch a position — the
    # book computes every span before it runs anything, so a bad instrument
    # would otherwise reach `TENOR_T` as a KeyError instead of a 422.
    _validate(dataset, pos)

    dates = dataset.dates
    entry_i = _index_on_or_after(dates, pos.entry)
    exit_i = _index_on_or_before(dates, pos.exit) if pos.exit else len(dates) - 1
    if exit_i <= entry_i:
        raise BacktestError(
            f"{pos.series_id}: the exit date must be after the entry date"
        )
    matures = max(
        _maturity_of(dates[entry_i], t) for t, _sign in _legs_for(pos.series_id)
    )
    # The last row the swap still exists on. Reported rather than re-derived by
    # the caller: a maturity landing on a non-trading day (3M struck 2020-06-30
    # matures 2020-09-30, a day the file has no row for) makes
    # `maturity <= exit_date` false even though the position DID mature, which
    # is exactly the shape the first version got wrong.
    # `_index_on_or_before` CLAMPS to the last row, so a 10Y struck in 2020 —
    # maturing in 2030, well past the data — would otherwise report as matured
    # on the final date. It has to still be inside the file to have happened.
    matured = matures <= dates[-1] and _index_on_or_before(dates, matures) <= exit_i
    if matured:
        exit_i = _index_on_or_before(dates, matures)
        if exit_i <= entry_i:
            raise BacktestError(
                f"{pos.series_id}: matures on {matures}, before it could be held"
            )
    return entry_i, exit_i, matured


def _curve_at(dataset: Dataset, i: int, cache: dict[int, np.ndarray] | None = None) -> np.ndarray:
    """The bootstrapped zero curve for the row at `i`.

    `cache` is per-RUN, not global: the curve depends on the dataset, and a
    module-level cache would survive a data refresh and serve yesterday's
    curve. Within one request the same date is valued once per position, so a
    three-position book was bootstrapping every date three times — measured
    0.7ms each, which is 0.8s of a 2.2s run spent recomputing the same array.
    """
    if cache is not None and i in cache:
        return cache[i]
    zc = bootstrap_zero_curve(par_rates_at_index(dataset, i))
    if cache is not None:
        cache[i] = zc
    return zc


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
    cache: dict[int, np.ndarray] | None = None,
) -> tuple[float, float]:
    """(clean NPV, accrued interest) of the position on the row at index `i`.

    Split rather than summed [OWNER, 2026-07-31] so the P&L can be reported as
    평가손익 + 캐리손익. Their sum is the dirty NPV, which is what the total is
    built from, so nothing about the headline number changes — only that it can
    now be read in two parts.
    """
    curve = CurveBundle(dataset.dates[i], _curve_at(dataset, i, cache), [])
    clean = 0.0
    accrued = 0.0
    for leg in legs:
        swap = VanillaSwap(
            # The FLOAT tenor, not a rounded integer. `VanillaSwap` annotates
            # this `int`, but the ported body's only use of it is
            # `round(tenor_years * 365)` to derive the maturity — so obeying the
            # annotation silently repriced every non-whole-year node: 1D, 3M, 6M
            # and 9M all became ONE-YEAR swaps (round(0.25) is 0, and `or 1`
            # finished the job) and 1.5Y became 2Y. Only integer-year tenors
            # were ever right.
            tenor_years=TENOR_T[leg.tenor],
            notional=leg.notional,
            fixed_rate=leg.entry_rate,
            pay_fixed=leg.sign > 0,
            trade_date=entry_date,
        )
        res = value_booked_trade(swap, curve, fixings)
        clean += res.clean_npv
        accrued += res.accrued_interest
    return clean, accrued


def _settled_to(
    legs: list[Leg],
    entry_date: dt.date,
    upto: dt.date,
    fixings: dict[dt.date, float],
) -> float:
    total = 0.0
    for leg in legs:
        swap = VanillaSwap(
            # The FLOAT tenor, not a rounded integer. `VanillaSwap` annotates
            # this `int`, but the ported body's only use of it is
            # `round(tenor_years * 365)` to derive the maturity — so obeying the
            # annotation silently repriced every non-whole-year node: 1D, 3M, 6M
            # and 9M all became ONE-YEAR swaps (round(0.25) is 0, and `or 1`
            # finished the job) and 1.5Y became 2Y. Only integer-year tenors
            # were ever right.
            tenor_years=TENOR_T[leg.tenor],
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
    dataset: Dataset,
    pos: Position,
    sample: list[int],
    cache: dict[int, np.ndarray] | None = None,
) -> tuple[dict, dict[int, float]]:
    """One position: its record, and its P&L at each sampled index.

    A position contributes NOTHING before its entry and stays FROZEN at its
    closing P&L after its exit. Both matter: a position that started paying
    before it was opened would be free money, and one that kept marking after
    it was closed is the classic way a backtest flatters itself.
    """
    dates = dataset.dates
    entry_i, exit_i, matured = _span_of(dataset, pos)  # validates, caps at maturity 
    legs = _build_legs(dataset, pos.series_id, pos.notional, entry_i)
    for leg in legs:
        leg.sign *= pos.direction

    entry_date = dates[entry_i]
    clean0, accrued0 = _value_on(
        legs, dataset, entry_i, entry_date, _cd_fixings(dataset, entry_i), cache
    )

    # Valued only on the sampled dates INSIDE its own life, plus its exit — so
    # the frozen tail is the real closing figure, not the last sample before it.
    live = sorted(
        {i for i in sample if entry_i <= i <= exit_i}
        | {exit_i}
        # Plus the business day BEFORE each published point, so the chart can
        # report a real ONE-DAY change even where the series is thinned. A
        # ten-year book publishes 400 of ~2,600 days, so the step between
        # neighbours is ~6 days; without these the readout could only say how
        # much moved between two dots, which is not what anyone means by "that
        # day". Costs one extra valuation per point — measured 0.6s -> 1.2s on
        # ten years, which is not a trade worth agonising over.
        | {i - 1 for i in sample if entry_i < i <= exit_i}
    )

    own: dict[int, float] = {}
    last = 0.0
    last_carry = 0.0
    last_val = 0.0
    last_cash = 0.0
    for i in live:
        fx = _cd_fixings(dataset, i)
        clean, accrued = _value_on(legs, dataset, i, entry_date, fx, cache)
        cash = _settled_to(legs, entry_date, dates[i], fx)
        # An exact split, not an attribution model:
        #   pnl = (dirty_t − dirty_0) + cash
        #       = (clean_t − clean_0) + (accrued_t − accrued_0 + cash)
        # so 평가손익 and 캐리손익 sum to the published figure by construction.
        val = clean - clean0
        carry = accrued - accrued0 + cash
        own[i] = last = val + carry
        last_val, last_carry, last_cash = val, carry, cash

    def at(i: int) -> float:
        if i < entry_i:
            return 0.0                 # not yet on
        if i > exit_i:
            return last                # closed: frozen, still counted
        return own[i]

    series = {i: at(i) for i in sample}
    # the same position one business day earlier, for the daily change
    prev_day = {i: at(i - 1) for i in sample if i - 1 >= 0}

    record = {
        "id": pos.series_id,
        "direction": pos.direction,
        "notional": pos.notional,
        "entry": entry_date.isoformat(),
        "exit": dates[exit_i].isoformat(),
        "closed": exit_i < len(dates) - 1,
        # 만기 and 청산 are different facts: one ran to the end of its own
        # schedule, the other was closed out early.
        "matured": matured,
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
        # The two halves of `pnl`, which they sum to exactly (§backtest).
        # 평가 = mark-to-market on the clean price: the rate move and the
        # roll-down. 캐리 = interest actually earned or paid, settled plus
        # still accruing.
        "valuation": round(last_val, 0),
        "carry": round(last_carry, 0),
        "cash": round(last_cash, 0),
    }
    return record, series, prev_day


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
    # the same span the book uses, maturity cap included — a trace that ran
    # past the swap's own end would disagree with the line drawn from it
    entry_i, exit_i, _matured = _span_of(dataset, pos)
    legs = _build_legs(dataset, pos.series_id, pos.notional, entry_i)
    for leg in legs:
        leg.sign *= pos.direction
    entry_date = dates[entry_i]
    clean0, accrued0 = _value_on(
        legs, dataset, entry_i, entry_date, _cd_fixings(dataset, entry_i)
    )

    out = []
    for i in _thin(list(range(entry_i, exit_i + 1)), MAX_POINTS):
        fx = _cd_fixings(dataset, i)
        clean, accrued = _value_on(legs, dataset, i, entry_date, fx)
        cash = _settled_to(legs, entry_date, dates[i], fx)
        val = clean - clean0
        carry = accrued - accrued0 + cash
        out.append(
            {
                "t": dates[i].isoformat(),
                "pnl": round(val + carry, 0),
                "valuation": round(val, 0),
                "carry": round(carry, 0),
                "npv": round(clean + accrued, 0),
                "cash": round(cash, 0),
            }
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
    # the union of the positions' ACTUAL lives, maturity cap included
    spans = [_span_of(dataset, p) for p in positions]
    first = min(a for a, _b, _m in spans)
    last = max(b for _a, b, _m in spans)
    sample = _thin(list(range(first, last + 1)), MAX_POINTS)

    # One curve per date for the whole run, shared by every position (see
    # `_curve_at`). Scoped to this call so a data refresh cannot be served a
    # stale curve.
    cache: dict[int, np.ndarray] = {}

    records = []
    series: list[dict[int, float]] = []
    prevs: list[dict[int, float]] = []
    for pos in positions:
        rec, own, prev_day = _run_one(dataset, pos, sample, cache)
        records.append(rec)
        series.append(own)
        prevs.append(prev_day)

    # The published line, with each point's CHANGE from the one before it.
    #
    # Computed here and not in the browser (§16). The rule is not ceremony:
    # `PreviewChart` carries the same note because differencing a rounded
    # series client-side gives a number that disagrees with the difference of
    # the two figures the reader can see.
    #
    # `d` is the step BETWEEN PUBLISHED POINTS, which is a day only while the
    # series is unthinned. `daily` says which — a ten-year book is ~2,600
    # business days thinned to 400, and calling a 6-day move "당일 변화" there
    # would be a plain lie.
    points = []
    for i in sample:
        total = round(sum(s[i] for s in series), 0)
        # `d` is the change over ONE BUSINESS DAY, always — the position is
        # valued on `i` and on `i-1` regardless of how far apart the published
        # points are. Differenced here rather than in the browser (§16):
        # subtracting a series that has already been rounded to the won gives a
        # figure that disagrees with the two the reader can see.
        d = (
            None
            if i == first
            else round(total - sum(pd.get(i, 0.0) for pd in prevs), 0)
        )
        points.append({"t": dates[i].isoformat(), "pnl": total, "d": d})

    pnls = [p["pnl"] for p in points]
    return {
        "positions": records,
        "from": dates[first].isoformat(),
        "to": dates[last].isoformat(),
        # Whether every business day is PUBLISHED. `d` is a one-day change
        # either way now; this only says whether the LINE is drawn at full
        # resolution, which the chart's own density depends on.
        "complete": len(sample) == last - first + 1,
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
