"""
Transparent memoization of VanillaSwap.to_irs_trade (the ISDA schedule build).

WHY THIS EXISTS
---------------
`value_booked_trade` and `settled_cash_between` each call
`swap.to_irs_trade(...)` on every invocation, and that constructor runs
`IRS_Trade._build_schedule` -- a `dateutil.relativedelta` walk with a
Modified-Following adjustment per period. The schedule is a function of the
SWAP ALONE (see KEY TOTALITY), so a book being revalued across hundreds of
dates rebuilds the same handful of schedules thousands of times over.
Measured on the 3-position 5-year reference book (RUN-BT-XLSX):

    _build_schedule calls    : 39,804   (14,376 backtest + 25,428 recon)
    distinct schedules       :      6   -> 6,634x redundant
    _build_schedule cumulative: 19.4s of a 37.7s profiled run (51%)

`book_recon` is the majority caller (63.9%) even though it pre-builds a
`VanillaSwap` per leg: `value_booked_trade` calls `to_irs_trade` on that swap
regardless, so the pre-build saves the dataclass allocation and never the
schedule.

WHY IT'S A WRAPPER AND NOT AN EDIT
----------------------------------
`app/valuation_port.py` is a byte-identical port of the frozen krw-fi-pms
engine, and `tests/test_valuation_port.py` enforces that from BOTH sides: one
test re-extracts every ported body and compares source text, and a second one
(`test_nothing_was_quietly_added_to_the_port`) asserts that the set of
top-level bodies in our file minus the frozen set is exactly `{"CurveBundle"}`.
Adding a memo *into* that module would fail the second test even if it touched
no ported line. So the memo lives here and `install()` rebinds the method on
the class, exactly as `irs_pricer/engine/curve_cache.py` rebinds
`bootstrap_zero_curve` for the simulation side. Both call sites resolve
`to_irs_trade` through the instance at call time, so both pick the wrapper up.

KEY TOTALITY (why a module-global memo is safe at all)
------------------------------------------------------
`to_irs_trade(valuation_date)` reads `valuation_date` **only** when
`self.trade_date is None`:

    start_dt = next_kr_business_day(self.trade_date if ... else valuation_date)
    mat_dt   = self.maturity_date or start_dt + round(tenor_years * 365) days

With `trade_date` set, both the start and the maturity -- and therefore the
whole forward-generated schedule -- are determined by the swap's own fields.
The key is those fields at full precision, so it is TOTAL over the schedule's
determinants and two swaps that could legitimately differ can never share an
entry. When `trade_date` is None the result IS valuation-date dependent, and
that call falls through to the original uncached (see FALLTHROUGH).

The one non-swap input the build reads is the KR holiday calendar, through
`_modfol_bd` -> `_is_kr_business_day` -> `_KR_HOLIDAYS`. That table is NOT
frozen at import: `holidays.HolidayBase.__keytransform__` auto-expands
(`if self.expand and dt.year not in self.years: self.years.add(...);
self._populate(...)`) before the dict lookup, so a query past the 2016-2035
preload grows it (375 -> 395 entries on a 2044 lookup). It is nonetheless
excluded from the key, on evidence rather than assumption:

  * `_populate(year)` only adds that year. Verified empirically -- populating
    2036..2059 leaves 2021's 18 holidays byte-identical -- so expansion can
    only APPEND beyond the preload horizon, never revise a date the narrower
    table already covered.
  * All 6 schedules of the reference book were built in two separate processes,
    one cold (preload table) and one with expansion to 2059 forced FIRST, and
    compared on every pay date, accrual and boundary date. Identical, 6 of 6.

So the first build being the permanent one is safe: whatever the table's state,
the schedule is the same. `tests/test_schedule_cache.py` pins both halves.

FALLTHROUGH
-----------
`trade_date is None` is legal, is the dataclass default, and is
valuation-date dependent -- so it is not cacheable on swap identity. It is also
unreached: all nine live call sites (three in `app/backtest.py`, six in tests)
pass `trade_date=entry_date`. MEMO-1's gate proposed encoding that as an
`assert` at this boundary. It is a fallthrough instead, deliberately:

  * an `assert` turns a legal, correct input into a 500 on a live endpoint,
  * `assert` is stripped under `-O`, so it is not a guarantee anyway,
  * and `curve_cache._bootstrap_memoized` sets the house precedent -- fall back
    to the original on any input that cannot key, "so memoization can never
    change behaviour -- worst case it stops helping".

A fallthrough is strictly stronger than an assert here: it cannot produce a
wrong answer OR a new failure mode. The invariant stays visible because
`stats()["fallthrough"]` counts it, and a test pins that the path is correct.

SAFETY -- IMMUTABILITY IS ENFORCED, NOT DOCUMENTED
--------------------------------------------------
Cached trades are handed out SHARED. Today all three consumers
(`value_booked_trade`, `settled_cash_between`, `IRS_Trade.compute_npv`) are
read-only -- verified by inspection, zero attribute writes. That is a fact
about today, in a repo where more than one session writes concurrently, and
`IRS_Trade` carries three mutable containers (`pay_dates` and `accruals` lists,
`_pay_date_set`). So the cached instance is frozen rather than trusted:

  * `pay_dates` and `accruals` become tuples, `_pay_date_set` a frozenset --
    every consumer only indexes, slices, iterates, `len()`s or `.index()`es
    them, all of which tuples support;
  * the instance is re-classed to `_FrozenIRSTrade`, whose `__setattr__` and
    `__delattr__` raise, so rebinding a field fails loudly instead of
    corrupting every later request in the process.

This mirrors `curve_cache`'s `curve.flags.writeable = False` on the arrays it
shares. `tests/test_schedule_cache.py::test_cached_trades_are_frozen` fails if
the guard is removed.

CONCURRENCY
-----------
Endpoints are sync `def` (or run in an executor), so Starlette runs them on its
threadpool and many threads can hit this at once. `functools.lru_cache` is
thread-safe for this use: its C implementation locks its own bookkeeping, and
the worst concurrent-miss race is two threads building the same schedule in
parallel -- both deterministic and identical, one insert wins, no result is
ever wrong.

SIZING
------
Cardinality is small and bounded per request: `backtest.MAX_POSITIONS` is 12
and a butterfly is 3 legs, so one request mints at most 36 keys (the reference
book mints 6). Entries are ~40 dates + ~40 floats, on the order of 3 KB. 4,096
entries is >100x the worst single request at roughly 12 MB, which leaves no
room for the silent LRU cliff `curve_cache` documents (its s18 note measured a
hit rate collapsing to ~0 when a cyclic access pattern exceeded capacity by a
few percent). Keys include notional, rate and trade date, so distinct books
mint distinct entries and old ones evict in LRU order.

KILL SWITCH
-----------
`BW_SCHEDULE_CACHE=0` makes `install()` a no-op, and `uninstall()` restores the
original at any time. Same shape as `IRS_PRICER_CURVE_CACHE`. It exists so the
memo can be A/B'd for evidence and switched off in an incident without a code
change.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
from functools import lru_cache

from .engine_port import IRS_Trade
from .valuation_port import VanillaSwap

logger = logging.getLogger(__name__)

# See SIZING.
_MAX_ENTRIES = 4096

# Read by install(): "0" means "do not install".
ENV_FLAG = "BW_SCHEDULE_CACHE"

_original = VanillaSwap.to_irs_trade
_installed = False
_fallthrough = 0


class _FrozenIRSTrade(IRS_Trade):
    """`IRS_Trade` with writes refused. `__slots__ = ()` keeps the memory layout
    identical to the parent, which is what makes the `__class__` reassignment in
    `_freeze()` legal."""

    __slots__ = ()

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError(
            f"{name!r}: this IRS_Trade is shared out of app.schedule_cache and "
            "is immutable. Mutating it would corrupt every later valuation in "
            "this process. Build your own via VanillaSwap.to_irs_trade with the "
            "cache uninstalled, or copy the fields you need."
        )

    def __delattr__(self, name: str) -> None:
        self.__setattr__(name, None)


def _freeze(trade: IRS_Trade) -> IRS_Trade:
    """Make `trade` safe to share: immutable containers, then refuse writes."""
    # set through the parent's __setattr__, before the class swap closes it
    IRS_Trade.__setattr__(trade, "pay_dates", tuple(trade.pay_dates))
    IRS_Trade.__setattr__(trade, "accruals", tuple(trade.accruals))
    IRS_Trade.__setattr__(trade, "_pay_date_set", frozenset(trade._pay_date_set))
    trade.__class__ = _FrozenIRSTrade
    return trade


@lru_cache(maxsize=_MAX_ENTRIES)
def _build_cached(
    tenor_years: float,
    notional: float,
    fixed_rate: float,
    pay_fixed: bool,
    float_spread: float,
    trade_date: dt.date,
    maturity_date: dt.date | None,
) -> IRS_Trade:
    swap = VanillaSwap(
        tenor_years=tenor_years,
        notional=notional,
        fixed_rate=fixed_rate,
        pay_fixed=pay_fixed,
        float_spread=float_spread,
        trade_date=trade_date,
        maturity_date=maturity_date,
    )
    # `trade_date` is set, so the argument is unread -- passing it keeps the
    # ported body's signature honoured rather than relying on that fact.
    return _freeze(_original(swap, trade_date))


def _to_irs_trade_memoized(self: VanillaSwap, valuation_date: dt.date) -> IRS_Trade:
    """Drop-in replacement for `VanillaSwap.to_irs_trade`. See FALLTHROUGH."""
    global _fallthrough
    if self.trade_date is None:
        _fallthrough += 1
        return _original(self, valuation_date)
    return _build_cached(
        self.tenor_years,
        self.notional,
        self.fixed_rate,
        self.pay_fixed,
        self.float_spread,
        self.trade_date,
        self.maturity_date,
    )


def install() -> None:
    """Swap the memoized wrapper in. Idempotent; safe to call from app startup."""
    global _installed
    if _installed:
        return
    if os.environ.get(ENV_FLAG, "1") == "0":
        logger.warning("schedule_cache NOT installed (%s=0)", ENV_FLAG)
        return
    VanillaSwap.to_irs_trade = _to_irs_trade_memoized
    _installed = True
    logger.info("schedule_cache installed (maxsize=%d)", _MAX_ENTRIES)


def uninstall() -> None:
    """Restore the unmemoized method. Exists so tests and the bench can A/B."""
    global _installed
    VanillaSwap.to_irs_trade = _original
    _installed = False


def clear() -> None:
    _build_cached.cache_clear()


def stats() -> dict[str, int | float | bool]:
    info = _build_cached.cache_info()
    total = info.hits + info.misses
    return {
        "installed": _installed,
        "hits": info.hits,
        "misses": info.misses,
        "entries": info.currsize,
        "hit_rate": round(info.hits / total, 4) if total else 0.0,
        # calls that could not be keyed (trade_date=None) and went to the
        # original. Nonzero means a caller this repo does not currently have.
        "fallthrough": _fallthrough,
    }
