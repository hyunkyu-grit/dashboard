# -*- coding: utf-8 -*-
"""Cash Bond 엔진의 핀 [OWNER, 2026-08-14].

**합성 민평으로 돈다.** `credit_matrix` 는 SQL 에만 있고(이 배포의 `data/` 에는
Credit Matrix 워크북이 없다), 테스트가 사무실 네트워크 너머의 MariaDB 에
매달리면 비행기에서 게이트를 못 돌린다. 여기서 재는 것은 엔진의 산술이지 DB 의
가용성이 아니므로, 커브를 손으로 세운다. SQL 로더 자체는 `test_creditmatrix_*`
가 닿을 수 있을 때만 검사한다.

조달은 `base`(= data/bokbaserate.xlsx, 로컬)만 쓴다 — `call` 은 SQL 이다.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app import cashbond as cb
from app import creditmatrix as cm
from app import funding as fd

N = 1e10  # 100억


def _flat_curve(rate_pct: float) -> dict[str, float]:
    return {t: rate_pct for t in cm.TENOR_LABELS}


def synth(
    days: int = 400,
    curve=lambda i: _flat_curve(3.0),
    types=("KTB",),
    start=dt.date(2024, 1, 1),
) -> cm.CreditMatrix:
    """영업일 하루 간격의 합성 민평. `curve(i)` 가 그날의 {테너: %} 를 준다.

    달력을 주말 없이 하루씩 세는 것은 의도적이다 — 여기서 재는 것은 날짜 산술이
    아니라 가격 산술이고, 연속 달력이라야 '92일 뒤' 같은 단언이 눈으로 읽힌다.
    """
    dates = [start + dt.timedelta(days=k) for k in range(days)]
    values: dict[tuple[str, str], list[float | None]] = {}
    for t in types:
        for label in cm.TENOR_LABELS:
            values[(t, label)] = [curve(i).get(label) for i in range(days)]
    return cm.CreditMatrix(dates=dates, values=values, watermark=("synthetic", days))


SPEC0 = fd.FundingSpec("base", 0.0)


# ── 가격의 기준선 ───────────────────────────────────────────────────────────


class TestParIdentity:
    """쿠폰 = 수익률이면 값은 정확히 액면이다. 이 화면 전체가 그 위에 선다."""

    @pytest.mark.parametrize("tenor", cm.TENOR_LABELS)
    @pytest.mark.parametrize("y", [0.001, 0.0378, 0.05, 0.15])
    def test_entry_price_is_exactly_par(self, tenor, y):
        n = cb.periods_for(tenor)
        dirty, accrued, paid = cb.price(y, y, n, 0.0)
        assert abs(dirty - 1.0) < 1e-12, (tenor, y, dirty)
        assert accrued == 0.0
        assert paid == 0.0

    def test_a_coupon_above_the_yield_prices_above_par(self):
        n = cb.periods_for("10Y")
        assert cb.price(0.03, 0.04, n, 0.0)[0] > 1.0
        assert cb.price(0.04, 0.03, n, 0.0)[0] < 1.0

    def test_coupons_pay_on_the_quarter_and_accrual_resets(self):
        n = cb.periods_for("3Y")
        c = 0.04 / 4
        just_before = cb.price(0.04, 0.04, n, 0.25 - 1e-7)
        on_the_day = cb.price(0.04, 0.04, n, 0.25)
        # 직전: 한 기 전액이 경과이자로 서 있고 받은 이표는 아직 0
        assert just_before[1] == pytest.approx(c, rel=1e-4)
        assert just_before[2] == 0.0
        # 당일: 경과이자는 0 으로 떨어지고 그 금액이 받은 이표로 넘어간다
        assert on_the_day[1] == 0.0
        assert on_the_day[2] == pytest.approx(c)
        # dirty + 받은 이표는 그 경계에서 이어진다 (톱니가 없다)
        assert just_before[0] + just_before[2] == pytest.approx(
            on_the_day[0] + on_the_day[2], abs=1e-6
        )


# ── 백테스트의 항등식 ───────────────────────────────────────────────────────


class TestDecomposition:
    def test_entry_day_is_zero_in_every_bucket(self):
        """진입한 날 손익은 0 이다 — par 로 샀으니까. IRS 쪽에서 진입일에
        롤다운이 서던 결함(2026-08-14 개시 분리)의 현금채권 판 예방핀이다."""
        m = synth()
        pos = cb.BondPosition("CB", "KTB", "3Y", 1, N, m.dates[0], m.dates[0])
        r = cb.run_backtest(m, None, [pos], SPEC0)
        p = r["positions"][0]
        for k in ("pnl", "valuation", "carry", "rolldown", "funding", "startup"):
            assert p[k] == 0, k
        assert r["points"][0]["pnl"] == 0

    def test_the_five_buckets_sum_to_the_pnl(self):
        m = synth(days=500, curve=lambda i: {
            t: 3.0 + 0.5 * cm.TENOR_YEARS[t] / 10 + 0.002 * i for t in cm.TENOR_LABELS
        })
        book = [
            cb.BondPosition("CB", "KTB", "3Y", 1, N, m.dates[10]),
            cb.BondPosition("CB", "KTB", "10Y", 1, 2 * N, m.dates[40], m.dates[300]),
            cb.BondPosition("CB", "KTB", "1Y", 1, N, m.dates[5]),
        ]
        r = cb.run_backtest(m, None, book, SPEC0)
        for p in r["positions"]:
            parts = p["valuation"] + p["carry"] + p["rolldown"] + p["funding"] + p["startup"]
            assert abs(parts - p["pnl"]) <= 2, p["id"]

    def test_a_frozen_flat_curve_is_carry_and_nothing_else(self):
        """커브가 평평하고 멈춰 있으면 남는 것은 쿠폰뿐이다.

        평가는 정확히 0 이다 — 커브가 안 움직였으니까. 롤다운은 정확히 0 이
        **아니라** 예산 안이다: par 채권의 clean 가격은 이표기간 안에서 완전히
        평평하지 않다(할인은 복리, 경과이자는 단리라는 관행 조합의 결과로 기간
        중앙에서 액면의 1.2e-5 만큼 처졌다가 이표일에 돌아온다). 그 톱니는
        clean 변화이므로 롤다운 칸에 앉는 것이 맞고, 크기는 액면의 0.01bp
        미만이어야 한다. 이 예산이 깨지면 규약이 아니라 산술이 틀린 것이다.
        """
        m = synth(days=200, curve=lambda i: _flat_curve(3.0))
        entry = m.dates[0]
        pos = cb.BondPosition("CB", "KTB", "5Y", 1, N, entry, m.dates[92])
        r = cb.run_backtest(m, None, [pos], SPEC0)
        p = r["positions"][0]
        assert p["coupon"] == pytest.approx(3.0, abs=1e-9)
        assert abs(p["valuation"]) <= 1
        assert abs(p["rolldown"]) / N * 1e4 <= 0.01, p["rolldown"]
        # 92일치 쿠폰. 같은 규약 차이만큼만 어긋난다.
        expected = N * 0.03 * 92 / 365
        assert p["carry"] == pytest.approx(expected, rel=2e-4)

    def test_the_clean_price_sawtooth_stays_inside_its_budget(self):
        """위 예산의 근거를 직접 잰다 — 이표기간 안에서 par 채권의 clean 이
        얼마나 처지는가. 액면의 2e-5 를 넘으면 할인/경과이자 규약이 어긋난
        것이다."""
        n = cb.periods_for("10Y")
        worst = max(
            abs(cb.price(0.04, 0.04, n, k / 10_000)[0] - cb.price(0.04, 0.04, n, k / 10_000)[1] - 1.0)
            for k in range(0, 2500)
        )
        assert worst < 2e-5, worst

    def test_an_upward_curve_rolls_down_into_profit_for_a_buyer(self):
        """기울어진 커브가 멈춰 있으면 매수자는 롤다운으로 번다 — 잔존만기가
        줄며 더 낮은 금리로 값이 매겨진다. 평가는 여전히 0 이어야 한다."""
        m = synth(days=200, curve=lambda i: {
            t: 2.0 + 0.1 * cm.TENOR_YEARS[t] for t in cm.TENOR_LABELS
        })
        pos = cb.BondPosition("CB", "KTB", "5Y", 1, N, m.dates[0], m.dates[92])
        p = cb.run_backtest(m, None, [pos], SPEC0)["positions"][0]
        assert abs(p["valuation"]) <= 1, p["valuation"]
        assert p["rolldown"] > 0
        # 기울기 10bp/년 × 0.25년 = 2.5bp, 4.75Y 채권의 DV01 근방
        assert 5e6 < p["rolldown"] < 15e6, p["rolldown"]

    def test_selling_is_refused_rather_than_silently_priced(self):
        """매수뿐이다 [OWNER, 2026-08-14 — "국고채는 매도는 없는거고"].

        엔진은 부호를 다룰 줄 알지만(아래에서 거울임을 확인한다) **북 단계에서
        막는다**: 공매도는 채권을 빌리는 것이고 그 대차료를 이 화면은 모른다.
        모르는 비용을 0 으로 두면 공매도가 늘 이기는 백테스트가 된다."""
        m = synth(days=200)
        with pytest.raises(cb.CashBondError, match="매수만"):
            cb.run_backtest(
                m, None, [cb.BondPosition("CB", "KTB", "3Y", -1, N, m.dates[10])], SPEC0
            )

    def test_the_engine_itself_is_sign_symmetric(self):
        """거절은 상품의 규칙이지 산술의 한계가 아니다 — 다리 단계에서는 부호가
        정확히 거울이다. 나중에 대차료가 생겨 매도를 열 때, 그때 열 것이 이미
        맞다는 증거."""
        m = synth(days=200, curve=lambda i: {
            t: 3.0 + 0.05 * cm.TENOR_YEARS[t] + 0.003 * i for t in cm.TENOR_LABELS
        })
        e, x = m.dates[10], m.dates[120]
        sample = list(range(10, 121))
        out = []
        for d in (1, -1):
            pos = cb.BondPosition("CB", "KTB", "3Y", d, N, e, x)
            rec, _own, _prev = cb.run_bond_leg(m, pos, cb._bond_leg(m, pos), sample, SPEC0)
            out.append(rec)
        for k in ("valuation", "carry", "rolldown"):
            assert abs(out[0][k] + out[1][k]) <= 2, k
        assert out[1]["funding"] == 0  # 조달은 매수 원금에만 붙는다


class TestFunding:
    def test_funding_follows_the_policy_staircase_not_a_constant(self):
        """2020년 구간은 그 시점 기준금리로 조달해야 한다 — 오늘 값으로 전
        기간을 칠하면 옛 구간의 캐리가 통째로 거짓이 된다."""
        spec = fd.FundingSpec("base", 10.0)
        old = fd.rate_on(spec, dt.date(2020, 6, 1))
        new = fd.rate_on(spec, dt.date(2026, 8, 13))
        assert old < new
        assert old == pytest.approx(0.0050 + 0.0010, abs=1e-9)   # 기준금리 0.50%
        assert new == pytest.approx(0.0275 + 0.0010, abs=1e-9)   # 기준금리 2.75%

    def test_cost_is_act_365_on_the_purchase_price(self):
        spec = fd.FundingSpec("base", 10.0)
        d0, d1 = dt.date(2026, 7, 16), dt.date(2026, 8, 13)  # 인상 이후 구간 28일
        got = fd.cost_between(spec, d0, d1, N)
        assert got == pytest.approx(N * 0.0285 * 28 / 365, rel=1e-9)

    def test_the_spread_moves_the_cost_linearly(self):
        d0, d1 = dt.date(2026, 7, 16), dt.date(2026, 8, 13)
        a = fd.cost_between(fd.FundingSpec("base", 0.0), d0, d1, N)
        b = fd.cost_between(fd.FundingSpec("base", 10.0), d0, d1, N)
        assert b - a == pytest.approx(N * 0.0010 * 28 / 365, rel=1e-9)

    def test_a_wild_spread_is_refused_rather_than_silently_priced(self):
        with pytest.raises(fd.FundingError):
            fd.FundingSpec("base", 10_000.0).validated()
        with pytest.raises(fd.FundingError):
            fd.FundingSpec("무엇", 10.0).validated()


class TestSpanAndUniverse:
    def test_a_bond_stops_at_its_own_maturity(self):
        m = synth(days=400)
        pos = cb.BondPosition("CB", "KTB", "3M", 1, N, m.dates[0])
        p = cb.run_backtest(m, None, [pos], SPEC0)["positions"][0]
        assert p["matured"] is True
        # 91.25일 = 3개월. 하루 간격 달력이라 그 자리에서 멈춘다.
        assert (dt.date.fromisoformat(p["exit"]) - m.dates[0]).days == 91

    def test_a_tenor_the_type_does_not_have_is_refused(self):
        """통안채 5Y 처럼 **없는 만기**는 조용히 보간하지 않고 세운다. 0 을
        금리로 읽는 것이 이 테이블의 가장 큰 함정이라(creditmatrix 주석),
        없는 것은 없다고 말해야 한다."""
        m = synth(types=("MSB",))
        m = cm.CreditMatrix(
            dates=m.dates,
            values={k: v for k, v in m.values.items() if cm.TENOR_YEARS[k[1]] <= 3.0},
            watermark=m.watermark,
        )
        assert m.tenors_for("MSB") == ["3M", "6M", "9M", "1Y", "1.5Y", "2Y", "2.5Y", "3Y"]
        with pytest.raises(cb.CashBondError):
            cb.run_backtest(m, None, [cb.BondPosition("CB", "MSB", "5Y", 1, N, m.dates[0])], SPEC0)

    def test_asset_swap_only_where_both_markets_have_the_tenor(self):
        m = synth()
        for tenor in ("2.5Y", "20Y", "30Y"):
            with pytest.raises(cb.CashBondError):
                cb.run_backtest(
                    m, None, [cb.BondPosition("ASW", "KTB", tenor, 1, N, m.dates[0])], SPEC0
                )

    def test_ids_round_trip_and_junk_is_refused(self):
        assert cb.parse_id("CB:KTB:3Y") == ("CB", "KTB", "3Y")
        assert cb.parse_id("ASW:CB1:10Y") == ("ASW", "CB1", "10Y")
        for bad in ("KTB:3Y", "XX:KTB:3Y", "CB:없음:3Y", "CB:KTB:4Y"):
            with pytest.raises(cb.CashBondError):
                cb.parse_id(bad)

    def test_the_eight_types_are_the_owners_list(self):
        """[OWNER, 2026-08-14] 여덟이다. CB2~CB5 는 테이블에 있어도 이 화면의
        유니버스가 아니다."""
        assert list(cm.BOND_TYPES) == [
            "KTB", "MSB", "KDB", "SPB", "BD", "CB1", "CARD", "OFB",
        ]
        assert cm.BOND_TYPES["OFB"] == "캐피탈채 AA-"  # 기타금융채를 이렇게 부른다


class TestZeroIsMissing:
    """SQL 은 없는 값을 0.0 으로 채운다(NULL 이 아니라). 0 을 금리로 읽으면
    통안채 10년이 0% 로 그려지고 보간이 커브 전체를 끌어내린다 — 이 리포에서
    가장 비싼 오독이라 규칙에 핀을 둔다."""

    def test_zero_is_read_as_missing_not_as_a_rate(self):
        assert cm.rate_or_none(0) is None
        assert cm.rate_or_none(0.0) is None
        assert cm.rate_or_none(None) is None
        assert cm.rate_or_none(3.777) == 3.777
        assert cm.rate_or_none(-0.5) == -0.5  # 음수 금리는 결측이 아니다

    def test_a_missing_tenor_is_absent_from_the_curve_never_zero(self):
        m = synth(days=3, curve=lambda i: {**_flat_curve(3.0), "30Y": None})
        pts = cm.curve_points(m, "KTB", 0)
        assert all(r > 0 for _y, r in pts)
        assert 30.0 not in [y for y, _r in pts]
        # 그 만기를 물으면 있는 마지막 점으로 평탄 외삽한다 — 0 이 아니다
        assert cm.yield_at(m, "KTB", 0, 30.0) == pytest.approx(0.03)


# ── 라우트 ──────────────────────────────────────────────────────────────────
# 여기서부터는 **SQL 이 닿아야** 돈다 — 민평의 유일한 출처이기 때문이다.
# 닿지 않으면 건너뛴다: 네트워크가 없다는 사실이 엔진의 결함으로 보고되면
# 게이트가 거짓말을 하는 것이다.


def _sql_reachable() -> bool:
    try:
        cm.watermark()
        return True
    except Exception:
        return False


pytestmark_live = pytest.mark.skipif(
    not _sql_reachable(), reason="credit_matrix SQL 에 닿지 않습니다"
)


@pytestmark_live
class TestRoutes:
    @pytest.fixture(scope="class")
    def client(self):
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as c:
            yield c

    def test_instruments_carry_every_row_precomputed(self, client):
        r = client.get("/api/cashbond/instruments")
        assert r.status_code == 200
        body = r.json()
        assert body["rows"], "행이 하나도 없다"
        ids = {row["id"] for row in body["rows"]}
        # 통안채는 3Y 까지만, 30Y 는 국고채·공사채만 — 데이터가 강제하는 제약
        assert "CB:MSB:3Y" in ids
        assert "CB:MSB:5Y" not in ids
        assert "CB:KTB:30Y" in ids
        assert "CB:BD:30Y" not in ids
        # 자산스왑은 양쪽에 있는 만기만
        assert "ASW:KTB:3Y" in ids
        assert "ASW:KTB:20Y" not in ids
        for row in body["rows"]:
            assert row["now"] is not None
            assert set(row["changes"]) == {"d1", "mtd", "ytd"}

    def test_backtest_runs_and_the_buckets_close(self, client):
        r = client.get(
            "/api/cashbond/backtest",
            params={"positions": "CB:KTB:3Y,1,1e10,2026-05-13", "basis": "base", "spreadBp": 10},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        p = body["positions"][0]
        parts = p["valuation"] + p["carry"] + p["rolldown"] + p["funding"] + p["startup"]
        assert abs(parts - p["pnl"]) <= 2
        assert p["funding"] < 0, "매수는 조달비용이 음수로 선다"
        assert body["funding"]["label"] == "기준금리 +10bp"

    def test_an_asset_swap_carries_the_swap_legs_startup(self, client):
        r = client.get(
            "/api/cashbond/backtest",
            params={"positions": "ASW:KTB:3Y,1,1e10,2026-05-13"},
        )
        assert r.status_code == 200, r.text
        p = r.json()["positions"][0]
        # 스왑 다리는 스팟 시작이라 개시가 산다 [OWNER, 2026-08-14]
        assert p["startup"] != 0
        assert p["swapPnl"] is not None
        assert p["aswSpread"] is not None

    def test_a_cash_bond_has_no_startup_night(self, client):
        r = client.get(
            "/api/cashbond/backtest",
            params={"positions": "CB:KTB:3Y,1,1e10,2026-05-13"},
        )
        # 이 채권은 진입일에 발행돼 진입일부터 경과이자가 붙는다 — 셀 밤이 없다
        assert r.json()["positions"][0]["startup"] == 0

    @pytest.mark.parametrize("bad", [
        "",                                    # 빈 요청
        "KTB,1,1e10,2026-05-13",               # id 문법 아님
        "CB:MSB:10Y,1,1e10,2026-05-13",        # 통안채에 없는 만기
        "ASW:KTB:20Y,1,1e10,2026-05-13",       # IRS 에 없는 만기
        "CB:KTB:3Y,1,1e10",                    # 필드 부족
    ])
    def test_bad_requests_are_refused_with_a_reason(self, client, bad):
        r = client.get("/api/cashbond/backtest", params={"positions": bad})
        assert r.status_code == 422, (bad, r.text)
        assert r.json()["detail"]

    def test_the_funding_setting_route_reports_its_source(self, client):
        r = client.get("/api/settings/funding", params={"basis": "call", "spreadBp": 25})
        assert r.status_code == 200
        body = r.json()
        assert body["basisLabel"] == "콜금리"
        assert body["label"] == "콜금리 +25bp"
        assert body["from"] < body["to"]
        assert {o["id"] for o in body["options"]} == {"base", "call"}
        bad = client.get("/api/settings/funding", params={"basis": "무엇"})
        assert bad.status_code == 422
