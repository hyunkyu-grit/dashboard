"""Pins the canonical bank calendar against the 27 divergent dates that
`research/calendar/divergence.py` measured over 2015..2026.

The point of this file is upgrade safety. `holidays` ships a new release most
months and its KR content changes (제헌절 was restored for 2026; 임시공휴일 are
added as they are gazetted). Without these assertions a `pip install -U
holidays` could move a CD91 fixing date and nothing would say so.

These are research tests. They do not import `backend/app/`.
"""

from __future__ import annotations

import datetime as dt

import pytest

from research.calendar.canonical import (
    backend_says_business_day,
    cd91_fixing_date,
    is_bank_business_day,
    prev_bank_business_day,
)

D = dt.date.fromisoformat


# ── the 9 May-1 divergences: banks shut, holidays.KR says open ──────────────
WORKERS_DAYS_ON_WEEKDAYS = [
    "2015-05-01", "2017-05-01", "2018-05-01", "2019-05-01", "2020-05-01",
    "2023-05-01", "2024-05-01", "2025-05-01", "2026-05-01",
]


@pytest.mark.parametrize("iso", WORKERS_DAYS_ON_WEEKDAYS)
def test_workers_day_is_not_a_bank_business_day(iso):
    """근로자의 날 — banks and the KOFIA CD91 fixing are shut."""
    assert is_bank_business_day(D(iso)) is False


@pytest.mark.parametrize("iso", WORKERS_DAYS_ON_WEEKDAYS)
def test_this_is_exactly_where_the_backend_disagrees(iso):
    """The gap this lane found, pinned so it cannot be lost.

    The backend's own predicate calls these business days. If a future change
    fixes `app/engine_port.py`, this assertion flips and the fix is visible
    rather than silent.
    """
    assert backend_says_business_day(D(iso)) is True
    assert is_bank_business_day(D(iso)) is False


# ── the 6 temporary / election / statute holidays holidays.KR does know ─────
TEMPORARY_HOLIDAYS = [
    ("2016-05-06", "임시공휴일"),
    ("2017-10-02", "임시공휴일"),
    ("2025-01-27", "임시공휴일"),
    ("2025-06-03", "대통령 선거일"),
    ("2026-06-03", "지방선거일"),
    ("2026-07-17", "제헌절 (restored 2026)"),
]


@pytest.mark.parametrize("iso,label", TEMPORARY_HOLIDAYS)
def test_temporary_and_statute_holidays_are_not_business_days(iso, label):
    assert is_bank_business_day(D(iso)) is False, label


# ── the 12 year-end days: banks OPEN, exchange shut ─────────────────────────
KRX_YEAR_END_CLOSURES = [
    "2015-12-31", "2016-12-30", "2017-12-29", "2018-12-31", "2019-12-31",
    "2020-12-31", "2021-12-31", "2022-12-30", "2023-12-29", "2024-12-31",
    "2025-12-31", "2026-12-31",
]


@pytest.mark.parametrize("iso", KRX_YEAR_END_CLOSURES)
def test_krx_year_end_closure_is_still_a_bank_business_day(iso):
    """The reason XKRX was rejected as canonical for fixing and settlement.

    The exchange is shut; banks are not. A fixing keyed to XKRX would be
    pushed off the last banking day of the year.
    """
    assert is_bank_business_day(D(iso)) is True


# ── the convention that depends on all of the above ─────────────────────────
def test_cd91_fixing_skips_workers_day():
    """2025-05-02 was a Friday; 2025-05-01 a Thursday and 근로자의 날.

    Under the canonical calendar the fixing walks back to Wednesday 04-30.
    Under the backend's calendar it would stop on 05-01 — the off-by-one this
    lane is reporting.
    """
    assert cd91_fixing_date(D("2025-05-02")) == D("2025-04-30")
    assert prev_bank_business_day(D("2025-05-02")) == D("2025-04-30")


def test_cd91_fixing_normal_case_is_unchanged():
    """A week with no holiday behaves exactly as before — the overlay must not
    move anything it is not aimed at."""
    assert cd91_fixing_date(D("2025-03-13")) == D("2025-03-12")


def test_cd91_fixing_at_year_end_uses_the_banking_day():
    """2026-01-04 is a Monday; 2025-12-31 a Thursday on which banks are open
    but the KRX is shut. The fixing is 12-31, not 12-30."""
    assert cd91_fixing_date(D("2026-01-02")) == D("2025-12-31")
