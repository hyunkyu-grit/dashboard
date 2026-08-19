# -*- coding: utf-8 -*-
"""RV Analysis 의 핀 (rv2).

## 앵커 — Appendix B 8행의 상주 재현 [세션 규칙]

REPORT_rv1 의 기계 검증을 그대로 상주시킨다: 특은채(=KDB, 벤더 열 이름으로
확정) 2026-08-13 커브, H=6M, 조달 = 정책금리 2.75% + 인상 08-27·11-26(+25bp),
시작일 2026-08-14. **상수를 전부 테스트 안에 내장**하므로 funding 게이트·SQL
과 무관하게 돈다 — 살아 있는 funding 모듈은 안 부른다.

허용오차는 rv1 실측 잔차 그대로: carry ≤0.02bp · roll ≤0.4bp · BEP ≤2.8bp ·
스왑점 3Y→9M = +13.0bp(±0.15, 스프레드시트 기대 13.2 와의 0.2bp 는 원본 일수
규약 차이 — rv1 UV-C, 순위·껍질 구성 일치로 종결).
"""

from __future__ import annotations

import datetime as dt

import pytest

from app import creditmatrix as cm
from app import rv

# Appendix B 의 기준 커브(2026-08-13 KDB 민평 — 스프레드시트와 소수 셋째 자리
# 일치가 rv1 C7 의 세 번째 증거였다)와 기대값.
SHEET = {"3M": 3.007, "6M": 3.279, "9M": 3.612, "1Y": 3.619,
         "1.5Y": 3.781, "2Y": 3.842, "2.5Y": 3.911, "3Y": 4.007}
EXPECT = {  # (total, carry, roll, BEP)
    "3M": (1.07, 1.07, 0.0, None), "6M": (9.48, 9.48, 0.0, None),
    "9M": (40.91, 26.26, 14.64, 169.0), "1Y": (43.49, 26.62, 16.88, 88.8),
    "1.5Y": (50.62, 34.78, 15.84, 51.8), "2Y": (46.77, 37.86, 8.91, 32.2),
    "2.5Y": (54.50, 41.34, 13.17, 28.4), "3Y": (68.97, 46.17, 22.79, 29.1),
}
START = dt.date(2026, 8, 14)
BASE = 0.0275
MEETINGS = [(dt.date(2026, 8, 27), 25.0), (dt.date(2026, 11, 26), 25.0)]
POINTS = [(cm.TENOR_YEARS[k], v / 100.0) for k, v in SHEET.items()]


def anchor_candidates() -> dict[str, dict]:
    out = {}
    for k in SHEET:
        c = rv.candidate(POINTS, k, START, BASE, MEETINGS)
        c["sector"] = "SHEET"
        out[k] = c
    return out


