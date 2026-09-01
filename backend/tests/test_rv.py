# -*- coding: utf-8 -*-
"""RV Analysis 의 핀 (rv2).

## 앵커 — Appendix B 8행의 상주 재현 [세션 규칙]

REPORT_rv1 의 기계 검증을 그대로 상주시킨다: 특은채(=KDB, 벤더 열 이름으로
확정) 2026-08-13 커브, H=6M, 조달 = 정책금리 2.75% + 인상 08-27·11-26(+25bp),
시작일 2026-08-14. **상수를 전부 테스트 안에 내장**하므로 funding 게이트·SQL
과 무관하게 돈다 — 살아 있는 funding 모듈은 안 부른다.

허용오차는 rv1 실측 잔차 그대로: carry ≤0.02bp · roll ≤0.4bp · 스왑점 3Y→9M =
+13.0bp(±0.15, 스프레드시트 기대 13.2 와의 0.2bp 는 원본 일수 규약 차이 —
rv1 UV-C, 순위·껍질 구성 일치로 종결).

**BEP 허용오차는 2.8 → 1.6bp 로 조인다** [OWNER 2026-08-20 — "엑셀 기준의 BEP"].
분모가 워크북 K열의 par 폐형(`par_duration`, 달력 잔존)으로 바뀌면서 듀레이션이
워크북과 1e-5년 안에서 맞고, 남는 오차는 롤의 가격 스케줄 차이 하나다 —
9M 1.52bp, 나머지 ≤0.17bp. 느슨한 채로 두면 분모가 되돌아가도 이 게이트가
안 짖는다.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app import creditmatrix as cm
from app import rv
from app.policy import MPC_DATES

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
            assert rv.tr(c) / c["dur"] * 1e4 == pytest.approx(bep_exp, abs=1.6)

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
        # `reinv` 는 tr() 의 세 번째 항이다 — 합성 후보도 세 항을 다 들어야
        # 한다(2026-08-20 재투자 이식으로 tr 이 3항이 됐다).
        mk = lambda lab, dur, t: {  # noqa: E731
            "label": lab, "dur": dur, "carry": t, "roll": (lambda dy: 0.0),
            "reinv": (lambda dy: 0.0), "sector": "S", "years": dur,
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
        zero = lambda dy: 0.0  # noqa: E731 — tr() 의 재투자 항
        a = {"label": "L", "dur": 10.0, "carry": 10.0e-4, "roll": flat_roll(10.0),
             "reinv": zero, "sector": "S", "years": 10.0}
        b = {"label": "M", "dur": 6.0, "carry": 8.2e-4, "roll": flat_roll(6.0),
             "reinv": zero, "sector": "S", "years": 6.0}
        c = {"label": "S", "dur": 2.0, "carry": 6.0e-4, "roll": flat_roll(2.0),
             "reinv": zero, "sector": "S", "years": 2.0}
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


class TestLastWeekPercentile:
    """사분면 y축 = 지난주 스프레드의 창 백분위 [OWNER 2026-08-20 — "지난주
    벌어진 스프레드가 과거 52주 대비 백분위 몇이었냐"]. 전임자는 Coverage 의
    자기 이력 백분위(covPct)였고 버퍼가 아웃라이트로 옮겨 가며 은퇴했다.

    지켜야 하는 성질은 **자기 이력 대비 위치**라는 것이다 — 수준을 점수화하면
    최고 스프레드 섹터가 늘 이긴다(원칙 ③, 레인 B 금지의 같은 실측)."""

    def test_level_shift_does_not_move_the_percentile(self):
        """계열 전체를 +100bp 들어올려도 백분위는 그대로다 — 넓은 섹터라고
        점수가 오르면 수리가 아니라 병의 재배치다."""
        a: list[float | None] = [10.0 + (i % 7) for i in range(300)]
        b: list[float | None] = [None if v is None else v + 100.0 for v in a]
        end = len(a) - 1
        la, lb = rv.last_week_mean(a, end), rv.last_week_mean(b, end)
        assert la is not None and lb is not None
        assert rv.mid_rank_pct(rv.window_vals(a, "52w"), la) == pytest.approx(
            rv.mid_rank_pct(rv.window_vals(b, "52w"), lb), abs=1e-9
        )

    def test_it_is_last_week_not_today(self):
        """직전 5영업일 **평균**이다 — 오늘 하루가 아니다. 마지막 날만 튀게
        만들면 평균은 그 1/5 만 움직인다(고시 잡음에 계단으로 반응하지 않는
        것이 이 평균의 존재 이유)."""
        base: list[float | None] = [10.0] * 100
        spiked = base[:-1] + [20.0]
        assert rv.last_week_mean(base, 99) == pytest.approx(10.0)
        assert rv.last_week_mean(spiked, 99) == pytest.approx(12.0)

    def test_all_missing_says_none_rather_than_carrying_forward(self):
        seq: list[float | None] = [10.0] * 20 + [None] * 5
        assert rv.last_week_mean(seq, 24) is None
        # 한 자리라도 있으면 그것으로 — 이월이 아니라 관측이다.
        seq2: list[float | None] = [10.0] * 20 + [None, None, 30.0, None, None]
        assert rv.last_week_mean(seq2, 24) == pytest.approx(30.0)

    def test_mid_rank_pct_ties_are_halved(self):
        # 상수 계열이 100%("늘 넓다")로 읽히면 안 된다 — midrank 는 50.
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


# ── 합성 커브 앵커 — 크레딧 RV 의 BEP 산술 ──────────────────────────────────
#
# 전신은 트레이더 2026-08-18 설계안의 예제였다: "스프레드 70bp · 캐리 ≈7bp ·
# 롤 ≈5bp → BEP ≈82bp", 캐리 1차가 s·t/D (70×0.25/2.5 ≈ 7). 그 산술은 BEP 가
# **스프레드 축**(국고 헤지 페어, 조달 소거)일 때의 것이고, 2026-08-20 에 축이
# 워크북의 **아웃라이트 금리축**으로 옮겨 가면서 은퇴했다 [OWNER — "엑셀 기준의
# BEP 로 고치기"; 같은 트레이더의 두 문서가 다른 축을 말하고 있었다].
#
# 새 앵커는 같은 합성 커브에서 아웃라이트 산술을 잰다 — 캐리는 이제 (y − f)·t 라
# 조달이 **남고**, 그래서 조달을 흔들면 버퍼가 움직인다. 그 사실 자체를 아래
# `test_funding_no_longer_cancels` 가 못박는다(옛 게이트의 정확한 반대).
#
# 합성 커브: KTB 평탄 2.60% + BD 2.5Y = +60bp(3.20%) / 3Y = +70bp(3.30%), H=3M.


def synthetic_matrix() -> cm.CreditMatrix:
    """BEP 산술 전용 픽스처.

    **KDB 를 KTB 와 같은 레벨에 둔다** — 2026-08-20 에 은행채(BD)의 앵커가 국고
    에서 특은(KDB)으로 옮겨 갔는데, 이 픽스처가 재려는 것은 앵커가 아니라 버퍼
    산술이다. 두 앵커를 같은 자리에 두면 스프레드 값이 앵커 교체 전과 같아져서
    이 파일의 BEP 기대값이 그 변경에 흔들리지 않는다. 앵커 자체는
    `TestSpreadAnchor` 가 딴 픽스처로 잰다.
    """
    dates = [dt.date(2026, 8, 13), dt.date(2026, 8, 14)]
    values: dict[tuple[str, str], list[float | None]] = {}
    for lab in cm.TENOR_LABELS:
        values[("KTB", lab)] = [2.60] * len(dates)
        values[("KDB", lab)] = [2.60] * len(dates)
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
        yield fd.FundingSpec(basis="call")
    finally:
        fd.reset_cache()


class TestOutrightBep:
    def test_buffer_is_carry_plus_roll_on_the_rate_axis(self, seeded_funding):
        payload = rv.credit_block(synthetic_matrix(), seeded_funding, [], "52w")
        # H 는 한 벌이 됐다 [OWNER 2026-08-20 — 워크북 만기선택!B7 이 하나다].
        # 전에는 레인 A 6M / 크레딧 3M 으로 갈려 있었다.
        assert payload["hMonths"] == rv.H_DEFAULT_MONTHS == 6
        by = {(it["sector"], it["tenor"]): it for it in payload["items"]}
        it = by[("BD", "3Y")]
        assert it["nowBp"] == pytest.approx(70.0, abs=1e-9)
        # 가산 항등 — buffer = carry + roll (반올림 첫째 자리 두 번이라 0.15bp).
        assert it["bufferBp"] == pytest.approx(it["carryBp"] + it["rollBp"], abs=0.15)
        # 스프레드축의 `bepSpreadBp`(= now + buffer) 는 은퇴했다 — 축이 다르면
        # 그 덧셈이 뜻을 잃는다. 페이로드에 남아 있으면 화면이 다시 그린다.
        assert "bepSpreadBp" not in it
        assert "coverage" not in it and "covPct" not in it and "vol3mBp" not in it

    def test_bep_denominator_is_the_workbook_par_duration(self, seeded_funding):
        """버퍼 = (캐리+롤) ÷ 매도시점 par 듀레이션 × 10⁴ — 분모가 워크북 K열.

        커브·조달은 `credit_block` 이 실제로 쓰는 것을 그대로 다시 집는다
        (`curve_points`·`fd.rate_on`). 손으로 재구성하면 그 재구성이 틀린 것을
        게이트가 대신 짖는다 — 이 테스트를 쓰다 한 번 겪었다.
        """
        from app import funding as fd

        m = synthetic_matrix()
        payload = rv.credit_block(m, seeded_funding, [], "52w")
        # 픽스처에 KDB 가 생기며 3Y 항목이 둘이 됐다 — 섹터까지 찍는다.
        # (KDB 는 KTB 와 같은 레벨이라 캐리·롤이 0 이고, 그걸 집으면 분모 검사가
        # 0 == 0 으로 통과해 아무것도 안 재게 된다.)
        it = next(x for x in payload["items"]
                  if x["sector"] == "BD" and x["tenor"] == "3Y")

        asof_i = len(m.dates) - 1
        pts = cm.curve_points(m, "BD", asof_i)
        base = fd.rate_on(seeded_funding, m.dates[asof_i])
        c = rv.candidate(pts, "3Y", m.dates[asof_i], base, [], rv.H_DEFAULT_MONTHS)
        assert it["bufferBp"] == pytest.approx(
            (c["carry"] + c["roll"](0.0)) / c["dur"] * 1e4, abs=0.15
        )
        # 분모의 정의가 워크북 폐형이라는 것 자체 — dur 는 par_duration 이다.
        assert c["dur"] == pytest.approx(rv.par_duration(c["j"], c["m_cal"]), abs=1e-12)
        # 그리고 그 m 은 **달력 잔존**이고 0.25 플로어를 안 받는다(보간용 m_res
        # 와 다른 숫자여야 한다 — 9M 후보에서 BEP 2.7bp 를 가르는 그 차이).
        assert c["m_cal"] != pytest.approx(c["m_res"], abs=1e-6)

    def test_funding_no_longer_cancels(self, seeded_funding):
        """조달을 100bp 올리면 버퍼가 **움직인다** — 아웃라이트 축이라 조달이
        캐리에 남는다. 옛 스프레드축 게이트(`불변`)의 정확한 반대이고, 이 축
        이동이 실제로 일어났다는 증거다 [OWNER 2026-08-20]."""
        from app import funding as fd

        a = rv.credit_block(synthetic_matrix(), seeded_funding, [], "52w")
        fd._series_cache["call"] = [(dt.date(2020, 1, 1), 0.035)]
        fd._ladder_cache.clear()
        b = rv.credit_block(synthetic_matrix(), seeded_funding, [], "52w")
        pick = lambda p: next(  # noqa: E731
            x for x in p["items"] if x["sector"] == "BD" and x["tenor"] == "3Y")
        ita, itb = pick(a), pick(b)
        assert ita["bufferBp"] != pytest.approx(itb["bufferBp"], abs=1.0)
        # 금통위 인상도 같은 통로로 닿는다 — 조달 경로가 캐리를 깎는다.
        c = rv.credit_block(
            synthetic_matrix(), seeded_funding,
            [(dt.date(2026, 8, 27), 25.0)], "52w",
        )
        itc = pick(c)
        assert itc["bufferBp"] < ita["bufferBp"]

    def test_monthly_return_is_not_divided_by_duration(self):
        """사분면 x축은 버퍼와 **다른 자**다 [OWNER 2026-08-20] — 그 차이가 순서를
        뒤집는 것이 이 축을 새로 세운 이유다.

        앵커 워크북 커브로 잰다(합성 커브는 BD 노드가 2.5Y·3Y 둘뿐이라 롤이
        평탄 외삽으로 죽어 순서를 못 본다 — 실측으로 확인). 워크북 8행에서
        버퍼(=총BEP)는 9M 이 1등(169bp)이고 월환산 총수익은 3Y 가 1등이다.
        """
        cands = {k: c for k, c in anchor_candidates().items() if c["dur"] > 0}
        bep = {k: rv.tr(c) / c["dur"] * 1e4 for k, c in cands.items()}
        per_month = {k: rv.tr(c) * 1e4 / 6 for k, c in cands.items()}
        assert max(bep, key=lambda k: bep[k]) == "9M"
        assert max(per_month, key=lambda k: per_month[k]) == "3Y"
        # 듀레이션으로 나눈 자와 안 나눈 자가 서로 뒤집힌다 — 한 축으로 둘을
        # 말할 수 없다는 것이 이 두 줄의 내용이다.
        assert bep["9M"] > bep["3Y"]
        assert per_month["9M"] < per_month["3Y"]

    def test_short_history_says_none_rather_than_inventing_sigma(self, seeded_funding):
        """이틀짜리 이력에서 z·score 는 **None** 이다 — 지어낸 σ 로 나눈 배수는
        숫자처럼 보이는 잡음이다(모듈 독스트링의 최소 관측 규칙)."""
        payload = rv.credit_block(synthetic_matrix(), seeded_funding, [], "52w")
        it = next(x for x in payload["items"]
                  if x["sector"] == "BD" and x["tenor"] == "3Y")
        assert it["relRv"] is None
        assert it["score"] is None


# ── 워크북 정렬 2026-08-20 [OWNER] — 재투자 · 비평행 커브 · 만기 상한 ───────
#
# 기대값의 출처는 워크북 `크레딧 채권 상대우위 비교.xlsx` 다(앵커 커브·조건과
# 같은 세계). 케이스 C/C-2 는 F73:F80 · F86:F93 을 bp 로 옮긴 것이다.

# 케이스 C — 베어 플래트닝(3M 0 → 3Y +20). 워크북 D73:D80 / F73:F80.
PATH_C = [0, 5, 10, 15, 20, 20, 20, 20]
EXPECT_C = [1.0669, 9.4756, 40.9058, 41.0791, 35.9542, 17.8163, 16.1825, 21.6434]
# 케이스 C-2 — 반대 방향(3M +20 → 1.5Y 이후 0). 워크북 D86:D93 / F86:F93.
PATH_C2 = [20, 15, 10, 5, 0, 0, 0, 0]
EXPECT_C2 = [1.0669, 9.4756, 36.0602, 36.0969, 45.7297, 46.7484, 54.5023, 68.9661]


def _path(deltas):
    return [(cm.TENOR_YEARS[lab], float(d)) for lab, d in zip(SHEET, deltas)]


class TestCustomCurve:
    """비평행 커스텀 커브 — 워크북 케이스 C/C-2 [OWNER 2026-08-20].

    허용오차는 평행 케이스와 같다(0.4bp): 남는 차이는 롤의 가격 스케줄 하나이고
    경로가 바뀐다고 그 차이가 커지지 않는다는 것이 이 게이트의 내용이다."""

    @pytest.mark.parametrize("i,tenor", list(enumerate(SHEET)))
    def test_case_c_reproduces_the_workbook(self, i, tenor):
        c = anchor_candidates()[tenor]
        assert rv.tr_path(c, _path(PATH_C)) * 1e4 == pytest.approx(EXPECT_C[i], abs=0.4)

    @pytest.mark.parametrize("i,tenor", list(enumerate(SHEET)))
    def test_case_c2_reproduces_the_workbook(self, i, tenor):
        c = anchor_candidates()[tenor]
        assert rv.tr_path(c, _path(PATH_C2)) * 1e4 == pytest.approx(EXPECT_C2[i], abs=0.4)

    def test_a_flat_path_equals_the_parallel_shift(self):
        """모든 테너가 같은 Δ 인 경로 = 평행이동. 두 통로가 같은 답을 내야
        커스텀 커브가 평행 격자의 **확장**이지 다른 기계가 아니다."""
        flat = [(cm.TENOR_YEARS[lab], 10.0) for lab in SHEET]
        for c in anchor_candidates().values():
            assert rv.tr_path(c, flat) == pytest.approx(rv.tr(c, 10.0 / 1e4), abs=1e-12)

    def test_the_shift_that_lands_is_interpolated_at_the_residual(self):
        """같은 경로가 후보마다 **다른 크기**로 닿는다 — 워크북 E열. 2Y 후보는
        잔존 1.5Y 라 그 지점의 Δ 를 맞지, 자기 만기의 Δ 를 맞지 않는다."""
        c2y = anchor_candidates()["2Y"]
        assert cm.interp(_path(PATH_C), c2y["m_res"]) == pytest.approx(20.0, abs=1e-9)
        c1y = anchor_candidates()["1Y"]
        # 잔존 0.5Y → 6M 노드의 Δ = 5bp (자기 만기 1Y 의 15bp 가 아니다)
        assert cm.interp(_path(PATH_C), c1y["m_res"]) == pytest.approx(5.0, abs=1e-9)

    def test_parse_paths_rejects_a_half_read_curve(self):
        assert rv.parse_paths("") == []
        assert rv.parse_paths("3M:0,1Y:15") == [[(0.25, 0.0), (1.0, 15.0)]]
        assert len(rv.parse_paths("3M:0|3M:20")) == 2
        for bad in ("3M", "9Q:5", "3M:x"):
            with pytest.raises(ValueError):
                rv.parse_paths(bad)
        # 만기 상한 밖 테너는 경로에도 못 선다 — 화면과 같은 유니버스여야 한다
        with pytest.raises(ValueError):
            rv.parse_paths("10Y:5")


class TestReinvest:
    """재투자 3갈래 — 워크북 `만기선택!B11`. H(6M) 안에 만기가 드는 후보에만
    닿는다(앵커 조건에서 3M 후보 하나, 재투자 92일)."""

    def _c(self, tenor, mode, rate=0.0):
        return rv.candidate(POINTS, tenor, START, BASE, MEETINGS, 6, mode, rate)

    def test_default_is_none_so_the_anchor_eight_rows_do_not_move(self):
        for tenor in SHEET:
            a = rv.candidate(POINTS, tenor, START, BASE, MEETINGS)
            b = self._c(tenor, "none")
            assert rv.tr(a) == pytest.approx(rv.tr(b), abs=1e-15)
            assert b["reinv"](0.0) == 0.0

    def test_only_the_maturity_hold_candidates_have_a_stub(self):
        assert self._c("3M", "manual", 0.03)["n_reinv"] == 92
        for tenor in ("6M", "9M", "1Y", "3Y"):
            assert self._c(tenor, "manual", 0.03)["n_reinv"] == 0
            assert self._c(tenor, "manual", 0.03)["reinv"](0.0) == 0.0

    def test_manual_rate_against_the_funding_path(self):
        """3M 후보: 만기 2026-11-14 → 호라이즌 2027-02-14, 92일. 그 구간의 조달은
        **만기일 레벨 3.00%**(08-27 인상이 이미 지난 뒤)에서 출발해 11-26 인상을
        일할로 얹어 3.2174% 다. 재투자 3.00% 면 −5.48bp."""
        c = self._c("3M", "manual", 0.03)
        assert c["f_reinv"] * 100 == pytest.approx(3.2174, abs=1e-3)
        assert c["reinv"](0.0) * 1e4 == pytest.approx(-5.48, abs=0.02)
        assert rv.tr(c) * 1e4 == pytest.approx(-4.41, abs=0.02)

    def test_the_workbook_defect_is_not_ported(self):
        """워크북 O열은 이 자리의 base 를 **오늘 기준금리**(2.75%)로 놓아 매수
        만기까지의 인상을 빼먹는다 — 같은 조건에서 +0.82bp 가 되어 6.3bp 차이가
        난다. `path_rate` 가 그 자리를 제대로 적는다."""
        c = self._c("3M", "manual", 0.03)
        n, hor, mat = 92, dt.date(2027, 2, 14), dt.date(2026, 11, 14)
        defective_f = BASE + 25.0 / 1e4 * (hor - dt.date(2026, 11, 26)).days / n
        defective = (0.03 - defective_f) * n / 365.0
        assert defective * 1e4 == pytest.approx(0.82, abs=0.02)
        assert rv.path_rate(BASE, MEETINGS, START, mat) == pytest.approx(0.03, abs=1e-12)
        assert c["reinv"](0.0) * 1e4 < defective * 1e4 - 6.0

    def test_residual_reads_the_curve_at_the_stub_tenor(self):
        """잔존만기 방식 — 92일을 테너로 보고 커브에서 **보간**한다.

        92/365 = 0.2521년이라 0.25Y 플로어가 안 물리고, 3M(3.007)과 6M(3.279)
        사이 보간으로 3.0092% 가 된다. 워크북 `MAX(N/365, 0.25)` 뒤의 같은 선형
        보간이다 — 플로어는 92일보다 짧은 스텁에만 걸린다.
        """
        c = self._c("3M", "residual")
        assert c["reinv_rate"] * 100 == pytest.approx(3.0092, abs=1e-3)
        assert c["reinv_residual"] is True
        # 플로어가 실제로 무는 자리 — 스텁이 0.25Y 보다 짧으면 3M 노드로 잠긴다
        short = rv.candidate(POINTS, "3M", START, BASE, MEETINGS, 4, "residual")
        assert short["n_reinv"] == 30  # 2026-11-14 → 12-14
        assert short["reinv_rate"] == pytest.approx(0.03007, abs=1e-9)

    def test_the_parallel_shift_touches_only_the_residual_mode(self):
        """워크북 격자의 IF 가지 — 수기입력 금리는 시장이 움직여도 안 바뀐다."""
        man = self._c("3M", "manual", 0.03)
        res = self._c("3M", "residual")
        assert man["reinv"](50 / 1e4) == pytest.approx(man["reinv"](0.0), abs=1e-15)
        assert res["reinv"](50 / 1e4) - res["reinv"](0.0) == pytest.approx(
            50 / 1e4 * 92 / 365, abs=1e-15
        )

    def test_an_unknown_mode_is_refused(self):
        with pytest.raises(ValueError):
            self._c("3M", "재투자X")


class TestMaxYears:
    """[OWNER 2026-08-20] 만기 상한 3Y — **RV 섹션 안에서만**."""

    def test_the_cap_is_three_years(self):
        assert rv.MAX_YEARS == 3.0

    def test_the_shared_tenor_grid_is_untouched(self):
        """공용 격자는 그대로여야 한다 — Lab 3D 표면(3M~30Y)·Cash Bond ASW·
        Backtest 가 같은 테이블을 읽는다. 여기를 자르면 이 결정이 닿을 이유가
        없는 화면 셋이 같이 잘린다."""
        assert cm.TENOR_YEARS["30Y"] == 30.0
        assert max(cm.TENOR_YEARS.values()) == 30.0

    def test_rv_labels_filters_by_the_cap(self):
        m = synthetic_matrix()
        labs = rv.rv_labels(m, "KTB", len(m.dates) - 1)
        assert labs and all(cm.TENOR_YEARS[lab] <= 3.0 for lab in labs)
        assert "5Y" not in labs and "10Y" not in labs


class TestSpreadAnchor:
    """스프레드 앵커가 섹터마다 다르다 [트레이더 피드백 2026-08-20].

    지적의 형태: 특은채와 카드채가 **둘 다** 자기 이력 75~80% 에 있으면, 두
    백분위가 같으니 남는 차이가 캐리뿐이라 일드 높은 카드가 늘 이긴다. 해법은
    확산 섹터를 특은채 대비로 옮겨 "특은 대비 붙었나 벌어졌나"를 넣는 것이다.
    """

    def test_the_ladder_is_split_into_two_anchors(self):
        assert rv.base_of("KDB") == "KTB"   # 앵커 자신은 국고 대비
        assert rv.base_of("MSB") == "KTB"   # 통안 = 국/통 벤치마크 가족
        assert rv.base_of("SPB") == "KTB"   # 공사 = 준정부 [OWNER 2026-08-20]
        for bt in ("BD", "CB1", "CARD", "OFB"):
            assert rv.base_of(bt) == "KDB", bt
        # 앵커가 자기 자신이면 스프레드가 항상 0 이다 — 그 자기참조가 없어야
        # 한다. (KTB 는 크레딧 섹터가 아니라 뿌리라 이 검사 밖이다.)
        for bt in cm.TYPE_ORDER:
            if bt == "KTB":
                continue
            assert rv.base_of(bt) != bt, bt

    def test_every_credit_sector_has_an_anchor(self):
        """표에 없는 종목군이 조용히 국고로 떨어지지 않게 — 새 섹터를 붙이는
        날 이 게이트가 먼저 짖는다."""
        for bt in cm.TYPE_ORDER:
            if bt == "KTB":
                continue
            assert bt in rv.SPREAD_BASE, bt

    def test_the_spread_is_measured_against_the_anchor(self):
        """산술 자체 — 은행채는 국고가 아니라 **특은채**를 뺀다."""
        m = cm.CreditMatrix(
            dates=[dt.date(2026, 8, 13), dt.date(2026, 8, 14)],
            values={
                ("KTB", "3Y"): [2.60, 2.60],
                ("KDB", "3Y"): [3.00, 3.00],
                ("BD", "3Y"): [3.30, 3.30],
            },
            watermark=("synthetic", 0),
        )
        # 특은 = 국고 대비 40bp
        assert rv.aligned_spread(m, "KDB", "3Y")[-1] == pytest.approx(40.0, abs=1e-9)
        # 은행 = **특은** 대비 30bp (국고 대비 70bp 가 아니다)
        assert rv.aligned_spread(m, "BD", "3Y")[-1] == pytest.approx(30.0, abs=1e-9)

    def test_the_cross_section_only_averages_same_anchor_peers(self):
        """국고 대비 33bp 와 특은 대비 6bp 를 한 평균에 넣으면 그 평균은 아무
        양도 아니다 — 모집단이 앵커별로 갈린다."""
        credit = [b for b in cm.TYPE_ORDER if b != "KTB"]
        wide = rv.peers_of("CARD", credit)
        front = rv.peers_of("KDB", credit)
        assert set(wide) == {"BD", "CB1", "CARD", "OFB"}
        assert set(front) == {"MSB", "KDB", "SPB"}
        assert not (set(wide) & set(front))

    def test_it_answers_the_traders_case(self):
        """지적 그 자체를 재현한다: 특은과 카드가 자기 이력에서 **같은 위치**에
        있는 세계를 세우고, 앵커 교체가 그 둘을 갈라 놓는지 본다.

        커브: 국고 평탄. 특은 = 국고 + s(t), 카드 = 특은 + 20bp **고정**.
        s(t) 를 20 → 60 으로 끌어올리면 특은은 자기 이력의 꼭대기(≈100%)에
        서고, 국고 대비로 잰 카드도 **같은 모양이라 같은 백분위**가 된다 —
        두 숫자가 같으니 남는 차이가 캐리뿐이고, 그것이 지적의 산술적 형태다.

        앵커를 특은으로 바꾸면 카드의 스프레드는 상수 20 이라 midrank 50% 다.
        "평소와 똑같이 붙어 있다"가 그제야 숫자로 선다.
        """
        n = 300
        dates = [dt.date(2025, 1, 1) + dt.timedelta(days=i) for i in range(n)]
        sp = [20.0 + 40.0 * i / (n - 1) for i in range(n)]  # 20 → 60 추세
        m = cm.CreditMatrix(
            dates=dates,
            values={
                ("KTB", "3Y"): [2.60] * n,
                ("KDB", "3Y"): [2.60 + x / 100.0 for x in sp],
                ("CARD", "3Y"): [2.60 + (x + 20.0) / 100.0 for x in sp],
            },
            watermark=("synthetic", 0),
        )
        end = n - 1
        kdb = rv.aligned_spread(m, "KDB", "3Y")
        card = rv.aligned_spread(m, "CARD", "3Y")

        # 카드의 앵커가 특은이므로 스프레드는 상수 20bp 다.
        assert all(v == pytest.approx(20.0, abs=1e-9) for v in card)
        # 상수 계열의 백분위는 가운데에 선다 — "평소와 똑같다"가 숫자로 서는
        # 자리다. **정확히 50 을 요구하지 않는다**: 두 금리를 빼서 만든 계열이라
        # 잔차가 1e-14 쯤 남고, midrank 는 그 잔차를 동률이 아니라 순위로 센다
        # (실측 40.5%). 여기서 재려는 것은 "가운데"이지 소수점이 아니다.
        card_pct = rv.mid_rank_pct(
            rv.window_vals(card, "52w"), rv.last_week_mean(card, end)
        )
        assert 25.0 < card_pct < 75.0
        # 특은은 자기 이력의 꼭대기에 있다 — 둘이 확실히 갈렸다.
        kdb_pct = rv.mid_rank_pct(
            rv.window_vals(kdb, "52w"), rv.last_week_mean(kdb, end)
        )
        assert kdb_pct > 95.0
        assert abs(kdb_pct - card_pct) > 40.0

        # 대조: 옛 방식(둘 다 국고 대비)이었다면 두 백분위가 **같았다** —
        # 그것이 트레이더가 지적한 "캐리 큰 쪽이 늘 이긴다"의 산술적 형태다.
        card_vs_ktb = [
            (a - b) * 100.0
            for a, b in zip(m.values[("CARD", "3Y")], m.values[("KTB", "3Y")])
        ]
        old_pct = rv.mid_rank_pct(
            rv.window_vals(card_vs_ktb, "52w"), rv.last_week_mean(card_vs_ktb, end)
        )
        assert old_pct == pytest.approx(kdb_pct, abs=0.5)
        # 그리고 그 옛 값은 새 값과 **크게** 다르다 — 앵커 교체가 실제로 한 일.
        assert abs(old_pct - card_pct) > 40.0

    def test_the_payload_names_the_anchor_on_every_row(self, seeded_funding):
        """한 표에 두 앵커가 섞이므로 열 머리 하나로는 못 적는다 — 행마다 이름."""
        payload = rv.credit_block(synthetic_matrix(), seeded_funding, [], "52w")
        for it in payload["items"]:
            assert it["base"] == rv.base_of(it["sector"])
            assert it["baseLabel"] == cm.BOND_TYPES[it["base"]]


class TestMeetingDayBoundary:
    """회의가 **분석 시작일 당일**일 때 — 워크북과 일부러 다른 자리.

    워크북 F열은 `md >= start` 라 그날 인상을 전 구간에 얹는다. 여기는
    `md > start` 라 안 센다. 워크북 B6 은 손으로 적는 값이라 당일 아침에 옛
    값이고, 여기 base 는 회의 당일에 이미 새 값을 싣는 피드이기 때문이다
    (2026-07-16 실측: 전일 2.60% → 당일 2.85%).

    **워크북에 맞춘다고 부등호를 바꾸면 25bp 를 두 번 센다.** 이 클래스가 그
    자리를 지킨다.
    """

    def test_a_meeting_on_the_start_date_is_not_counted(self):
        d = dt.date(2026, 8, 27)
        f = rv.avg_funding(0.0275, [(d, 25.0)], d, rv.add_months(d, 6), 184)
        assert f == pytest.approx(0.0275, abs=1e-12)

    def test_a_meeting_after_the_start_date_is_counted(self):
        start = dt.date(2026, 8, 14)
        d = dt.date(2026, 8, 27)
        sale = rv.add_months(start, 6)
        eff = (sale - start).days
        f = rv.avg_funding(0.0275, [(d, 25.0)], start, sale, eff)
        assert f > 0.0275
        assert f == pytest.approx(0.0275 + 25 / 1e4 * (sale - d).days / eff, abs=1e-15)

    def test_a_meeting_on_the_sale_date_has_zero_weight(self):
        """`md == sale` 은 어느 부등호든 같다 — 남은 날이 0 이라서."""
        start = dt.date(2026, 8, 14)
        sale = rv.add_months(start, 6)
        f = rv.avg_funding(0.0275, [(sale, 25.0)], start, sale, (sale - start).days)
        assert f == pytest.approx(0.0275, abs=1e-15)

    def test_path_rate_uses_the_same_inequality(self):
        """재투자 스텁의 base 도 같은 규약이어야 한다 — 셋이 같이 움직인다."""
        start = dt.date(2026, 8, 14)
        d = dt.date(2026, 8, 27)
        # 시작일 **뒤** 회의는 그 시점 레벨에 얹힌다.
        assert rv.path_rate(0.0275, [(d, 25.0)], start, d) == pytest.approx(0.03, abs=1e-12)
        assert rv.path_rate(0.0275, [(d, 25.0)], start, d - dt.timedelta(days=1)) == (
            pytest.approx(0.0275, abs=1e-12)
        )
        # 시작일 **당일** 회의는 안 얹힌다 — 이미 피드에 들어 있다.
        assert rv.path_rate(0.0275, [(d, 25.0)], d, d + dt.timedelta(days=90)) == (
            pytest.approx(0.0275, abs=1e-12)
        )


class TestInputLimits:
    """사람이 넣는 bp 값의 한도 — **서버가 판정의 주인**이다.

    화면(RvPage)도 같은 값으로 막지만 URL·API 로 우회하면 화면 클램프는 없는
    것과 같다. 2026-08-20 감사에서 둘 다 무방비였고, 금통위 9999bp 가 200 으로
    통과해 조달 102% 짜리 화면이 아무 말 없이 그려졌다.
    """

    def test_mpc_beyond_the_limit_is_refused(self):
        assert rv.parse_meetings("2026-08-27:100") == [(dt.date(2026, 8, 27), 100.0)]
        assert rv.parse_meetings("2026-08-27:-100") == [(dt.date(2026, 8, 27), -100.0)]
        for bad in ("2026-08-27:101", "2026-08-27:-101", "2026-08-27:9999"):
            with pytest.raises(ValueError):
                rv.parse_meetings(bad)

    def test_a_meeting_without_a_colon_is_refused(self):
        """전에는 `partition` 이 빈 문자열을 주고 float("") 가 터졌다 — 메시지가
        "could not convert string to float" 였다. 이제 우리 말로 거절한다."""
        with pytest.raises(ValueError, match="모양"):
            rv.parse_meetings("2026-08-27")

    def test_path_delta_beyond_the_limit_is_refused(self):
        assert rv.parse_paths("3M:200") == [[(0.25, 200.0)]]
        for bad in ("3M:201", "3M:-201", "3M:9999"):
            with pytest.raises(ValueError):
                rv.parse_paths(bad)

    def test_the_screen_and_the_server_use_the_same_numbers(self):
        """화면 클램프가 서버 한도와 갈리면 사용자가 못 넣는 값이 생기거나
        (너무 빡빡) 넣었는데 422 가 돌아온다(너무 헐렁)."""
        import io as _io
        import pathlib

        page = pathlib.Path(__file__).parents[2] / "src" / "rv" / "RvPage.tsx"
        src = _io.open(page, encoding="utf-8").read()
        assert f"Math.max(-{rv.MPC_LIMIT_BP:g}, Math.min({rv.MPC_LIMIT_BP:g}, v))" in src
        assert f"Math.max(-{rv.PATH_LIMIT_BP:g}, Math.min({rv.PATH_LIMIT_BP:g}, v))" in src


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
        # 실측 64 — 격자가 통째로 줄면 알아야 한다. 전신은 94(3M~30Y)였고
        # 2026-08-20 만기 상한 3Y [OWNER] 로 8테너 × 8섹터 세계가 됐다.
        assert body["candidates"] >= 55
        assert len(body["meetings"]) >= 1  # 달력의 남은 회의 미리 채움
        assert all(m["bp"] == 0.0 for m in body["meetings"])  # 기본 경로 0
        # 껍질과 창 안 승자는 딴 키로 실린다 (PN-2)
        assert "hull" in body["pool"] and "winners" in body["pool"]

    def test_sector_rows_carry_the_five_derived_quantities(self, client):
        body = client.get("/api/rv/analysis").json()
        ktb = next(s for s in body["sectors"] if s["id"] == "KTB")
        row = next(c for c in ktb["candidates"] if not c["maturityHold"])
        for k in ("dur", "carryBp", "rollBp", "reinvBp", "trBp", "bepBp", "tr"):
            assert row[k] is not None
        assert len(row["tr"]) == len(body["dys"])
        # 행 안에서 닫힌다: tr(0) = carry + roll + 재투자
        i0 = body["dys"].index(0)
        assert row["tr"][i0] == pytest.approx(
            row["carryBp"] + row["rollBp"] + row["reinvBp"], abs=0.15
        )

    def test_credit_block_gates_and_series_ids(self, client):
        body = client.get("/api/rv/analysis").json()
        credit = body["credit"]
        # 두 레인이 **같은 H** 를 쓴다 — 워크북에 H 가 하나뿐이라서.
        assert credit["hMonths"] == body["hMonths"] == rv.H_DEFAULT_MONTHS
        # 가중 40/40/20 은 페이로드가 노출한다 — 조건 바가 그대로 읽는다.
        assert credit["weights"] == {"abs": 0.4, "sector": 0.4, "curve": 0.2}
        items = credit["items"]
        assert items, "크레딧 RV 항목이 비었다"
        # 만기 상한 3Y [OWNER 2026-08-20] — 5Y 는 유니버스에 아예 없다.
        # "5년 숏 불가" 게이트를 5Y 항목으로 재던 전신 테스트가 여기 있었는데,
        # 그 만기가 사라져 항목으로는 못 잰다. 게이트 자체는 상수로 확인하고,
        # 항목 쪽은 **상한 안에서 숏 수단이 없는 만기**(2.5Y)로 잰다.
        assert not [p for p in items if p["years"] > rv.MAX_YEARS]
        assert 5.0 not in rv.SHORTABLE  # 5년 숏 불가 — 상수가 그 결정을 진다
        half = [p for p in items if p["years"] == 2.5]
        assert half and all(not p["shortable"] for p in half)
        three = [p for p in items if p["years"] == 3.0]
        assert three and all(p["shortVia"] == "IRS·선물" for p in three)
        # 점 클릭의 이력 단면 id 는 universe 의 CRD 어휘 그대로다
        assert all(p["seriesId"].startswith("CRD-") for p in items)
        # 앵커 — 실데이터에서도 두 벌이 섞여 서고, 행마다 이름이 붙는다
        bases = {p["sector"]: p["base"] for p in items}
        assert bases.get("CARD") == "KDB" and bases.get("KDB") == "KTB"
        assert len({p["base"] for p in items}) == 2
        assert all(p["baseLabel"] for p in items)
        # 절대축·상대축·합성이 실데이터에서 실제로 계산된다 — 전부 None 이면
        # 화면이 빈 사분면이 되고, 그건 여기서 잡혀야 한다.
        assert any(p["trMonthBp"] is not None for p in items)
        assert any(p["pctLastWeek"] is not None for p in items)
        assert any(p["spreadVolPct"] is not None for p in items)
        assert any(p["relRv"] is not None for p in items)
        assert any(p["score"] is not None for p in items)
        # 사분면 y축과 Score 절대축 입력은 **다른 통계**다 — 같은 값이면 수준
        # 감쇠가 사라졌다는 뜻이고, 그 회귀를 2026-08-20 에 한 번 냈다.
        both = [p for p in items if p["pctLastWeek"] is not None
                and p["spreadVolPct"] is not None]
        assert any(p["pctLastWeek"] != p["spreadVolPct"] for p in both)
        # 랭크·랭크 Δ [OWNER 2026-08-19] — 랭크는 Score 있는 항목에 1..K 연속,
        # Score 없는 항목엔 없다. Δ 는 전일 랭크가 있는 항목에만 숫자다.
        ranks = sorted(p["rank"] for p in items if p["rank"] is not None)
        scored = [p for p in items if p["score"] is not None]
        assert ranks == list(range(1, len(scored) + 1))
        assert all(p["rank"] is None for p in items if p["score"] is None)
        assert any(p["rankDelta"] is not None for p in items)
        # 만기 보유 후보는 항목 대신 제외 목록에서 이유를 말한다
        assert any("만기 보유" in e["reason"] for e in credit["exclusions"])
        # 3년 초과는 이 화면 밖 [OWNER 2026-08-20] — 항목엔 없고 제외가 말한다
        assert all(p["years"] <= rv.MAX_YEARS for p in items)
        assert any("3년까지만" in e["reason"] for e in credit["exclusions"])

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
        """인하(−25bp) 오버라이드는 조달을 낮춰 캐리를 **키운다** — 방향 핀.

        회의 날짜는 **달력에서 계산한다.** 지나간 회의는 캐리 지평 밖이라
        오버라이드가 아무것도 안 움직이고, 그러면 이 핀이 방향이 아니라 날짜가
        지났다는 사실을 시험하게 된다 — 박아 뒀던 2026-08-27 이 그날이 지나며
        정확히 그렇게 깨졌다(2026-09-01, `35.04 > 35.04`).
        """
        base = client.get("/api/rv/analysis").json()
        asof = dt.date.fromisoformat(base["asof"]["creditMatrix"])
        nxt = next((d for d in MPC_DATES if d > asof), None)
        # 달력이 말라도 StopIteration 으로 죽지 않게 — 고칠 곳을 말한다.
        assert nxt, f"{asof} 이후 회의가 달력에 없어요 — app.policy.MPC_DATES 를 늘리세요"
        cut = client.get(
            "/api/rv/analysis", params={"mpc": f"{nxt.isoformat()}:-25"}
        ).json()
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
