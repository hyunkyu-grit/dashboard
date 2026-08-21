# -*- coding: utf-8 -*-
"""Phase-4.6 two-moment tp_us feasibility analysis — VERDICT: both sanctioned
forms are infeasible; STOP per the phase rule (no further forms).

python -m bigfoot.solve.tpus2   (writes output/tpus_two_moment.json)

Moments (exactly identified, 2 params):
  M1 = 0.106pp  US10y peak on the block's own one-off +25bp rule shock
  M2 = 0.425pp  US10y peak under the sustained HFL policy path (rff diff
                imposed with the full HFL triple, as in the Phase-4 pipeline)

Form 1  tp_t = rho tp_{t-1} + theta i_t (AR(1) on the policy LEVEL, v1.1):
  REJECTED. The QPM block attenuates its OWN one-off shock (policy peak
  0.1925pp per 25bp — the rule's forward-looking terms offset instantly)
  but an IMPOSED sustained path keeps its full 1.0pp peak. Input-peak
  ratio 5.19 vs the required output ratio 4.01, and accumulation (rho>0)
  only widens it — the rho->0 memoryless bound already leaves M2 +21bp
  over target; the best grid point (rho=0.30 floor) is +41bp over.
  No (rho in [0.3,0.98], theta>0) comes within +/-1.5bp of both.

Form 2  tp_t = rho tp_{t-1} + theta EH10_t (FORM_TP_EH, premium rides the
  expected-rates move):
  REJECTED — wrong-signed regressor, not a tuning failure. The 40q EH mean
  is NEGATIVE throughout q1-q8 under BOTH shocks (max -0.011 / -0.0046):
  the rule's endogenous easing undershoot dominates every 40-quarter
  window, so the "expected-rates move" FALLS under a tightening and no
  theta>0 can lift the 10y in any economically relevant window (the only
  formal solutions put the peak 6-9 years out, riding tail artifacts).

Root cause (one sentence): the QPM policy block's strong endogenous mean
reversion makes both internal drivers unusable — the level path
over-accumulates across persistence regimes and the EH path has the wrong
sign. Matching pyfrbus needs an owner decision: calibrate tp on the
pyfrbus rg10 shape directly (import the path, not a 2-parameter filter of
QPM states), or change the US block's rule persistence.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import brentq

from bigfoot.equations.us import USBlock

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"

M1, M2 = 0.106, 0.425
TOL_PP = 0.015                # +/-1.5bp feasibility tolerance
RHO_GRID = np.round(np.arange(0.30, 0.9801, 0.02), 3)
H = 60


def _paths():
    usb = USBlock()
    i1 = usb.simulate_shock(25.0, T=120)["i"]
    df = pd.read_csv(OUT / "hfl_paths.csv")
    piv = df.pivot(index="quarter", columns="variable", values="diff").sort_index()
    cond = {"us_i": piv["rff"].values, "us_y": piv["xgap2"].values,
            "us_pi": piv["picxfe"].values}
    i2 = usb.conditioned_solve(cond, T=120)[0]["i"]
    eh = lambda i: np.array([i[t:t + 40].mean() for t in range(H)])
    return i1, i2, eh(i1), eh(i2)


def _filt(rho, x):
    f = np.zeros(H)
    for t in range(H):
        f[t] = rho * (f[t - 1] if t > 0 else 0.0) + x[t]
    return f


def analyze() -> dict:
    i1, i2, EH1, EH2 = _paths()

    # ---- form 1: driver = policy level
    rows1, best1 = [], None
    for rho in RHO_GRID:
        th = brentq(lambda t: np.max(EH1 + t * _filt(rho, i1)) - M1, 0.0, 50.0)
        resid2 = float(np.max(EH2 + th * _filt(rho, i2)) - M2)
        rows1.append({"rho": float(rho), "theta": round(float(th), 4),
                      "m2_resid_pp": round(resid2, 4)})
        if best1 is None or abs(resid2) < abs(best1["m2_resid_pp"]):
            best1 = rows1[-1]
    th0 = (M1 - float(EH1[int(np.argmax(i1[:8]))])) / float(i1.max())
    memoryless_m2 = float(th0 * i2.max() + EH2[int(np.argmax(i2[:8]))])

    # ---- form 2: driver = EH 10y move (theta > 0)
    f_eh1_window = {str(r): round(float(_filt(r, EH1)[:8].max()), 4)
                    for r in (0.3, 0.65, 0.9)}

    out = {
        "module": "tpus_two_moment", "as_of": date.today().isoformat(),
        "moments": {"M1_oneoff_25bp_pp": M1, "M2_sustained_hfl_pp": M2,
                    "tolerance_pp": TOL_PP},
        "inputs": {
            "i1_peak_pp": round(float(i1.max()), 4),
            "i2_peak_pp": round(float(i2.max()), 4),
            "input_peak_ratio": round(float(i2.max() / i1.max()), 2),
            "required_output_ratio": round(M2 / M1, 2),
            "eh1_q1_q8_max": round(float(EH1[:8].max()), 4),
            "eh2_q1_q8_max": round(float(EH2[:8].max()), 4),
        },
        "form1_level": {
            "verdict": "REJECTED",
            "best_grid_point": best1,
            "memoryless_bound_m2_pp": round(memoryless_m2, 4),
            "grid": rows1,
            "reason": ("QPM attenuates its own one-off shock (0.1925/25bp) "
                       "but not an imposed sustained path (1.0/100bp): "
                       "input ratio 5.19 vs required 4.01; accumulation "
                       "only widens it"),
        },
        "form2_eh": {
            "verdict": "REJECTED",
            "filtered_eh1_q1_q8_max_by_rho": f_eh1_window,
            "reason": ("40q EH mean is negative through q1-q8 under both "
                       "shocks (endogenous easing undershoot dominates the "
                       "window); no theta>0 lifts the 10y in any "
                       "economically relevant window"),
        },
        "phase_rule": "STOP — no further forms; owner decision required",
        "options_for_owner": [
            "calibrate tp_us directly on the pyfrbus rg10 IRF shape "
            "(import the path; give up the 2-parameter QPM-state filter)",
            "revisit the US block's rule persistence (G1/undershoot) so "
            "internal drivers carry the right sign/scale",
        ],
    }
    return out


def main() -> None:
    out = analyze()
    (OUT / "tpus_two_moment.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: out[k] for k in ("inputs", "phase_rule")}, indent=2))
    print("form1 best:", out["form1_level"]["best_grid_point"],
          "| memoryless bound:", out["form1_level"]["memoryless_bound_m2_pp"])
    print("form2 filtered-EH window max:",
          out["form2_eh"]["filtered_eh1_q1_q8_max_by_rho"])
    f1 = abs(out["form1_level"]["best_grid_point"]["m2_resid_pp"]) > TOL_PP
    f2 = out["inputs"]["eh1_q1_q8_max"] < 0
    print("infeasibility verdicts hold:", f1 and f2)
    if not (f1 and f2):
        raise SystemExit("feasibility changed — re-run Phase 4.6 decision")


if __name__ == "__main__":
    main()
