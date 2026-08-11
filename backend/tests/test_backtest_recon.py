# -*- coding: utf-8 -*-
"""일별 대사 블록 (`book_recon`) + 3분해 — [OWNER, 2026-08-11].

"3월 9일에 1Y Rec으로 진입한 게 PnL이 진짜 이게 맞냐" — the recon block is
the surface that answers that against the trading system: per business day,
the book's per-tenor KRD on that day's curve, the ACTUAL market Δbp, the
P&L-explain linear estimate (전일 KRD × 당일 Δbp), and the day's actual P&L
split 평가/캐리/롤다운.

What is pinned here:
  1. IDENTITY  — every row: actual == 평가 + 롤다운 + 캐리 (±1원 rounding).
  2. AGGREGATION — the daily rows SUM to the position records' closing
     scalars (the two are computed on different grids by different loops, so
     agreement is a real check, not bookkeeping).
  3. PUBLISHED PARITY — recon `actual` equals the published points' one-day
     change `d` (same engine, same convention, independently assembled).
  4. LINEARIZATION — the estimate explains the 평가 (curve-move) bucket, not
     the total: |est − 평가| is the linearization residual and must be an
     order smaller than |평가| in aggregate. The est is NOT compared to
     `actual` — carry and roll-down are invisible to a KRD × Δbp product by
     construction (the sim recon doc records the same statement).
  5. SCOPE — tenors beyond the book's longest maturity carry KRD 0 (the bump
     set is cut at the position's own horizon; a 1Y book must not show 10Y
     risk — the phantom-bucket defect class, 2026-08-11).
  6. FROZEN MARKET — on the frozen fixture every Δbp is 0, so est == 0 and
     `actual` is carry + roll-down alone with 평가 == 0: time, and nothing
     else.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from app.backtest import Position, book_recon, run_backtest
from app.curves import TENOR_T, par_rates_at_index
from app.dataset import load_dataset
from app.engine_port import bootstrap_zero_curve

from tests.synthetic import frozen_dataset

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"
N = 1e10  # 100억


@pytest.fixture(scope="module")
def ds():
    return load_dataset(DATA)


@pytest.fixture(scope="module")
def one_y(ds):
    """The owner's own probe: 2026-03-09 1Y receiver, 100억."""
    pos = [Position("1Y", -1, N, dt.date(2026, 3, 9))]
    return run_backtest(ds, pos), book_recon(ds, pos)


def test_every_row_is_an_identity(one_y):
    _book, rc = one_y
    assert rc["rows"], "recon produced no rows"
    for r in rc["rows"]:
        assert abs(r["actual"] - (r["valuation"] + r["rolldown"] + r["carry"])) <= 1, r["t"]
        assert r["residual"] == r["actual"] - r["estTotal"]


def test_daily_rows_sum_to_the_record_scalars(one_y):
    book, rc = one_y
    assert rc["truncated"] is False  # a five-month book fits the window whole
    rec = book["positions"][0]
    tol = len(rc["rows"])  # ±1원 per row of rounding
    assert abs(sum(r["valuation"] for r in rc["rows"]) - rec["valuation"]) <= tol
    assert abs(sum(r["rolldown"] for r in rc["rows"]) - rec["rolldown"]) <= tol
    assert abs(sum(r["carry"] for r in rc["rows"]) - rec["carry"]) <= tol


def test_actual_matches_the_published_one_day_change(one_y):
    book, rc = one_y
    d_by_date = {p["t"]: p["d"] for p in book["points"] if p["d"] is not None}
    matched = 0
    for r in rc["rows"]:
        if r["t"] in d_by_date:
            assert abs(r["actual"] - d_by_date[r["t"]]) <= 1, r["t"]
            matched += 1
    assert matched >= len(rc["rows"]) - 1


def test_estimate_explains_the_curve_move_bucket(one_y):
    _book, rc = one_y
    sum_est = sum(r["estTotal"] for r in rc["rows"])
    sum_val = sum(r["valuation"] for r in rc["rows"])
    # the aggregate linearization gap is small relative to the move itself
    assert abs(sum_est - sum_val) <= 0.15 * max(abs(sum_val), 1.0), (sum_est, sum_val)


def test_tenors_beyond_the_books_horizon_carry_no_krd(one_y):
    _book, rc = one_y
    beyond = [lb for lb in rc["tenors"] if TENOR_T[lb] > 1.6]  # 1Y book + node gap
    assert beyond, "tenor list unexpectedly short"
    for r in rc["rows"]:
        for lb in beyond:
            assert r["krd"][lb] == 0, (r["t"], lb)


def test_frozen_market_recon_is_time_and_nothing_else():
    real = load_dataset(DATA)
    start = dt.date(2025, 8, 4)
    i = real.dates.index(start)
    zc = bootstrap_zero_curve(par_rates_at_index(real, i))
    ds = frozen_dataset(zc, start, 90)
    pos = [Position("10Y", +1, N, start)]
    rc = book_recon(ds, pos)
    assert rc["rows"]
    for r in rc["rows"]:
        for lb, v in r["dbp"].items():
            assert v is None or v == 0.0, (r["t"], lb, v)
        assert r["estTotal"] == 0
        assert abs(r["valuation"]) <= 1
        assert abs(r["actual"] - (r["rolldown"] + r["carry"])) <= 1
