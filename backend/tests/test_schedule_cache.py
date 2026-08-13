# -*- coding: utf-8 -*-
"""The schedule memo (`app/schedule_cache.py`) — MEMO-1B.

What has to be true for a memo that hands out SHARED objects on a live path:

  1. It changes no number. Proven by running the characterization book with the
     memo off and on and comparing the whole payload plus unrounded float64 —
     not by trusting that the key looks right.
  2. Its key separates every swap that could differ. A key that collapsed two
     legs would still "work" on an outright and be wrong on a spread.
  3. The shared object cannot be mutated. Read-only consumers are a fact about
     today; the guard is what makes it a fact about tomorrow.
  4. The uncacheable input (`trade_date=None`) still returns the right answer.
  5. The holiday table's auto-expansion cannot change a cached schedule — the
     one non-swap input the build reads (module docstring, KEY TOTALITY).

`test_cached_trades_are_frozen` is the one that fails if someone deletes the
guard: revert `_freeze` to a no-op and it goes red. That was proven by doing it.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app import schedule_cache
from app.backtest import book_recon, run_backtest
from app.valuation_port import VanillaSwap

from tests.characterization import characterization_dataset
from tests.test_backtest_characterization import _raw_floats, positions


@pytest.fixture(autouse=True)
def _clean():
    """Every test decides its own install state, and none leaks into the next —
    this module is the only place in the suite that installs the memo."""
    schedule_cache.uninstall()
    schedule_cache.clear()
    yield
    schedule_cache.uninstall()
    schedule_cache.clear()


ENTRY = dt.date(2021, 8, 2)


def _swap(tenor=10.0, notional=1e10, rate=0.02, pay=True, trade_date=ENTRY):
    return VanillaSwap(tenor, notional, rate, pay, trade_date=trade_date)


# ── 1. the memo changes no number ──────────────────────────────────────────

def test_memo_on_equals_memo_off_on_the_whole_book():
    """The claim the whole pass rests on, checked the only way that settles it:
    same book, both states, every published number and every raw float."""
    ds = characterization_dataset()

    off_bt, off_rc = run_backtest(ds, positions()), book_recon(ds, positions())
    off_raw = _raw_floats()

    schedule_cache.install()
    assert schedule_cache.stats()["installed"]
    on_bt, on_rc = run_backtest(ds, positions()), book_recon(ds, positions())
    on_raw = _raw_floats()

    assert on_bt == off_bt
    assert on_rc == off_rc
    assert on_raw == off_raw          # exact float64, no tolerance
    assert schedule_cache.stats()["hits"] > 0, "memo was installed but never hit"


# ── 2. the key separates what must stay separate ───────────────────────────

@pytest.mark.parametrize(
    "kwargs",
    [
        {"tenor": 3.0},
        {"notional": 5e9},
        {"rate": 0.03},
        {"pay": False},
        {"trade_date": dt.date(2021, 8, 3)},
    ],
    ids=["tenor", "notional", "rate", "pay_fixed", "trade_date"],
)
def test_every_swap_field_is_in_the_key(kwargs):
    """Change one field, get a different trade. `notional` and `rate` do not
    alter the SCHEDULE, but they are carried on the object consumers read, so a
    key that dropped them would hand a caller someone else's notional."""
    schedule_cache.install()
    a = _swap().to_irs_trade(ENTRY)
    b = _swap(**kwargs).to_irs_trade(ENTRY)
    assert a is not b
    differs = (
        a.pay_dates != b.pay_dates
        or a.notional != b.notional
        or a.fixed_rate_pct != b.fixed_rate_pct
        or a.direction != b.direction
    )
    assert differs, f"{kwargs} produced an indistinguishable trade"


def test_identical_swaps_share_one_build():
    schedule_cache.install()
    a = _swap().to_irs_trade(ENTRY)
    b = _swap().to_irs_trade(ENTRY)
    assert a is b
    assert schedule_cache.stats()["entries"] == 1


# ── 3. the shared object is frozen ─────────────────────────────────────────

