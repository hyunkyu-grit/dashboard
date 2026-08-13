"""
Market data service: snapshot loading, date enumeration, and live-cache management.

PORTED FROM krw-fi-pms-backend WITH ONE DELIBERATE DEVIATION — the MySQL tier is
gone. The frozen source tried the DB first and fell back to the three-tier
Excel/CSV factory whenever the DB wasn't configured, wasn't reachable, or had no
row for the date. This deployment has no database at all: the data folder IS the
source, and the owner updates it by dropping fresh workbooks in. Keeping a DB
tier that could only ever raise DatabaseNotConfiguredError would buy nothing and
cost a SQLAlchemy dependency.

So every `_load_*_from_db` path below is deleted and the Excel/CSV factory is
called directly. Everything else — the TTL cache keys, the live-snapshot
precedence, the raise semantics (NonBusinessDayError for weekends, ValueError
for a date no source covers) — is unchanged, which is what keeps the simulate
golden intact.

Monkeypatch seam preserved (SPLIT_PLAN H4): simulation/swap_inputs.py calls
`market_data_service.load_snapshot(...)` through the MODULE attribute, so tests
patching this module still land.

Route handlers call these functions; no path/loader logic lives in api/.
"""

from __future__ import annotations

from datetime import date

from ..config import DATA_DIR
from ..core import ttl_cache
from ..core.errors import _check_business_day
from ..core.market_data import MarketSnapshot
from ..loaders.factory import (
    list_available_dates as _list_available_dates,
    load_fixing_history,
    load_market_snapshot,
)

# In-memory cache of intraday rates pushed by an external RTD poller. Keyed by
# valuation_date; takes priority over the file sources so a live push shows up
# without waiting for a workbook refresh. Nothing in this deployment writes to
# it yet — the endpoint that did (POST /api/market-data/live) is retained
# because the cost is one dict and the precedence rule is load-bearing below.
_live_snapshots: dict[date, MarketSnapshot] = {}


def _load_snapshot_uncached(valuation_date: date) -> MarketSnapshot:
    return load_market_snapshot(DATA_DIR, valuation_date)


def load_snapshot(valuation_date: date) -> MarketSnapshot:
    """The three-tier Excel/CSV factory's snapshot for the date.

    Raises NonBusinessDayError for weekends/holidays.
    Raises ValueError if no file source has data for the date.

    TTL-cached per date: a closed date's snapshot is immutable, and the callers
    that dominate load hammer the same handful of dates. The live-snapshot check
    stays OUTSIDE the cache so an intraday push is never masked by a cached file
    value. Neither _check_business_day's NonBusinessDayError nor a missing-data
    ValueError is cached — the factory raises before anything is stored.
    """
    if valuation_date in _live_snapshots:
        return _live_snapshots[valuation_date]
    _check_business_day(valuation_date)
    return ttl_cache.get_or_compute(
        ("market-snapshot", valuation_date),
        lambda: _load_snapshot_uncached(valuation_date),
    )


def list_available_dates() -> list[date]:
    """Available dates across the Excel/CSV sources, sorted ascending.

    TTL-cached: it costs a workbook scan every time. update_live() invalidates
    it when a genuinely new date shows up; a data-folder refresh invalidates it
    through data_watch.check() (see api/app.py).
    """
    return ttl_cache.get_or_compute(("market-available-dates",), _list_available_dates_uncached)


def _list_available_dates_uncached() -> list[date]:
    dates: set[date] = set()
    try:
        dates |= set(_list_available_dates(DATA_DIR))
    except ValueError:
        pass

    dates |= set(_live_snapshots.keys())
    if not dates:
        raise ValueError("사용 가능한 시장 데이터가 없습니다.")
    return sorted(dates)


def update_live(snapshot: MarketSnapshot) -> None:
    """Store an intraday snapshot pushed by an external poller."""
    is_new_date = snapshot.valuation_date not in _live_snapshots
    _live_snapshots[snapshot.valuation_date] = snapshot
    # Only the date LIST needs invalidating, and only when this tick introduces
    # a date it didn't already have. The per-date snapshot cache doesn't:
    # load_snapshot checks _live_snapshots ahead of it. Blanket-clearing here
    # would wipe the cache on every tick and keep it permanently cold.
    if is_new_date:
        ttl_cache.invalidate(("market-available-dates",))


def load_fixings() -> dict[date, float]:
    """Historical CD91D fixings used for MTM past-reset estimation.

    TTL-cached: every analytics path loads this once per request, all to get the
    same whole-history dict, which only changes when the data folder does.

    The cached dict is shared by reference, not copied. Callers treat fixings as
    read-only (they only ever look up past resets); copying a multi-thousand-entry
    dict per call would give back a chunk of what the cache just saved.
    """
    return ttl_cache.get_or_compute(("cd-fixings",), _load_fixings_uncached)


def _load_fixings_uncached() -> dict[date, float]:
    return load_fixing_history(DATA_DIR)
