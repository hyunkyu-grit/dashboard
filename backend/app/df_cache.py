"""
Per-curve memoization of df_linear_rate (the scalar discount-factor lookup).

WHY THIS EXISTS
---------------
`df_linear_rate(t, zc)` is one scalar `np.interp` plus an `exp`. Measured cost
is **2.24 us/call**, of which a bare scalar `np.interp` on the same array is
**1.78 us** -- so roughly four fifths of it is numpy's dispatch path
(`_interp_dispatcher`, `iscomplexobj`, `asarray`), not arithmetic. It is called
enough to dominate everything:

    RUN-SIM-GRID, fan off      calls      distinct (curve, t)     repeat
      8 swaps x 180d         266,496                  13,109       20.3x
     32 swaps x 180d       1,506,454                  28,320       53.2x
     32 swaps x 365d       2,832,982                  29,028       97.6x
     64 swaps x 180d       3,008,500                  40,847       73.7x

The redundancy is structural, not accidental: quarterly swaps across one book
land on heavily overlapping payment dates, and every swap on a given simulated
day discounts against the *same* curve object. So the union of (curve, t) pairs
is one to two orders of magnitude smaller than the call count, and it gets
*better* as the book and the horizon grow -- which is precisely the direction
the owner's complaint points.

WHY IT'S A WRAPPER AND NOT AN EDIT
----------------------------------
`quant_engine.py` is required to stay byte-identical to the authoritative copy
(`irs_pricer/engine/curve_cache.py:23-24`), and `app/engine_port.py` is pinned
by `tests/test_engine_port.py` re-extracting its bodies from the frozen repo.
So this follows the route the repo has now taken four times -- `curve_cache`
for `bootstrap_zero_curve`, `schedule_cache` for `to_irs_trade`,
`calendar_cache` for `prev_seoul_business_day`, and this one. No ported line
changes and no owner exemption is needed.

THE DEF-TIME DEFAULT TRAP (the part that makes this non-obvious)
----------------------------------------------------------------
Rebinding the module attribute alone would install a memo that does **nothing**
here, and would do so silently. `df_linear_rate` is captured as a DEFAULT
ARGUMENT, evaluated at def time, in every hot caller:

    quant_engine.IRS_Trade.compute_npv   df_fn=df_linear_rate   (defaults[0])
    quant_engine.forward_rate_simple     df_fn=df_linear_rate   (defaults[0])
    quant_engine.compute_irs_npv         df_fn=df_linear_rate   (defaults[4])
    quant_engine.compute_irs_pvbp        df_fn=df_linear_rate   (defaults[4])
    engine_port.IRS_Trade.compute_npv    df_fn=df_linear_rate   (defaults[0])
    engine_port.forward_rate_simple      df_fn=df_linear_rate   (defaults[0])

Those tuples hold the ORIGINAL function object and never consult the module
global again. `install()` therefore rewrites `__defaults__` as well, and
`uninstall()` puts the originals back. `curve_cache` hit the same class of trap
from the other direction (`curve.py` had imported the name directly, binding at
import time) and documents it; this is that trap's default-argument twin.

TWO MODULES, TWO INSTALLS. `app.engine_port.df_linear_rate` and
`irs_pricer.engine.quant_engine.df_linear_rate` are DIFFERENT function objects
-- the backtest and the simulation each carry their own copy of the port. There
is no incidental sharing: memoizing one does not touch the other, so both are
installed explicitly and reported separately.

CURVE IDENTITY -- why this key is exact
---------------------------------------
A wrong curve key here is the worst defect this codebase could ship: it would
return a *plausible* discount factor from the wrong curve, silently, and every
downstream number would be wrong by an amount no tolerance test is looking for.
So the key is not a date, not a bootstrap input, and not a bare `id()`.

The key is **live object identity**, enforced by a weakref:

  * a per-curve table is created the first time an array is seen, and stored
    alongside a `weakref.ref(zc)` under `id(zc)`;
  * on lookup, the entry is used ONLY if that weakref is still alive. A live
    object's id cannot be reused by another object, so `id(zc) == key` plus
    "the referent is alive" proves `zc` IS the array the table was built for;
  * when the array is collected the weakref callback drops the whole entry, so
    a recycled id can never hit a stale table.

This is exact rather than approximate, and it is *stronger* than a content
hash: two distinct arrays with identical contents get separate tables, which
costs a missed hit and can never produce a wrong answer. Curves are also
`writeable=False` (curve_cache sets that), so a live array's contents cannot
change under the table.

CACHE LIFETIME cannot outlive the curve, structurally rather than by policy:
the table IS the weakref entry's payload, so it is freed by the same callback
that invalidates the identity. There is no TTL to tune and no eviction pass to
forget to run. A run that builds thousands of daily shocked curves accumulates
nothing after those curves are dropped.

BIT-IDENTITY. A hit returns the exact float the original call produced and
stored -- not a recomputation -- so agreement is by construction, not by
tolerance. `tests/test_df_cache.py` checks it anyway, on real curves and real
query points, with `==` and `struct.pack` byte comparison.

KILL SWITCH
-----------
`BW_DF_CACHE=0` makes `install()` a no-op; `uninstall()` restores both modules
(module attribute and every `__defaults__` tuple) at any time.
"""

from __future__ import annotations

import logging
import os
import weakref
from typing import Any, Callable

logger = logging.getLogger(__name__)

ENV_FLAG = "BW_DF_CACHE"

