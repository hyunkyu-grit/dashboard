# -*- coding: utf-8 -*-
"""The fixture the backtest characterization pin is computed on.

SEPARATE FROM `synthetic.py` ON PURPOSE. Those builders seed from a real row of
`data/irsdata.xlsx` — fine for the property tests that consume them, which
assert relationships that hold whatever the curve is. A characterization pin
asserts EXACT NUMBERS, so it may not depend on a workbook the morning bake
rewrites (and which is, as of this pass, uncommitted in the working tree). This
module therefore takes nothing from disk: the quotes are literals and the
evolution is arithmetic.

WHY THE LAW IS WHAT IT IS.

  - It MOVES. A frozen market makes every day's curve the same object, which is
    exactly the condition under which a wrong schedule cache would still agree
    with the truth. The pin has to price a moving book or it pins nothing.
  - It uses ONLY +,-,*,/ and `math.sqrt`. IEEE-754 requires sqrt to be
    correctly rounded; `sin`/`**0.5` route through libm/pow and are NOT
    guaranteed identical across platforms or library versions. A pin whose
    expected values drift with a libm upgrade is a false alarm generator.
  - The twist is front-end led, so the 1D/3M anchors and the 10Y node do not
    move together — a cache that confused two legs of a spread would show up.
"""

from __future__ import annotations

import datetime as dt
import math

from app.curves import TENOR_T
from app.dataset import Dataset
from app.engine_port import next_kr_business_day

# A market-plausible KRW curve, frozen as literals. Shapes are in the region of
# a real 2024 snapshot; the exact levels do not matter, only that they never
# change again.
BASE_QUOTES: dict[str, float] = {
    "1D":   3.500,
    "3M":   3.620,
    "6M":   3.585,
    "9M":   3.540,
    "1Y":   3.480,
    "1.5Y": 3.395,
    "2Y":   3.340,
    "3Y":   3.295,
    "4Y":   3.290,
    "5Y":   3.300,
    "6Y":   3.315,
    "7Y":   3.330,
    "8Y":   3.345,
    "9Y":   3.360,
    "10Y":  3.375,
}

START = dt.date(2024, 1, 2)
DAYS = 260          # ~one year of KR business days; crosses four quarterly resets
_PERIOD = 80        # business days per triangle cycle
_AMPLITUDE = 20.0   # bp, peak of the level move


def shift_bp(tenor: str, day: int) -> float:
    """Deterministic bp shift applied to `tenor` on business-day index `day`.

    level: a triangle wave (pure integer arithmetic into a float) so the whole
    curve rises and falls; twist: a linear-in-time tilt scaled by sqrt(t) so the
    front end leads. Together they reshape the curve rather than translate it.
    """
    phase = day % _PERIOD
    up = phase if phase <= _PERIOD // 2 else _PERIOD - phase
    level = up * (_AMPLITUDE / (_PERIOD / 2))
    twist = (day / DAYS) * (8.0 - 3.0 * math.sqrt(TENOR_T[tenor]))
    return level + twist


def business_days(start: dt.date, n: int) -> list[dt.date]:
    out = [start]
    while len(out) < n:
        out.append(next_kr_business_day(out[-1]))
    return out


def characterization_dataset() -> Dataset:
    """The fixture: `DAYS` business days from `START`, every tenor moving under
    `shift_bp`. Depends on no file and on no clock."""
    dates = business_days(START, DAYS)
    tenors = list(TENOR_T.keys())
    series: dict[str, list[float]] = {}
    for t in tenors:
        base = BASE_QUOTES[t]
        series[t] = [base + shift_bp(t, i) / 100.0 for i in range(len(dates))]
    return Dataset(dates=dates, series=series, tenor_order=tenors)
