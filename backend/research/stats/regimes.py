"""T2 — regime detection, three methods side by side. NOT a winner.

Runs in the isolated `.venv-q1` (ruptures, hmmlearn, statsmodels), reading the
real series exported by `export_series.py`. Nothing is installed into the
application venv.

    python research/stats/regimes.py            # from backend/, on .venv-q1

The deliverable the plan asks for is agreement/disagreement and hyperparameter
sensitivity, not a labelled series from whichever method looked best. So:

  * all three label the SAME series over the SAME window;
  * each is swept across its own governing hyperparameter;
  * agreement is measured pairwise, on a common binary encoding
    (high-vol vs low-vol), because the three methods do not share a label
    vocabulary — ruptures returns segment boundaries, MarkovRegression and
    hmmlearn return state indices whose numbering is arbitrary.

Label-switching is handled by ordering states by fitted volatility, so "state
1" means "the calmer one" in every method rather than "whichever the optimiser
happened to number first".

Writes `docs/q1/regime_comparison.csv` and `docs/q1/regime_sensitivity.csv`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[3]
SERIES = REPO / "docs" / "q1" / "_series_ktb.csv"
COL = "KTB_10Y_bp"


def load() -> pd.Series:
    if not SERIES.exists():
        raise SystemExit(
            f"{SERIES} missing — run `python research/stats/export_series.py` "
            f"on the application interpreter first."
        )
    df = pd.read_csv(SERIES, index_col=0, parse_dates=True)
    return df[COL].diff().dropna()  # daily changes in bp (T4 convention)


# ── method 1: change points on the variance ─────────────────────────────────


def ruptures_segments(x: np.ndarray, penalty: float) -> int:
    """How many change points PELT actually finds. Reported separately because
    'no high-vol days' and 'no breakpoints at all' are different statements and
    the collapsed label cannot tell them apart."""
    import ruptures as rpt

    algo = rpt.Pelt(model="rbf", min_size=20).fit(x.reshape(-1, 1))
    return len(algo.predict(pen=penalty)) - 1


def ruptures_labels(x: np.ndarray, penalty: float) -> np.ndarray:
    import ruptures as rpt

    algo = rpt.Pelt(model="rbf", min_size=20).fit(x.reshape(-1, 1))
    bkps = algo.predict(pen=penalty)
    seg = np.zeros(len(x), dtype=int)
    start = 0
    for k, b in enumerate(bkps):
        seg[start:b] = k
        start = b
    # collapse segments to high/low vol by their own sd, split at the median
    sds = {k: x[seg == k].std() for k in np.unique(seg)}
    cut = np.median(list(sds.values()))
    return np.array([1 if sds[s] > cut else 0 for s in seg])


# ── method 2: Markov switching ──────────────────────────────────────────────


def markov_labels(x: np.ndarray, k_regimes: int = 2) -> np.ndarray:
    from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression

    mod = MarkovRegression(x, k_regimes=k_regimes, trend="c", switching_variance=True)
    res = mod.fit(disp=False)
    probs = res.smoothed_marginal_probabilities
    probs = np.asarray(probs)
    if probs.ndim == 1:
        probs = probs.reshape(-1, 1)
    raw = probs.argmax(axis=1)
    order = np.argsort([x[raw == s].std() if (raw == s).any() else 0
                        for s in range(k_regimes)])
    rank = {s: i for i, s in enumerate(order)}
    return np.array([1 if rank[s] == k_regimes - 1 else 0 for s in raw])


# ── method 3: HMM ───────────────────────────────────────────────────────────


def hmm_labels(x: np.ndarray, n_states: int = 2, seed: int = 0) -> np.ndarray:
    from hmmlearn.hmm import GaussianHMM

    mod = GaussianHMM(n_components=n_states, covariance_type="diag",
                      n_iter=200, random_state=seed)
    mod.fit(x.reshape(-1, 1))
    raw = mod.predict(x.reshape(-1, 1))
    order = np.argsort([x[raw == s].std() if (raw == s).any() else 0
                        for s in range(n_states)])
    rank = {s: i for i, s in enumerate(order)}
    return np.array([1 if rank[s] == n_states - 1 else 0 for s in raw])


def agreement(a: np.ndarray, b: np.ndarray) -> float:
    return float((a == b).mean())


def main() -> None:
    y = load()
    x = y.to_numpy(dtype=float)
    print(f"series: {COL} daily changes, n={len(x)}, "
          f"{y.index[0].date()} .. {y.index[-1].date()}")

    lab = {
        "ruptures(pen=20)": ruptures_labels(x, 20.0),
        "MarkovRegression(k=2)": markov_labels(x, 2),
        "hmmlearn(states=2)": hmm_labels(x, 2, seed=0),
    }

    print("\n── where they agree ──")
    names = list(lab)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            print(f"  {names[i]:24s} vs {names[j]:24s} : "
                  f"{agreement(lab[names[i]], lab[names[j]]) * 100:5.1f}% of days")
    unanimous = np.ones(len(x), dtype=bool)
    for v in lab.values():
        unanimous &= (v == lab[names[0]])
    print(f"  all three identical on {unanimous.mean() * 100:.1f}% of days")

    print("\n── what each calls 'high vol' ──")
    for n, v in lab.items():
        share = v.mean()
        sd_hi = x[v == 1].std() if (v == 1).any() else float("nan")
        sd_lo = x[v == 0].std() if (v == 0).any() else float("nan")
        flips = int((np.diff(v) != 0).sum())
        print(f"  {n:24s} high-vol {share * 100:5.1f}% of days, "
              f"sd hi/lo = {sd_hi:.2f}/{sd_lo:.2f} bp, {flips} switches")

    out = pd.DataFrame(lab, index=y.index)
    out.insert(0, "change_bp", y.values)
    out.to_csv(REPO / "docs" / "q1" / "regime_comparison.csv", encoding="utf-8")

    # ── sensitivity: each method against its OWN governing knob ─────────────
    print("\n── hyperparameter sensitivity (share of days called high-vol) ──")
    rows = []
    for pen in (5.0, 10.0, 20.0, 50.0, 100.0):
        v = ruptures_labels(x, pen)
        rows.append({"method": "ruptures", "param": f"pen={pen:g}",
                     "breakpoints": ruptures_segments(x, pen),
                     "high_vol_share": v.mean(),
                     "switches": int((np.diff(v) != 0).sum()),
                     "agree_with_base": agreement(v, lab["ruptures(pen=20)"])})
    for k in (2, 3):
        v = markov_labels(x, k)
        rows.append({"method": "MarkovRegression", "param": f"k={k}",
                     "breakpoints": None,
                     "high_vol_share": v.mean(),
                     "switches": int((np.diff(v) != 0).sum()),
                     "agree_with_base": agreement(v, lab["MarkovRegression(k=2)"])})
    for seed in (0, 1, 2, 3, 4):
        v = hmm_labels(x, 2, seed=seed)
        rows.append({"method": "hmmlearn", "param": f"seed={seed}",
                     "breakpoints": None,
                     "high_vol_share": v.mean(),
                     "switches": int((np.diff(v) != 0).sum()),
                     "agree_with_base": agreement(v, lab["hmmlearn(states=2)"])})
    for st in (2, 3, 4):
        v = hmm_labels(x, st, seed=0)
        rows.append({"method": "hmmlearn", "param": f"states={st}",
                     "breakpoints": None,
                     "high_vol_share": v.mean(),
                     "switches": int((np.diff(v) != 0).sum()),
                     "agree_with_base": agreement(v, lab["hmmlearn(states=2)"])})

    sens = pd.DataFrame(rows)
    for _, r in sens.iterrows():
        bk = "" if pd.isna(r["breakpoints"]) else f"bkps {int(r['breakpoints']):3d}  "
        print(f"  {r['method']:18s} {r['param']:11s} {bk:>10s}high-vol {r['high_vol_share'] * 100:5.1f}%  "
              f"switches {r['switches']:4d}  agrees {r['agree_with_base'] * 100:5.1f}%")
    sens.to_csv(REPO / "docs" / "q1" / "regime_sensitivity.csv", index=False, encoding="utf-8")

    print("\n  Reported as a comparison, not a recommendation. The seed rows are")
    print("  the ones to read first: if hmmlearn moves across seeds on identical")
    print("  data, a single labelled series from it is not a result.")


if __name__ == "__main__":
    main()
