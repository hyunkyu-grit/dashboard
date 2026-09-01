"""T3 — warm-up guard audit, and T4 — spread-volatility convention.

Both are audits of the CODE AS IT IS, measured on real series. Neither fixes
anything: T3's gaps are encoded as xfail tests
(`research/tests/test_warmup_guards.py`), and T4 reports what convention is in
use rather than changing it.

## T3, the idea being applied

gs-quant's `zscores(x, Window(w, r))` lets the caller say "emit nothing until
`w` observations exist", and that guard is OFF by default (`Window(None, 0)`).
The transferable lesson is not the API but the question: for every rolling
statistic, what is the minimum number of observations below which the output
is noise wearing a number's clothes?

Writes `docs/q1/warmup_audit.csv` and `docs/q1/spread_vol_convention.csv`.
"""

from __future__ import annotations

import csv
import statistics as st
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))

# ── T3: the audit table, from reading every site (D0.3g) ────────────────────
# `floor` is the minimum observation count at which the site will emit a
# number. `guarded` means that floor is tied to the window the caller asked
# for, rather than to a constant that happens to be small.
AUDIT = [
    {
        "site": "app/mrbacktest.py:64 rolling_series",
        "statistic": "SMA / population sigma / z",
        "floor": "lookback",
        "guarded": True,
        "note": "emits None until index lookback-1; floor IS the window",
    },
    {
        "site": "app/mrregime.py:43 realized_vol",
        "statistic": "realised vol of diffs",
        "floor": "win",
        "guarded": True,
        "note": "requires len(w) == win exactly",
    },
    {
        "site": "app/mrregime.py:59 vol_percentile",
        "statistic": "expanding percentile",
        "floor": "1 prior obs",
        "guarded": True,
        "note": "past-only, None while empty",
    },
    {
        "site": "app/derive.py:57 (moving average)",
        "statistic": "moving average",
        "floor": "window",
        "guarded": True,
        "note": "documents 'window not full -> None, not 0'",
    },
    {
        "site": "app/rv.py:578 vol_3m",
        "statistic": "3M realised spread vol",
        "floor": "26 changes",
        "guarded": True,
        "note": "explicit: 'sigma invented from thin data is noise'",
    },
    {
        "site": "app/volatility.py relative ATR",
        "statistic": "short/long vol ratio",
        "floor": "60 obs",
        "guarded": True,
        "note": "null until the full long window exists",
    },
    {
        "site": "app/rv.py:735 z_score",
        "statistic": "z-score",
        "floor": "2",
        "guarded": False,
        "note": "ONLY n<2 is rejected; window_vals() drops Nones AFTER slicing, "
                "so a '52-week' window can carry 2 points and still emit a z",
    },
]

Z_CALL_SITES = [
    "app/rv.py:956  z52  — z over the last 252 rows",
    "app/rv.py:957  zAll — z over the whole series",
    "app/rv.py:1173 z1   — relative-axis level z",
    "app/rv.py:1180 z2   — cross-sector relative z",
    "app/rv.py:1184 z3   — curve-relative z",
]


def z_score_ref(series, now):
    """The exact body of `app/rv.py:735`, reproduced so the demonstration does
    not depend on importing the RV payload machinery."""
    n = len(series)
    if n < 2:
        return None
    mean = sum(series) / n
    var = sum((v - mean) ** 2 for v in series) / (n - 1)
    sd = var ** 0.5
    return (now - mean) / sd if sd > 0 else None


def demo_thin_z():
    """What the ungoverned floor produces. Two observations, and the z-score is
    forced to ±1/sqrt(2) = ±0.707 no matter what the numbers are — it carries
    no information about the level at all, only about which of the two is
    larger."""
    out = []
    for pair in ([100.0, 101.0], [100.0, 180.0], [3.0, 3.0001]):
        z = z_score_ref(pair, pair[-1])
        out.append({"observations": len(pair), "values": str(pair), "z": z})
    # and the same series once it is actually populated
    real = [100.0 + i * 0.1 for i in range(60)]
    out.append({"observations": len(real), "values": "60-point ramp",
                "z": z_score_ref(real, real[-1])})
    return out


# ── T4: which convention does the codebase use for spread vol? ─────────────


