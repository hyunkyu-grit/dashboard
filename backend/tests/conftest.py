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
