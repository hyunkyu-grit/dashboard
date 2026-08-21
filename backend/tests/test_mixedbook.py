# -*- coding: utf-8 -*-
"""혼합 북(현금채권 + 스왑)의 핀 [OWNER, 2026-08-21].

합성 데이터로 돈다 — 민평은 SQL 에만 있고 IRS 워크북은 배포마다 다르다
(`test_cashbond` 의 같은 근거). 여기서 재는 것은 **병합의 산술**이지 데이터의
가용성이 아니다: 두 엔진이 각자 옳다는 것은 저쪽 파일들이 이미 핀으로 박고
있으므로, 이 파일이 지는 명제는 셋뿐이다.

    1. 섞은 북의 손익 = 따로 돌린 둘의 합 (같은 날짜 위에서).
    2. 한 종류뿐인 북은 종전 엔진의 답 **그대로**다 — 통합이 기존 화면의
       숫자를 한 원도 바꾸면 안 된다.
    3. 대사표의 행은 가로로 닫히고, 두 KRD 격자는 섞이지 않는다.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app import cashbond as cb
from app import creditmatrix as cm
from app import funding as fd
from app import mixedbook as mb
from app.backtest import Position, run_backtest as swap_run_backtest
from app.engine_port import bootstrap_zero_curve

from tests.synthetic import frozen_dataset

N = 1e10  # 100억

#: 기울어진 par 커브 하나 — 합성 IRS 데이터셋의 씨앗.
_SEED_PAR = [
    (1.0 / 365.0, 0.0250), (91.0 / 365.0, 0.0255), (0.5, 0.0260), (0.75, 0.0265),
    (1.0, 0.0270), (1.5, 0.0278), (2.0, 0.0285), (3.0, 0.0295), (4.0, 0.0302),
    (5.0, 0.0308), (6.0, 0.0313), (7.0, 0.0317), (8.0, 0.0320), (9.0, 0.0323),
    (10.0, 0.0325),
]


@pytest.fixture(autouse=True)
def _seed_funding():
    """조달 계단을 직접 시드한다 — 신선도 게이트는 여기서 재는 것이 아니다
    (`test_cashbond._seed_base_series` 와 같은 이유·같은 수법)."""
    fd.reset_cache()
    fd._series_cache["base"] = [(dt.date(2020, 1, 1), 0.0250)]
    yield
    fd.reset_cache()


SPEC = fd.FundingSpec("base", 0.0)


def _dataset(n_days: int = 300, start: dt.date = dt.date(2024, 1, 2)):
    zc = bootstrap_zero_curve(_SEED_PAR)
    return frozen_dataset(zc, start, n_days)


def _matrix(dates: list[dt.date], rate_pct: float = 3.10) -> cm.CreditMatrix:
    """그 날짜들 위의 평평한 합성 민평. 종목군은 국고채 하나면 충분하다."""
    values: dict[tuple[str, str], list[float | None]] = {}
    for label in cm.TENOR_LABELS:
        values[("KTB", label)] = [rate_pct] * len(dates)
    return cm.CreditMatrix(
        dates=list(dates), values=values, watermark=("synthetic-mixed", len(dates))
    )


def _pos(sid: str, direction: int, entry: dt.date, exit: dt.date | None = None):
    return mb.MixedPosition(sid, direction, N, entry, exit)


# ── 1. 섞은 북 = 따로 돌린 둘의 합 ──────────────────────────────────────────


class TestAdditivity:
    """두 다리가 한 북에서 **더해진다**. 이것이 안 되면 나머지는 볼 것도 없다."""

    def test_a_mixed_book_totals_the_two_engines(self):
        ds = _dataset()
        m = _matrix(ds.dates)              # 달력이 완전히 겹치는 판
        entry = ds.dates[5]

        swap_only = mb.run_backtest(m, ds, [_pos("3Y", 1, entry)], SPEC)
        bond_only = mb.run_backtest(m, ds, [_pos("CB:KTB:3Y", 1, entry)], SPEC)
        both = mb.run_backtest(
            m, ds, [_pos("3Y", 1, entry), _pos("CB:KTB:3Y", 1, entry)], SPEC
        )

        assert both["pnl"] == pytest.approx(
            swap_only["pnl"] + bond_only["pnl"], abs=2.0
        )
        assert len(both["positions"]) == 2
        assert [p["kind"] for p in both["positions"]] == ["swap", "cashbond"]

    def test_the_line_adds_up_point_for_point(self):
        """점마다 더해진다 — 합계만 맞고 선이 어긋나면 차트가 거짓말한다."""
        ds = _dataset()
        m = _matrix(ds.dates)
        entry = ds.dates[5]

        a = mb.run_backtest(m, ds, [_pos("5Y", -1, entry)], SPEC)
        b = mb.run_backtest(m, ds, [_pos("CB:KTB:5Y", 1, entry)], SPEC)
        both = mb.run_backtest(
            m, ds, [_pos("5Y", -1, entry), _pos("CB:KTB:5Y", 1, entry)], SPEC
        )

        by_t = {p["t"]: p["pnl"] for p in both["points"]}
        pa = {p["t"]: p["pnl"] for p in a["points"]}
        pb = {p["t"]: p["pnl"] for p in b["points"]}
        common = set(pa) & set(pb) & set(by_t)
        assert len(common) > 100
        for t in common:
            assert by_t[t] == pytest.approx(pa[t] + pb[t], abs=2.0)

    def test_an_asset_swap_row_keeps_its_two_legs_in_a_mixed_book(self):
        """자산스왑은 한 줄에 두 다리다 — 혼합 북에서도 그 병합은
        `cashbond.run_bond_position` 한 군데서만 일어난다."""
        ds = _dataset()
        m = _matrix(ds.dates)
        entry = ds.dates[5]
        out = mb.run_backtest(
            m, ds, [_pos("ASW:KTB:3Y", 1, entry), _pos("10Y", 1, entry)], SPEC
        )
        asw = out["positions"][0]
        assert asw["kind"] == "assetswap"
        assert asw["swapPnl"] is not None
        assert out["positions"][1]["kind"] == "swap"


# ── 2. 한 종류뿐인 북은 종전 그대로 ─────────────────────────────────────────


class TestDelegation:
    """통합은 **기존 답을 바꾸지 않는다.** 스왑만 있는 북이 민평에 닿을 이유도 없다."""

    def test_a_swap_only_book_matches_the_irs_engine_to_the_won(self):
        ds = _dataset()
        entry = ds.dates[5]
        mine = mb.run_backtest(None, ds, [_pos("3Y-10Y", 1, entry)], SPEC)
        theirs = swap_run_backtest(ds, [Position("3Y-10Y", 1, N, entry)])
        assert mine["pnl"] == theirs["pnl"]
        assert [p["pnl"] for p in mine["points"]] == [p["pnl"] for p in theirs["points"]]

    def test_a_swap_only_book_never_touches_the_credit_matrix(self):
        """민평을 `None` 으로 줘도 돈다 — 그것이 위임의 증거다."""
        ds = _dataset()
        out = mb.run_backtest(None, ds, [_pos("10Y", 1, ds.dates[3])], SPEC)
        assert out["points"]

    def test_a_bond_only_book_matches_the_cash_bond_engine(self):
        ds = _dataset()
        m = _matrix(ds.dates)
        entry = ds.dates[5]
        mine = mb.run_backtest(m, ds, [_pos("CB:KTB:3Y", 1, entry)], SPEC)
        theirs = cb.run_backtest(
            m, ds, [cb.BondPosition("CB", "KTB", "3Y", 1, N, entry)], SPEC
        )
        assert mine["pnl"] == theirs["pnl"]
        assert [p["pnl"] for p in mine["points"]] == [p["pnl"] for p in theirs["points"]]

    def test_a_bond_row_without_a_matrix_says_so(self):
        ds = _dataset()
        with pytest.raises(mb.MixedBookError) as e:
            mb.run_backtest(None, ds, [_pos("CB:KTB:3Y", 1, ds.dates[5])], SPEC)
        assert "민평" in str(e.value)


# ── 3. 달력 ─────────────────────────────────────────────────────────────────


class TestCalendar:
    """민평 달력에 구멍이 뚫려도 지어내지 않는다."""

    def test_the_book_runs_on_the_intersection(self):
        ds = _dataset()
        holes = {ds.dates[40], ds.dates[41], ds.dates[90]}
        m = _matrix([d for d in ds.dates if d not in holes])
        out = mb.run_backtest(
            m, ds, [_pos("3Y", 1, ds.dates[5]), _pos("CB:KTB:3Y", 1, ds.dates[5])], SPEC
        )
        got = {p["t"] for p in out["points"]}
        assert not (got & {d.isoformat() for d in holes})
        assert out["calendar"]["dropped"] == 3

    def test_a_gap_day_measures_from_the_last_shared_close(self):
        """민평이 하루 빠진 다음 날의 `d` 는 **직전 공통일 대비**다 — 두 계열의
        서로 다른 밤을 더하지 않는다(모듈 주석의 `d` 절)."""
        ds = _dataset()
        hole = ds.dates[40]
        m = _matrix([d for d in ds.dates if d != hole])
        out = mb.run_backtest(
            m, ds, [_pos("3Y", 1, ds.dates[5]), _pos("CB:KTB:3Y", 1, ds.dates[5])], SPEC
        )
        pts = {p["t"]: p for p in out["points"]}
        after = ds.dates[41].isoformat()
        before = ds.dates[39].isoformat()
        assert after in pts and before in pts
        assert pts[after]["d"] == pytest.approx(
            pts[after]["pnl"] - pts[before]["pnl"], abs=2.0
        )

    def test_the_first_point_has_no_daily_change(self):
        ds = _dataset()
        m = _matrix(ds.dates)
        out = mb.run_backtest(
            m, ds, [_pos("3Y", 1, ds.dates[5]), _pos("CB:KTB:3Y", 1, ds.dates[5])], SPEC
        )
        assert out["points"][0]["d"] is None


# ── 4. 거절 ─────────────────────────────────────────────────────────────────


class TestRefusals:
    def test_a_bond_cannot_be_sold_even_beside_a_swap(self):
        """[OWNER, 2026-08-14 — "국고채는 매도는 없는거고"]. 스왑이 옆에 있다고
        규칙이 바뀌지 않는다."""
        ds = _dataset()
        m = _matrix(ds.dates)
        with pytest.raises(mb.MixedBookError) as e:
            mb.run_backtest(
                m, ds,
                [_pos("3Y", 1, ds.dates[5]), _pos("CB:KTB:3Y", -1, ds.dates[5])],
                SPEC,
            )
        assert "매수" in str(e.value)

    def test_an_empty_book_is_refused(self):
        with pytest.raises(mb.MixedBookError):
            mb.run_backtest(None, _dataset(), [], SPEC)

    def test_thirteen_rows_are_refused(self):
        ds = _dataset()
        book = [_pos("3Y", 1, ds.dates[5])] * 13
        with pytest.raises(mb.MixedBookError):
            mb.run_backtest(None, ds, book, SPEC)


# ── 5. 대사 ─────────────────────────────────────────────────────────────────


class TestRecon:
    def _recon(self):
        ds = _dataset(120)
        m = _matrix(ds.dates)
        book = [_pos("3Y", 1, ds.dates[5]), _pos("CB:KTB:3Y", 1, ds.dates[5])]
        return ds, m, mb.book_recon(m, ds, book, SPEC)

    def test_the_two_grids_do_not_mix(self):
        _ds, _m, r = self._recon()
        assert [g["label"] for g in r["groups"]] == ["스왑 KRD", "채권 KRD"]
        keys = r["tenors"]
        assert len(keys) == len(set(keys))          # 열쇠가 겹치지 않는다
        assert all(k.startswith(("S:", "B:")) for k in keys)
        flat = [c["key"] for g in r["groups"] for c in g["cols"]]
        assert flat == keys
        # 화면에 적히는 것은 테너뿐 — 어느 커브인지는 그룹 머리가 말한다
        assert all(":" not in c["label"] for g in r["groups"] for c in g["cols"])

    def test_every_row_closes_across(self):
        """평가 + 롤다운 + 캐리 + 개시 + 조달 = 그날 손익. 이 성질이 이 표의
        존재 이유다 — 읽는 사람이 암산으로 거짓말을 잡을 수 있어야 한다."""
        _ds, _m, r = self._recon()
        body = [x for x in r["rows"] if not x.get("carryover")]
        assert body
        for row in body:
            total = (
                row["valuation"] + row["rolldown"] + row["carry"]
                + (row["startup"] or 0) + (row["funding"] or 0)
            )
            assert total == pytest.approx(row["actual"], abs=2.0)

    def test_the_carryover_anchor_has_no_pnl(self):
        _ds, _m, r = self._recon()
        anchor = r["rows"][-1]
        assert anchor["carryover"] is True
        assert anchor["actual"] is None and anchor["estTotal"] is None
        assert any(v for v in anchor["krd"].values())

    def test_every_row_carries_both_grids(self):
        _ds, _m, r = self._recon()
        for row in r["rows"]:
            assert set(row["krd"]) == set(r["tenors"])

    def test_the_window_is_the_overlap_of_the_two_windows(self):
        """두 대사는 각자 **자기 달력의** 최근 250영업일을 싣고 온다 — 시작일이
        다르다(실측 2026-08-21: 스왑 2025-08-25 · 채권 2025-08-08). 그 밖의 행을
        «달력이 어긋나서» 뺐다고 세면 화면이 없는 병을 보고한다."""
        ds = _dataset(400)
        m = _matrix(ds.dates)
        # 진입을 아주 이르게 둬 양쪽 창이 다 잘리게 한다
        book = [_pos("3Y", 1, ds.dates[1]), _pos("CB:KTB:3Y", 1, ds.dates[1])]
        r = mb.book_recon(m, ds, book, SPEC)
        body = [x for x in r["rows"] if not x.get("carryover")]
        assert body
        # 달력이 완전히 겹치는 판이므로 뺄 날이 없다 — 창 밖은 뺀 게 아니다
        assert r["dropped"] == 0

    def test_calendar_gaps_cost_the_day_and_the_day_after(self):
        """한쪽만 쉰 날은 짝이 없고, **그 다음 날**은 두 계열이 다른 밤을 잰다."""
        ds = _dataset(200)
        hole = ds.dates[150]
        m = _matrix([d for d in ds.dates if d != hole])
        book = [_pos("3Y", 1, ds.dates[5]), _pos("CB:KTB:3Y", 1, ds.dates[5])]
        r = mb.book_recon(m, ds, book, SPEC)
        got = {x["t"] for x in r["rows"]}
        assert hole.isoformat() not in got
        assert ds.dates[151].isoformat() not in got
        assert r["dropped"] == 2

    def test_a_pure_book_keeps_the_old_shape(self):
        """한 종류뿐이면 그룹도 접두사도 없다 — 기존 화면이 그대로 읽는다."""
        ds = _dataset(120)
        r = mb.book_recon(None, ds, [_pos("3Y", 1, ds.dates[5])], SPEC)
        assert "groups" not in r
        assert all(":" not in k for k in r["tenors"])


# ── 6. 라우트 ───────────────────────────────────────────────────────────────


class TestRoutes:
    """`/api/backtest` 가 두 문법을 다 받는다. 창이 하나이므로 라우트도 하나다."""

    @pytest.fixture(scope="class")
    def client(self):
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as c:
            yield c

    def test_a_swap_book_still_answers(self, client):
        r = client.get("/api/backtest", params={"positions": "10Y,1,1e10,2025-01-02"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["positions"][0]["kind"] == "swap"
        # 스왑만 있는 북은 조달도 달력 각주도 없다 — 없는 개념을 적지 않는다.
        assert "funding" not in body
        assert "calendar" not in body

    def test_a_mixed_book_answers_with_both_rows(self, client):
        r = client.get(
            "/api/backtest",
            params={
                "positions": "10Y,1,1e10,2025-01-02;CB:KTB:3Y,1,1e10,2025-01-02",
                "basis": "call",
                "spreadBp": 0,
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert [p["kind"] for p in body["positions"]] == ["swap", "cashbond"]
        assert body["calendar"]["basis"] == "민평 ∩ IRS"
        assert body["funding"]["label"]
        # 대사는 두 격자다 — 같은 칸에 두 커브를 더하지 않는다.
        groups = body["recon"]["groups"]
        assert [g["label"] for g in groups] == ["스왑 KRD", "채권 KRD"]
        keys = body["recon"]["tenors"]
        assert len(keys) == len(set(keys))

    def test_selling_a_bond_is_refused_with_a_sentence(self, client):
        r = client.get(
            "/api/backtest",
            params={"positions": "10Y,1,1e10,2025-01-02;CB:KTB:3Y,-1,1e10,2025-01-02"},
        )
        assert r.status_code == 422
        assert "매수" in r.json()["detail"]

    def test_an_unknown_swap_id_still_says_so(self, client):
        r = client.get("/api/backtest", params={"positions": "42Y,1,1e10,2025-01-02"})
        assert r.status_code == 422
        assert "unknown instrument" in r.json()["detail"]
