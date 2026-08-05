"""Dataset freshness (closing session part 2, Pass C).

`data/irsdata.xlsx` is a static snapshot and nothing in this repo defines how
tomorrow's close arrives — that feed is an owner decision and out of scope. What
is IN scope is the failure mode: without this, the product shows yesterday's
curve as today's with no hint that it is stale, which is this project's recurring
defect class. So we measure how old the data is, in KR business days, and let the
UI say so.

Business days (not calendar days) because a Friday snapshot read on Saturday or
Monday-before-close is not "stale" — the market was shut. The KR business-day
test is the frozen engine's own (`_is_kr_business_day`: weekend + KR public
holiday), reused, not re-implemented, so freshness and the curve share one
calendar.
"""

from __future__ import annotations

from datetime import date, timedelta

from .engine_port import _is_kr_business_day

# Thresholds (Pass C brief): same-day quiet, one business day behind visible,
# more than that unmissable and stated in words.
_BEHIND_AT = 1
_STALE_AT = 2


def business_days_between(start: date, end: date) -> int:
    """KR business days strictly AFTER `start`, up to and including `end`.

    0 when `end <= start`. A Friday `start` viewed on the weekend returns 0
    (no business day has passed); viewed the next business day returns 1.
    """
    if end <= start:
        return 0
    n = 0
    d = start + timedelta(days=1)
    while d <= end:
        if _is_kr_business_day(d):
            n += 1
        d += timedelta(days=1)
    return n


def freshness_level(age_business_days: int) -> str:
    """`current` (quiet) / `behind` (visible) / `stale` (unmissable)."""
    if age_business_days >= _STALE_AT:
        return "stale"
    if age_business_days >= _BEHIND_AT:
        return "behind"
    return "current"


def dataset_freshness(asof: date, today: date | None = None) -> dict:
    """Freshness of a dataset whose latest date is `asof`, as of `today`
    (defaults to the server's local date — computed per request, never cached,
    so the age advances with the wall clock even though the file does not).

    전일종가 rule [OWNER, 2026-08-05]: the loader drops today's intraday row,
    so the freshest a dataset CAN be is asof = the last business day strictly
    before today. Age therefore counts the completed closes the file is
    missing — business days after `asof` up to and including YESTERDAY, not
    today. On Tuesday a Monday close is current (age 0); a Friday close is
    behind (Monday's close exists and is absent, age 1). Before this rule the
    same arithmetic ran through today itself, which under the cutoff would
    have called every dataset permanently behind."""
    today = today or date.today()
    age = business_days_between(asof, today - timedelta(days=1))
    return {
        "asOf": asof.isoformat(),
        "today": today.isoformat(),
        "ageBusinessDays": age,
        "level": freshness_level(age),
    }
