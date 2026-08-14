"""커브 표면 (app/surface.py) — Lab 의 두 번째 세입자.

여기서 잡는 것은 넷이다. 셋은 표면이 **거짓말할 수 있는 자리**이고, 하나는
이 화면이 존재하는 이유 자체다.

1. **마지막 능선은 as-of 다.** 앞에서부터 솎으면 굽는 날에 따라 마지막 능선이
   최대 4영업일 과거가 되고, 그림은 멀쩡해 보인다. 조용한 낡음의 교과서다.
2. **노드 집합은 유도된 것이다.** 손으로 적은 목록은 호가 노드가 바뀌는 날
   갈라진다. 1D 가 빠졌는지도 여기서 못 박는다.
3. **z 는 데이터셋 그대로다.** 표면이 자기 값을 만들면 표와 어긋난다 (§16).
4. **역전 부호 규약** — `spread_series` 가 long − short 이므로 음수가 역전이다.
   프론트는 부호만 읽으므로 이 규약이 뒤집히면 화면이 조용히 반대로 칠한다.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.dataset import QUOTED_NODES, Dataset
from app.surface import STRIDE, SURFACE_NODES, surface_payload


def _dataset(n: int = 23) -> Dataset:
    """n 영업일짜리 장난감 데이터셋. 값은 테너·날짜로 결정되는 식이라
    페이로드의 어느 칸이 어느 원본인지 계산으로 확인할 수 있다."""
    dates = [dt.date(2026, 1, 1) + dt.timedelta(days=i) for i in range(n)]
    tenors = ["1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"]
    series = {
        t: [round(1.0 + k * 0.1 + i * 0.001, 4) for i in range(n)]
        for k, t in enumerate(tenors)
    }
    return Dataset(dates=dates, series=series, tenor_order=tenors)


class TestNodeSet:
    def test_the_node_set_is_derived_from_the_quoted_nodes(self):
        # 손으로 적은 목록이 아니다 — 호가 노드에서 1D 만 뺀 것.
        assert set(SURFACE_NODES) == set(QUOTED_NODES) - {"1D"}

    def test_the_call_rate_is_not_a_curve_point(self):
        # [OWNER, 2026-08-05] CurveView 의 같은 판정. 콜금리는 앵커다.
        assert "1D" not in SURFACE_NODES

    def test_interpolated_nodes_stay_out(self):
        # 4Y·6Y~9Y 는 업스트림 보간이다. 표면 위에서는 점 마커로 구분할 수 없어
        # 매끄러움이 곧 "여기 값이 있다" 는 거짓 주장이 된다.
        for t in ("4Y", "6Y", "7Y", "8Y", "9Y"):
            assert t not in SURFACE_NODES

    def test_nodes_are_short_to_long(self):
        payload = surface_payload(_dataset())
        assert payload["tenors"] == SURFACE_NODES
        assert payload["tenors"][0] == "3M"
        assert payload["tenors"][-1] == "10Y"


class TestStride:
    def test_the_last_ridge_is_the_asof_date(self):
        for n in range(1, 40):
            ds = _dataset(n)
            payload = surface_payload(ds)
            assert payload["dates"][-1] == ds.asof.isoformat(), n

    def test_ridges_are_one_stride_apart(self):
        ds = _dataset(23)
        payload = surface_payload(ds)
        picked = [ds.dates.index(dt.date.fromisoformat(d)) for d in payload["dates"]]
        assert picked == sorted(picked)
        gaps = {b - a for a, b in zip(picked, picked[1:])}
        assert gaps == {STRIDE}

    def test_a_dataset_shorter_than_one_stride_still_draws_one_ridge(self):
        payload = surface_payload(_dataset(1))
        assert payload["dates"] == ["2026-01-01"]
        assert all(len(row) == 1 for row in payload["z"])


class TestValues:
    def test_z_is_the_dataset_not_a_recomputation(self):
        ds = _dataset()
        payload = surface_payload(ds)
        for row, tenor in zip(payload["z"], payload["tenors"]):
            for value, iso in zip(row, payload["dates"]):
                i = ds.dates.index(dt.date.fromisoformat(iso))
                assert value == pytest.approx(ds.series[tenor][i])

    def test_z_is_tenors_by_dates(self):
        payload = surface_payload(_dataset())
        assert len(payload["z"]) == len(payload["tenors"])
        assert all(len(row) == len(payload["dates"]) for row in payload["z"])

    def test_holes_stay_holes(self):
        # 0 으로 채우면 표면에 절벽이 생기고 그것이 시장으로 읽힌다.
        ds = _dataset()
        ds.series["5Y"][-1] = None
        payload = surface_payload(ds)
        assert payload["z"][payload["tenors"].index("5Y")][-1] is None


class TestInversion:
    def test_inverted_curve_is_negative(self):
        ds = _dataset()
        # 10Y 를 2Y 아래로 내린다 → 역전
        for i in range(len(ds.dates)):
            ds.series["10Y"][i] = ds.series["2Y"][i] - 0.5
        payload = surface_payload(ds)
        assert payload["inversionPair"] == "2Y-10Y"
        assert all(v == pytest.approx(-50.0) for v in payload["inversionBp"])

    def test_upward_curve_is_positive(self):
        payload = surface_payload(_dataset())
        assert all(v > 0 for v in payload["inversionBp"])

    def test_inversion_is_aligned_to_the_dates(self):
        payload = surface_payload(_dataset())
        assert len(payload["inversionBp"]) == len(payload["dates"])


class TestMissingNodes:
    def test_a_missing_node_is_named_not_silently_dropped(self):
        ds = _dataset()
        del ds.series["1.5Y"]
        payload = surface_payload(ds)
        assert "1.5Y" not in payload["tenors"]
        assert payload["missingNodes"] == ["1.5Y"]
        assert len(payload["z"]) == len(payload["tenors"])


class TestRoute:
    """라우트가 실제로 붙어 있는가.

    2026-08-14 에 이 테스트가 없어서 값을 치렀다: 브라우저에서 Lab 이 계속
    "불러오는 중" 이었고, 원인은 프론트도 페이로드도 아니라 **떠 있던 백엔드가
    라우트를 추가하기 전에 뜬 것**이었다. 앱을 통째로 세워 물어보는 것이 그
    종류의 착시를 없애는 유일한 방법이다.
    """

    @pytest.fixture(scope="class")
    def client(self):
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as c:
            yield c

    def test_the_surface_is_served(self, client):
        r = client.get("/api/surface")
        assert r.status_code == 200
        body = r.json()
        assert body["tenors"] == SURFACE_NODES
        assert body["dates"][-1] == body["asof"]
        assert len(body["z"]) == len(body["tenors"])
        assert all(len(row) == len(body["dates"]) for row in body["z"])
        assert len(body["inversionBp"]) == len(body["dates"])

    def test_the_served_body_is_the_payload_function(self, client):
        # 라우트가 캐시를 지나므로, 서빙된 것이 이 모듈이 만든 것과 같은지
        # 확인한다 — 캐시가 낡으면 화면만 조용히 과거가 된다.
        from app.main import _dataset

        assert client.get("/api/surface").json() == surface_payload(_dataset)
