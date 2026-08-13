"""Pass A diagnostics for the change-log firing rule. READ-ONLY analysis.

Replicates the production rule (frontend/src/wall/outliers.ts +
backend/app/derive.py) and replays it, plus three candidate rules, over the
last 500 business days. Prints a JSON blob consumed by the report writer.
"""

from __future__ import annotations

import json
from itertools import combinations
from pathlib import Path

import numpy as np

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.dataset import DISPLAY_TENORS, load_dataset  # noqa: E402

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"
OUTLIER_PCT = 95
REPLAY_DAYS = 500

ds = load_dataset(DATA)
dates = ds.dates
n = len(dates)

# ---- Build the full series matrix (outrights + 35 derived), each as a float
# array aligned to `dates`, plus metadata (kind, unit-scale, leg tenors). ----
Series = dict[str, dict]
series: dict[str, dict] = {}

for t in ds.tenor_order:  # outrights (1D, 3M, ... 10Y as present)
    arr = np.array([np.nan if v is None else v for v in ds.series[t]], float)
    series[t] = {
        "kind": "outright",
        "scale": 100.0,  # % level -> bp deltas
        "legs": [t],
        "arr": arr,
    }

def spread_arr(a: str, b: str) -> np.ndarray:
    return (np.array([np.nan if v is None else v for v in ds.series[b]], float)
            - np.array([np.nan if v is None else v for v in ds.series[a]], float)) * 100

def fly_arr(a: str, b: str, c: str) -> np.ndarray:
    A = np.array([np.nan if v is None else v for v in ds.series[a]], float)
    B = np.array([np.nan if v is None else v for v in ds.series[b]], float)
    C = np.array([np.nan if v is None else v for v in ds.series[c]], float)
    return (2 * B - A - C) * 100

for a, b in combinations(DISPLAY_TENORS, 2):
    series[f"{a}-{b}"] = {"kind": "spread", "scale": 1.0, "legs": [a, b],
                          "arr": spread_arr(a, b)}
for a, b, c in combinations(DISPLAY_TENORS, 3):
    series[f"{a}-{b}-{c}"] = {"kind": "fly", "scale": 1.0, "legs": [a, b, c],
                             "arr": fly_arr(a, b, c)}

ids = list(series)


def pct_at(arr: np.ndarray, j: int) -> float | None:
    """Percentile of arr[j] within arr[0..j] (bisect_left / len * 100),
    matching derive.summarize point-in-time."""
    now = arr[j]
    if np.isnan(now):
        return None
    hist = arr[: j + 1]
    hist = hist[~np.isnan(hist)]
    if hist.size == 0:
        return None
    below = int(np.sum(hist < now))
    return round(below / hist.size * 100, 1)


def d1_delta(arr: np.ndarray, j: int, scale: float) -> float | None:
    """Δ vs previous business day (previous index) in bp."""
    if j == 0 or np.isnan(arr[j]) or np.isnan(arr[j - 1]):
        return None
    return (arr[j] - arr[j - 1]) * scale


def band_of(kind: str) -> str:
    # §2: Band 3+ time-series matrix rows = outrights + spreads. Outrights
    # also appear on the Band-1 curve tile.
    return {
        "outright": "Band 3 (series matrix) · also Band 1 curve",
        "spread": "Band 3 (series matrix)",
        "fly": "Band 3 (series matrix)",
    }[kind]


# ============================================================
# STEP 1 — enumerate current firing (last day), basis = d1
# ============================================================
j = n - 1
move_mags = []
for sid in ids:
    d = d1_delta(series[sid]["arr"], j, series[sid]["scale"])
    if d is not None:
        move_mags.append(abs(d))
move_mags.sort()
move_cut = move_mags[int(OUTLIER_PCT / 100 * (len(move_mags) - 1))] if move_mags else float("inf")

current = []
for sid in ids:
    s = series[sid]
    p = pct_at(s["arr"], j)
    d = d1_delta(s["arr"], j, s["scale"])
    reasons = []
    if p is not None and (p >= OUTLIER_PCT or p <= 100 - OUTLIER_PCT):
        reasons.append("percentile")
    if d is not None and abs(d) >= move_cut and move_cut > 0:
        reasons.append("move")
    if reasons:
        current.append({
            "id": sid, "kind": s["kind"], "legs": s["legs"],
            "pct": p, "delta_d1_bp": None if d is None else round(d, 2),
            "reasons": reasons, "band": band_of(s["kind"]),
        })
current.sort(key=lambda e: -(abs((e["pct"] or 50) - 50)))


