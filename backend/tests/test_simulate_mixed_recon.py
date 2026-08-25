# -*- coding: utf-8 -*-
"""시뮬레이션 일별 대사 — 스왑·채권 **각자 자기 표** [OWNER, 2026-08-25].

2026-08-21 판은 채권 성분을 스왑 표(`irsDailyReconciliation`)에 합산해 표합을
헤드라인과 맞췄다. 그 판이 드러낸 근본 문제 — 채권 다리에 롤다운 항이 아예
없었다(스왑 = unchanged term structure, 채권 = unchanged yields) — 를 chart.py
의 bondRolldown 누적기(bond_roll.py)가 채우면서, 채권 대사는
`bondDailyReconciliation` 이라는 자기 표로 독립했다.

이 파일이 지는 명제:
    ① 두 표가 각자 서고(스왑만/채권만/혼합), 스왑 표에는 조달이라는 질문이 없다.
    ② 각 표의 세로합 = 자기 소계, 두 소계의 합 = 헤드라인.
    ③ 가로 항등식 — 스왑: 평가+캐리+롤다운 = 그날 손익.
                    채권: 평가+캐리+롤다운+조달 = 그날 손익.
    ④ 채권 표는 chart.py 가 **이미 낸** 누적 계열(`decompositionDaily`)의
       차분이다 — 두 번째 정의 금지.
    ⑤ 롤다운 레인: 우상향 동결 커브 위 매수 채권의 롤은 양수, 평탄 커브는 0,
       공급자 부재는 «롤 0 + rollBasis.applied=False» 로 정직하게 강등.

커브 공급자는 모듈 픽스처가 **명시적으로 주입**한다 — 기동 여부(SQL 연결)에
따라 수치가 흔들리면 이 파일의 명제가 데이터 명제가 되어 버린다.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from irs_pricer.services.simulation import bond_roll

BOND = {
    "id": "b1", "name": "국고채 3Y", "book": "직접입력", "bondType": "bond",
    "sector": "국고채", "couponRate": 3.0, "notional": 10_000_000_000,
    "evaluationAmount": 10_000_000_000, "mtmYield": 3.0,
    "duration": 2.8, "pvbp": 2_800_000, "tenor": "3Y",
    "remainingDays": 1095, "krdMap": {"3Y": 2_800_000},
}

SWAP = {
    "id": "s1", "name": "3Y", "book": "직접입력", "bondType": "swap",
    "sector": "IRS", "couponRate": 3.2, "frequency": 4,
    "notional": 10_000_000_000, "maturityDate": "2029-07-15",
    "evaluationAmount": 0, "duration": 0, "pvbp": 0, "tenor": "3Y",
    "remainingDays": 1095, "krdMap": {}, "direction": 1,
    "entryYield": 0, "entryYieldPurchase": 0, "durationWeight": 0,
    "startDate": "2026-07-15",
}

#: 우상향 동결 민평 커브 (decimal) — 잔존이 줄면 수익률이 내려 매수 롤이 양수다.
UPWARD = [(0.25, 0.030), (1.0, 0.032), (3.0, 0.034), (5.0, 0.036)]


@pytest.fixture(autouse=True)
def _frozen_curve(bond_roll_lane_off):
    """결정적 커브 주입 — conftest 의 lane-off 뒤에 얹혀(요청 관계 = 순서
    보증) SQL·기동 여부와 무관하게 같은 수를 낸다."""
    bond_roll.set_sector_curve_provider(lambda: {"국채": list(UPWARD)})
    yield


def _request(positions: list[dict]) -> dict:
    return {
        "positions": positions,
        "shockCurves": {
            "bondCurves": {"국채": [{"t": 1, "val": 10}, {"t": 5, "val": 15}]},
            "swapCurve": [{"t": 1, "val": 12}, {"t": 5, "val": 16}],
        },
        "dailyShockCurves": {"bondCurves": {}, "swapCurve": []},
        "fundingRate": 0.042,
        "fundingEvents": [],
        "simDays": 30,
        "shockType": "ramp",
        "shockMode": "matrix",
        "baseShockBp": 15,
        "baseDate": "2026-07-15",
        "irsCurves": [],
        "customPath": [{"day": 0, "bp": 0}, {"day": 30, "bp": 15}],
        "includeDistribution": False,
    }


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def _run(client: TestClient, positions: list[dict]) -> dict:
    r = client.post("/api/simulate", json=_request(positions))
    assert r.status_code == 200, r.text
    return r.json()


def _swap_rows(body: dict) -> list[dict]:
    return [r for r in (body.get("irsDailyReconciliation") or []) if not r.get("carryover")]


def _bond_rows(body: dict) -> list[dict]:
    tbl = body.get("bondDailyReconciliation") or {}
    return [r for r in (tbl.get("rows") or []) if not r.get("carryover")]


class TestTwoTablesStandApart:
    """① 각자 자기 표 — 스왑만/채권만/혼합에서 서는 표가 그 북을 말한다."""

    def test_swap_only_has_no_bond_table(self, client):
        body = _run(client, [dict(SWAP)])
        assert _swap_rows(body)
        assert body.get("bondDailyReconciliation") is None

    def test_bond_only_has_no_swap_table(self, client):
        body = _run(client, [dict(BOND)])
        assert body.get("irsDailyReconciliation") == []
        assert _bond_rows(body)

    def test_mixed_has_both(self, client):
        body = _run(client, [dict(SWAP), dict(BOND)])
        assert _swap_rows(body) and _bond_rows(body)

    def test_the_swap_table_has_no_funding_question(self, client):
        """스왑에는 조달이라는 질문 자체가 없다 — null 조차 싣지 않는다."""
        for row in _swap_rows(_run(client, [dict(SWAP), dict(BOND)])):
            assert "funding" not in row


class TestEachTableTotalsItsOwnBook:
    """② 세로합 = 자기 소계, 두 소계의 합 = 헤드라인."""

    def test_swap_rows_sum_to_the_swap_headline(self, client):
        body = _run(client, [dict(SWAP), dict(BOND)])
        rows = _swap_rows(body)
        assert sum(r["totalActual"] for r in rows) == pytest.approx(
            body["summary"]["finalSwap"], abs=len(rows)
        )

    def test_bond_rows_sum_to_the_bond_share(self, client):
        body = _run(client, [dict(SWAP), dict(BOND)])
        rows = _bond_rows(body)
        d = body["totalReturnDecomposition"]
        bond_share = d["bondMtm"] + d["bondCarry"] + d["bondRolldown"] + d["fundingCost"]
        assert sum(r["actual"] for r in rows) == pytest.approx(
            bond_share, abs=len(rows)
        )

    def test_the_two_subtotals_total_the_book(self, client):
        body = _run(client, [dict(SWAP), dict(BOND)])
        total = sum(r["totalActual"] for r in _swap_rows(body)) + sum(
            r["actual"] for r in _bond_rows(body)
        )
        assert total == pytest.approx(
            body["summary"]["finalTotal"],
            abs=len(_swap_rows(body)) + len(_bond_rows(body)),
        )


class TestRowsCloseAcross:
    """③ 가로 항등식 — 각 표가 자기 성분으로 닫힌다."""

    @pytest.mark.parametrize(
        "label, positions",
        [("스왑만", [dict(SWAP)]), ("혼합", [dict(SWAP), dict(BOND)])],
    )
    def test_every_swap_row(self, client, label, positions):
        for row in _swap_rows(_run(client, positions)):
            total = row["valuationPnl"] + row["carryPnl"] + row["rolldownPnl"]
            assert total == pytest.approx(row["totalActual"], abs=2), f"{label} {row['date']}"

    @pytest.mark.parametrize(
        "label, positions",
        [("채권만", [dict(BOND)]), ("혼합", [dict(SWAP), dict(BOND)])],
    )
    def test_every_bond_row(self, client, label, positions):
        for row in _bond_rows(_run(client, positions)):
            total = row["valuation"] + row["carry"] + row["rolldown"] + row["funding"]
            assert total == pytest.approx(row["actual"], abs=3), f"{label} {row['date']}"
        # 조달은 서버가 이미 음수로 준다 — 화면이 부호를 다시 주지 않는다.
        assert all(
            (r["funding"] or 0) <= 0
            for r in _bond_rows(_run(client, positions))
        )


class TestNoSecondDefinition:
    """④ 채권 표 = `decompositionDaily` 누적의 차분 — 산술은 한 군데에만."""

    def test_bond_columns_match_decomposition_daily(self, client):
        body = _run(client, [dict(SWAP), dict(BOND)])
        rows = _bond_rows(body)
        daily = body["decompositionDaily"]
        tol = len(rows) * 2

        # 평가 — 백워드 차분: 기간 합 = 누적 bondMtm 끝 − 시작.
        assert sum(r["valuation"] for r in rows) == pytest.approx(
            daily[-1]["bondMtm"] - daily[0]["bondMtm"], abs=tol
        )
        # 캐리·롤다운·조달 — 포워드 차분: 기간 합 = 같은 끝점 차이.
        assert sum(r["carry"] for r in rows) == pytest.approx(
            daily[-1]["bondCarry"] - daily[0]["bondCarry"], abs=tol
        )
        assert sum(r["rolldown"] for r in rows) == pytest.approx(
            daily[-1]["bondRolldown"] - daily[0]["bondRolldown"], abs=tol
        )
        assert sum(r["funding"] for r in rows) == pytest.approx(
            daily[-1]["fundingCost"] - daily[0]["fundingCost"], abs=tol
        )

    def test_the_swap_table_is_untouched_by_the_bond(self, client):
        """스왑 표는 채권이 있든 없든 한 글자도 다르지 않다 — v1 계약 복원."""
        mixed = _swap_rows(_run(client, [dict(SWAP), dict(BOND)]))
        swap = _swap_rows(_run(client, [dict(SWAP)]))
        assert mixed == swap


class TestTheRollLane:
    """⑤ 롤다운 레인 — 있어야 할 항이 실제로 서고, 없을 때는 말한다."""

    def test_upward_curve_long_bond_rolls_positive(self, client):
        body = _run(client, [dict(BOND)])
        d = body["totalReturnDecomposition"]
        assert d["bondRolldown"] > 0, "우상향 커브 위 매수 채권의 롤은 양수여야 한다"
        assert body["bondDailyReconciliation"]["rollBasis"] == {
            "applied": True, "missing": [],
        }

    def test_identity_includes_the_roll(self, client):
        """항등식: bondMtm + bondCarry + bondRolldown + fundingCost (+스왑) == total."""
        d = _run(client, [dict(SWAP), dict(BOND)])["totalReturnDecomposition"]
        parts = (
            d["bondMtm"] + d["bondCarry"] + d["bondRolldown"] + d["fundingCost"]
            + d["swapMtm"] + d["swapCarry"] + d["swapRolldown"]
        )
        assert parts == pytest.approx(d["total"], abs=1)

    def test_a_flat_curve_rolls_zero(self, client):
        bond_roll.set_sector_curve_provider(lambda: {"국채": [(0.25, 0.03), (5.0, 0.03)]})
        try:
            d = _run(client, [dict(BOND)])["totalReturnDecomposition"]
            assert d["bondRolldown"] == pytest.approx(0.0, abs=1)
        finally:
            bond_roll.set_sector_curve_provider(lambda: {"국채": list(UPWARD)})

    def test_sub_month_tenor_labels_in_days(self):
        """1/365 노드는 «1D» 다 — 개월 반올림은 «0M» 을 만든다(실측 2026-08-25,
        FE 전체 커브가 실리자 첫 열이 0M 으로 섰다)."""
        from irs_pricer.services.simulation.bond_recon import _tenor_label

        assert _tenor_label(1 / 365) == "1D"
        assert _tenor_label(7 / 365) == "7D"
        assert _tenor_label(0.25) == "3M"
        assert _tenor_label(2.5) == "2.5Y"

    def test_matrix_with_empty_bond_curves_estimates_zero(self, client):
        """Δbp 는 엔진이 실제로 소비한 것만 말한다 [2026-08-25 실측 결함].

        FE 가 bondCurves 를 비워 보내면 matrix 엔진은 채권에 0 을 적용한다 —
        그때 이 표가 base_shock 램프를 «추정»으로 그리면, 엔진이 안 값매긴
        250bp 가 표에 서고 평가 0 과의 다리가 없다(첫 판이 정확히 그랬다).
        폴백 열은 라벨 «—» 에 Δbp 0 이어야 한다."""
        req = _request([dict(BOND)])
        req["shockCurves"]["bondCurves"] = {}
        r = client.post("/api/simulate", json=req)
        assert r.status_code == 200, r.text
        body = r.json()
        tbl = body["bondDailyReconciliation"]
        assert [c["label"] for g in tbl["groups"] for c in g["cols"]] == ["—"]
        rows = [x for x in tbl["rows"] if not x.get("carryover")]
        assert all(v == 0.0 for x in rows for v in x["dailyDbp"].values())
        assert all(x["totalEstPnl"] == 0 for x in rows)
        # 엔진도 실제로 0 을 값매겼다 — 표와 엔진이 같은 말을 한다.
        assert body["totalReturnDecomposition"]["bondMtm"] == 0.0

    def test_no_provider_degrades_honestly(self, client):
        """공급자 부재 = 종전(unchanged-yields) 동작 + applied=False. 조용한 0 금지."""
        bond_roll.set_sector_curve_provider(None)
        try:
            body = _run(client, [dict(BOND)])
            assert body["totalReturnDecomposition"]["bondRolldown"] == 0.0
            basis = body["bondDailyReconciliation"]["rollBasis"]
            assert basis["applied"] is False
            assert basis["missing"] == ["국채"]
        finally:
            bond_roll.set_sector_curve_provider(lambda: {"국채": list(UPWARD)})


class TestTheKrdTableKeepsBondTenors:
    """KRD 표(`pvbpSensitivity`)의 열이 **포지션이 실제로 든 테너**를 따라간다.

    이 표의 열은 `qe.KRD_NAMES` — IRS 커브의 노드다. 채권의 `krdMap` 은 **민평
    격자**에 살아서 2.5Y·20Y·30Y 가 그 목록에 없다. 종전에는 그 줄들이 통째로
    떨어져 표가 «리스크 0» 이라고 말했다(실측: 국고채 30Y 100억의 15,965,062원/bp
    가 합계에 0).

    v2 화면은 아직 이 표를 안 그린다 — 그래서 더 위험하다. 나중에 붙이는 사람이
    밟을 자리이고, 그때는 이 숫자가 어디서 새는지 찾기 어렵다.
    """

    #: 민평에만 있는 만기 — IRS KRD 격자에 대응 노드가 없다.
    OFF_GRID = {"2.5Y": 2.5, "20Y": 20.0, "30Y": 30.0}

    def _bond_with(self, tenor: str, years: float) -> dict:
        p = dict(BOND)
        p["tenor"] = tenor
        p["remainingDays"] = int(years * 365)
        p["krdMap"] = {tenor: 5_000_000}
        return p

    @pytest.mark.parametrize("tenor,years", sorted(OFF_GRID.items()))
    def test_an_off_grid_bond_is_not_dropped(self, client, tenor, years):
        body = _run(client, [self._bond_with(tenor, years)])
        total = [r for r in body["pvbpSensitivity"] if r["sector"] == "합계"][0]
        assert total["total"] == pytest.approx(5_000_000, abs=1)
        assert tenor in total["tenors"], f"{tenor} 열이 안 섰다"

    def test_columns_stay_ascending_by_maturity(self, client):
        body = _run(client, [self._bond_with("2.5Y", 2.5)])
        cols = [t for t in body["pvbpSensitivity"][0]["tenors"] if t != "합계"]
        from irs_pricer.services.simulation.daily_valuation import parse_tenor_to_years

        years = [parse_tenor_to_years(t) for t in cols]
        assert years == sorted(years), "열이 만기순이 아니다"
        assert cols.index("2.5Y") == cols.index("2Y") + 1

    def test_an_on_grid_book_is_byte_identical(self, client):
        """아무도 격자 밖 테너를 안 들면 열 목록은 종전과 한 글자도 다르지 않다."""
        from irs_pricer.engine.quant_engine import KRD_NAMES

        body = _run(client, [dict(SWAP), dict(BOND)])
        cols = [t for t in body["pvbpSensitivity"][0]["tenors"] if t != "합계"]
        assert cols == list(KRD_NAMES)

    def test_a_zero_krd_does_not_add_a_column(self, client):
        """0 은 열을 세우지 않는다 — 빈 열을 늘리는 것도 표를 못 읽게 만든다."""
        p = self._bond_with("30Y", 30.0)
        p["krdMap"] = {"30Y": 0}
        body = _run(client, [p])
        cols = [t for t in body["pvbpSensitivity"][0]["tenors"] if t != "합계"]
        assert "30Y" not in cols