def spread_vol_conventions(seq):
    """Both estimators on the same real spread series.

    A basis-point spread has no meaningful origin — it can sit at zero or go
    negative — so a percentage return is undefined or explosive there. The
    difference-based estimator is the correct one, and the point of computing
    both is to say by how much the wrong one would differ, in numbers.
    """
    vals = [v for v in seq if v is not None]
    diffs = [vals[i] - vals[i - 1] for i in range(1, len(vals))]
    rets = []
    blowups = 0
    for i in range(1, len(vals)):
        prev = vals[i - 1]
        if abs(prev) < 1e-9:
            blowups += 1
            continue
        rets.append((vals[i] - prev) / prev)
    return {
        "n": len(vals),
        "level_min": min(vals),
        "level_max": max(vals),
        "crosses_zero": min(vals) < 0 < max(vals),
        "near_zero_denominators": blowups,
        "sd_of_diffs_bp": st.pstdev(diffs) if len(diffs) > 1 else None,
        "sd_of_returns_pct": st.pstdev(rets) * 100 if len(rets) > 1 else None,
        "ratio_returns_to_diffs": (
            (st.pstdev(rets) * 100) / st.pstdev(diffs)
            if len(rets) > 1 and len(diffs) > 1 and st.pstdev(diffs) > 0 else None
        ),
    }


def main() -> None:
    outdir = REPO / "docs" / "q1"
    outdir.mkdir(parents=True, exist_ok=True)

    # ---- T3 ----
    print("── T3: warm-up guard audit ──")
    guarded = [a for a in AUDIT if a["guarded"]]
    gaps = [a for a in AUDIT if not a["guarded"]]
    print(f"  rolling-statistic sites audited : {len(AUDIT)}")
    print(f"  guarded                          : {len(guarded)}")
    print(f"  UNGUARDED                        : {len(gaps)}")
    for a in AUDIT:
        mark = "ok " if a["guarded"] else "GAP"
        print(f"    [{mark}] {a['site']:38s} floor={a['floor']:>10s}  {a['note'][:60]}")
    print("\n  call sites of the unguarded one:")
    for s in Z_CALL_SITES:
        print(f"    {s}")

    with (outdir / "warmup_audit.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(AUDIT[0]))
        w.writeheader()
        w.writerows(AUDIT)

    print("\n  what the missing floor produces:")
    for r in demo_thin_z():
        print(f"    n={r['observations']:>3d}  {r['values']:<20s} z={r['z']}")
    print("    -> with n=2 the z-score is +/-0.7071 for ANY two distinct values.")
    print("       It is a sign, printed as though it were a magnitude.")

    # ---- T4 ----
    print("\n── T4: spread-volatility convention ──")
    from app import creditmatrix as cm
    from app.dataset import load_dataset_merged

    ds = load_dataset_merged()
    rows = []
    # real KRW spread series: bond-swap spread proxy per tenor, in bp
    m = cm.load()
    for label in ("3Y", "5Y", "10Y"):
        if not m.has("KTB", label):
            continue
        yrs = cm.TENOR_YEARS[label]
        seq = []
        for i in range(len(m.dates)):
            try:
                seq.append(cm.yield_at(m, "KTB", i, yrs) * 1e4)  # bp
            except Exception:  # noqa: BLE001
                seq.append(None)
        # spread against its own 60-day mean -> a genuine zero-crossing series
        vals = [v for v in seq if v is not None]
        spread = [vals[i] - sum(vals[i - 60:i]) / 60 for i in range(60, len(vals))]
        stats = spread_vol_conventions(spread)
        stats["series"] = f"KTB {label} minus its 60d mean (bp)"
        rows.append(stats)
        print(f"  {stats['series']}")
        print(f"    n={stats['n']}  range [{stats['level_min']:.1f}, {stats['level_max']:.1f}] bp"
              f"  crosses zero: {stats['crosses_zero']}")
        print(f"    sd of DIFFERENCES : {stats['sd_of_diffs_bp']:.4f} bp   <- the convention in use")
        print(f"    sd of RETURNS     : {stats['sd_of_returns_pct']:.1f} %  "
              f"(ratio {stats['ratio_returns_to_diffs']:.1f}x, "
              f"{stats['near_zero_denominators']} near-zero denominators)")

    with (outdir / "spread_vol_convention.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    print("\n  VERDICT: the codebase already differences the spread everywhere it")
    print("  measures spread vol — app/rv.py:578 vol_3m (seq[i]-seq[i-63]),")
    print("  app/mrregime.py:43 realized_vol (vals[i]-vals[i-1]), and")
    print("  app/volatility.py (mean absolute change). No defect to report; the")
    print("  numbers above are what the wrong convention WOULD have produced.")
    _ = ds


if __name__ == "__main__":
    main()