class TestAnchor:
    def test_funding_inversion(self):
        """조달 3.091% 역산 — 6M 후보의 유효기간 조달이 오차 0.01bp 안."""
        c6 = rv.candidate(POINTS, "6M", START, BASE, MEETINGS)
        assert c6["f"] * 100 == pytest.approx(3.091, abs=1e-3)
        # 3M 후보는 11-26 회의가 유효기간 밖 — 조달 2.964% 까지 재현(rv1).
        c3 = rv.candidate(POINTS, "3M", START, BASE, MEETINGS)
        assert c3["f"] * 100 == pytest.approx(2.964, abs=1e-2)

    @pytest.mark.parametrize("tenor", list(SHEET))
    def test_eight_rows(self, tenor):
        c = anchor_candidates()[tenor]
        t_exp, c_exp, r_exp, bep_exp = EXPECT[tenor]
        assert c["carry"] * 1e4 == pytest.approx(c_exp, abs=0.02)
        assert c["roll"](0.0) * 1e4 == pytest.approx(r_exp, abs=0.4)
        assert rv.tr(c) * 1e4 == pytest.approx(t_exp, abs=0.4)
        if bep_exp is None:
            assert c["dur"] == 0.0  # 만기 보유 — BEP 없음
        else:
            assert rv.tr(c) / c["dur"] * 1e4 == pytest.approx(bep_exp, abs=2.8)

    def test_swap_point_3y_to_9m(self):
        cands = list(anchor_candidates().values())
        hull = rv.upper_hull(cands)
        bps = {(a["label"], b["label"]): dy for a, b, dy in rv.breakpoints(hull)}
        assert ("3Y", "9M") in bps
        assert bps[("3Y", "9M")] == pytest.approx(13.0, abs=0.15)

    def test_hull_vs_window_winners_are_different_sets(self):
        """rv1 PN-2 의 핀: 6M(D=0)은 **껍질에는 있으나** 창 안 승자가 아니다
        (9M→6M 스왑점 +128bp). 화면이 두 낱말을 섞으면 이 차이가 사용자 질문으로
        돌아온다 — 페이로드가 딴 이름으로 싣는 근거."""
        cands = list(anchor_candidates().values())
        hull_labels = {c["label"] for c in rv.upper_hull(cands)}
        win = rv.winners_in_window(cands)
        win_labels = {k[1] for k in win}
        assert "6M" in hull_labels
        assert "6M" not in win_labels
        assert win_labels == {"3Y", "9M"}
        bps = {(a["label"], b["label"]): dy
               for a, b, dy in rv.breakpoints(rv.upper_hull(cands))}
        assert bps[("9M", "6M")] > rv.WINDOW_BP  # +128bp — 창 밖


class TestHullMechanics:
    def test_high_duration_edge_stays_on_the_hull(self):
        """오른쪽 가장자리 유지 — TR 이 낮아도 랠리에서 이긴다. 지배 필터를
        걸면 KTB 30Y 같은 승자를 잘못 지운다(rv1 실측의 합성판)."""
        mk = lambda lab, dur, t: {  # noqa: E731
            "label": lab, "dur": dur, "carry": t, "roll": (lambda dy: 0.0),
            "sector": "S", "years": dur,
        }
        low = mk("A", 1.0, 0.0100)
        high = mk("B", 10.0, 0.0010)  # TR 은 낮지만 듀레이션이 크다
        hull = rv.upper_hull([low, high])
        assert {c["label"] for c in hull} == {"A", "B"}

    def test_decision_numbers_are_swap_points_not_the_integer_grid(self):
        """1bp 격자는 껍질 멤버를 건너뛴다(rv1: KDB 10Y 의 구간 +5.2~+5.7bp 는
        정수 bp 를 하나도 안 품는다). 결정 숫자는 스왑점이어야 한다 — 합성으로
        재현: 승리 구간이 정수 사이(0.3~0.7bp)에만 있는 중간 후보."""
        flat_roll = lambda slope: (lambda dy: -slope * dy)  # noqa: E731
        a = {"label": "L", "dur": 10.0, "carry": 10.0e-4, "roll": flat_roll(10.0),
             "sector": "S", "years": 10.0}
        b = {"label": "M", "dur": 6.0, "carry": 8.2e-4, "roll": flat_roll(6.0),
             "sector": "S", "years": 6.0}
        c = {"label": "S", "dur": 2.0, "carry": 6.0e-4, "roll": flat_roll(2.0),
             "sector": "S", "years": 2.0}
        hull = rv.upper_hull([a, b, c])
        assert {x["label"] for x in hull} == {"L", "M", "S"}
        bps = rv.breakpoints(hull)
        (a1, b1, dy1), (a2, b2, dy2) = bps
        # 승리 구간 [0.45, 0.55]bp — 정수 격자에는 안 보인다
        assert 0 < dy1 < dy2 < 1
        win = rv.winners_in_window([a, b, c])
        assert ("S", "M") not in win  # 격자가 건너뛴 멤버
        # 그래도 껍질·스왑점 목록에는 있다 — 그것이 결정 숫자인 이유
        assert b1["label"] == "M" and a2["label"] == "M"

    def test_refine_breakpoint_agrees_with_linear_within_a_bp_on_the_anchor(self):
        """C12: 재가격 경계는 선형화 경계에서 ±1bp 안. 앵커 커브로 확인."""
        cands = list(anchor_candidates().values())
        hull = rv.upper_hull(cands)
        for a, b, dy_lin in rv.breakpoints(hull):
            if not -rv.WINDOW_BP <= dy_lin <= rv.WINDOW_BP:
                continue
            dy = rv.refine_breakpoint(a, b, dy_lin)
            assert abs(dy - dy_lin) <= 1.0
            # 다듬은 점에서 두 후보의 재가격 TR 이 실제로 같다
            d = dy / 1e4
            assert rv.tr(a, d) == pytest.approx(rv.tr(b, d), abs=1e-7)