# id(curve) -> (weakref to the curve, {t: df})
_entries: dict[int, tuple[weakref.ref, dict[float, float]]] = {}
_hits = 0
_misses = 0
_uncacheable = 0

# what install() rebound, so uninstall() can put it back exactly
#   [(module, original_fn, [(function_object, index), ...]), ...]
_installed: list[tuple[Any, Callable, list[tuple[Any, int]]]] = []


def _table_for(zc) -> dict[float, float] | None:
    """The per-curve table for `zc`, or None if it cannot be keyed."""
    key = id(zc)
    ent = _entries.get(key)
    if ent is not None:
        if ent[0]() is not None:
            # the referent is alive, so this id belongs to it and to nothing
            # else -- `zc` IS that array
            return ent[1]
        _entries.pop(key, None)          # dead; its id is free for reuse
    table: dict[float, float] = {}
    try:
        _entries[key] = (weakref.ref(zc, lambda _r, k=key: _entries.pop(k, None)),
                         table)
    except TypeError:
        return None                      # not weakref-able -> never cached
    return table


def _make(original: Callable) -> Callable:
    def memoized(t: float, zc) -> float:
        global _hits, _misses, _uncacheable
        if zc is None:
            _uncacheable += 1
            return original(t, zc)
        table = _table_for(zc)
        if table is None:
            _uncacheable += 1
            return original(t, zc)
        hit = table.get(t)
        if hit is not None:
            _hits += 1
            return hit
        _misses += 1
        out = table[t] = original(t, zc)
        return out
    memoized.__name__ = "df_linear_rate"      # keeps profiles legible
    memoized.__qualname__ = f"df_cache({original.__module__})"
    return memoized


def _importers(original: Callable) -> list[Any]:
    """Every already-imported module holding its own binding to `original`.

    Found by scanning `sys.modules` at install time rather than from a hand
    list, because a hand list is exactly what goes stale. `app/valuation_port.py`
    does `from .engine_port import df_linear_rate`, which binds at IMPORT time —
    rebinding the defining module's attribute leaves that copy on the original,
    and the memo then reports itself installed while serving nothing. That is
    the same trap `curve_cache` records for `engine/curve.py`, and it was caught
    here only because the backtest measured 0 hits (see REPORT_memo2 §4).
    """
    import sys as _sys
    out = []
    for mod in list(_sys.modules.values()):
        if mod is None:
            continue
        try:
            if getattr(mod, "df_linear_rate", None) is original:
                out.append(mod)
        except Exception:               # modules with exotic __getattr__
            continue
    return out


def _rebind(module, wrapper: Callable, original: Callable) -> list[tuple[Any, int]]:
    """Point every live reference to `original` at `wrapper`.

    Three kinds of reference, and missing any one leaves the memo partly inert:
      1. the defining module's attribute,
      2. other modules that imported the NAME directly (`_importers`),
      3. functions that captured it as a DEF-TIME DEFAULT (`df_fn=...`).
    """
    patched: list[tuple[Any, int]] = []
    for m in [module, *_importers(original)]:
        m.df_linear_rate = wrapper
        patched.append((m, -1))         # -1 marks a module attribute, not a default

    candidates: list[Any] = []
    for m in [module, *_importers(wrapper)]:
        candidates += [getattr(m, n, None) for n in
                       ("forward_rate_simple", "compute_irs_npv", "compute_irs_pvbp",
                        "compute_irs_krd_map", "df", "zero_rate")]
        trade = getattr(m, "IRS_Trade", None)
        if trade is not None:
            candidates.append(trade.compute_npv)
    for fn in candidates:
        if fn is None or not hasattr(fn, "__defaults__"):
            continue
        d = list(fn.__defaults__ or ())
        changed = False
        for i, v in enumerate(d):
            if v is original:
                d[i] = wrapper
                patched.append((fn, i))
                changed = True
        if changed:
            fn.__defaults__ = tuple(d)
    return patched


def install() -> None:
    """Install on both the backtest and the simulation copies. Idempotent."""
    global _installed
    if _installed:
        return
    if os.environ.get(ENV_FLAG, "1") == "0":
        logger.warning("df_cache NOT installed (%s=0)", ENV_FLAG)
        return
    from . import engine_port
    modules = [engine_port]
    try:
        from irs_pricer.engine import quant_engine
        modules.append(quant_engine)
    except ImportError:                   # backtest-only deployments
        pass
    for m in modules:
        original = m.df_linear_rate
        wrapper = _make(original)
        patched = _rebind(m, wrapper, original)
        _installed.append((m, original, patched))
        logger.info("df_cache installed on %s (%d default sites)",
                    m.__name__, len(patched))


def uninstall() -> None:
    global _installed
    for module, original, patched in _installed:
        for target, i in patched:
            if i < 0:                    # a module attribute
                target.df_linear_rate = original
            else:                        # a def-time default slot
                d = list(target.__defaults__ or ())
                d[i] = original
                target.__defaults__ = tuple(d)
        module.df_linear_rate = original
    _installed = []


def clear() -> None:
    global _hits, _misses, _uncacheable
    _entries.clear()
    _hits = _misses = _uncacheable = 0


def stats() -> dict[str, int | float | bool]:
    total = _hits + _misses
    return {
        "installed": bool(_installed),
        "modules": [m.__name__ for m, _o, _p in _installed],
        "hits": _hits,
        "misses": _misses,
        "uncacheable": _uncacheable,
        "live_curves": len(_entries),
        "hit_rate": round(_hits / total, 4) if total else 0.0,
    }
