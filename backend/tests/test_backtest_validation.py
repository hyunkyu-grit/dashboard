# -*- coding: utf-8 -*-
"""V-PASS validation set for the backtest PnL decomposition (2026-08-03).

Durable versions of the audits that first ran as one-off scripts, plus the
path-additivity sweep (Phase V1) that no entry/maturity check ever touched.

TOLERANCES, stated once and used by name:

  KRW_TOL = 1 KRW  — deterministic arithmetic (additivity, telescoping, cash
  partition, mirrors, linearity). These are identities up to independent
  float rounding; anything above 1 KRW is a real defect.

  Bootstrap-touching assertions use the ACCEPTED residual budget
  (docs/CONVENTIONS.md, owner-accepted): ≤0.25bp of RATE at quoted swap
  tenors. An NPV bound follows by pricing that rate residual at the leg's
  own annuity:  |clean NPV| ≤ RESID_BP × pv01(T) × notional × 1e-4.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from app.backtest import (
    Position,
    _build_legs,
    _cd_fixings,
    _settled_to,
    _span_of,
    _value_on,
    run_backtest,
    trace,
)
from app.curves import TENOR_T, par_rates_at_index
from app.dataset import load_dataset
from app.dv01 import pv01
from app.engine_port import bootstrap_zero_curve
from app.valuation_port import (
    VanillaSwap,
    prev_seoul_business_day,
    settled_cash_between,
)

KRW_TOL = 1.0          # KRW — identities up to independent rounding
RESID_BP = 0.25        # accepted bootstrap rate residual at quoted tenors

N = 10_000_000_000     # 100억


@pytest.fixture(scope="module")
def ds():
    return load_dataset(Path(__file__).resolve().parents[1].parent / "data" / "irsdata.xlsx")


# The reference book: every structural case the engine distinguishes —
# payer/receiver, matured, a rate-regime crossing, a DV01-neutral package,
# a three-leg package, and a window short enough to be DV01-like.
REFERENCE = [
    Position("10Y", +1, N, dt.date(2025, 8, 4)),
    Position("10Y", -1, N, dt.date(2025, 8, 4)),
    Position("1Y", +1, N, dt.date(2024, 1, 2)),                       # matured
    Position("1Y", +1, N, dt.date(2021, 6, 1)),                       # regime
    Position("3Y-10Y", +1, N, dt.date(2025, 8, 14), dt.date(2026, 7, 24)),
    Position("2Y-5Y-10Y", +1, N, dt.date(2025, 8, 4)),
    Position("10Y", +1, N, dt.date(2026, 7, 20), dt.date(2026, 7, 30)),
]


def _cash_window(legs, entry_date: dt.date, ws: dt.date, we: dt.date, fixings) -> float:
    """Settled cash of the ENTRY-STRUCK swaps with payment dates in (ws, we].

    NOT `_settled_to(legs, ws, …)` — that helper binds its second argument to
    the swap's trade_date, i.e. it would re-strike the schedule at ws and
    price a different swap. The first draft of this suite did exactly that
    and manufactured a 226,712 KRW "partition failure" out of its own
    harness; the engine's partition was exact all along. Kept as a named
    helper so the mistake is structural to repeat."""
    total = 0.0
    for leg in legs:
        swap = VanillaSwap(
            tenor_years=TENOR_T[leg.tenor],
            notional=leg.notional,
            fixed_rate=leg.entry_rate,
            pay_fixed=leg.sign > 0,
            trade_date=entry_date,
        )
        total += settled_cash_between(swap, fixings, ws, we)
    return total


def _sweep_points(ds, pos: Position, entry_i: int, exit_i: int) -> list[int]:
    """t1 candidates: an arbitrary mid-life day, a fixing date ±1, and a
    payment date ±1 — derived from the trade's OWN schedule, never
    hand-listed. All mapped to dataset indices strictly inside (entry, exit)."""
    dates = ds.dates
    legs = _build_legs(ds, pos.series_id, pos.notional, entry_i)
    swap = VanillaSwap(
        tenor_years=TENOR_T[legs[0].tenor],
        notional=legs[0].notional,
        fixed_rate=legs[0].entry_rate,
        pay_fixed=True,
        trade_date=dates[entry_i],
    )
    irs = swap.to_irs_trade(dates[exit_i])

    def idx_on_or_after(d: dt.date) -> int | None:
        lo, hi = 0, len(dates)
        while lo < hi:
            mid = (lo + hi) // 2
            if dates[mid] < d:
                lo = mid + 1
            else:
                hi = mid
        return lo if lo < len(dates) else None

    wanted: set[int] = {(entry_i + exit_i) // 2}
    inside = [p for p in irs.pay_dates if dates[entry_i] < p < dates[exit_i]]
    if inside:
        pay = inside[0]
        reset = irs.start_date if irs.pay_dates.index(pay) == 0 else irs.pay_dates[irs.pay_dates.index(pay) - 1]
        fix = prev_seoul_business_day(reset)
        for d in (pay, fix):
            j = idx_on_or_after(d)
            if j is not None:
                wanted |= {j - 1, j, j + 1}
    return sorted(i for i in wanted if entry_i < i < exit_i)


def test_pnl_and_both_components_telescope_across_midlife_splits(ds):
    """PnL[t0→t2] = PnL[t0→t1] + PnL[t1→t2], with 평가 and 캐리 telescoping
    INDEPENDENTLY — where the [t1→t2] leg is the SAME t0-struck swap measured
    from t1, i.e. the unwind-and-rebook a mid-life mark implies. The cash
    partition is the part that can actually break: a coupon paying near t1
    must land in exactly one sub-interval. Sweeping t1 across a payment date
    and a fixing date (±1 business day) is what exercises the (start, end]
    windowing of `settled_cash_between` on both edges.

    Tolerance: KRW_TOL per split point (independent float rounding)."""
    cache: dict[int, object] = {}
    checked_splits = 0
    for pos in REFERENCE:
        entry_i, exit_i, _m = _span_of(ds, pos)
        legs = _build_legs(ds, pos.series_id, pos.notional, entry_i)
        for leg in legs:
            leg.sign *= pos.direction
        dates = ds.dates
        entry_date = dates[entry_i]

        fx2 = _cd_fixings(ds, exit_i)
        clean2, acc2 = _value_on(legs, ds, exit_i, entry_date, fx2, cache)
        cash_02 = _settled_to(legs, entry_date, dates[exit_i], fx2)
        clean0, acc0 = _value_on(legs, ds, entry_i, entry_date, _cd_fixings(ds, entry_i), cache)

        for t1 in _sweep_points(ds, pos, entry_i, exit_i):
            fx1 = _cd_fixings(ds, t1)
            clean1, acc1 = _value_on(legs, ds, t1, entry_date, fx1, cache)
            cash_01 = _settled_to(legs, entry_date, dates[t1], fx1)
            cash_12 = _cash_window(legs, entry_date, dates[t1], dates[exit_i], fx2)

            # the cash partition — the double-count/drop detector
            assert abs(cash_02 - (cash_01 + cash_12)) <= KRW_TOL, (
                pos.series_id, dates[t1], cash_02, cash_01, cash_12)

            # 평가 telescopes
            val_02 = clean2 - clean0
            val_01 = clean1 - clean0
            val_12 = clean2 - clean1
            assert abs(val_02 - (val_01 + val_12)) <= KRW_TOL

            # 캐리 telescopes: carry over [t1,t2] measured FROM t1's accrual
            carry_02 = (acc2 - acc0) + cash_02
            carry_01 = (acc1 - acc0) + cash_01
            carry_12 = (acc2 - acc1) + cash_12
            assert abs(carry_02 - (carry_01 + carry_12)) <= KRW_TOL, (
                pos.series_id, dates[t1])

            # and the total
            assert abs((val_02 + carry_02) - ((val_01 + carry_01) + (val_12 + carry_12))) <= KRW_TOL
            checked_splits += 1
    assert checked_splits >= 7 * 3, "sweep produced too few split points to certify anything"


def test_payer_and_receiver_mirror_to_the_won(ds):
    """The exact mirror, all four figures — the durable version of the audit
    that ran as a script (measured sum: exactly 0 KRW on every figure)."""
    res = run_backtest(ds, [
        Position("10Y", +1, N, dt.date(2025, 8, 4)),
        Position("10Y", -1, N, dt.date(2025, 8, 4)),
    ])
    p, r = res["positions"]
    for k in ("pnl", "valuation", "carry", "cash"):
        assert abs(p[k] + r[k]) <= KRW_TOL, k
    assert abs(res["pnl"]) <= 2 * KRW_TOL  # two independently rounded figures


def test_notional_scales_linearly_to_the_won(ds):
    res = run_backtest(ds, [
        Position("10Y", +1, N, dt.date(2025, 8, 4)),
        Position("10Y", +1, 2 * N, dt.date(2025, 8, 4)),
    ])
    p, p2 = res["positions"]
    for k in ("pnl", "valuation", "carry", "cash"):
        # 2× the rounded single is within 2 KRW of the rounded double
        assert abs(p2[k] - 2 * p[k]) <= 2 * KRW_TOL, k


def test_entry_npv_is_within_the_bootstrap_budget_across_tenors(ds):
    """Struck at par means the entry NPV is bounded by the ACCEPTED bootstrap
    residual priced at the leg's own annuity — not by a loose absolute
    number. Interpolated tenors share the budget: their par input is a real
    column and enters the bootstrap as a node like any other."""
    entry = dt.date(2025, 8, 4)
    for tenor in ("1Y", "3Y", "10Y", "4Y", "7Y"):
        pos = Position(tenor, +1, N, entry)
        entry_i, _e, _m = _span_of(ds, pos)
        legs = _build_legs(ds, tenor, N, entry_i)
        clean0, acc0 = _value_on(legs, ds, entry_i, ds.dates[entry_i], _cd_fixings(ds, entry_i))
        zc = bootstrap_zero_curve(par_rates_at_index(ds, entry_i))
        budget = RESID_BP * pv01(zc, TENOR_T[tenor]) * N * 1e-4
        assert abs(clean0) <= budget, (tenor, clean0, budget)
        assert acc0 == 0.0  # nothing has accrued on the entry date


def test_held_to_maturity_the_pnl_is_the_carry(ds):
    """At maturity every flow has settled, so clean NPV is 0 and 평가 collapses
    to −clean₀ — the entry residual and nothing else. The bound is therefore
    the SAME bootstrap budget as the entry test, at the entry curve."""
    for pos in (Position("1Y", +1, N, dt.date(2024, 1, 2)),
                Position("1Y", +1, N, dt.date(2021, 6, 1))):
        entry_i, _e, matured = _span_of(ds, pos)
        assert matured
        zc = bootstrap_zero_curve(par_rates_at_index(ds, entry_i))
        budget = RESID_BP * pv01(zc, TENOR_T[pos.series_id]) * N * 1e-4
        last = trace(ds, pos)[-1]
        assert abs(last["valuation"]) <= budget, (pos.entry, last["valuation"], budget)
        assert abs(last["pnl"] - last["carry"]) <= budget + KRW_TOL


def test_carry_reproduced_by_independent_recomputation(ds):
    """The clean-room audit, made durable. Only the SCHEDULE DATES are taken
    from the trade object; fixing selection (F(R) = reset − 1 Seoul business
    day, latest print at or before), accrual composition, the current-period
    stub and every sign are recomputed here from the raw CD series. Measured
    0 KRW difference when first run; asserted at KRW_TOL."""
    cd_dates, cd_vals = ds.dates, ds.series["3M"]

    def cd_print_on_or_before(d: dt.date) -> float | None:
        lo, hi, idx = 0, len(cd_dates) - 1, None
        while lo <= hi:
            mid = (lo + hi) // 2
            if cd_dates[mid] <= d:
                idx = mid
                lo = mid + 1
            else:
                hi = mid - 1
        while idx is not None and idx >= 0:
            if cd_vals[idx] is not None:
                return cd_vals[idx] / 100.0
            idx -= 1
        return None

    for pos in (Position("10Y", +1, N, dt.date(2025, 8, 4)),
                Position("1Y", +1, N, dt.date(2024, 1, 2)),
                Position("1Y", +1, N, dt.date(2021, 6, 1))):
        entry_i, exit_i, _m = _span_of(ds, pos)
        entry_date, val_date = ds.dates[entry_i], ds.dates[exit_i]
        legs = _build_legs(ds, pos.series_id, pos.notional, entry_i)
        for leg in legs:
            leg.sign *= pos.direction

        mine = 0.0
        for leg in legs:
            swap = VanillaSwap(tenor_years=TENOR_T[leg.tenor], notional=leg.notional,
                               fixed_rate=leg.entry_rate, pay_fixed=leg.sign > 0,
                               trade_date=entry_date)
            irs = swap.to_irs_trade(val_date)
            direction = -1 if leg.sign > 0 else 1
            for i, pay in enumerate(irs.pay_dates):
                a_start = irs.pay_dates[i - 1] if i > 0 else irs.start_date
                accr = irs.accruals[i]
                fixing = cd_print_on_or_before(prev_seoul_business_day(a_start))
                if fixing is None:
                    continue
                if pay <= val_date:
                    mine += direction * (leg.entry_rate - fixing) * leg.notional * accr
                elif a_start < val_date:
                    frac = (val_date - a_start).days / (pay - a_start).days
                    mine += direction * (leg.entry_rate - fixing) * leg.notional * accr * frac

        engine = trace(ds, pos)[-1]["carry"]
        assert abs(mine - engine) <= KRW_TOL, (pos.series_id, pos.entry, mine, engine)
