# -*- coding: utf-8 -*-
"""V-PASS Phase V5 — edge cases and the closed [TBD] (2026-08-03).

Tolerances: degenerate positions assert at EXACT 0 KRW (nothing has accrued,
nothing has settled, the same close values both ends — there is no rounding
to forgive). The carry-sign economics assert signs, cross-checked in-test
against the average realized fixing, in BOTH directions.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from app.backtest import BacktestError, Position, run_backtest
from app.curves import TENOR_T
from app.dataset import load_dataset
from app.forwards import forward_history
from app.valuation_port import VanillaSwap, prev_seoul_business_day

N = 10_000_000_000


@pytest.fixture(scope="module")
def ds():
    return load_dataset(Path(__file__).resolve().parents[1].parent / "data" / "irsdata.xlsx")


# ── V5-1: a curve that cannot price the span is skipped, never served 0.0% ──

def test_unpriceable_dates_are_skipped_not_served_as_zero(ds):
    """The 3Mx3M early-2016 finding (Phase 0): dates whose 1D AND 3M are both
    blank bootstrap a curve whose first node is 6M; `df()` extrapolates flat
    to the left, so a forward STARTING at 3M collapsed to exactly 0.0% and
    was served as data. The membership rule is derived from the FILE, not
    from a hand-pinned date list: a date serves the 3M-start forward exactly
    when it carries at least one short node."""
    hist = forward_history(ds, "3Mx3M")
    assert all(p["v"] > 0 for p in hist), "a zero forward rate is not a rate"

    served = {p["t"] for p in hist}
    for i, d in enumerate(ds.dates):
        has_short = (
            ds.series["1D"][i] is not None or ds.series["3M"][i] is not None
        )
        assert (d.isoformat() in served) == has_short, (d, has_short)

    # the discriminating case: 6Mx3M STARTS at the shortest surviving node,
    # so the same blank dates remain fully priceable there — the skip is
    # span-specific, not a blanket date ban
    h6 = forward_history(ds, "6Mx3M")
    assert {p["t"] for p in h6} == {d.isoformat() for d in ds.dates}
    assert all(p["v"] > 0 for p in h6)


# ── V5-2: settlement on the entry date is a zero, not a 422 ─────────────────

def test_same_day_entry_and_exit_is_exactly_zero(ds):
    res = run_backtest(ds, [Position("10Y", +1, N, dt.date(2026, 7, 30), dt.date(2026, 7, 30))])
    p = res["positions"][0]
    assert p["pnl"] == 0.0
    assert p["valuation"] == 0.0
    assert p["carry"] == 0.0
    assert p["cash"] == 0.0
    assert res["pnl"] == 0.0
    assert len(res["points"]) == 1
    assert res["points"][0]["d"] is None
    # …while exit BEFORE entry stays refused
    with pytest.raises(BacktestError):
        run_backtest(ds, [Position("10Y", +1, N, dt.date(2026, 7, 30), dt.date(2026, 7, 29))])


# ── V5-3: non-business-day requests roll, and the record SAYS so ────────────

def test_request_dates_roll_conservatively_and_visibly(ds):
    """Entry rolls FORWARD to the first close on/after; exit rolls BACK to
    the last close on/before — deliberately NOT ModFol (docs/CONVENTIONS.md
    § Backtest request dates): both roll INTO the requested window, so a
    weekend request can never be charged a day it did not ask to hold. No
    silent shifting: the record reports the dates actually used."""
    res = run_backtest(ds, [
        # 2026-08-01 is a Saturday; 2026-07-26 is a Sunday
        Position("10Y", +1, N, dt.date(2026, 6, 1), dt.date(2026, 7, 26)),
        Position("10Y", +1, N, dt.date(2026, 8, 1), None),
    ])
    sunday_exit, saturday_entry = res["positions"]
    assert sunday_exit["exit"] == "2026-07-24"      # back to Friday
    assert saturday_entry["entry"] == "2026-08-03"  # forward to Monday
    # both reported dates are real closes
    closes = {d.isoformat() for d in ds.dates}
    assert sunday_exit["exit"] in closes and saturday_entry["entry"] in closes


# ── V5-4: settlement before the first accrual day → carry is EXACTLY 0 ─────

def test_exit_on_the_swap_start_date_has_zero_carry(ds):
    """The schedule accrues from the swap's START (entry + 1 business day).
    Exiting ON that start date means zero days accrued and nothing settled:
    carry must be EXACTLY 0 KRW and the PnL entirely clean-price (평가+롤다운
    — the one chained aging step of the 3분해 [OWNER, 2026-08-11])."""
    entry = dt.date(2026, 7, 29)
    start = dt.date(2026, 7, 30)  # next business day
    res = run_backtest(ds, [Position("10Y", +1, N, entry, start)])
    p = res["positions"][0]
    assert p["exit"] == start.isoformat()
    assert p["carry"] == 0.0
    assert p["cash"] == 0.0
    assert p["pnl"] == p["valuation"] + p["rolldown"]


# ── V5-5: carry sign, exercised in BOTH directions with the fixing average ──

def _avg_fixing(ds, tenor: str, entry: dt.date, exit: dt.date, strike_pct: float) -> float:
    """Average CD print at the position's own reset dates — the same clean-
    room fixing selection the V1 recomputation uses."""
    cd = {d: v for d, v in zip(ds.dates, ds.series["3M"]) if v is not None}

    def print_on_or_before(d: dt.date) -> float | None:
        best = None
        for dd, v in cd.items():
            if dd <= d and (best is None or dd > best[0]):
                best = (dd, v)
        return best[1] if best else None

    swap = VanillaSwap(tenor_years=TENOR_T[tenor], notional=N,
                       fixed_rate=strike_pct / 100.0, pay_fixed=True, trade_date=entry)
    irs = swap.to_irs_trade(exit)
    fixes = []
    for i, _pay in enumerate(irs.pay_dates):
        a_start = irs.pay_dates[i - 1] if i > 0 else irs.start_date
        if a_start >= exit:
            continue
        v = print_on_or_before(prev_seoul_business_day(a_start))
        if v is not None:
            fixes.append(v)
    return sum(fixes) / len(fixes)


@pytest.mark.parametrize(
    "entry,expected_sign",
    [
        (dt.date(2023, 1, 2), -1),  # struck at the 2023 top, CD stayed below
        (dt.date(2021, 6, 1), +1),  # struck near the 2021 floor, CD rose
    ],
)
def test_payer_carry_sign_matches_the_fixing_average(ds, entry, expected_sign):
    res = run_backtest(ds, [Position("1Y", +1, N, entry)])
    p = res["positions"][0]
    assert p["matured"] is True
    strike = p["legs"][0]["entryRate"]
    avg = _avg_fixing(ds, "1Y", dt.date.fromisoformat(p["entry"]),
                      dt.date.fromisoformat(p["exit"]), strike)
    # the economics and the engine must agree about WHICH side earned
    assert (avg - strike) * expected_sign > 0, (avg, strike)
    assert p["carry"] * expected_sign > 0, (p["carry"], expected_sign)
    # and the receiver is the mirror
    rec = run_backtest(ds, [Position("1Y", -1, N, entry)])["positions"][0]
    assert rec["carry"] * expected_sign < 0


# ── the dropdown finding: forward ids are refused by the engine ─────────────

def test_forward_positions_are_refused_with_a_readable_message(ds):
    """`_legs_for`/`_validate` have no forward-id handling, so every forward
    the sheet's dropdown used to offer 422'd at run time. The dropdown no
    longer offers them (BacktestSheet, same pass); proper forward-leg
    support is an owner decision recorded in DESIGN ## Provisional. This
    pins the CURRENT contract so the UI and the engine cannot silently
    disagree again."""
    with pytest.raises(BacktestError, match="unknown instrument"):
        run_backtest(ds, [Position("2Yx1Y", +1, N, dt.date(2025, 8, 4))])