def test_cached_trades_are_frozen():
    """THE GUARD. Delete `_freeze`'s body and this goes red — verified by
    reverting it, watching all four assertions fail, and restoring."""
    schedule_cache.install()
    tr = _swap().to_irs_trade(ENTRY)

    # rebinding a field — refused by _FrozenIRSTrade.__setattr__/__delattr__
    with pytest.raises(AttributeError):
        tr.notional = 1.0
    with pytest.raises(AttributeError):
        tr.pay_dates = []
    with pytest.raises(AttributeError):
        del tr.accruals

    # mutating a CONTAINER in place — refused by the tuple/frozenset swap. A
    # guard on rebinding alone would still let a caller append to the list that
    # every later request reads. Two different refusals, two exception types:
    # a missing method is AttributeError, item assignment is TypeError.
    with pytest.raises(AttributeError):
        tr.pay_dates.append(dt.date(2030, 1, 1))
    with pytest.raises(TypeError):
        tr.accruals[0] = 0.0
    with pytest.raises(AttributeError):
        tr._pay_date_set.add(dt.date(2030, 1, 1))


def test_an_uncached_trade_is_still_writable():
    """The freeze applies to what the cache shares, not to the ported class —
    an ordinary build stays an ordinary mutable IRS_Trade."""
    schedule_cache.uninstall()
    tr = _swap().to_irs_trade(ENTRY)
    tr.notional = 123.0
    assert tr.notional == 123.0


# ── 4. the uncacheable input ───────────────────────────────────────────────

def test_trade_date_none_falls_through_and_is_correct():
    """`trade_date=None` makes the schedule valuation-date dependent, so it is
    not cacheable on swap identity. It must still be right, and must not be
    served a cached answer from a different valuation date."""
    schedule_cache.install()
    before = schedule_cache.stats()["fallthrough"]

    sw = VanillaSwap(10.0, 1e10, 0.02, True, trade_date=None)
    a = sw.to_irs_trade(dt.date(2021, 8, 2))
    b = sw.to_irs_trade(dt.date(2023, 8, 2))

    assert schedule_cache.stats()["fallthrough"] == before + 2
    assert a.start_date != b.start_date, "the fallthrough served a stale schedule"

    schedule_cache.uninstall()
    assert a.start_date == sw.to_irs_trade(dt.date(2021, 8, 2)).start_date


def test_the_repo_never_takes_the_fallthrough():
    """Every live call site passes `trade_date`. If this ever fails, a new
    caller appeared and the cache is quietly doing nothing for it."""
    schedule_cache.install()
    before = schedule_cache.stats()["fallthrough"]
    run_backtest(characterization_dataset(), positions())
    assert schedule_cache.stats()["fallthrough"] == before


# ── 5. the holiday table cannot change a cached schedule ───────────────────

def test_holiday_expansion_does_not_change_a_cached_schedule():
    """`_KR_HOLIDAYS` auto-expands past its 2016-2035 preload. A memo makes the
    first build permanent, so expansion must only APPEND — never revise a date
    the narrower table already covered."""
    import app.engine_port as ep

    schedule_cache.install()
    # a swap whose schedule reaches past the preload horizon
    late = VanillaSwap(10.0, 1e10, 0.03, True, trade_date=dt.date(2026, 8, 12))
    cold = late.to_irs_trade(dt.date(2026, 8, 12))
    cold_pays = tuple(cold.pay_dates)

    for y in range(2036, 2060):
        ep._is_kr_business_day(dt.date(y, 6, 15))

    schedule_cache.clear()
    warm = late.to_irs_trade(dt.date(2026, 8, 12))
    assert tuple(warm.pay_dates) == cold_pays
    assert warm.accruals == cold.accruals
    assert warm.maturity_date == cold.maturity_date


def test_populating_a_year_leaves_loaded_years_alone():
    """The mechanism behind the test above, pinned directly: expansion adds a
    year, it does not rewrite one."""
    import holidays as H

    kr = H.KR(years=range(2016, 2036))
    before = {d: v for d, v in kr.items() if d.year == 2021}
    for y in range(2036, 2060):
        _ = dt.date(y, 6, 15) in kr
    after = {d: v for d, v in kr.items() if d.year == 2021}
    assert before == after and len(before) > 0


# ── the switch ─────────────────────────────────────────────────────────────

def test_kill_switch_blocks_installation(monkeypatch):
    monkeypatch.setenv(schedule_cache.ENV_FLAG, "0")
    schedule_cache.install()
    assert schedule_cache.stats()["installed"] is False
    tr_a = _swap().to_irs_trade(ENTRY)
    tr_b = _swap().to_irs_trade(ENTRY)
    assert tr_a is not tr_b          # unmemoized: a fresh build each time
