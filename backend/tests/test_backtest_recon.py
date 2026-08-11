# -*- coding: utf-8 -*-
"""일별 대사 블록 (`book_recon`) + 3분해 — [OWNER, 2026-08-11].

"3월 9일에 1Y Rec으로 진입한 게 PnL이 진짜 이게 맞냐" — the recon block is
the surface that answers that against the trading system: per business day,
the book's per-tenor KRD on that day's curve, the ACTUAL market Δbp, the
P&L-explain linear estimate (전일 KRD × 당일 Δbp), and the day's actual P&L
split 평가/캐리/롤다운.

세타 귀속은 **평가일 기준 포워드**다 [OWNER, 같은 날 — "금요일날 토일월의
캐리롤다운이 반영되어야 … 금요일에 값이 튀어야"]: 행 t 의 캐리·롤다운은
(t → 다음 영업일) 몫이고, 평가는 전일 대비다(_book_recon 모듈 주석).

What is pinned here:
  1. IDENTITY  — every row: actual == 평가 + 롤다운 + 캐리 (±2원 rounding),
     residual == 평가 − 추정합(선형화 잔차 — 세타는 추정의 설명 대상이 아니다).
  2. AGGREGATION — Σ평가 == record 평가; Σ캐리/Σ롤다운은 record 스칼라보다
     정확히 마지막 행의 포워드 세타(아직 열린 포지션의 "오늘 밤" 몫)만큼
     앞선다. 청산된 포지션이라면 그 몫이 0이라 정확히 일치한다.
  3. FRIDAY BOOKING — 주말을 건너는 행(다음 마크까지 3일)이 하루짜리 행의
     ~3배 캐리를 싣는다: "금요일에 튄다"는 요구사항 그 자체.
  4. LINEARIZATION — the estimate explains the 평가 (curve-move) bucket, not
     the total: |est − 평가| is the linearization residual and must be an
     order smaller than |평가| in aggregate.
  5. SCOPE — tenors beyond the book's longest maturity carry KRD 0 (the bump
     set is cut at the position's own horizon; a 1Y book must not show 10Y
     risk — the phantom-bucket defect class, 2026-08-11).
  6. FROZEN MARKET — on the frozen fixture every Δbp is 0, so est == 0 and
     `actual` is carry + roll-down alone with 평가 == 0: time, and nothing
     else. 진입일 행이 있고(평가 0, 첫날 밤 세타), 리시버의 캐리 부호가
     경제와 맞는다.
  7. START-OF-DAY KRD + 이월 앵커 [OWNER, 2026-08-11] — 행의 krd 는 est 가
     곱한 전일 KRD 그 자체라 블록 안에서 krd × dbp ≈ est 가 표시 라운딩
     안에서 닫히고, 진입일 krd 는 0(그날 아침엔 포지션이 없었다), 마지막
     행은 carryover 앵커(종가 KRD 만, 손익은 전부 None)다.
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


def pnl_rows(rc: dict) -> list[dict]:
    """손익이 실리는 행만 — 끝의 carryover 앵커(종가 KRD 만, 손익 None)를
    뺀다. 합산·항등식 단언은 전부 이 창 위에서 성립한다."""
    return [r for r in rc["rows"] if not r.get("carryover")]


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
    assert pnl_rows(rc), "recon produced no rows"
    for r in pnl_rows(rc):
        assert abs(r["actual"] - (r["valuation"] + r["rolldown"] + r["carry"])) <= 2, r["t"]
        assert r["residual"] == r["valuation"] - r["estTotal"]


def test_daily_rows_sum_to_the_record_scalars(one_y):
    book, rc = one_y
    assert rc["truncated"] is False  # a five-month book fits the window whole
    rec = book["positions"][0]
    rows = pnl_rows(rc)
    tol = len(rows)  # ±1원 per row of rounding
    last = rows[-1]  # 아직 열린 포지션: 마지막 행은 "오늘 밤" 포워드 세타
    assert abs(sum(r["valuation"] for r in rows) - rec["valuation"]) <= tol
    assert abs(
        sum(r["rolldown"] for r in rows) - last["rolldown"] - rec["rolldown"]
    ) <= tol
    assert abs(
        sum(r["carry"] for r in rows) - last["carry"] - rec["carry"]
    ) <= tol
    # 진입일 행이 있다: 평가 0(그날 par 로 struck), 세타는 booking 된다.
    # krd 도 0 이다 — 그날 아침엔 포지션이 없었다(기초 리스크의 참값).
    first = rows[0]
    assert first["t"] == rec["entry"]
    assert first["valuation"] == 0
    assert first["carry"] != 0 or first["rolldown"] != 0
    assert all(v == 0 for v in first["krd"].values())


def test_weekend_theta_books_on_friday(one_y):
    """주말을 건너는 행이 사흘치 캐리를 싣는다 — 관행의 정의 그 자체.
    캐리 일당은 픽싱 기간 안에서 상수이므로, 3일 스팬 행의 캐리는 1일 스팬
    행의 ~3배다(비교는 픽싱이 같은 인접 행끼리의 중앙값으로)."""
    import datetime as _dt
    import statistics as _st

    _book, rc = one_y
    rows = pnl_rows(rc)
    span = []
    for a, b in zip(rows, rows[1:]):
        gap = (_dt.date.fromisoformat(b["t"]) - _dt.date.fromisoformat(a["t"])).days
        span.append((gap, a["carry"]))
    one_day = [c for g, c in span if g == 1 and c != 0]
    week_end = [c for g, c in span if g == 3 and c != 0]
    assert one_day and week_end, "fixture lacks weekday/weekend rows"
    ratio = _st.median(week_end) / _st.median(one_day)
    assert 2.5 <= ratio <= 3.5, ratio
    # 그리고 하루짜리 행(월요일 포함)은 사흘치를 싣지 않는다
    assert max(abs(c) for _g, c in span if _g == 1) < 2 * abs(_st.median(week_end))


def test_estimate_explains_the_curve_move_bucket(one_y):
    _book, rc = one_y
    sum_est = sum(r["estTotal"] for r in pnl_rows(rc))
    sum_val = sum(r["valuation"] for r in pnl_rows(rc))
    # the aggregate linearization gap is small relative to the move itself
    assert abs(sum_est - sum_val) <= 0.15 * max(abs(sum_val), 1.0), (sum_est, sum_val)


def test_block_closes_in_row(one_y):
    """행의 krd 는 est 가 곱한 전일 KRD 그 자체다 [OWNER, 2026-08-11] — 한
    블록 안에서 −krd × dbp ≈ est 가 **표시 라운딩** 안에서 닫힌다(krd 는
    1원, dbp 는 0.01bp 로 반올림된 표시값이므로 그만큼의 슬랙만 허용)."""
    _book, rc = one_y
    checked = 0
    for r in pnl_rows(rc):
        for lb, e in r["est"].items():
            d = r["dbp"][lb]
            if d is None:
                continue
            slack = 0.5 * abs(d) + 0.005 * abs(r["krd"][lb]) + 1.0
            assert abs(e - (-r["krd"][lb] * d)) <= slack, (r["t"], lb)
            if e != 0:
                checked += 1
    assert checked > 0, "fixture had no nonzero estimates to check"


def test_carryover_anchor_carries_tomorrows_risk(one_y):
    """rows 의 마지막은 이월 앵커다: 마지막 날의 종가 KRD(다음 영업일 기준
    재평가 — 내일 아침 들고 갈 리스크)만 싣고, 손익 필드는 전부 None."""
    _book, rc = one_y
    anchor = rc["rows"][-1]
    assert anchor.get("carryover") is True
    assert sum(1 for r in rc["rows"] if r.get("carryover")) == 1
    last = pnl_rows(rc)[-1]
    assert anchor["t"] > last["t"]  # 다음 영업일 — P&L 창 밖
    assert any(v != 0 for v in anchor["krd"].values())  # 아직 열린 1Y 북
    for key in ("estTotal", "actual", "valuation", "rolldown", "carry", "residual"):
        assert anchor[key] is None, key
    assert anchor["dbp"] == {} and anchor["est"] == {}


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
    assert pnl_rows(rc)
    for r in pnl_rows(rc):
        for lb, v in r["dbp"].items():
            assert v is None or v == 0.0, (r["t"], lb, v)
        assert r["estTotal"] == 0
        assert abs(r["valuation"]) <= 1
        assert abs(r["actual"] - (r["rolldown"] + r["carry"])) <= 2
