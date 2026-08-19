# -*- coding: utf-8 -*-
"""The discount-factor memo (`app/df_cache.py`) — MEMO-2.

A wrong curve key here would return a plausible discount factor from the wrong
curve, silently, and no tolerance test in this repo is looking for that. So the
identity is tested harder than the speed:

  1. bit-identity of every returned float, on real curves and real query points;
  2. two curves that differ anywhere never share a table;
  3. the def-time default sites really do route through the wrapper — the trap
     that would make this memo silently inert;
  4. a curve's table dies with the curve, so the cache cannot outlive it.
"""

from __future__ import annotations

import gc
import struct

import numpy as np
import pytest

from app import df_cache
import app.engine_port as ep


@pytest.fixture(autouse=True)
def _clean():
    df_cache.uninstall()
    df_cache.clear()
    yield
    df_cache.uninstall()
    df_cache.clear()


def _curve(shift: float = 0.0) -> np.ndarray:
    return ep.bootstrap_zero_curve(
        [(0.25, 0.0310 + shift), (0.5, 0.0315 + shift), (1.0, 0.0320 + shift),
         (2.0, 0.0330 + shift), (3.0, 0.0335 + shift), (5.0, 0.0350 + shift),
         (7.0, 0.0365 + shift), (10.0, 0.0380 + shift)]
    )


def test_every_returned_float_is_bit_identical():
    """GATE 2. Not 'within tolerance' — the same 8 bytes."""
    original = ep.df_linear_rate
    curves = [_curve(), _curve(1e-4), _curve(-5e-4)]
    # real query points: quarterly out to 10y, plus stubs and the 1D anchor
    ts = [i * 0.25 for i in range(1, 41)] + [1 / 365, 0.003, 0.2493, 7.77, 9.999]
    expected = {(i, t): original(t, zc) for i, zc in enumerate(curves) for t in ts}

    df_cache.install()
    got = {(i, t): ep.df_linear_rate(t, zc) for i, zc in enumerate(curves) for t in ts}

    assert set(got) == set(expected)
    bad = [k for k in expected
           if struct.pack("<d", got[k]) != struct.pack("<d", expected[k])]
    assert not bad, f"{len(bad)} value(s) differ in bits, e.g. {bad[:3]}"
    # and a second pass, now served entirely from the tables
    again = {(i, t): ep.df_linear_rate(t, zc) for i, zc in enumerate(curves) for t in ts}
    assert all(struct.pack("<d", again[k]) == struct.pack("<d", expected[k]) for k in expected)
    assert df_cache.stats()["hits"] > 0


def test_curves_that_differ_never_share_a_table():
    a, b = _curve(), _curve(1e-4)
    assert not np.array_equal(a, b)
    original = ep.df_linear_rate
    exp_a, exp_b = original(5.0, a), original(5.0, b)
    assert exp_a != exp_b

    df_cache.install()
    assert ep.df_linear_rate(5.0, a) == exp_a
    assert ep.df_linear_rate(5.0, b) == exp_b        # not served a's value
    assert ep.df_linear_rate(5.0, a) == exp_a        # and back again


def test_the_def_time_default_sites_route_through_the_wrapper():
    """The trap: `df_fn=df_linear_rate` is captured at def time, so rebinding
    the module attribute alone leaves every hot caller on the original and the
    memo does nothing while reporting itself installed."""
    df_cache.install()
    df_cache.clear()
    zc = _curve()
    before = df_cache.stats()["hits"] + df_cache.stats()["misses"]
    # forward_rate_simple takes df_fn as a DEFAULT — no explicit argument here
    ep.forward_rate_simple(1.0, 1.25, zc)
    after = df_cache.stats()["hits"] + df_cache.stats()["misses"]
    assert after > before, "forward_rate_simple did not reach the memo"


def test_compute_npv_routes_through_the_wrapper():
    import datetime as dt

    from app.valuation_port import VanillaSwap

    df_cache.install()
    df_cache.clear()
    trade = VanillaSwap(5.0, 1e10, 0.03, True,
                        trade_date=dt.date(2024, 1, 2)).to_irs_trade(dt.date(2024, 1, 2))
    before = df_cache.stats()["hits"] + df_cache.stats()["misses"]
    trade.compute_npv(dt.date(2024, 6, 3), _curve(), 3.2)
    assert df_cache.stats()["hits"] + df_cache.stats()["misses"] > before


def test_the_real_backtest_path_reaches_the_memo():
    """THE REGRESSION TEST for the defect this memo shipped with for an hour.

    `app/valuation_port.py` does `from .engine_port import df_linear_rate`,
    which binds at IMPORT time. The first version of `install()` rebound only
    the defining module's attribute and every def-time default — and every one
    of the other tests here passed, because they all call through
    `app.engine_port`. The backtest went through `valuation_port`'s own copy,
    took zero hits, and got zero speedup while `stats()` cheerfully reported
    `installed: True`.

    A memo that is installed and inert is worse than one that is absent: it
    reports success. So this asserts hits through the REAL entry point, not
    through the module the wrapper happens to be defined in.
    """
    import datetime as dt

    from app.curves import build_basis_curves
    from app.valuation_port import CurveBundle, VanillaSwap, value_booked_trade
    from tests.characterization import characterization_dataset

    ds = characterization_dataset()
    zc = build_basis_curves(ds)["now"]
    swap = VanillaSwap(5.0, 1e10, 0.03, True, trade_date=ds.dates[0])

    df_cache.install()
    df_cache.clear()
    value_booked_trade(swap, CurveBundle(ds.dates[-1], zc, []), None)
    s = df_cache.stats()
    assert s["hits"] + s["misses"] > 0, (
        "value_booked_trade did not reach the memo — a direct-import binding "
        "was missed by install()"
    )


def test_a_curves_table_dies_with_the_curve():
    """Lifetime is structural: the table IS the weakref entry's payload."""
    df_cache.install()
    zc = _curve()
    ep.df_linear_rate(5.0, zc)
    assert df_cache.stats()["live_curves"] == 1
    del zc
    gc.collect()
    assert df_cache.stats()["live_curves"] == 0


def test_uninstall_restores_the_defaults_too():
    original = ep.df_linear_rate
    d_before = ep.forward_rate_simple.__defaults__
    df_cache.install()
    assert ep.forward_rate_simple.__defaults__ != d_before
    df_cache.uninstall()
    assert ep.df_linear_rate is original
    assert ep.forward_rate_simple.__defaults__ == d_before


def test_a_none_curve_falls_through():
    df_cache.install()
    assert ep.df_linear_rate(1.0, None) == df_cache._installed[0][1](1.0, None)
    assert df_cache.stats()["uncacheable"] > 0


def test_kill_switch_blocks_installation(monkeypatch):
    monkeypatch.setenv(df_cache.ENV_FLAG, "0")
    df_cache.install()
    assert df_cache.stats()["installed"] is False
