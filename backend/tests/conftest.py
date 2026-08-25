"""Shared fixtures.

Came over with the simulation. The frozen krw-fi-pms conftest was almost
entirely DB scaffolding — an in-memory SQLite engine, MySQL-only upsert shims,
a seeded tenor_pillar table. None of it applied to simulation_project, which
had no database, and none of it applies here yet either.

This is now the FIRST conftest in this backend: the monitor's own tests never
needed one (they run as `cd backend; python -m pytest tests -q`, and that is
what puts `backend/` on sys.path for `from app import ...` — unchanged, and
`irs_pricer` resolves the same way). The autouse fixture below therefore runs
for every test in this directory, monitor tests included. That is harmless —
the TTL cache it clears is the simulation's, and a monitor test that never
touches it clears an empty dict — but it is a real widening, so it is written
down rather than left to be discovered.
"""

from __future__ import annotations

import pytest

from irs_pricer.core import ttl_cache
from irs_pricer.services.simulation import bond_roll


@pytest.fixture(autouse=True)
def bond_roll_lane_off():
    """채권 롤다운 커브 공급자를 매 테스트 앞에서 내린다 [2026-08-25].

    공급자는 프로세스 전역이고, `with TestClient(app)` 가 lifespan 을 돌리면
    app 이 **실제 SQL 민평** 공급자를 등록한다 — 그 순간부터 골든·항등식
    테스트의 수치가 «SQL 이 닿는가» 라는 환경 사실에 붙는다. 여기서 매번
    내려 «롤 레인 꺼짐»을 결정적 기본으로 만들고, 롤 레인을 시험하는 테스트
    (test_simulate_mixed_recon)만 이 픽스처를 명시적으로 요청한 뒤 자기
    커브를 얹는다 — 요청 관계가 곧 실행 순서 보증이다.
    """
    bond_roll.set_sector_curve_provider(None)
    yield
    bond_roll.set_sector_curve_provider(None)


@pytest.fixture(autouse=True)
def _isolate_caches():
    """Reset the process-global TTL cache around every test.

    market_data_service's load_snapshot/load_fixings/list_available_dates are
    TTL-cached, and these tests deliberately swap the underlying source between
    cases. Without this, one test's cached snapshot answers the next test's
    differently-mocked call and the failure lands somewhere unrelated. Autouse
    because it's needed by any test that touches market data, directly or
    transitively.
    """
    ttl_cache.clear()
    yield
    ttl_cache.clear()