# ============================================================
# STEP 2 — correlation collapse (union-find over shared tenors)
# ============================================================
def collapse(firing_ids: list[str]) -> list[list[str]]:
    parent = {sid: sid for sid in firing_ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        parent[find(x)] = find(y)

    # link two firing series if they share any tenor leg
    tenor_owner: dict[str, str] = {}
    for sid in firing_ids:
        for leg in series[sid]["legs"]:
            if leg in tenor_owner:
                union(sid, tenor_owner[leg])
            else:
                tenor_owner[leg] = sid
    comps: dict[str, list[str]] = {}
    for sid in firing_ids:
        comps.setdefault(find(sid), []).append(sid)
    return list(comps.values())


current_ids = [e["id"] for e in current]
components = collapse(current_ids)
# Which display tenors are "at extreme level" today (drives the cluster)?
extreme_tenors = [
    t for t in DISPLAY_TENORS
    if (pct_at(series[t]["arr"], j) or 50) >= OUTLIER_PCT
    or (pct_at(series[t]["arr"], j) or 50) <= 100 - OUTLIER_PCT
]


# ============================================================
# STEP 3 & 4 — replay current rule + 3 candidates over 500 days
# ============================================================
start = n - REPLAY_DAYS

def extreme(p):
    return p is not None and (p >= OUTLIER_PCT or p <= 100 - OUTLIER_PCT)

# Precompute per-series own-change |distribution| percentile threshold (b).
def own_change_extreme(arr, j, scale):
    """|Δ today| vs this series' own history of |daily changes| up to day j."""
    if j == 0 or np.isnan(arr[j]) or np.isnan(arr[j - 1]):
        return False, None
    diffs = np.abs(np.diff(arr[: j + 1]))
    diffs = diffs[~np.isnan(diffs)]
    if diffs.size < 20:
        return False, None
    today = abs(arr[j] - arr[j - 1]) * scale
    thresh = np.percentile(diffs, OUTLIER_PCT) * scale
    return (today >= thresh and thresh > 0), today

counts = {"current": [], "a_transition": [], "b_deltapct": [], "c_union_collapsed": []}

for jj in range(start, n):
    # daily move cut for the current rule
    mags = []
    for sid in ids:
        d = d1_delta(series[sid]["arr"], jj, series[sid]["scale"])
        if d is not None:
            mags.append(abs(d))
    mags.sort()
    mcut = mags[int(OUTLIER_PCT / 100 * (len(mags) - 1))] if mags else float("inf")

    fired_current = 0
    fired_a = 0
    fired_b_ids = []
    fired_c_ids = []
    for sid in ids:
        s = series[sid]
        arr, scale = s["arr"], s["scale"]
        p = pct_at(arr, jj)
        p_prev = pct_at(arr, jj - 1) if jj > 0 else None
        d = d1_delta(arr, jj, scale)

        lvl = extreme(p)
        mv = d is not None and abs(d) >= mcut and mcut > 0
        if lvl or mv:
            fired_current += 1

        # (a) transition into/out of extreme band
        if extreme(p) != extreme(p_prev):
            fired_a += 1

        # (b) own-change extreme
        b_fire, _ = own_change_extreme(arr, jj, scale)
        if b_fire:
            fired_b_ids.append(sid)

        # (c) = (a) OR (b) firing set, before collapse
        if (extreme(p) != extreme(p_prev)) or b_fire:
            fired_c_ids.append(sid)

    counts["current"].append(fired_current)
    counts["a_transition"].append(fired_a)
    counts["b_deltapct"].append(len(fired_b_ids))
    counts["c_union_collapsed"].append(len(collapse(fired_c_ids)) if fired_c_ids else 0)


def stats(xs):
    a = np.array(xs)
    return {
        "median": float(np.median(a)),
        "p90": float(np.percentile(a, 90)),
        "max": int(a.max()),
        "zero_days": int(np.sum(a == 0)),
        "mean": round(float(a.mean()), 2),
    }


out = {
    "asof": ds.asof.isoformat(),
    "n_series_scanned": len(ids),
    "replay_days": REPLAY_DAYS,
    "move_cut_bp_today": round(move_cut, 2),
    "current_firing_count": len(current),
    "current_firing": current,
    "current_components": [sorted(c) for c in components],
    "current_component_count": len(components),
    "extreme_display_tenors": extreme_tenors,
    "replay": {k: stats(v) for k, v in counts.items()},
}
print(json.dumps(out, indent=2, ensure_ascii=False))
