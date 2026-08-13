# -*- coding: utf-8 -*-
"""The business-day memo (`app/calendar_cache.py`) — MEMO-1C Step 3.

Same standard as the schedule memo: it changes no number, its key is total over
what the answer depends on, and the one input that is NOT frozen at import (the
KR holiday table) is shown not to matter rather than assumed not to.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app import calendar_cache, schedule_cache
from app.backtest import book_recon, run_backtest
from app.valuation_port import fixing_date_for_reset

from tests.characterization import characterization_dataset
from tests.test_backtest_characterization import _raw_floats, positions


@pytest.fixture(autouse=True)
def _clean():
    calendar_cache.uninstall()
    calendar_cache.clear()
    yield
    calendar_cache.uninstall()
    calendar_cache.clear()


def test_memo_on_equals_memo_off_on_the_whole_book():
    """The claim: no number moves. Payload plus unrounded float64, both states."""
    ds = characterization_dataset()
    schedule_cache.install()          # the state production runs in

    off_bt, off_rc, off_raw = run_backtest(ds, positions()), book_recon(ds, positions()), _raw_floats()

    calendar_cache.install()
    on_bt, on_rc, on_raw = run_backtest(ds, positions()), book_recon(ds, positions()), _raw_floats()

    assert on_bt == off_bt
    assert on_rc == off_rc
    assert on_raw == off_raw           # exact float64, no tolerance
    assert calendar_cache.stats()["hits"] > 0, "installed but never hit"


def test_the_memo_agrees_with_the_unmemoized_walk_everywhere():
    """Every day across a multi-year span, both lags, memo vs original."""
    orig = calendar_cache._original
    calendar_cache.install()
    d = dt.date(2020, 1, 1)
    checked = 0
    while d < dt.date(2027, 1, 1):
        for n in (1, 2, 3):
            assert calendar_cache._memoized(d, n) == orig(d, n), (d, n)
        d += dt.timedelta(days=1)
        checked += 1
    assert checked > 2500
    assert calendar_cache.stats()["entries"] > 0


def test_fixing_date_for_reset_picks_the_wrapper_up():
    """The seam: `fixing_date_for_reset` must resolve the name through the
    module global, or the memo is installed and doing nothing."""
    calendar_cache.install()
    before = calendar_cache.stats()["misses"] + calendar_cache.stats()["hits"]
    fixing_date_for_reset(dt.date(2024, 3, 11))
    assert calendar_cache.stats()["misses"] + calendar_cache.stats()["hits"] > before


def test_a_walk_past_the_holiday_preload_is_still_correct():
    """The ordering-dependent case, and the reason append-only is sufficient.

    `_KR_HOLIDAYS` preloads 2016-2035 and auto-expands on lookup. A walk whose
    dates sit PAST that horizon must be right on its first evaluation — which
    it is, because expansion happens inside `__keytransform__`, before the dict
    lookup answers. So the value that lands in the cache was never computed
    against a partial table.
    """
    import app.engine_port as ep

    orig = calendar_cache._original
    late = dt.date(2038, 3, 15)                 # well past the preload
    assert 2038 not in ep._KR_HOLIDAYS.years    # genuinely cold

    calendar_cache.install()
    cold = calendar_cache._memoized(late, 1)    # first ever evaluation

    for y in range(2036, 2060):                 # now force full expansion
        ep._is_kr_business_day(dt.date(y, 6, 15))

    calendar_cache.clear()
    warm = calendar_cache._memoized(late, 1)
    assert cold == warm == orig(late, 1)


def test_populating_a_year_leaves_loaded_years_alone():
    """MEMO-1B's proof, re-pinned here because THIS memo's correctness rests on
    it: expansion adds a year, it never rewrites one."""
    import holidays as H

    kr = H.KR(years=range(2016, 2036))
    before = {d: v for d, v in kr.items() if d.year == 2021}
    for y in range(2036, 2060):
        _ = dt.date(y, 6, 15) in kr
    after = {d: v for d, v in kr.items() if d.year == 2021}
    assert before == after and len(before) > 0


def test_the_lag_is_part_of_the_key():
    calendar_cache.install()
    d = dt.date(2024, 3, 11)
    assert calendar_cache._memoized(d, 1) != calendar_cache._memoized(d, 3)


def test_kill_switch_blocks_installation(monkeypatch):
    monkeypatch.setenv(calendar_cache.ENV_FLAG, "0")
    calendar_cache.install()
    assert calendar_cache.stats()["installed"] is False
