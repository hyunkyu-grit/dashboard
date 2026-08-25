# -*- coding: utf-8 -*-
"""시뮬 IRS 스냅샷의 SQL 이관 [OWNER, 2026-08-25 — 감사록 F2 첫 발현의 근본 수정].

병: 시뮬의 DATA_DIR 워크북 복사가 아침 파이프라인에 매여 있고, 그 파이프라인이
멈추면(실측 08-19 정지) 스왑이 «당일 IRS 호가 없음»으로 통째로 제외됐다 —
SQL(mkt_irs_close)에는 그날 호가가 있는데도. 자산스왑 북에서는 채권 다리만
값이 나오고 스왑 다리가 전부 공란이 되는, 오너가 직접 목격한 그 화면이다.

수정: app 이 기동 시 자기 병합 데이터셋(load_dataset_merged — SQL 우선)을
`irsdata.set_dataset` 으로 주입하고, 스냅샷·픽싱·날짜목록이 그것을 읽는다.
백테스트와 시뮬이 같은 데이터 한 벌을 본다. 미주입(테스트 기본 — conftest
`sql_snapshot_off`)은 종전 워크북 경로 그대로라 골든이 결정적으로 남는다.

이 파일이 지는 명제:
    ① 주입본에만 있는 날짜의 스냅샷·픽싱이 주입본 값으로 나온다.
    ② 주입을 내리면 그 날짜는 종전대로 없다(워크북 경로 불변).
    ③ E2E: 워크북에 없는 날짜의 스왑 시뮬이 제외 없이 값매겨진다 —
       스왑 대사표가 서고, 자산스왑의 두 다리가 다 산다.
"""

from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.dataset import Dataset
from app.main import app
from irs_pricer.loaders import irsdata as irsdata_loader
from irs_pricer.services import market_data_service

#: 워크북이 절대 가질 수 없는 미래 영업일 — 주입본만이 이 날을 안다.
D = dt.date(2026, 9, 22)   # 화요일
NODES = ["1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"]
RATES = {"1D": 2.60, "3M": 2.94, "6M": 3.05, "9M": 3.18, "1Y": 3.30,
         "1.5Y": 3.45, "2Y": 3.55, "3Y": 3.71, "5Y": 3.96, "10Y": 4.17}


def _fake_dataset() -> Dataset:
    dates = [D - dt.timedelta(days=1), D]
    return Dataset(
        dates=dates,
        series={n: [RATES[n] - 0.01, RATES[n]] for n in NODES},
        tenor_order=list(NODES),
        source="sql",
    )


@pytest.fixture()
def injected():
    irsdata_loader.set_dataset(_fake_dataset())
    yield
    irsdata_loader.set_dataset(None)


class TestSnapshotRidesTheInjectedDataset:
    def test_injected_date_prices(self, injected):
        snap = market_data_service.load_snapshot(D)
        assert snap.valuation_date == D
        assert snap.cd_rate == pytest.approx(0.0294)
        assert snap.on_rate == pytest.approx(0.0260)
        got = {(q.tenor_years, q.tenor_months): q.rate for q in snap.swap_quotes}
        assert got[(3, None)] == pytest.approx(0.0371)
        assert got[(2, 18)] == pytest.approx(0.0345)   # 1.5Y 핀 규약 그대로

    def test_fixings_ride_along(self, injected):
        fx = market_data_service.load_fixings()
        assert fx[D] == pytest.approx(0.0294)

    def test_without_injection_the_date_is_absent(self):
        """워크북 경로 불변 — 주입이 없으면 종전 그대로 그날은 없다."""
        with pytest.raises(ValueError):
            market_data_service.load_snapshot(D)


class TestEndToEndSwapsComeAlive:
    SWAP = {
        "id": "s1", "name": "3Y", "book": "직접입력", "bondType": "swap",
        "sector": "IRS", "couponRate": 3.71, "frequency": 4,
        "notional": 10_000_000_000, "maturityDate": "2029-09-22",
        "evaluationAmount": 0, "duration": 0, "pvbp": 0, "tenor": "3Y",
        "remainingDays": 1095, "krdMap": {}, "direction": 1,
        "entryYield": 0, "entryYieldPurchase": 0, "durationWeight": 0,
        "startDate": "2026-09-22",
    }

    def _req(self):
        return {
            "positions": [dict(self.SWAP)],
            "shockCurves": {"bondCurves": {}, "swapCurve": [{"t": 1, "val": 10}, {"t": 5, "val": 10}]},
            "dailyShockCurves": {"bondCurves": {}, "swapCurve": []},
            "fundingRate": 0.0285, "fundingEvents": [],
            "simDays": 30, "shockType": "ramp", "shockMode": "matrix",
            "baseShockBp": 10, "baseDate": D.isoformat(),
            # 실전 브리지 그대로 비운다 — 백엔드 스냅샷 저장소가 채워야 한다.
            "irsCurves": [],
            "customPath": [{"day": 0, "bp": 0}, {"day": 30, "bp": 10}],
            "includeDistribution": False,
        }

    def test_swap_prices_from_injected_snapshot(self, injected):
        r = TestClient(app).post("/api/simulate", json=self._req())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["exclusions"] == []          # «당일 IRS 호가 없음» 소멸
        d = body["totalReturnDecomposition"]
        assert d["swapMtm"] is not None and d["swapCarry"] is not None
        rows = [x for x in body["irsDailyReconciliation"] if not x.get("carryover")]
        assert rows, "스왑 대사표가 서야 한다"

    def test_without_injection_the_same_request_excludes(self):
        r = TestClient(app).post("/api/simulate", json=self._req())
        assert r.status_code == 200, r.text
        body = r.json()
        assert [x["assetClass"] for x in body["exclusions"]] == ["swap"]
