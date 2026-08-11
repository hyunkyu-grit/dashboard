# -*- coding: utf-8 -*-
"""V-PASS Phase V3 — forward-realization neutrality: the capstone (2026-08-03).

The market evolves EXACTLY along the forwards today's curve implies (each
date's curve is the T-implied forward curve for that horizon, and the CD
fixings realize the forward CD path, because the 3M row IS the fixing
store). A par swap entered at T and held to maturity on this path must end
at ~zero PnL: swap theta is priced so that forward realization is the
zero-PnL path, exactly as option theta offsets gamma at implied vol.

One assertion exercises the bootstrap, the forward projection, discounting,
fixing selection (F(R) = reset − 1 Seoul business day), accrual, the
maturity cap, and the 평가/캐리 decomposition at once — the deepest single
internal-consistency test this engine admits.

TOLERANCE — derived, not chosen to pass:
  NEUTRALITY_BUDGET_BP = 0.5bp of notional, made of
  (a) the accepted ≤0.25bp bootstrap residual priced on the annuity (the
      engine re-bootstraps MY par rows every date and must recover the
      intended forward curve through the same single-pass fit), and
  (b) the engine's stated no-reinvestment convention: PnL sums settled
      coupons UNDISCOUNTED, while par pricing sets their DISCOUNTED sum to
      zero. The gap is Σ (L_q − K)·accr·(1 − df) ≈ tenor-slope × rate ×
      horizon — ~0.1bp for a 1Y on this curve, growing with tenor², which
      is why the hold-to-maturity subject is the 1Y, not the 10Y.
  A breach is a finding to diagnose, not a bound to widen.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from app.backtest import Position, run_backtest, trace
from app.curves import par_rates_at_index
from app.dataset import load_dataset
from app.engine_port import bootstrap_zero_curve

from tests.synthetic import forward_realized_dataset

N = 10_000_000_000
NEUTRALITY_BUDGET_BP = 0.5

START = dt.date(2025, 8, 4)
DAYS = 280  # comfortably past the 1Y's maturity


@pytest.fixture(scope="module")
def realized():
    real = load_dataset(Path(__file__).resolve().parents[1].parent / "data" / "irsdata.xlsx")
    i = real.dates.index(START)
    zc = bootstrap_zero_curve(par_rates_at_index(real, i))
    return forward_realized_dataset(zc, START, DAYS)


def test_forward_realization_is_the_zero_pnl_path(realized):
    ds = realized
    pos = Position("1Y", +1, N, START)
    res = run_backtest(ds, [pos])
    p = res["positions"][0]

    # the swap must actually have LIVED and DIED on this fixture — a test on
    # a position that never matured would certify a different claim
    assert p["matured"] is True

    for k in ("pnl", "carry"):
        bp = abs(p[k]) / N * 1e4
        assert bp <= NEUTRALITY_BUDGET_BP, (k, p[k], bp)

    # [OWNER, 2026-08-11 — 3분해] the textbook statement this fixture was
    # built to isolate, now visible as FIELDS: roll-down is the unchanged-
    # curve assumption, so when the forwards DO realize, the market move
    # (평가) claws back exactly what the roll chain booked. Each half is
    # REAL (visibly nonzero) and their SUM collapses to the entry residual.
    assert abs(p["valuation"] + p["rolldown"]) / N * 1e4 <= NEUTRALITY_BUDGET_BP
    assert abs(p["rolldown"]) / N * 1e4 > NEUTRALITY_BUDGET_BP

    # 평가 and 캐리 offset into the same budget along the way too: no point
    # of the path may drift beyond the budget + the swap's own mid-life mark
    # (the remaining span's forward par converges to K only at the end, so
    # the PATH bound is looser — 4× — and exists to catch runaway drift, not
    # to restate the endpoint claim)
    for pt in trace(ds, pos):
        assert abs(pt["pnl"]) / N * 1e4 <= 4 * NEUTRALITY_BUDGET_BP, pt


def test_the_receiver_is_neutral_too(realized):
    """Neutrality must not be a sign accident: the mirror position on the
    same path lands inside the same budget."""
    res = run_backtest(ds := realized, [Position("1Y", -1, N, START)])
    p = res["positions"][0]
    assert p["matured"] is True
    for k in ("pnl", "carry"):
        assert abs(p[k]) / N * 1e4 <= NEUTRALITY_BUDGET_BP, (k, p[k])
    # mirror of the payer's 평가↔롤다운 offset (see that test's comment)
    assert abs(p["valuation"] + p["rolldown"]) / N * 1e4 <= NEUTRALITY_BUDGET_BP
    assert abs(p["rolldown"]) / N * 1e4 > NEUTRALITY_BUDGET_BP
