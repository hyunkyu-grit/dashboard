"""Server-side derivations: time bases, deltas, spreads/flies, downsampling.

Everything the wall shows is computed here — the browser never derives a
series (design spec §4).
"""

from __future__ import annotations

import datetime as dt
from bisect import bisect_left, bisect_right
from itertools import combinations

from .dataset import (
    DISPLAY_TENORS,
    QUOTED_NODES,
    SPEC_NODE_ORDER,
    Dataset,
    tenor_years,
)

BASIS_KEYS = ["d1", "wtd", "mtd", "qtd", "ytd"]

SPARK_POINTS = 150  # ~150-pt downsampled sparkline / preview series (§4/§16)
CALENDAR_DAYS = 130  # ~26 trading weeks of daily changes for the heatmap (§2)

# LEVEL statistics window (annual-stats session): trailing one year of
# observations, the 52-week convention. A ten-year window straddles the
# 2020-21 near-zero regime, so every level sat at the 99th-100th percentile
# of it permanently — no discriminating power. Trailing (not calendar-YTD:
# a January YTD range is a handful of days). CHANGE-based statistics
# (movePct, tint, move-extreme rung) deliberately stay on the FULL history:
# daily changes are far more stationary than levels, so the regime break
# does not distort them and the longer window estimates better.
ANNUAL_OBS = 252


def annual_stats(values: list[float | None]) -> dict:
    """52-week level stats: min/max/avg of the trailing ANNUAL_OBS non-null
    observations + the percentile of the latest level within that window."""
    clean = [v for v in values if v is not None][-ANNUAL_OBS:]
    if not clean:
        return {"min": None, "max": None, "avg": None, "pct": None}
    now = clean[-1]
    s = sorted(clean)
    return {
        "min": s[0],
        "max": s[-1],
        "avg": round(sum(clean) / len(clean), 4),
        "pct": round(bisect_left(s, now) / len(s) * 100, 1),
    }


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


# 한 줄 ladder thresholds (§C2), chosen from the Session-15 replay
# (docs/diagnostics/color-density.md): a top-3% own-history daily move, or a
# level in the top/bottom 5%. The level rung is CAPPED to the few most-extreme
# rows (LEVEL_CAP): on a synchronised-regime day the whole curve sits at decade
# highs and an uncapped rung printed "백분위 9X" on ~20 rows — the "nine rows
# said the same thing" failure. A cap only limits when there are many; it never
# forces winners (unlike the cross-sectional rule the report disqualified), so
# a quiet day still shows nothing. Which instruments are at highs is the
# "10년 고점권" screener chip's job, not a label repeated down the column.
MOVE_PCT_CUT = 97.0   # today's move in the top (100 − this)% of own daily moves
LEVEL_BAND = 5.0      # level percentile in the top/bottom this-many %
LEVEL_CAP = 3         # at most this many level-extreme labels per peer group
SOLO_MIN_BP = 0.5     # a move below this is not a "solo" mover


def day_move_pct(values: list[float | None], scale: float,
                 today_change_bp: float | None) -> float | None:
    """Percentile (0–100) of today's |D-1 change| within the series' OWN history
    of |daily changes| (in bp). This is the signal the table showed nowhere:
    +5bp is ordinary for 10Y and an event for 3M. None if too little history."""
    if today_change_bp is None:
        return None
    diffs: list[float] = []
    prev: float | None = None
    for v in values:
        if v is not None and prev is not None:
            diffs.append(abs(v - prev) * scale)
        if v is not None:
            prev = v
    if len(diffs) < 30:
        return None
    x = abs(today_change_bp)
    return round(100.0 * sum(1 for d in diffs if d <= x) / len(diffs), 1)


def classify_one_liner(move_pct: float | None, has_data: bool) -> dict:
    """Rung 1 of the `한 줄` ladder (§16 exception; §C2): today's move is extreme
    against the series' OWN history → move_extreme (value = the top-N%, a number
    shown in no column). The backend decides WHAT is true; the browser renders
    the Korean. Rungs 2 (level extreme, capped) and 3 (solo direction) are
    cross-sectional and applied by the caller over a peer group.

    Never restates a visible column: a move percentile appears in no cell, and a
    bp magnitude is never emitted here.
    """
    if not has_data:
        return {"kind": "none", "value": None}
    if move_pct is not None and move_pct >= MOVE_PCT_CUT:
        return {"kind": "move_extreme", "value": max(1, round(100 - move_pct))}
    return {"kind": "none", "value": None}