class TestSpreadStats:
    def test_rank_pct_is_a_rank_not_a_minmax_position(self):
        # 기존 pct(min-max 위치)와 다른 통계 — 극단값 하나가 자리를 못 누른다.
        s = [0.0, 1.0, 2.0, 3.0, 100.0]
        assert rv.rank_pct(s, 3.0) == pytest.approx(80.0)
        # min-max 위치라면 3%였을 것이다
        assert (3.0 - 0.0) / 100.0 * 100 == pytest.approx(3.0)

    def test_z_score_needs_two_observations(self):
        assert rv.z_score([1.0], 1.0) is None
        assert rv.z_score([1.0, 3.0], 3.0) == pytest.approx(0.7071, abs=1e-3)

    def test_meetings_parse_roundtrip_and_refusal(self):
        got = rv.parse_meetings("2026-08-27:-25;2026-11-26:0")
        assert got == [(dt.date(2026, 8, 27), -25.0), (dt.date(2026, 11, 26), 0.0)]
        with pytest.raises(ValueError):
            rv.parse_meetings("언제:-25")


class TestCoverageHistory:
    """절대축의 점수 입력 = Coverage 의 자기 이력 백분위 [OWNER 2026-08-19 —
    "크레딧 리스크 미반영, 회사채 단기물 독식" 타개책]. 핵심 성질은 **레벨
    불변**: 스프레드가 두 배로 넓은(=위험한) 계열이라고 백분위가 올라가면
    수리가 아니라 병의 재배치다."""

    def _noisy(self, base: float, n: int = 400) -> list[float | None]:
        # 결정적 톱니 — 63일 간격 변화가 ±1 로 진동해 σ 가 서는 계열.
        return [base + (i % 2) for i in range(n)]

    def test_scale_invariance_kills_the_level_channel(self):
        a = self._noisy(10.0)
        b = [None if v is None else v * 5.0 for v in a]  # 다섯 배 넓은 섹터
        pa = rv.coverage_hist_series(a)
        pb = rv.coverage_hist_series(b)
        wa = rv.window_vals(pa, "52w")
        wb = rv.window_vals(pb, "52w")
        assert pa[-1] is not None and pb[-1] is not None
        assert rv.mid_rank_pct(wa, pa[-1]) == pytest.approx(
            rv.mid_rank_pct(wb, pb[-1]), abs=1e-9
        )

    def test_warmup_is_none_not_a_number(self):
        p = rv.coverage_hist_series(self._noisy(10.0))
        # 63일 변화 + 최소 26관측 전에는 σ 가 없다 — 지어내지 않는다.
        assert all(v is None for v in p[: 63 + 25])
        assert p[-1] is not None

    def test_mid_rank_pct_ties_are_halved(self):
        # 상수 계열이 100%("늘 후하다")로 읽히면 안 된다 — midrank 는 50.
        assert rv.mid_rank_pct([3.0, 3.0, 3.0, 3.0], 3.0) == pytest.approx(50.0)
        assert rv.mid_rank_pct([1.0, 2.0, 3.0, 4.0], 4.0) == pytest.approx(87.5)
        # 기존 rank_pct 와 다른 통계임을 못박는다(≤-셈은 상수에서 100).
        assert rv.rank_pct([3.0, 3.0], 3.0) == pytest.approx(100.0)


