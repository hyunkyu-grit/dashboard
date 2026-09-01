"""The canonical KR **bank** calendar for CD91 fixing and settlement.

## What the measurement found

`divergence.py` compared four sources over 2015..2026 (3,131 weekdays) and
found **27 divergent days** in five patterns. Every pattern is interpretable,
and no single source is right:

  12 days  year-end (12-29/30/31), one per year
           holidays.KR=business, QL.Settlement=business, KRX=holiday, XKRX=holiday
           -> the KRX year-end closure. Banks open, exchange shut. Correct for
              a TRADING calendar to call it a holiday; wrong for a bank one.

   9 days  May 1, every year it falls on a weekday
           holidays.KR=BUSINESS, QL.Settlement=holiday, KRX=holiday, XKRX=holiday
           -> 근로자의 날. `holidays.KR` is a PUBLIC-holiday list and is
              technically right to omit it: 근로자의 날 is not a 관공서 공휴일.
              But banks close under 「근로자의 날 제정에 관한 법률」, the KRX is
              shut, and the KOFIA CD91 fixing is not published. For a BANK
              calendar this is a miss, and it is the one that matters here.

   2 days  2016-05-06, 2017-10-02  — 임시공휴일
   2 days  2025-01-27 (임시공휴일), 2025-06-03 (대통령 선거일)
   2 days  2026-06-03 (지방선거일), 2026-07-17 (제헌절, restored from 2026)
           -> holidays.KR knows all six; QuantLib.Settlement knows none of
              them; XKRX knows some. `holidays.KR` is the most current source
              on temporary holidays, election days and statute changes.

So the two candidate libraries fail in opposite directions: QuantLib knows
근로자의 날 but not 임시공휴일; `holidays.KR` knows 임시공휴일 but not
근로자의 날.

## The choice

**Canonical = `holidays.KR` + an explicit 근로자의 날 (May 1) overlay.**

Reasoning, in order:

1. `holidays.KR` is already the sole calendar this backend uses — all five
   construction sites resolve to it (D0.3b), and `window_sensitivity()`
   measured **0 days** of disagreement across the four year windows, so those
   five sites are functionally one source. Choosing it changes nothing that
   currently works.
2. It is the only source that tracks 임시공휴일 and statute changes, which are
   announced with weeks of notice and cannot be hard-coded ahead.
3. Its single systematic gap — 근로자의 날 — is a fixed calendar date, so the
   overlay is one line and cannot drift.
4. XKRX is rejected as canonical **for fixing and settlement** because it is a
   trading calendar: it closes at year end when banks are open, which would
   push a fixing off the last banking day of the year. It remains the right
   calendar for anything keyed to exchange sessions (futures, KRX marks).
5. QuantLib is rejected because nothing in this backend imports it (D0.3a) and
   because it misses every 임시공휴일 in the sample.

## What this implies for the running system

The backend today answers "is May 1 a business day?" with **yes**. The KRW
money market answers **no**. On the 9 weekday May-1s in the sample, any
CD91 fixing or settlement date derived by walking business days is off by one.
This module does not change that — it is research. The finding is reported.
"""

from __future__ import annotations

import datetime as dt
from functools import lru_cache

# 근로자의 날. Fixed date, no observed-day substitution in Korea: when it falls
# on a weekend it is simply lost, which is why the overlay is a plain
# month/day test and not a shifted-holiday rule.
WORKERS_DAY = (5, 1)


@lru_cache(maxsize=4)
def _kr_public(first_year: int, last_year: int):
    import holidays

    return holidays.KR(years=range(first_year, last_year + 1))


def is_workers_day(d: dt.date) -> bool:
    return (d.month, d.day) == WORKERS_DAY


def is_bank_business_day(d: dt.date, first_year: int = 2010, last_year: int = 2040) -> bool:
    """Canonical: a Seoul **bank** business day.

    Weekday, not a 공휴일, and not 근로자의 날.
    """
    if d.weekday() >= 5:
        return False
    if is_workers_day(d):
        return False
    return d not in _kr_public(first_year, last_year)


def prev_bank_business_day(d: dt.date) -> dt.date:
    x = d - dt.timedelta(days=1)
    while not is_bank_business_day(x):
        x -= dt.timedelta(days=1)
    return x


def next_bank_business_day(d: dt.date) -> dt.date:
    x = d + dt.timedelta(days=1)
    while not is_bank_business_day(x):
        x += dt.timedelta(days=1)
    return x


def cd91_fixing_date(reset_date: dt.date) -> dt.date:
    """CD91 fixing = reset date − 1 **bank** business day.

    The lag is the contract convention; the calendar is the part this module
    exists to pin down.
    """
    return prev_bank_business_day(reset_date)


def backend_says_business_day(d: dt.date) -> bool:
    """What `app/engine_port.py:_is_kr_business_day` answers today — reproduced
    here so the test can show the gap without importing the app."""
    import holidays

    cal = holidays.KR(years=range(2016, 2036))
    return d.weekday() < 5 and d not in cal
