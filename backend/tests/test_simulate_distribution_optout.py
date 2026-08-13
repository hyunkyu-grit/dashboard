"""분위수 팬 옵트아웃 (2026-08-06) — 이미 전송되던 필드 `includeDistribution`.

왜 있는가: 프로파일 실측에서 팬(scenario-expansion, 엔진 4회 추가 실행)이
총 109.9초 중 **82.8초(75%)**였다. 실제 손익은 나머지 26초다. 그런데 팬은
HARDEN-1에서 결과 화면을 떠났고 이 배포는 그리지 않는다.

여기서 못박는 것은 두 가지다.
  1. 빼달라고 하면 distribution이 null이다.
  2. **나머지 응답은 한 글자도 안 바뀐다** — 팬은 순수한 추가 계산이지
     손익 경로에 영향을 주지 않는다. 이게 성립하지 않으면 옵트아웃은
     "빠른 대신 다른 답"이 되고, 그건 최적화가 아니다.
  3. 기본값은 종전 동작이다 — 골든 패리티가 그 경로로 계속 검증된다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app  # the simulation rides on braveworld's app now (:8100)

DATA = Path(__file__).parent / "data"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def _request() -> dict:
    return json.loads((DATA / "simulate_request_representative.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def with_fan(client: TestClient) -> dict:
    r = client.post("/api/simulate", json=_request())
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def without_fan(client: TestClient) -> dict:
    req = _request()
    req["includeDistribution"] = False
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    return r.json()


def test_default_still_computes_the_fan(with_fan: dict) -> None:
    """필드를 안 보내면 종전과 같다 — 팬이 계산된다."""
    assert with_fan["distribution"] is not None
    assert with_fan["distribution"]["bands"]


def test_optout_returns_null_distribution(without_fan: dict) -> None:
    assert without_fan["distribution"] is None


def test_everything_else_is_byte_identical(with_fan: dict, without_fan: dict) -> None:
    """팬을 빼도 손익은 그대로다.

    distribution 하나만 빼고 전체 응답을 직렬화해서 비교한다. 키 몇 개를
    골라 보면 고르지 않은 키에서 어긋나도 통과한다."""
    a = {k: v for k, v in with_fan.items() if k != "distribution"}
    b = {k: v for k, v in without_fan.items() if k != "distribution"}
    assert set(a) == set(b)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
