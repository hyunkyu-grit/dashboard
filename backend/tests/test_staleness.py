"""Dataset freshness (closing session part 2, Pass C).

Dates chosen against the real KR calendar: 2026-07-24 is a Friday, 07-27 Mon,
07-28 Tue; 2026-01-01 (New Year) is a Thursday holiday — a *weekday* that must
still not count, which is what separates the business-day rule from a plain
weekday count.
"""

from datetime import date

from app.engine_port import _is_kr_business_day
from app.staleness import business_days_between, dataset_freshness, freshness_level


ASOF = date(2026, 7, 24)  # Friday — the dataset's actual asof


def test_same_day_and_weekend_are_current():
    for today in (date(2026, 7, 24), date(2026, 7, 25), date(2026, 7, 26)):
        f = dataset_freshness(ASOF, today)
        assert f["ageBusinessDays"] == 0
        assert f["level"] == "current"


def test_one_business_day_behind_is_visible():
    f = dataset_freshness(ASOF, date(2026, 7, 27))  # Monday
    assert f["ageBusinessDays"] == 1
    assert f["level"] == "behind"


def test_two_or_more_business_days_is_stale():
    assert dataset_freshness(ASOF, date(2026, 7, 28))["level"] == "stale"  # Tue, age 2
    over = dataset_freshness(ASOF, date(2026, 7, 31))  # Friday, a full week later
    assert over["ageBusinessDays"] == 5
    assert over["level"] == "stale"


def test_weekend_days_are_not_counted():
    assert business_days_between(date(2026, 7, 24), date(2026, 7, 26)) == 0


def test_weekday_holiday_is_excluded_not_just_weekends():
    # 2026-01-01 is a Thursday AND a public holiday: it is a weekday that must
    # not count, proving the rule uses the frozen engine's holiday calendar.
    assert not _is_kr_business_day(date(2026, 1, 1))
    assert business_days_between(date(2025, 12, 31), date(2026, 1, 1)) == 0
    assert business_days_between(date(2025, 12, 31), date(2026, 1, 2)) == 1  # Fri only


def test_future_asof_is_not_negative():
    f = dataset_freshness(date(2026, 7, 24), date(2026, 7, 20))
    assert f["ageBusinessDays"] == 0
    assert f["level"] == "current"


def test_level_thresholds():
    assert freshness_level(0) == "current"
    assert freshness_level(1) == "behind"
    assert freshness_level(2) == "stale"
    assert freshness_level(9) == "stale"