def apply_level_extreme(rows: list[dict], cap: int = LEVEL_CAP) -> None:
    """Rung 2 (§C2), cross-sectional so it can be capped: among rows still
    silent, label the `cap` most-extreme levels (top/bottom LEVEL_BAND%) with
    their percentile — the 52-week percentile (annual-stats session), which
    actually discriminates; the 10y one printed 백분위 9X down whole columns.
    Mutates `oneLiner` in place. A quiet peer group produces nothing; a
    synchronised-regime one produces at most `cap`."""
    cands: list[tuple[float, dict, float]] = []
    for r in rows:
        if r["oneLiner"]["kind"] != "none":
            continue
        pct = r["range1y"]["pct"]
        if pct is None:
            continue
        if pct >= 100 - LEVEL_BAND or pct <= LEVEL_BAND:
            cands.append((abs(pct - 50.0), r, pct))
    cands.sort(key=lambda t: t[0], reverse=True)
    for _extremity, r, pct in cands[:cap]:
        r["oneLiner"] = {"kind": "extreme", "value": round(pct)}


# When most of the curve sits in one extreme band, "this tenor is at a decade
# high" is a fact about the CURVE, not any row — it belongs in one line above
# the table, not repeated down it (§I). Above this fraction of outrights, the
# per-row level rung is suppressed and the banner speaks instead.
CURVE_REGIME_FRAC = 0.6


def curve_banner(outrights: list[dict]) -> dict:
    """Classify whether the outright curve as a whole sits at a 52-week
    extreme (§I; annual window per the annual-stats session). Backend decides
    WHAT is true; the browser renders the Korean."""
    pcts = [o["range1y"]["pct"] for o in outrights if o["range1y"]["pct"] is not None]
    if not pcts:
        return {"kind": None}
    hi = sum(1 for p in pcts if p >= 90) / len(pcts)
    lo = sum(1 for p in pcts if p <= 10) / len(pcts)
    if hi >= CURVE_REGIME_FRAC:
        return {"kind": "curve_high"}
    if lo >= CURVE_REGIME_FRAC:
        return {"kind": "curve_low"}
    return {"kind": None}


def apply_solo_direction(rows: list[dict]) -> None:
    """Rung 3 (§C2), cross-sectional over a peer group (outrights): a row that
    is still silent and moved OPPOSITE the day's majority stands out. Mutates
    each row's `oneLiner` in place; only touches rows still classified "none"."""
    d1s = [r["deltas"]["d1"] for r in rows
           if r["deltas"]["d1"] is not None and abs(r["deltas"]["d1"]) >= SOLO_MIN_BP]
    if not d1s:
        return
    ups = sum(1 for d in d1s if d > 0)
    downs = sum(1 for d in d1s if d < 0)
    if ups == downs:
        return
    maj = 1 if ups > downs else -1
    for r in rows:
        if r["oneLiner"]["kind"] != "none":
            continue
        d = r["deltas"]["d1"]
        if d is None or abs(d) < SOLO_MIN_BP:
            continue
        if (1 if d > 0 else -1) == -maj:
            r["oneLiner"] = {"kind": "solo_up" if d > 0 else "solo_down", "value": None}


def downsample_triples(points: list[dict], target: int = SPARK_POINTS) -> list[dict]:
    """Stride decimation of {t,v,d} points to ≤ target, always keeping the last.
    Each surviving point keeps its own true daily change `d` (computed on the
    full series before thinning), so a preview point's tooltip stays honest."""
    if len(points) <= target:
        return points
    stride = len(points) / target
    picked = [points[int(i * stride)] for i in range(target)]
    if picked[-1] is not points[-1]:
        picked[-1] = points[-1]
    return picked