class TestShortableGate:
    def test_five_year_is_not_shortable(self):
        """[OWNER] 숏 가능 만기 = {1, 1.5, 2, 3(IRS·선물), 10(선물)} — 5년 숏 불가."""
        assert 5.0 not in rv.SHORTABLE
        assert set(rv.SHORTABLE) == {1.0, 1.5, 2.0, 3.0, 10.0}
        assert rv.SHORTABLE[3.0] == "IRS·선물"
        assert rv.SHORTABLE[10.0] == "선물"


# ── 트레이더 앵커 — 크레딧 RV 의 BEP 산술 (2026-08-18 설계안의 예제) ─────────
#
# "스프레드 70bp · 캐리 ≈7bp · 롤 ≈5bp → BEP ≈82bp". 1차 산술은 캐리 ≈ s·t/D
# (70×0.25/2.5 ≈ 7) — 조달은 국고 헤지 페어에서 소거되므로(원칙 ② 의 산술 형태)
# 시드 값이 무엇이든 결과가 같아야 하고, 그래서 상수 시드로 SQL 없이 돈다.
#
# 합성 커브: KTB 평탄 2.60% + BD 2.5Y = +60bp(3.20%) / 3Y = +70bp(3.30%), H=3M.
# 3Y 채권이 2.75Y 로 굴러 내려오며 커브에서 5bp 를 얻는 것이 롤 ≈5 의 형태다.


def synthetic_matrix() -> cm.CreditMatrix:
    dates = [dt.date(2026, 8, 13), dt.date(2026, 8, 14)]
    values: dict[tuple[str, str], list[float | None]] = {}
    for lab in cm.TENOR_LABELS:
        values[("KTB", lab)] = [2.60] * len(dates)
    values[("BD", "2.5Y")] = [3.20] * len(dates)
    values[("BD", "3Y")] = [3.30] * len(dates)
    return cm.CreditMatrix(dates=dates, values=values, watermark=("synthetic", 0))


@pytest.fixture()
def seeded_funding():
    """`fd._series_cache` 상수 시드 — 살아 있는 SQL 을 안 부른다. 시드는 반드시
    되돌린다: 모듈 스코프 TestClient 의 라우트 테스트가 같은 캐시를 읽는다."""
    from app import funding as fd

    fd.reset_cache()
    fd._series_cache["call"] = [(dt.date(2020, 1, 1), 0.025)]
    try:
        yield fd.FundingSpec()  # v2 기본 = call +10bp
    finally:
        fd.reset_cache()


class TestTraderAnchor:
    def test_bep_82_from_70_plus_7_plus_5(self, seeded_funding):
        payload = rv.credit_block(synthetic_matrix(), seeded_funding, [], "52w")
        assert payload["hMonths"] == 3
        by = {(it["sector"], it["tenor"]): it for it in payload["items"]}
        it = by[("BD", "3Y")]
        assert it["nowBp"] == pytest.approx(70.0, abs=1e-9)
        assert 6.0 <= it["carryBp"] <= 8.0
        assert 4.5 <= it["rollBp"] <= 5.5
        # 가산 항등 둘 — buffer = carry + roll, bepSpread = now + buffer.
        # 반올림(각 첫째 자리)이 끼므로 0.15bp 를 허용한다.
        assert it["bufferBp"] == pytest.approx(it["carryBp"] + it["rollBp"], abs=0.15)
        assert it["bepSpreadBp"] == pytest.approx(it["nowBp"] + it["bufferBp"], abs=0.15)
        assert it["bepSpreadBp"] == pytest.approx(82.0, abs=1.0)

    def test_funding_cancels_in_the_hedged_pair(self, seeded_funding):
        """조달 시드를 100bp 움직여도 크레딧 BEP 는 그대로다 — 두 다리에 같게
        붙어 소거되기 때문(원칙 ②). 금통위 Δbp 가 크레딧 RV 에 무영향인 것도
        같은 산술이다."""
        from app import funding as fd

        a = rv.credit_block(synthetic_matrix(), seeded_funding, [], "52w")
        fd._series_cache["call"] = [(dt.date(2020, 1, 1), 0.035)]
        fd._ladder_cache.clear()
        b = rv.credit_block(synthetic_matrix(), seeded_funding, [], "52w")
        ita = next(x for x in a["items"] if x["tenor"] == "3Y")
        itb = next(x for x in b["items"] if x["tenor"] == "3Y")
        assert ita["bufferBp"] == pytest.approx(itb["bufferBp"], abs=1e-9)
        c = rv.credit_block(
            synthetic_matrix(), seeded_funding,
            [(dt.date(2026, 8, 27), 25.0)], "52w",
        )
        itc = next(x for x in c["items"] if x["tenor"] == "3Y")
        assert ita["bufferBp"] == pytest.approx(itc["bufferBp"], abs=1e-9)

    def test_short_history_says_none_rather_than_inventing_sigma(self, seeded_funding):
        """이틀짜리 이력에서 vol·z·score 는 **None** 이다 — 지어낸 σ 로 나눈
        배수는 숫자처럼 보이는 잡음이다(모듈 독스트링의 최소 관측 규칙)."""
        payload = rv.credit_block(synthetic_matrix(), seeded_funding, [], "52w")
        it = next(x for x in payload["items"] if x["tenor"] == "3Y")
        assert it["vol3mBp"] is None
        assert it["coverage"] is None
        assert it["relRv"] is None
        assert it["score"] is None


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


