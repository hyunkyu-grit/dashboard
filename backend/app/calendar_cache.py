"""
Transparent memoization of the Seoul business-day walk behind CD fixing lookup.

WHY THIS EXISTS
---------------
`select_fixing` resolves every floating period's F(R) = reset - 1 Seoul
business day, once per period per valuation. `fixing_date_for_reset` delegates
that to `prev_seoul_business_day`, which walks back a day at a time calling
`_is_kr_business_day`. The reset dates of a book are a tiny fixed set -- they
are the swaps' own pay dates -- so the same forty questions get asked half a
million times. Measured on the 3-position 5-year reference book (RUN-BT-XLSX,
memo installed, after MEMO-1B's schedule memo):

    prev_seoul_business_day : 515,473 calls over        40 distinct inputs
                              -> 12,887x redundant
    _is_kr_business_day     : 1,090,598 calls over     127 distinct dates
                              -> 8,587x redundant

Every one of those 1.09M business-day tests is a `holidays` dict lookup that
runs `__keytransform__` first. MEMO-1B left this as the residual after the
schedule memo removed 61% of `_is_kr_business_day`'s calls: what survived was
not schedule building at all, it was fixing resolution, and no schedule memo
could reach it.

WHY IT'S A WRAPPER AND NOT AN EDIT
----------------------------------
`prev_seoul_business_day` is a ported body -- `tests/test_valuation_port.py`
re-extracts it from the frozen `fixings.py` and compares source text, and
`test_nothing_was_quietly_added_to_the_port` forbids adding anything beside it.
So this follows the same route `curve_cache` takes for `bootstrap_zero_curve`
and `schedule_cache` takes for `to_irs_trade`: rebind the module attribute,
touch no ported line. `fixing_date_for_reset` calls
`prev_seoul_business_day(...)` through the module global at call time, so it
picks the wrapper up; nothing imports the name directly.

KEY TOTALITY, and why append-only is enough HERE
------------------------------------------------
The function's inputs are `(d, n)` and the KR holiday table. The table is not
frozen at import -- `holidays.HolidayBase.__keytransform__` auto-expands past
the 2016-2035 preload -- so "is the key total?" has to be answered, not
assumed. MEMO-1B proved `_populate(year)` only ADDS a year and never revises a
loaded one (populating 2036..2059 leaves 2021's 18 holidays byte-identical).

That proof is necessary but not by itself sufficient here, because unlike a
schedule this function *walks* backwards and could in principle cross into a
year that was unknown when the first call was cached. It is sufficient anyway,
and the reason is the ORDER of operations inside `holidays`: expansion happens
in `__keytransform__`, which runs BEFORE the dict lookup returns. So the very
first evaluation of any date already populates that date's year and answers
against the complete table. A cached answer was therefore never computed
against a partial table, and an answer that was right when computed stays
right, because the years it depended on are never rewritten.

If that ordering ever changed, the fix is to put the table's size in the key --
a wider key is always output-safe. `tests/test_calendar_cache.py` pins both the
ordering-dependent case (a walk whose dates sit past the preload horizon) and
the memo's agreement with the unmemoized function.

SIZING
------
Unbounded, deliberately, and this is the one place in this repo where that is
the right answer. The key is `(date, n)` with `n` always 1
(`CD_FIXING_LAG_SEOUL_BDAYS`), and the dates are reset dates drawn from the
dataset's own span -- roughly 2,600 business days of history plus schedule
dates a few years past it. The reference book uses 40. A pathological ceiling
is a few tens of thousands of tiny tuples; there is no cyclic access pattern
that could make an LRU thrash, and no capacity cliff to fall off. `clear()`
exists for tests.

KILL SWITCH
-----------
`BW_CALENDAR_CACHE=0` makes `install()` a no-op; `uninstall()` restores the
original at any time. Same shape as `BW_SCHEDULE_CACHE` and
`IRS_PRICER_CURVE_CACHE`.
"""

from __future__ import annotations

import datetime as dt
import logging
import os

from . import valuation_port as _vp

logger = logging.getLogger(__name__)

ENV_FLAG = "BW_CALENDAR_CACHE"

_original = _vp.prev_seoul_business_day
_installed = False
_cache: dict[tuple[dt.date, int], dt.date] = {}
_hits = 0
_misses = 0


def _memoized(d: dt.date, n: int = 1) -> dt.date:
    global _hits, _misses
    key = (d, n)
    hit = _cache.get(key)
    if hit is not None:
        _hits += 1
        return hit
    _misses += 1
    out = _original(d, n)
    _cache[key] = out
    return out


def install() -> None:
    """Swap the memoized wrapper in. Idempotent; safe from app startup."""
    global _installed
    if _installed:
        return
    if os.environ.get(ENV_FLAG, "1") == "0":
        logger.warning("calendar_cache NOT installed (%s=0)", ENV_FLAG)
        return
    _vp.prev_seoul_business_day = _memoized
    _installed = True
    logger.info("calendar_cache installed (unbounded)")


def uninstall() -> None:
    global _installed
    _vp.prev_seoul_business_day = _original
    _installed = False


def clear() -> None:
    global _hits, _misses
    _cache.clear()
    _hits = _misses = 0


def stats() -> dict[str, int | float | bool]:
    total = _hits + _misses
    return {
        "installed": _installed,
        "hits": _hits,
        "misses": _misses,
        "entries": len(_cache),
        "hit_rate": round(_hits / total, 4) if total else 0.0,
    }
