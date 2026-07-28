"""Change-log EVENT detection + correlation collapse (design DESIGN.md §12,
owner-confirmed rule (c), 2026-07-24).

A percentile-extreme LEVEL is a persistent STATE and belongs on the tile
(weight-600), never here. This module emits only EVENTS, fixed to the D-1
basis and independent of the global comparison-basis selector:

  (a) transition — the series crossed INTO or OUT OF the extreme percentile
      band relative to the previous business day (point-in-time percentiles);
  (b) own-Δ percentile — today's D-1 change is extreme vs the series' OWN
      10y distribution of daily changes.

Correlated firings (the 6 display tenors span only 5 spread dimensions) are
collapsed by union-find over shared tenor legs into one cluster per line.
All computation is server-side (§4).
"""

from __future__ import annotations

from bisect import bisect_left

import numpy as np

from .dataset import Dataset
from .derive import ANNUAL_OBS, derived_ids, series_values

OUTLIER_PCT = 95
MIN_CHANGE_HISTORY = 20  # need enough own-Δ history to trust the percentile


def _extreme(pct: float | None) -> bool:
    return pct is not None and (pct >= OUTLIER_PCT or pct <= 100 - OUTLIER_PCT)


def _pct_of(values: list[float | None], upto: int, x: float) -> float | None:
    """Percentile of x within the trailing ANNUAL_OBS non-null values up to
    values[upto]. This is a LEVEL percentile, so it uses the 52-week window
    (annual-stats session) — on the full history the regime break kept every
    level permanently extreme and the transition reason never fired. The
    'move' reason below stays on the FULL change history on purpose."""
    clean = sorted([v for v in values[: upto + 1] if v is not None][-ANNUAL_OBS:])
    if not clean:
        return None
    return round(bisect_left(clean, x) / len(clean) * 100, 1)


def _series_meta(dataset: Dataset):
    """Yield (id, values, kind, scale, legs, label) for every scanned series.
    scale converts a raw change to bp (outright %→bp = ×100; derived already
    in bp)."""
    for t in dataset.tenor_order:
        label = "Call (1D)" if t == "1D" else f"IRS {t}"
        yield t, dataset.series[t], "outright", 100.0, [t], label
    for sid, kind, legs in derived_ids():
        yield sid, series_values(dataset, sid), kind, 1.0, legs, sid.replace("-", "/")


def _series_event(values: list[float | None], scale: float) -> dict | None:
    """Compute the D-1 event signals for one series, or None if it does not
    fire. Returns {pct, deltaBp, reasons:[...]}."""
    idx = [i for i, v in enumerate(values) if v is not None]
    if len(idx) < 2:
        return None
    j, jp = idx[-1], idx[-2]  # today, previous business day (non-null)
    now, prev = values[j], values[jp]

    pct_today = _pct_of(values, j, now)
    pct_prev = _pct_of(values, jp, prev)
    delta_bp = round((now - prev) * scale, 2)

    reasons: list[str] = []
    if _extreme(pct_today) != _extreme(pct_prev):
        reasons.append("transition")

    # own-Δ distribution: consecutive-day changes over the full history
    changes = [
        abs(values[k] - values[k - 1])
        for k in range(1, j + 1)
        if values[k] is not None and values[k - 1] is not None
    ]
    if len(changes) >= MIN_CHANGE_HISTORY:
        thresh = float(np.percentile(changes, OUTLIER_PCT))
        if thresh > 0 and abs(now - prev) >= thresh:
            reasons.append("move")

    if not reasons:
        return None
    return {"pct": pct_today, "deltaBp": delta_bp, "reasons": reasons}


def _collapse(firing: list[dict]) -> list[list[dict]]:
    """Union-find over shared tenor legs → one component per correlated
    cluster."""
    parent = list(range(len(firing)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        parent[find(a)] = find(b)

    owner: dict[str, int] = {}
    for i, e in enumerate(firing):
        for leg in e["legs"]:
            if leg in owner:
                union(i, owner[leg])
            else:
                owner[leg] = i

    comps: dict[int, list[dict]] = {}
    for i, e in enumerate(firing):
        comps.setdefault(find(i), []).append(e)
    return list(comps.values())


def _strength(e: dict) -> tuple:
    # transitions rank above pure moves; then larger |Δ|, then level extremity
    return (
        "transition" in e["reasons"],
        abs(e["deltaBp"]),
        abs((e["pct"] or 50) - 50),
    )


def detect_event_clusters(dataset: Dataset) -> list[dict]:
    """Collapsed change-log clusters, most significant first. Each cluster is
    {leading, related:[...], count} where every entry is individually
    clickable (carries its own anchor)."""
    firing: list[dict] = []
    for sid, values, kind, scale, legs, label in _series_meta(dataset):
        sig = _series_event(values, scale)
        if sig is None:
            continue
        firing.append({
            "id": sid,
            "label": label,
            "kind": kind,
            "unit": "%" if kind == "outright" else "bp",
            "now": None if values[-1] is None else round(
                next(v for v in reversed(values) if v is not None), 4),
            "legs": legs,
            "anchor": "curve",  # Band 3 tiles will own precise anchors later
            **sig,
        })

    clusters: list[dict] = []
    for comp in _collapse(firing):
        comp.sort(key=_strength, reverse=True)
        leading = comp[0]
        related = comp[1:]
        clusters.append({
            "leading": {k: leading[k] for k in
                        ("id", "label", "kind", "unit", "now", "pct",
                         "deltaBp", "reasons", "anchor")},
            "related": [{k: r[k] for k in
                         ("id", "label", "kind", "unit", "now", "pct",
                          "deltaBp", "reasons", "anchor")} for r in related],
            "count": len(related),
        })

    clusters.sort(key=lambda c: _strength(c["leading"]), reverse=True)
    return clusters