class TestRoute:
    """라이브 SQL 라우트 — 이 게이트는 DB 가 닿는 환경에서 돈다(v2 스위트 전체가
    그렇다). 값 자체는 앵커가 지키고, 여기서는 **모양과 게이트**를 본다."""

    def test_payload_shape_and_per_source_asof(self, client):
        r = client.get("/api/rv/analysis")
        assert r.status_code == 200, r.text
        body = r.json()
        # 소스별 as-of — 없으면 첫 화면부터 두 숫자가 다른 날짜를 말한다(B-2)
        assert body["asof"]["creditMatrix"]
        assert body["asof"]["irs"]
        assert body["funding"]["label"]
        assert body["candidates"] >= 80  # 실측 94 — 격자가 통째로 줄면 알아야 한다
        assert len(body["meetings"]) >= 1  # 달력의 남은 회의 미리 채움
        assert all(m["bp"] == 0.0 for m in body["meetings"])  # 기본 경로 0
        # 껍질과 창 안 승자는 딴 키로 실린다 (PN-2)
        assert "hull" in body["pool"] and "winners" in body["pool"]

    def test_sector_rows_carry_the_five_derived_quantities(self, client):
        body = client.get("/api/rv/analysis").json()
        ktb = next(s for s in body["sectors"] if s["id"] == "KTB")
        row = next(c for c in ktb["candidates"] if not c["maturityHold"])
        for k in ("dur", "carryBp", "rollBp", "trBp", "bepBp", "tr"):
            assert row[k] is not None
        assert len(row["tr"]) == len(body["dys"])
        # 행 안에서 닫힌다: tr(0) = carry + roll
        i0 = body["dys"].index(0)
        assert row["tr"][i0] == pytest.approx(row["carryBp"] + row["rollBp"], abs=0.15)

    def test_credit_block_gates_and_series_ids(self, client):
        body = client.get("/api/rv/analysis").json()
        credit = body["credit"]
        # 크레딧 RV 의 H 는 레인 A(6M)와 다르다 — 3M [트레이더 출발값].
        assert credit["hMonths"] == 3
        # 가중 40/40/20 은 페이로드가 노출한다 — 조건 바가 그대로 읽는다.
        assert credit["weights"] == {"abs": 0.4, "sector": 0.4, "curve": 0.2}
        items = credit["items"]
        assert items, "크레딧 RV 항목이 비었다"
        five = [p for p in items if p["years"] == 5.0]
        assert five and all(not p["shortable"] for p in five)  # 5년 숏 불가
        three = [p for p in items if p["years"] == 3.0]
        assert three and all(p["shortVia"] == "IRS·선물" for p in three)
        # 점 클릭의 이력 단면 id 는 universe 의 CRD 어휘 그대로다
        assert all(p["seriesId"].startswith("CRD-") for p in items)
        # 절대축·상대축·합성이 실데이터에서 실제로 계산된다 — 전부 None 이면
        # 화면이 빈 사분면이 되고, 그건 여기서 잡혀야 한다.
        assert any(p["coverage"] is not None for p in items)
        assert any(p["covPct"] is not None for p in items)
        assert any(p["relRv"] is not None for p in items)
        assert any(p["score"] is not None for p in items)
        # 랭크·랭크 Δ [OWNER 2026-08-19] — 랭크는 Score 있는 항목에 1..K 연속,
        # Score 없는 항목엔 없다. Δ 는 전일 랭크가 있는 항목에만 숫자다.
        ranks = sorted(p["rank"] for p in items if p["rank"] is not None)
        scored = [p for p in items if p["score"] is not None]
        assert ranks == list(range(1, len(scored) + 1))
        assert all(p["rank"] is None for p in items if p["score"] is None)
        assert any(p["rankDelta"] is not None for p in items)
        # 만기 보유 후보는 항목 대신 제외 목록에서 이유를 말한다
        assert any("만기 보유" in e["reason"] for e in credit["exclusions"])
        # 10년 초과는 랭킹 대상 밖 [OWNER 2026-08-19] — 항목엔 없고 제외가 말한다
        assert all(p["years"] <= rv.RANK_MAX_YEARS for p in items)
        assert any("10년 초과" in e["reason"] for e in credit["exclusions"])

    def test_history_route_shape(self, client):
        r = client.get("/api/rv/history", params={"sector": "BD", "tenor": "3Y"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["sector"] == "BD" and body["tenor"] == "3Y"
        assert body["points"], "이력 점이 비었다"
        p0 = body["points"][-1]
        assert set(p0) == {"t", "s", "rel"}
        # ±σ 밴드 재료 — 두 차트 각각의 창 통계
        for key in ("spread", "rel"):
            assert set(body[key]) == {"now", "mean", "sd"}
        assert body["spread"]["now"] is not None
        # points 도 창을 지킨다 — 라벨("52주")과 그림이 같은 모집단이어야 한다
        # (크리틱 P0: 통계만 잘리고 그림은 전체 1,625점이던 결함의 핀).
        assert len(body["points"]) <= rv.ANNUAL_OBS
        full = client.get(
            "/api/rv/history", params={"sector": "BD", "tenor": "3Y", "window": "all"}
        ).json()
        assert len(full["points"]) > len(body["points"])
        # KTB 는 크레딧 섹터가 아니다 — 거절
        assert client.get(
            "/api/rv/history", params={"sector": "KTB", "tenor": "3Y"}
        ).status_code == 422
        assert client.get(
            "/api/rv/history", params={"sector": "BD", "tenor": "3Y", "window": "10y"}
        ).status_code == 422

    def test_mpc_override_moves_carry_the_right_way(self, client):
        """인하(−25bp) 오버라이드는 조달을 낮춰 캐리를 **키운다** — 방향 핀."""
        base = client.get("/api/rv/analysis").json()
        cut = client.get("/api/rv/analysis", params={"mpc": "2026-08-27:-25"}).json()
        ktb0 = next(s for s in base["sectors"] if s["id"] == "KTB")
        ktb1 = next(s for s in cut["sectors"] if s["id"] == "KTB")
        r0 = next(c for c in ktb0["candidates"] if c["tenor"] == "3Y")
        r1 = next(c for c in ktb1["candidates"] if c["tenor"] == "3Y")
        assert r1["carryBp"] > r0["carryBp"]
        assert r1["rollBp"] == pytest.approx(r0["rollBp"], abs=1e-9)  # 롤은 불변

    def test_bad_inputs_are_refused_with_a_reason(self, client):
        assert client.get("/api/rv/analysis", params={"window": "10y"}).status_code == 422
        assert client.get("/api/rv/analysis", params={"h": 0}).status_code == 422
        assert client.get("/api/rv/analysis", params={"mpc": "언제:-25"}).status_code == 422
