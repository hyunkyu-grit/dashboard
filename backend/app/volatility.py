"""Volatility transforms — a short-vs-long realised-volatility ratio over any
series (Session 14).

    Relative ATR = mean(ATR over 5 obs) / mean(ATR over 60 obs)

A dimensionless ratio: ~1.0 is normal, above 1 means the recent (5-obs) window
is hotter than the longer (60-obs) one.

**Input form (settled Session 14).** Proper ATR needs a daily high and low; the
export is daily CLOSES only (`MID종가`) — no intraday high/low column exists —
so true range collapses to the absolute day-over-day change,

    TR_t = |r_t − r_{t−1}|   (in bp)

and the measure becomes the ratio of the 5-obs to the 60-obs mean absolute
change: a sound short-vs-long realised-vol ratio. Recorded in DESIGN §6 and
under ## Provisional.

This is a **generic transform over any series id** (§16 — computed here, never
in the browser). The volatility tab exposes only the tenor set for now, but
spreads and forwards can reuse it unchanged.

**Windows are OBSERVATIONS**, i.e. trading days actually present in the data —
never calendar days — so a holiday cannot silently shorten a window.
"""

from __future__ import annotations

import datetime as dt
from bisect import bisect_left

from .dataset import DISPLAY_TENORS, Dataset, tenor_years
from .derive import BASIS_KEYS, series_values, value_at

SHORT_OBS = 5
LONG_OBS = 60
# The ratio is null until this many closes exist (owner spec). 60 observations
# give the long ATR its window; the warm-up is held to 65 so the short window
# also sits fully inside real history before a number is shown.
WARMUP_OBS = 65
# The 60-obs mean absolute change can approach zero for a rate that sits
# unchanged for weeks (the 1D call rate, 3M CD91 — 3M shows +0.0 for yesterday).
# Below this floor the ratio explodes or divides by zero, so it is undefined.
LONG_MEAN_FLOOR_BP = 0.05


def relative_atr(pairs: list[tuple[str, float]],
                 scale: float = 100.0) -> list[tuple[str, float | None]]:
    """Relative-ATR series aligned to `pairs`.

    `pairs` is the chronological, gap-free list of (iso-date, value) closes for
    one series (Nones already dropped, so every step is one observation apart).
    `scale` lifts the level's unit to bp (100 for a %-level series, 1 for a
    series already in bp) — it sets the floor's unit; the ratio itself is
    scale-invariant.

    Returns [(iso-date, ratio | None)] the same length as `pairs`. `None` (never
    0, never a partial-window value) covers both the warm-up and a near-zero
    long-window mean.
    """
    n = len(pairs)
    # Daily true range in bp. tr[0] is undefined (no prior observation).
    tr: list[float | None] = [None] * n
    for i in range(1, n):
        tr[i] = abs(pairs[i][1] - pairs[i - 1][1]) * scale

    out: list[tuple[str, float | None]] = []
    for i in range(n):
        ratio: float | None = None
        if i + 1 >= WARMUP_OBS:
            long_window = tr[i - LONG_OBS + 1 : i + 1]   # 60 TRs, all defined
            short_window = tr[i - SHORT_OBS + 1 : i + 1]  # 5 TRs, all defined
            long_mean = sum(long_window) / LONG_OBS       # type: ignore[arg-type]
            short_mean = sum(short_window) / SHORT_OBS     # type: ignore[arg-type]
            if long_mean >= LONG_MEAN_FLOOR_BP:
                ratio = round(short_mean / long_mean, 4)
        out.append((pairs[i][0], ratio))
    return out


_rel_atr_cache: dict[str, list[tuple[str, float | None]]] = {}


def relative_atr_for(dataset: Dataset, series_id: str) -> list[tuple[str, float | None]]:
    """Relative-ATR history for any series id (outright tenor or derived),
    compacted to available closes and cached per series alongside the other
    series caches."""
    if series_id in _rel_atr_cache:
        return _rel_atr_cache[series_id]
    values = series_values(dataset, series_id)  # raises KeyError on unknown id
    # % levels lift to bp (×100); series already in bp keep scale 1.
    scale = 100.0 if series_id in dataset.series else 1.0
    pairs = [
        (d.isoformat(), round(v, 4))
        for d, v in zip(dataset.dates, values)
        if v is not None
    ]
    out = relative_atr(pairs, scale)
    _rel_atr_cache[series_id] = out
    return out


def relative_atr_aligned(dataset: Dataset, series_id: str) -> list[float | None]:
    """Relative-ATR ratios aligned to `dataset.dates` (None where there is no
    close, or during warm-up / below the floor) — so the summary machinery
    (`value_at`, percentile) can read it like any other series."""
    by_date = {t: r for t, r in relative_atr_for(dataset, series_id)}
    return [by_date.get(d.isoformat()) for d in dataset.dates]


# ── Volatility tab payload (Session 14 Pass 3) ──────────────────────────────
# Same DTO shape as the other tabs (SeriesSummary-like) so the table component
# never branches. Everything is precomputed here (§16): the current ratio, the
# five basis deltas as RATIO DIFFERENCES (not bp), the 10y percentile, the sort
# key, and the summary classification.

def _volatility_row(dataset: Dataset, tenor: str,
                    bases: dict[str, dt.date | None],
                    aligned: list[float | None]) -> dict:
    now: float | None = None
    for v in reversed(aligned):
        if v is not None:
            now = v
            break

    deltas: dict[str, float | None] = {}
    basis_values: dict[str, float | None] = {}
    for key in BASIS_KEYS:
        bv = value_at(dataset, aligned, bases[key])
        basis_values[key] = round(bv, 4) if bv is not None else None
        # a change in the ratio is a ratio DIFFERENCE, never a bp figure (§ vol).
        deltas[key] = (
            round(now - bv, 4) if now is not None and bv is not None else None
        )

    clean = sorted(v for v in aligned if v is not None)
    pct = None
    if clean and now is not None:
        pct = round(bisect_left(clean, now) / len(clean) * 100, 1)

    # Vol classification is percentile-extreme only — the retracement shape's
    # 0.5bp threshold is meaningless for a dimensionless ratio.
    one_liner = (
        {"kind": "extreme", "value": round(pct)}
        if pct is not None and (pct >= 90 or pct <= 10)
        else {"kind": "none", "value": None}
    )

    return {
        "id": f"vol:{tenor}",
        "label": f"{tenor} σ",
        "kind": "vol",
        "unit": "ratio",
        "now": round(now, 4) if now is not None else None,
        "deltas": deltas,
        "basisValues": basis_values,
        "range10y": {
            "min": clean[0] if clean else None,
            "max": clean[-1] if clean else None,
            "pct": pct,
        },
        "sortKey": [tenor_years(tenor)],
        "quoted": None,
        "oneLiner": one_liner,
        "spark": [],
    }


def volatility_payload(dataset: Dataset, bases: dict[str, dt.date | None]) -> dict:
    """List rows + the across-tenor curve for the volatility tab. Nulls travel
    as null all the way out — zero is never substituted (§ vol)."""
    rows: list[dict] = []
    curve: list[dict] = []
    for tenor in DISPLAY_TENORS:
        aligned = relative_atr_aligned(dataset, tenor)
        row = _volatility_row(dataset, tenor, bases, aligned)
        rows.append(row)
        prev = value_at(dataset, aligned, bases["d1"])
        curve.append({
            "label": tenor,
            "now": row["now"],
            "prev": round(prev, 4) if prev is not None else None,
        })
    return {"rows": rows, "curve": curve}
