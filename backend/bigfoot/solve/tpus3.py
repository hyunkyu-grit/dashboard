# -*- coding: utf-8 -*-
"""Phase-4.7 tp_us FIR kernel fit (TP_TRUTH_PYFRBUS).

python -m bigfoot.solve.tpus3     (writes output/tpus_fir.json)

Form:  tp_us_t = sum_{k=0}^{K-1} w_k * i_dev_{t-k}   (K = 12 default)
Model US10y = EH(40q mean of i) + tp_us; fitted so it matches pyfrbus rg10
diffs on BOTH fit paths simultaneously. INPUT DESIGN (family-consistent):
every path's i input is the pyfrbus policy triple IMPOSED on the US block
(conditioned_solve continuation) — exactly how the kernel is driven in the
desk conditional-forecast pipeline:
  path 1: oneoff25 (+25bp x 1q)   vs pyfrbus oneoff25 rg10
  path 2: HFL (+100bp x 4q)       vs pyfrbus hfl rg10
An earlier design fed path 1 QPM's own rule-shock i path (internal IRF):
REJECTED — QPM's i flips negative at q3 (endogenous easing) while pyfrbus's
one-off rg10 stays positive, so no joint kernel exists on mixed input
families (path-1-alone requires exploding weights, sum ~16). Recorded in
the json; the residual caveat is that QPM-INTERNAL shocks (IRF-B) drive
the kernel out-of-family.
Ridge L2, lambda by leave-one-path-out CV between the two fit paths.
Unconstrained first; if the kernel has > 2 sign flips, refit NNLS.

Holdout gate (Step 2, fit-forbidden path: +50bp x 2q): mean abs gap
< 15bp AND peak error < 20bp; else retry K = 8, 16 once each.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import nnls

from bigfoot.equations.us import USBlock

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"

TQ = 12                       # target quarters per path
LAM_GRID = np.logspace(-6, 1, 29)


def _diffs(csv: str) -> pd.DataFrame:
    df = pd.read_csv(OUT / csv)
    return df.pivot(index="quarter", columns="variable",
                    values="diff").sort_index()


def _model_paths():
    """(i_path, EH, target_rg10) per path — ALL inputs are imposed pyfrbus
    policy triples with model-consistent continuation (family-consistent)."""
    usb = USBlock()
    out = []
    for csv in ("oneoff25_paths.csv", "hfl_paths.csv", "holdout_paths.csv"):
        piv = _diffs(csv)
        cond = {"us_i": piv["rff"].values, "us_y": piv["xgap2"].values,
                "us_pi": piv["picxfe"].values}
        i = usb.conditioned_solve(cond, T=120)[0]["i"]
        EH = np.array([i[t:t + 40].mean() for t in range(TQ)])
        out.append((i, EH, piv["rg10"].values))
    return tuple(out)


def _conv_matrix(i_path: np.ndarray, K: int) -> np.ndarray:
    A = np.zeros((TQ, K))
    for t in range(TQ):
        for k in range(K):
            if t - k >= 0:
                A[t, k] = i_path[t - k]
    return A


def _ridge(A, y, lam):
    K = A.shape[1]
    return np.linalg.solve(A.T @ A + lam * np.eye(K), A.T @ y)


def fit_kernel(K: int):
    p1, p2, _hold = _model_paths()
    A1, y1 = _conv_matrix(p1[0], K), p1[2] - p1[1]
    A2, y2 = _conv_matrix(p2[0], K), p2[2] - p2[1]

    # leave-one-path-out CV for lambda
    cv = []
    for lam in LAM_GRID:
        w12 = _ridge(A1, y1, lam)
        w21 = _ridge(A2, y2, lam)
        mse = float(np.mean((A2 @ w12 - y2) ** 2)
                    + np.mean((A1 @ w21 - y1) ** 2))
        cv.append((lam, mse))
    lam_star = min(cv, key=lambda t: t[1])[0]

    A = np.vstack([A1, A2])
    y = np.concatenate([y1, y2])
    w = _ridge(A, y, lam_star)
    flips = int(np.sum(np.diff(np.sign(w[np.abs(w) > 1e-10])) != 0))
    form = "ridge-unconstrained"
    if flips > 2:
        A_aug = np.vstack([A, np.sqrt(lam_star) * np.eye(K)])
        y_aug = np.concatenate([y, np.zeros(K)])
        w, _ = nnls(A_aug, y_aug)
        form = "ridge-NNLS (unconstrained kernel had "f"{flips} sign flips)"
    fit = {
        "K": K, "lambda": float(lam_star), "form": form,
        "sign_flips_unconstrained": flips,
        "kernel": [round(float(x), 5) for x in w],
        "kernel_sum": round(float(np.sum(w)), 4),
        "path1_max_abs_err_bp": round(float(
            np.max(np.abs(A1 @ w - y1))) * 100, 1),
        "path2_max_abs_err_bp": round(float(
            np.max(np.abs(A2 @ w - y2))) * 100, 1),
    }
    return w, fit, (p1, p2, _hold)


def holdout_gate(w: np.ndarray, hold, K: int) -> dict:
    i3, EH3, rg3 = hold
    model = EH3 + _conv_matrix(i3, K) @ w
    gap = model - rg3
    peak_err = abs(float(model[np.argmax(np.abs(model))])
                   - float(rg3[np.argmax(np.abs(rg3))]))
    return {
        "mean_abs_gap_bp": round(float(np.mean(np.abs(gap))) * 100, 1),
        "peak_error_bp": round(peak_err * 100, 1),
        "model_us10y_pp": [round(float(x), 4) for x in model],
        "pyfrbus_rg10_pp": [round(float(x), 4) for x in rg3],
        "pass": bool(np.mean(np.abs(gap)) * 100 < 15.0
                     and peak_err * 100 < 20.0),
    }


def main() -> None:
    results = []
    for K in (12, 8, 16):
        w, fit, (_p1, _p2, hold) = fit_kernel(K)
        gate = holdout_gate(w, hold, K)
        results.append({"fit": fit, "holdout_gate": gate})
        print(f"K={K}: kernel_sum={fit['kernel_sum']} "
              f"path errs {fit['path1_max_abs_err_bp']}/"
              f"{fit['path2_max_abs_err_bp']}bp | holdout mean "
              f"{gate['mean_abs_gap_bp']}bp peak err {gate['peak_error_bp']}"
              f"bp -> {'PASS' if gate['pass'] else 'FAIL'}")
        if gate["pass"]:
            break
    chosen = results[-1] if results[-1]["holdout_gate"]["pass"] else None
    out = {
        "module": "tpus_fir", "as_of": date.today().isoformat(),
        "truth_source": "TP_TRUTH_PYFRBUS",
        "attempts": results,
        "chosen": chosen,
        "verdict": "PASS" if chosen else "STOP (all K failed the gate)",
    }
    (OUT / "tpus_fir.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print("verdict:", out["verdict"])
    if chosen:
        print("kernel:", chosen["fit"]["kernel"])


if __name__ == "__main__":
    main()
