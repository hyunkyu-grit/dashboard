# -*- coding: utf-8 -*-
"""V-PASS Phase V4 — historical magnitude cross-check (2026-08-03).

Real windows, real moves: 평가 / DV01_avg must reproduce the realized Δy,
and the residual must BEHAVE like convexity/shape — shrinking as the window
shrinks — never like a bias.

THE BOUND IS SELF-CALIBRATING, not hand-tuned:

    |implied − realized| ≤ theta_rate × calendar_days + 10%·|Δy| + 0.3bp

where theta_rate = (K − 1D)bp / 365 / dv01(T) is the DETERMINISTIC clean-
value drift the frozen-curve replay (Phase V2) measured: a swap's clean NPV
rolls at roughly the strike-minus-funding spread even when nothing moves,
and a DV01×Δy model books none of it. Computed from the entry row itself,
so the bound tightens and loosens with the curve that actually was.

VALIDITY DOMAIN, encoded not assumed: the arithmetic-mean-DV01 estimator is
only meaningful while the position's aging is small against its tenor
(elapsed/T ≤ 0.25 here). A 1Y held for a year has ROLLED OFF — its 평가
pins to the entry residual while the 1Y QUOTE moved −73.75bp, because the
quote tracks a constant-maturity index and the position ages. That
decoupling is asserted as CORRECT below, not excluded as inconvenient.

Measured at pinning time (2026-08-03 data):
  10Y 1w   Δy  −6.75bp   implied  −6.90bp   resid 0.148bp
  10Y 3m   Δy +25.50bp   implied +24.73bp   resid 0.774bp
  10Y 12m  Δy +146.50bp  implied +133.53bp  resid 12.97bp (rolldown+convexity)
  1Y  10d  Δy  +1.00bp   implied  −0.79bp   resid 1.79bp (≈ pure theta drift)
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from app.backtest import Position, _build_legs, _cd_fixings, _span_of, _value_on
from app.curves import TENOR_T, par_rates_at_index
from app.dataset import load_dataset
from app.dv01 import pv01
from app.engine_port import bootstrap_zero_curve

N = 10_000_000_000


@pytest.fixture(scope="module")
def ds():
    return load_dataset(Path(__file__).resolve().parents[1].parent / "data" / "irsdata.xlsx")


def _window(ds, tenor: str, entry: dt.date, exit: dt.date):
    """(implied Δy from 평가/DV01_avg, realized Δy, residual KRW, cal days,
    theta_rate bp/day) — the engine's own primitives, one valuation each end."""
    pos = Position(tenor, +1, N, entry, exit)
    ei, xi, _m = _span_of(ds, pos)
    legs = _build_legs(ds, tenor, N, ei)
    c0, _a0 = _value_on(legs, ds, ei, ds.dates[ei], _cd_fixings(ds, ei))
    ct, _at = _value_on(legs, ds, xi, ds.dates[ei], _cd_fixings(ds, xi))
    val = ct - c0

    dy = (ds.series[tenor][xi] - ds.series[tenor][ei]) * 100  # bp
    elapsed_y = (ds.dates[xi] - ds.dates[ei]).days / 365.0
    zc0 = bootstrap_zero_curve(par_rates_at_index(ds, ei))
    zc1 = bootstrap_zero_curve(par_rates_at_index(ds, xi))
    dv0 = pv01(zc0, TENOR_T[tenor])
    dv_avg = (dv0 + pv01(zc1, max(TENOR_T[tenor] - elapsed_y, 0.05))) / 2

    implied = val / (N * 1e-4 * dv_avg)
    resid_krw = abs(val - N * 1e-4 * dv_avg * dy)

    k = ds.series[tenor][ei]
    short = ds.series["1D"][ei]
    # (K − funding) in bp — series are in percent, implied/realized in bp
    theta_rate = abs(k - short) * 100.0 / 365.0 / dv0 if short is not None else 0.0
    cal = (ds.dates[xi] - ds.dates[ei]).days
    return implied, dy, resid_krw, cal, theta_rate


# windows chosen per tenor bucket: short/small, medium, long/large — all
# inside the estimator's validity domain elapsed/T ≤ 0.25
WINDOWS = [
    ("10Y", dt.date(2026, 7, 20), dt.date(2026, 7, 30)),   # short, small move
    ("10Y", dt.date(2026, 7, 27), dt.date(2026, 8, 3)),    # 1 week
    ("10Y", dt.date(2026, 5, 4), dt.date(2026, 8, 3)),     # 3 months
    ("10Y", dt.date(2025, 8, 4), dt.date(2026, 8, 3)),     # 1 year, +146.5bp
    ("1Y", dt.date(2026, 7, 20), dt.date(2026, 7, 30)),    # short end, short
    ("1Y", dt.date(2026, 5, 4), dt.date(2026, 8, 3)),      # short end, medium
]


def test_valuation_over_dv01_reproduces_the_realized_move(ds):
    for tenor, entry, exit in WINDOWS:
        implied, dy, _r, cal, theta = _window(ds, tenor, entry, exit)
        elapsed_frac = cal / 365.0 / TENOR_T[tenor]
        assert elapsed_frac <= 0.25, "window outside the estimator's stated domain"
        bound = theta * cal + 0.10 * abs(dy) + 0.3
        assert abs(implied - dy) <= bound, (
            tenor, entry, exit, implied, dy, bound)


def test_the_residual_shrinks_with_the_window(ds):
    """Nested 10Y windows sharing one exit: the KRW residual must fall
    strictly as the window shrinks. A residual that held constant while the
    window collapsed would be a bias — the defect signal this phase exists
    to rule out. Measured: 1.21M < 6.32M < 106.0M KRW."""
    exit = dt.date(2026, 8, 3)
    r_1w = _window(ds, "10Y", dt.date(2026, 7, 27), exit)[2]
    r_3m = _window(ds, "10Y", dt.date(2026, 5, 4), exit)[2]
    r_12m = _window(ds, "10Y", dt.date(2025, 8, 4), exit)[2]
    assert r_1w < r_3m < r_12m, (r_1w, r_3m, r_12m)
    # and the shrink is real, not marginal: an order of magnitude across the
    # nest, which convexity/shape gives and a constant bias cannot
    assert r_1w < r_12m / 10


def test_an_aged_out_position_decouples_from_the_quote_by_design(ds):
    """A 1Y held ~a year is DONE regardless of where the 1Y quote went: 평가
    pins to the entry residual while the constant-maturity quote moved
    −73.75bp. The quote tracks an index; the position ages. This is the
    boundary of the DV01 reproduction claim, asserted as correct rather
    than silently excluded."""
    pos = Position("1Y", +1, N, dt.date(2024, 1, 2), dt.date(2024, 12, 30))
    ei, xi, _m = _span_of(ds, pos)
    legs = _build_legs(ds, "1Y", N, ei)
    c0, _ = _value_on(legs, ds, ei, ds.dates[ei], _cd_fixings(ds, ei))
    ct, _ = _value_on(legs, ds, xi, ds.dates[ei], _cd_fixings(ds, xi))
    dy = (ds.series["1Y"][xi] - ds.series["1Y"][ei]) * 100
    assert abs(dy) > 50  # the quote genuinely moved a lot
    # …while the aged position's 평가 is bounded by ~its remaining stub, not
    # by the quote's move: under 0.5bp of notional against a 73.75bp move
    assert abs(ct - c0) / N * 1e4 < 0.5
