# -*- coding: utf-8 -*-
"""시뮬레이션 일별 대사표가 **한 북 전체**를 센다 [2026-08-21].

시뮬레이션은 2026-08-14 부터 스왑과 현금채권을 한 포트폴리오에 담을 수 있었는데,
대사표는 `irsDailyReconciliation` — 이름 그대로 **스왑만** 세고 있었다. 결과는 두
가지였다:

    혼합 북    표의 합이 헤드라인과 조용히 어긋난다. 화면의 서랍 이름은 그냥
               「일별 대사」라 그 사실이 어디에도 안 적혀 있었다.
    채권만     par 커브가 없어 표가 **통째로 비었다**. 백테스트에서 같은 증상을
               같은 날 고쳤다(`app/mixedbook.py`).

이 파일이 지는 명제는 하나다: **표의 합 = 헤드라인.** 세 가지 북(스왑만·채권만·
혼합)에서 그것이 성립하는지만 본다. 성분의 옳고 그름은 저쪽 파일들(골든·carry_split
·harden1)이 이미 핀으로 박고 있다.

산술을 새로 쓰지 않았다는 것도 여기서 같이 지킨다: 대사표의 채권 몫은 chart.py 의
`decompositionDaily`(누적)의 차분이어야 하고, 두 계열이 갈리면 그건 두 번째 정의가
생겼다는 뜻이다.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

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


def _body_rows(body: dict) -> list[dict]:
    return [r for r in (body.get("irsDailyReconciliation") or []) if not r.get("carryover")]


class TestTheTableTotalsTheBook:
    """표의 합 = 헤드라인. 이 표가 있는 이유가 그것이다."""

    @pytest.mark.parametrize(
        "label, positions",
        [
            ("스왑만", [dict(SWAP)]),
            ("채권만", [dict(BOND)]),
            ("혼합", [dict(SWAP), dict(BOND)]),
        ],
    )
    def test_rows_sum_to_the_headline(self, client, label, positions):
        body = _run(client, positions)
        rows = _body_rows(body)
        assert rows, f"{label}: 대사표가 비었다"
        total = sum(r["totalActual"] for r in rows)
        # 허용 오차는 행마다 1원(라운딩) — 그 이상은 성분이 빠진 것이다.
        assert total == pytest.approx(
            body["summary"]["finalTotal"], abs=len(rows)
        ), f"{label}: 표 {total:,} 대 헤드라인 {body['summary']['finalTotal']:,}"

    def test_the_mixed_gap_was_exactly_the_bond(self, client):
        """혼합 북의 표가 스왑만 셌다는 것은 «표 − 스왑만 북» 으로 잡힌다."""
        mixed = _run(client, [dict(SWAP), dict(BOND)])
        bond_only = _run(client, [dict(BOND)])
        rows = _body_rows(mixed)
        bond_rows = _body_rows(bond_only)
        # 채권 몫은 채권만 돌린 북의 헤드라인이다 — 혼합 표에 그만큼이 들어 있다.
        assert sum(r["totalActual"] for r in rows) - sum(
            r["totalActual"] for r in bond_rows
        ) == pytest.approx(mixed["summary"]["finalSwap"], abs=len(rows) * 2)


class TestRowsCloseAcross:
    """가로로도 닫힌다 — 평가 + 캐리 + 롤다운 + 조달 = 그날 손익."""

    @pytest.mark.parametrize(
        "label, positions",
        [("스왑만", [dict(SWAP)]), ("채권만", [dict(BOND)]), ("혼합", [dict(SWAP), dict(BOND)])],
    )
    def test_every_row(self, client, label, positions):
        for row in _body_rows(_run(client, positions)):
            total = (
                row["valuationPnl"] + row["carryPnl"] + row["rolldownPnl"]
                + (row.get("funding") or 0)
            )
            assert total == pytest.approx(row["totalActual"], abs=2), f"{label} {row['date']}"


class TestNoSecondDefinition:
    """채권 몫은 chart.py 가 **이미 낸** 누적 계열의 차분이어야 한다."""

    def test_bond_components_match_decomposition_daily(self, client):
        """혼합 − 스왑만 = 채권 몫, 그리고 그 채권 몫은 `decompositionDaily` 의
        누적 끝점 차이와 같아야 한다. 두 계열이 갈리면 대사표가 채권 산술을 자기
        나름대로 다시 쓴 것이고, 그게 이 리포가 «두 번째 정의» 라 부르는 결함이다.
        """
        mixed = _run(client, [dict(SWAP), dict(BOND)])
        swap = _run(client, [dict(SWAP)])
        m_rows, s_rows = _body_rows(mixed), _body_rows(swap)
        assert len(m_rows) == len(s_rows)
        daily = mixed["decompositionDaily"]
        tol = len(m_rows) * 2

        # 평가 — 백워드 차분이라 기간 합은 누적 bondMtm 의 끝 − 시작이다.
        bond_val = sum(r["valuationPnl"] for r in m_rows) - sum(
            r["valuationPnl"] for r in s_rows
        )
        assert bond_val == pytest.approx(
            daily[-1]["bondMtm"] - daily[0]["bondMtm"], abs=tol
        )

        # 캐리 — 포워드 차분. 기간 합은 같은 끝점 차이다(조달은 자기 칸에 따로).
        bond_carry = sum(r["carryPnl"] for r in m_rows) - sum(
            r["carryPnl"] for r in s_rows
        )
        assert bond_carry == pytest.approx(
            daily[-1]["bondCarry"] - daily[0]["bondCarry"], abs=tol
        )

        # 조달 — 누적 조달의 끝 − 시작.
        assert sum(r.get("funding") or 0 for r in m_rows) == pytest.approx(
            daily[-1]["fundingCost"] - daily[0]["fundingCost"], abs=tol
        )

    def test_funding_is_absent_without_bonds(self, client):
        """스왑에는 조달이라는 질문이 없다 — 값이 0 이 아니라 없어야 한다.

        응답이 고정 모델을 지나므로 전선에는 `null` 로 실린다. 화면은 «숫자가
        하나라도 있나» 로 열을 세운다(`ReconStack` 의 `hasFunding`).
        """
        rows = _body_rows(_run(client, [dict(SWAP)]))
        assert rows
        assert all(r.get("funding") is None for r in rows)

    def test_funding_is_a_number_with_bonds(self, client):
        rows = _body_rows(_run(client, [dict(SWAP), dict(BOND)]))
        assert any(isinstance(r.get("funding"), int) for r in rows)
        # 서버가 이미 음수로 준다 — 화면이 부호를 다시 주지 않는다.
        assert all((r.get("funding") or 0) <= 0 for r in rows)


class TestTheGridStaysSwapOnly:
    """KRD 격자는 스왑의 것이다 — 채권을 근사로 채워 넣지 않는다.

    시뮬의 채권은 테너별 KRD 를 매일 재계산하지 않는다(하나의 pvbp 를 잔존으로
    감쇠시키고 섹터 커브에서 한 숫자를 보간한다). 진입 KRD 를 스케일해 채우면
    진짜 재계산인 스왑 열과 정적 배분인 채권 열이 한 표에서 같아 보인다.
    """

    def test_a_bond_only_book_has_a_zero_grid(self, client):
        rows = _body_rows(_run(client, [dict(BOND)]))
        assert rows
        assert all(v == 0 for v in rows[0]["pvbp"].values())
        assert all(v == 0 for v in rows[0]["pnl"].values())

    def test_the_estimate_explains_the_swap_only(self, client):
        """추정(격자 × Δbp)이 설명하는 대상은 스왑의 평가다. 채권 평가가 거기
        섞이면 잔차가 채권만큼 부풀어 대사표가 자기 잔차를 못 읽는다."""
        mixed = _body_rows(_run(client, [dict(SWAP), dict(BOND)]))
        swap = _body_rows(_run(client, [dict(SWAP)]))
        assert [r["totalEstPnl"] for r in mixed] == [r["totalEstPnl"] for r in swap]
        assert [r["residual"] for r in mixed] == [r["residual"] for r in swap]


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
        """아무도 격자 밖 테너를 안 들면 열 목록은 종전과 한 글자도 다르지 않다 —
        이 수리가 **가산적**이라는 것이 골든이 그대로 통과하는 이유다."""
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