def series_history(pairs: list[tuple[str, float]], unit: str,
                   resolution: str = "full") -> dict:
    """Precompute everything the preview/enlarged panes display for a series
    (§16): the line points (downsampled for preview, full otherwise), the
    range stats, and the recent daily-change calendar. `pairs` is the full,
    chronological list of (iso-date, value) with no gaps. The browser never
    differences or averages a series — it all leaves here."""
    scale = 100 if unit == "%" else 1  # deltas quoted in bp even for % levels
    triples: list[dict] = []
    prev: float | None = None
    for t, v in pairs:
        d = round((v - prev) * scale, 2) if prev is not None else None
        triples.append({"t": t, "v": v, "d": d})
        prev = v

    values = [x["v"] for x in triples]
    stats = None
    if values:
        # 52-week stats (annual-stats session): the tooltip's range statistics
        # narrow to the trailing year even though the chart still shows the
        # full history — the 10y min/max straddle the regime break.
        year = values[-ANNUAL_OBS:]
        stats = {
            "min": min(year),
            "max": max(year),
            "avg": round(sum(year) / len(year), 4),
        }

    points = (
        downsample_triples(triples) if resolution == "preview" else triples
    )
    # Calendar wants DAILY resolution regardless of the line's resolution.
    calendar = [
        {"t": x["t"], "d": x["d"]} for x in triples if x["d"] is not None
    ][-CALENDAR_DAYS:]

    return {"unit": unit, "points": points, "stats": stats, "calendar": calendar}


def ohlc_buckets(pairs: list[tuple[str, float]], interval: str) -> list[dict]:
    """Aggregate closes into weekly ('w') or monthly ('m') OHLC bars (§G). A
    true daily candle is impossible (closes only — open would equal close), so
    a bar is: open = first close in the period, high = max, low = min, close =
    last. The bar's date is the last close in the period. Aggregation is
    calculation, so it happens here, not the browser (§16)."""

    def key(iso: str) -> tuple:
        y, m, d = (int(x) for x in iso.split("-"))
        if interval == "m":
            return (y, m)
        iso_y, iso_w, _ = dt.date(y, m, d).isocalendar()
        return (iso_y, iso_w)

    def bar(group: list[tuple[str, float]]) -> dict:
        vals = [v for _t, v in group]
        return {
            "t": group[-1][0],
            "o": round(vals[0], 4),
            "h": round(max(vals), 4),
            "l": round(min(vals), 4),
            "c": round(vals[-1], 4),
        }

    bars: list[dict] = []
    group: list[tuple[str, float]] = []
    cur = None
    for t, v in pairs:
        k = key(t)
        if cur is not None and k != cur:
            bars.append(bar(group))
            group = []
        cur = k
        group.append((t, v))
    if group:
        bars.append(bar(group))
    return bars


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

    # Sort key + quoted flag + 한 줄 classification are computed HERE, not in the
    # browser (§16). Legs map to years; an outright is a single-leg key.
    sort_key = [tenor_years(leg) for leg in series_id.split("-")]
    quoted = (series_id in QUOTED_NODES) if kind == "outright" else None
    move_pct = day_move_pct(values, scale, deltas["d1"])

    return {
        "id": series_id,
        "label": label,
        "kind": kind,
        "unit": unit,
        "now": now,
        "deltas": deltas,
        "basisValues": basis_values,
        # 52-week LEVEL stats (annual-stats session) — never widen back to the
        # full history: the 10y window straddles the 2020-21 regime break and
        # pinned every level at the 99th-100th percentile.
        "range1y": annual_stats(values),
        "sortKey": sort_key,
        "quoted": quoted,
        # own-history move percentile — powers the "오늘 많이 움직인 것" screener
        # (§D) and rung 1 of the 한 줄; the browser never recomputes it (§16).
        # CHANGE-based, so it deliberately stays on the FULL history (see
        # ANNUAL_OBS note) — do not "fix" it to the annual window.
        "movePct": move_pct,
        "oneLiner": classify_one_liner(move_pct, now is not None),
        "spark": [
            {"t": d.isoformat(), "v": v}
            for d, v in downsample(dataset.dates, values)
        ],
    }
