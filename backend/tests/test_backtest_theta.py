# -*- coding: utf-8 -*-
"""V-PASS Phase V2 — frozen-curve replay: theta isolation (2026-08-03).

The market is held perfectly still (every tenor flat-lined, CD fixings
frozen with the 3M row), so everything the backtest reports is TIME:

    손익(frozen) = 캐리 + 롤다운, and nothing else.

WHERE ROLL-DOWN LIVES — encoded here on purpose: in this product's TWO-term
scheme, roll-down is part of 평가손익. 평가 is the change in clean NPV, and
on a frozen curve a swap ages toward a different par AND every remaining
flow discounts one day closer, so a NONZERO 평가 on a frozen curve is
CORRECT BEHAVIOUR, not reval noise (measured here: a 10Y payer's 평가
drifts −0.066bp of notional per CALENDAR day on the 2025-08-04 curve —
~−11.6bp over the half year — smooth and exactly calendar-proportional
across weekends and 추석). docs/STATE.md carries the same statement.

"Contains nothing else" is asserted two ways:
  1. SMOOTHNESS — on a frozen curve the valuation path is pure aging, so a
     step between neighbouring points may not exceed STEP_BUDGET_BP per
     CALENDAR day it spans (weekends age three days and must step three
     days' worth — a per-observation bound was the first draft's mistake
     and flagged every Monday). A disproportionate jump would be reval
     noise (a cache tear, a schedule discontinuity) hiding in the term.
  2. MAGNITUDE — at the one horizon where the aged swap lands back on the
     clean quarterly grid (elapsed ≈ 0.5y, remaining 9.5y — no stub, so the
     idealized par formula is exact in structure), 평가 must match the
     independently computed (par(9.5y) − K) × annuity(9.5y) × N MINUS the
     entry baseline clean₀ — 평가 is defined as clean_t − clean₀, so the
     prediction must subtract the same baseline (0.30bp of N even on the
     synthetic fixture: the accepted bootstrap/schedule residual) — within
     ROLL_BUDGET (measured gap: 0.347bp).

A methodological finding is recorded here rather than deleted: the first
draft predicted roll-down at EVERY date with a moving-stub quarterly grid,
and the prediction itself sawtoothed ±30bp across quarter boundaries while
the engine's path was smooth. The instrument was noisy, not the engine —
which is why the per-date check is a smoothness bound and the level check
sits on a stub-free horizon.

TOLERANCES:
  KRW_TOL = 1원 (identity). STEP_BUDGET_BP = 0.12bp of notional per CALENDAR
  day (measured steady drift 0.066, worst single day 0.088; ~1.4×
  headroom). ROLL_BUDGET_BP = 0.5bp of notional at the anchored horizon
  (accepted ≤0.25bp bootstrap residual priced on the annuity + the dated-
  schedule-vs-quarterly-grid idealization; measured 0.347). A breach is a
  finding to diagnose, not a bound to widen.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from app.backtest import (
    Position,
    _build_legs,
    _cd_fixings,
    _span_of,
    _value_on,
    trace,
)
from app.curves import TENOR_T, par_rates_at_index
from app.dataset import load_dataset
from app.engine_port import bootstrap_zero_curve, df, next_kr_business_day

from tests.synthetic import frozen_dataset

N = 10_000_000_000
KRW_TOL = 1.0
STEP_BUDGET_BP = 0.12   # bp of notional per CALENDAR day spanned by a step
ROLL_BUDGET_BP = 0.5    # bp of notional at the stub-free half-year horizon

START = dt.date(2025, 8, 4)
DAYS = 135  # a hair over half a year of business days


@pytest.fixture(scope="module")
def frozen():
    real = load_dataset(Path(__file__).resolve().parents[1].parent / "data" / "irsdata.xlsx")
    i = real.dates.index(START)
    zc = bootstrap_zero_curve(par_rates_at_index(real, i))
    return frozen_dataset(zc, START, DAYS), zc


def _grid_par_and_annuity(zc, t_years: float) -> tuple[float, float]:
    """Quarterly par + annuity at a GRID tenor (4·t integral) — no stub."""
    n = round(t_years * 4)
    assert abs(n - t_years * 4) < 1e-9, "grid tenors only; a stub would sawtooth"
    annuity = 0.25 * sum(df(0.25 * (k + 1), zc) for k in range(n))
    par = (1.0 - df(t_years, zc)) / annuity
    return par, annuity


def test_frozen_market_valuation_is_rolldown_and_nothing_else(frozen):
    ds, zc = frozen
    pos = Position("10Y", +1, N, START)
    path = trace(ds, pos)

    # identity at every point, and no step beyond the budget PER CALENDAR DAY
    # it spans — a weekend ages the swap three days and may step three days
    for a, b in zip(path, path[1:]):
        assert abs((b["valuation"] + b["carry"]) - b["pnl"]) <= KRW_TOL
        cal = (dt.date.fromisoformat(b["t"]) - dt.date.fromisoformat(a["t"])).days
        step_bp = abs(b["valuation"] - a["valuation"]) / N * 1e4
        assert step_bp <= STEP_BUDGET_BP * cal, (a["t"], b["t"], step_bp, cal)

    # magnitude at the stub-free horizon: elapsed 0.5y from the SCHEDULE's
    # accrual start (entry + 1bd), remaining exactly 9.5y on the grid
    accrual_from = next_kr_business_day(START)
    target = None
    for pt in path:
        elapsed = (dt.date.fromisoformat(pt["t"]) - accrual_from).days / 365.0
        if target is None or abs(elapsed - 0.5) < abs(target[1] - 0.5):
            target = (pt, elapsed)
    pt, elapsed = target
    assert abs(elapsed - 0.5) < 0.02, "fixture too short to reach the half-year grid point"

    strike = ds.series["10Y"][0] / 100.0
    par95, ann95 = _grid_par_and_annuity(zc, 9.5)
    # 평가 is clean_t − clean₀, so the prediction subtracts the SAME entry
    # baseline (the engine's own, ~0.30bp of N on this fixture — the accepted
    # bootstrap/schedule residual; a prediction from zero mis-books it)
    entry_i, _e, _m = _span_of(ds, pos)
    legs = _build_legs(ds, "10Y", N, entry_i)
    clean0, _acc0 = _value_on(legs, ds, entry_i, ds.dates[entry_i], _cd_fixings(ds, entry_i))
    predicted = (par95 - strike) * ann95 * N - clean0
    gap_bp = abs(pt["valuation"] - predicted) / N * 1e4
    assert gap_bp <= ROLL_BUDGET_BP, (pt["t"], pt["valuation"], predicted, gap_bp)

    # and roll-down is REAL here — the isolated term must be visibly nonzero,
    # or the bounds above certified an empty statement
    assert abs(path[-1]["valuation"]) / N * 1e4 > 0.5


def test_frozen_market_carry_is_the_frozen_spread_times_time(frozen):
    """With CD frozen, carry needs no schedule walk to predict: a payer
    accrues (CD − K) × elapsed FROM THE SWAP'S OWN START (entry + 1 business
    day — the first draft anchored at the entry date and sat exactly one
    day's carry off at every point). Tolerance: one day of carry, covering
    the dated-accrual-vs-continuous discretization."""
    ds, _zc = frozen
    pos = Position("10Y", +1, N, START)
    path = trace(ds, pos)
    k = ds.series["10Y"][0] / 100.0
    cd = ds.series["3M"][0] / 100.0
    accrual_from = next_kr_business_day(START)
    daily = abs(cd - k) * N / 365.0

    for pt in path:
        on = dt.date.fromisoformat(pt["t"])
        elapsed = max(0.0, (on - accrual_from).days) / 365.0
        pred = (cd - k) * N * elapsed
        assert abs(pt["carry"] - pred) <= max(daily, 2 * KRW_TOL), (
            pt["t"], pt["carry"], pred)

    # the sign is economics, not convention: K(10Y) > CD on this curve, so a
    # frozen payer BLEEDS carry — and the mirror receiver would collect it
    assert k > cd
    assert path[-1]["carry"] < 0
