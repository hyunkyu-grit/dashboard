"""Session 15 Pass E2 / C2 replay — how often should a cell or a 한 줄 light up?

Reproducible:  cd backend && python scripts/color_density.py
Reads data/irsdata.xlsx through the app modules; changes no runtime code.

Two questions, one script (they are the same question in two channels — "how
often is something worth highlighting"):

  * the five change columns' colour intensity (Pass E2), and
  * the 한 줄 priority ladder (Pass C2).

Forwards are excluded from the 500-day change-column replay: a historical
forward change needs a per-date curve bootstrap per cell (168 x 2608), far too
heavy for a diagnostic. The forward matrix is instead characterised from the
current single-day grid, which directly answers "how many of 168 cells tint
today". Both facts are stated in the report.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402

from app.dataset import load_dataset  # noqa: E402
from app.derive import BASIS_KEYS, basis_dates, derived_ids, series_values  # noqa: E402

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"
WINDOW = 500  # business days replayed

ds = load_dataset(DATA)
n = len(ds.dates)

# ── table series set: outrights + spreads + flies (what the columns colour) ──
series: dict[str, tuple[str, list[float | None]]] = {}
for t in ds.tenor_order:
    series[t] = ("%", series_values(ds, t))
for sid, _kind, _legs in derived_ids():
    series[sid] = ("bp", series_values(ds, sid))
outright_ids = list(ds.tenor_order)


def aligned_daily_bp(unit: str, vals: list[float | None]) -> np.ndarray:
    """Daily change in bp aligned to ds.dates (nan where undefined)."""
    scale = 100.0 if unit == "%" else 1.0
    out = np.full(n, np.nan)
    prev = None
    for i, v in enumerate(vals):
        if v is not None and prev is not None:
            out[i] = (v - prev) * scale
        if v is not None:
            prev = v
    return out


DCH = {sid: aligned_daily_bp(u, v) for sid, (u, v) in series.items()}
LVL = {sid: np.array([np.nan if v is None else float(v) for v in v2])
       for sid, (_u, v2) in ((s, series[s]) for s in series)}


def pct_rank(hist: np.ndarray, x: float) -> float:
    """Percentile of |x| within |hist| (0..100), history up to & incl. today."""
    h = np.abs(hist[~np.isnan(hist)])
    if len(h) < 30:
        return np.nan
    return 100.0 * (h <= abs(x)).mean()


def zscore(hist: np.ndarray, x: float) -> float:
    h = hist[~np.isnan(hist)]
    if len(h) < 30 or h.std() == 0:
        return np.nan
    return (abs(x) - np.abs(h).mean()) / np.abs(h).std()


def level_pct(hist_levels: np.ndarray, x: float) -> float:
    h = hist_levels[~np.isnan(hist_levels)]
    if len(h) < 30:
        return np.nan
    return 100.0 * (h <= x).mean()


def summarize(counts: list[int], label: str) -> str:
    a = np.array(counts, dtype=float)
    quiet = 100.0 * (a == 0).mean()
    return (f"  {label:<28} median {np.median(a):4.1f}  p90 {np.percentile(a,90):4.1f}  "
            f"max {a.max():4.0f}  quiet-days {quiet:4.1f}%")


idx = range(max(65, n - WINDOW), n)
sids = list(series.keys())

print(f"dataset: {n} closes, replaying last {len(list(idx))} business days")
print(f"table series: {len(sids)} (outrights {len(outright_ids)} + derived {len(sids)-len(outright_ids)})")
print()

# ── change-column colour intensity: how many series saturate per day ─────────
print("== D-1 change column: series reaching FULL saturation per day ==")
for thr, lab in [(97, "b) own-hist pct >= 97"), (95, "b) own-hist pct >= 95"),
                 (90, "b) own-hist pct >= 90")]:
    counts = []
    for i in idx:
        c = 0
        for sid in sids:
            x = DCH[sid][i]
            if np.isnan(x):
                continue
            if pct_rank(DCH[sid][: i + 1], x) >= thr:
                c += 1
        counts.append(c)
    print(summarize(counts, lab))
for zt in (3.0, 2.5, 2.0):
    counts = []
    for i in idx:
        c = sum(1 for sid in sids
                if not np.isnan(DCH[sid][i]) and (zscore(DCH[sid][: i + 1], DCH[sid][i]) or 0) >= zt)
        counts.append(c)
    print(summarize(counts, f"a) own-hist z >= {zt}"))
for k in (3, 5):
    counts = []
    for i in idx:
        today = [(sid, abs(DCH[sid][i])) for sid in sids if not np.isnan(DCH[sid][i])]
        today.sort(key=lambda t: t[1], reverse=True)
        counts.append(min(k, len(today)))
    print(summarize(counts, f"c) cross-sectional top-{k}"))
print()

# ── every column's quiet share under candidate (b) pct>=97, incl. YTD ────────
print("== per-column saturation under own-hist pct>=97 (basis change vs its own history) ==")
# basis changes need the historical basis level; approximate each basis change
# as (level_today - level_k_back) with k = {1,5,21,63,126} trading days — a
# faithful stand-in for d1/wtd/mtd/qtd/ytd against a same-length own history.
LOOKBACK = {"d1": 1, "wtd": 5, "mtd": 21, "qtd": 63, "ytd": 126}
for key, k in LOOKBACK.items():
    counts = []
    for i in idx:
        if i - k < 0:
            continue
        c = 0
        for sid in sids:
            u = series[sid][0]
            scale = 100.0 if u == "%" else 1.0
            lv = LVL[sid]
            if np.isnan(lv[i]) or np.isnan(lv[i - k]):
                continue
            ch = (lv[i] - lv[i - k]) * scale
            # own history of same-horizon changes
            hist = (lv[k:] - lv[:-k]) * scale
            if pct_rank(hist[: i - k + 1], ch) >= 97:
                c += 1
        counts.append(c)
    print(summarize(counts, f"{key} (~{k}d)"))
print()

# ── forward matrix: single-day snapshot (current grid) ───────────────────────
from app.curves import build_basis_curves  # noqa: E402
from app.forwards import forwards_payload  # noqa: E402

fp = forwards_payload(ds, build_basis_curves(ds))
cells = [c["deltas"]["d1"] for ten in fp["tenors"] for c in fp["grid"][ten]]
cells = np.abs(np.array(cells))
gmax = cells.max()
print("== forward matrix (168 cells, TODAY) — share above a fraction of grid-max ==")
for frac in (0.03, 0.10, 0.25, 0.50):
    print(f"  |d1| > {frac:.2f}*gridMax ({frac*gmax:.2f}bp): "
          f"{100.0*(cells > frac*gmax).mean():4.1f}% of cells")
print(f"  grid max |d1| = {gmax:.2f}bp, median |d1| = {np.median(cells):.2f}bp")
print()

# The second half of this script swept thresholds for the 한 줄 priority
# ladder (rung 1 move-percentile x rung 2 level-band x rung 3 solo direction,
# scored as "speaking rows per day"). The ladder and its column are gone
# (pass L), so the sweep tuned nothing and would have read as live guidance to
# the next person who ran it. The FINDINGS it produced are still on the record
# in docs/diagnostics/color-density.md — that report is a dated diagnosis and
# stays. The colour-intensity half above is unaffected: the tint density scale
# has other consumers (the 어제 column's outlier rule, the forward matrix wash)
# and is still the thing this script exists to characterise.
