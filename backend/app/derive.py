"""Server-side derivations: time bases, deltas, spreads/flies, downsampling.

Everything the wall shows is computed here — the browser never derives a
series (design spec §4).
"""

from __future__ import annotations

import datetime as dt
from bisect import bisect_left
from itertools import combinations

from .dataset import DISPLAY_TENORS, Dataset

BASIS_KEYS = ["d1", "wtd", "mtd", "qtd", "ytd"]

SPARK_POINTS = 150  # ~150-pt downsampled sparkline (design spec §4)


def basis_dates(dataset: Dataset) -> dict[str, dt.date | None]:
    """Last close strictly BEFORE each period containing the as-of date.

    d1 = previous available business day; wtd = last close of the previous
    ISO week; mtd/qtd/ytd = last close before the month/quarter/year start.
    """
    dates = dataset.dates
    asof = dataset.asof

    def last_before(cutoff: dt.date) -> dt.date | None:
        i = bisect_left(dates, cutoff)
        return dates[i - 1] if i > 0 else None

    week_start = asof - dt.timedelta(days=asof.weekday())
    month_start = asof.replace(day=1)
    quarter_start = asof.replace(month=3 * ((asof.month - 1) // 3) + 1, day=1)
    year_start = asof.replace(month=1, day=1)

    return {
        "d1": last_before(asof),
        "wtd": last_before(week_start),
        "mtd": last_before(month_start),
        "qtd": last_before(quarter_start),
        "ytd": last_before(year_start),
    }


def value_at(dataset: Dataset, values: list[float | None],
             date: dt.date | None) -> float | None:
    """Value on `date`, falling back to the most recent prior close."""
    if date is None:
        return None
    i = bisect_left(dataset.dates, date)
    if i < len(dataset.dates) and dataset.dates[i] == date:
        j = i
    else:
        j = i - 1
    while j >= 0:
        if values[j] is not None:
            return values[j]
        j -= 1
    return None


def spread_series(dataset: Dataset, short: str, long: str) -> list[float | None]:
    """Two-point curve spread in bp: long tenor minus short tenor."""
    a, b = dataset.series[short], dataset.series[long]
    return [
        (y - x) * 100 if x is not None and y is not None else None
        for x, y in zip(a, b)
    ]


def fly_series(dataset: Dataset, short: str, belly: str,
               long: str) -> list[float | None]:
    """Butterfly in bp: 2×belly − short − long."""
    a = dataset.series[short]
    b = dataset.series[belly]
    c = dataset.series[long]
    return [
        (2 * y - x - z) * 100
        if x is not None and y is not None and z is not None else None
        for x, y, z in zip(a, b, c)
    ]


def derived_ids() -> list[tuple[str, str, list[str]]]:
    """All 35 derived series: (id, kind, legs). 15 spreads + 20 flies."""
    out: list[tuple[str, str, list[str]]] = []
    for a, b in combinations(DISPLAY_TENORS, 2):
        out.append((f"{a}-{b}", "spread", [a, b]))
    for a, b, c in combinations(DISPLAY_TENORS, 3):
        out.append((f"{a}-{b}-{c}", "fly", [a, b, c]))
    return out


def series_values(dataset: Dataset, series_id: str) -> list[float | None]:
    """Values for an outright tenor id or a derived id like '1Y-2Y[-3Y]'."""
    if series_id in dataset.series:
        return dataset.series[series_id]
    legs = series_id.split("-")
    if len(legs) == 2 and all(t in dataset.series for t in legs):
        return spread_series(dataset, *legs)
    if len(legs) == 3 and all(t in dataset.series for t in legs):
        return fly_series(dataset, *legs)
    raise KeyError(series_id)


def downsample(dates: list[dt.date], values: list[float | None],
               target: int = SPARK_POINTS) -> list[tuple[dt.date, float]]:
    """Stride decimation to ≤ target points, always keeping the last point.

    Good enough for 300px sparklines; swap for LTTB if shape fidelity ever
    matters at this size.
    """
    pts = [(d, v) for d, v in zip(dates, values) if v is not None]
    if len(pts) <= target:
        return pts
    stride = len(pts) / target
    picked = [pts[int(i * stride)] for i in range(target)]
    if picked[-1][0] != pts[-1][0]:
        picked[-1] = pts[-1]
    return picked


def summarize(dataset: Dataset, series_id: str, label: str, kind: str,
              bases: dict[str, dt.date | None]) -> dict:
    values = [None if v is None else round(v, 4)
              for v in series_values(dataset, series_id)]
    now = None
    for v in reversed(values):
        if v is not None:
            now = v
            break

    unit = "%" if kind == "outright" else "bp"
    # Outright deltas are quoted in bp even though levels are in %.
    scale = 100 if unit == "%" else 1

    deltas: dict[str, float | None] = {}
    basis_values: dict[str, float | None] = {}
    for key in BASIS_KEYS:
        bv = value_at(dataset, values, bases[key])
        basis_values[key] = bv
        deltas[key] = round((now - bv) * scale, 4) \
            if now is not None and bv is not None else None

    clean = sorted(v for v in values if v is not None)
    pct = None
    if clean and now is not None:
        pct = round(bisect_left(clean, now) / len(clean) * 100, 1)

    return {
        "id": series_id,
        "label": label,
        "kind": kind,
        "unit": unit,
        "now": now,
        "deltas": deltas,
        "basisValues": basis_values,
        "range10y": {
            "min": clean[0] if clean else None,
            "max": clean[-1] if clean else None,
            "pct": pct,
        },
        "spark": [
            {"t": d.isoformat(), "v": v}
            for d, v in downsample(dataset.dates, values)
        ],
    }
