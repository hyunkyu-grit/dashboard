# -*- coding: utf-8 -*-
"""Phase-4.5 tp_us calibration — reproducible derivation of us.TP_RHO/TP_THETA.

python -m bigfoot.solve.tpus

Target: US 10y (EH 40q mean + tp) peak response to the block's own +25bp
rule shock = 0.106pp = 42.5bp/100bp / 4 (SOURCE_PYFRBUS_PASSTHROUGH,
output/hfl_summary.json), peak within q1-q4. Grid rho_tp in [0.5, 0.95];
theta solves the peak match per rho (brentq — the 10y peak is monotone in
theta); tie-break = half-life closest to pyfrbus's rg10 (hfl_paths.csv).
Writes output/tpus_calibration.json.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import brentq

from bigfoot.equations import us

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"

TARGET_PEAK = 0.106          # pp per 25bp (= 42.5bp/100bp / 4)
PEAK_WINDOW = 4              # peak must land in q1-q4


def half_life_after_peak(path: np.ndarray) -> float:
    pk = int(np.argmax(path))
    post = path[pk:]
    below = np.where(post <= path[pk] / 2.0)[0]
    if not len(below):
        return float("inf")
    j = int(below[0])
    frac = (post[j - 1] - path[pk] / 2.0) / (post[j - 1] - post[j])
    return j - 1 + float(frac)


def pyfrbus_half_life() -> float:
    df = pd.read_csv(OUT / "hfl_paths.csv")
    rg = df[df["variable"] == "rg10"]["diff"].values
    return half_life_after_peak(rg)


def calibrate() -> dict:
    usb = us.USBlock()
    i = usb.simulate_shock(25.0, T=120)["i"]
    EH = np.array([i[t:t + 40].mean() for t in range(60)])
    hl_py = pyfrbus_half_life()

    def filt(rho):
        f = np.zeros(60)
        for t in range(60):
            f[t] = rho * (f[t - 1] if t > 0 else 0.0) + i[t]
        return f

    rows = []
    for rho in np.round(np.arange(0.50, 0.9501, 0.05), 3):
        f = filt(rho)
        theta = brentq(lambda th: np.max(EH + th * f) - TARGET_PEAK, 0.0, 5.0)
        p = EH + theta * f
        pk = int(np.argmax(p))
        rows.append({"rho": float(rho), "theta": round(float(theta), 4),
                     "peak_q": pk + 1, "peak_pp": round(float(p[pk]), 4),
                     "half_life_q": round(half_life_after_peak(p), 2)})
    ok = [r for r in rows if r["peak_q"] <= PEAK_WINDOW]
    best = min(ok, key=lambda r: abs(r["half_life_q"] - hl_py))
    return {
        "module": "tpus_calibration", "as_of": date.today().isoformat(),
        "target_peak_pp_per_25bp": TARGET_PEAK,
        "source": "SOURCE_PYFRBUS_PASSTHROUGH (hfl_summary.json 42.5bp/100bp)",
        "pyfrbus_half_life_q": round(hl_py, 2),
        "half_life_note": ("pyfrbus half-life measured on the 4q-sustained "
                           "HFL rg10 path (only decay info available) — "
                           "conflates shock persistence with the 10y "
                           "process; model half-life capped ~1.9q by the "
                           "QPM rule's endogenous easing"),
        "grid": rows, "chosen": best,
        "pinned_in_code": {"TP_RHO": us.TP_RHO, "TP_THETA": us.TP_THETA},
    }


def main() -> None:
    out = calibrate()
    (OUT / "tpus_calibration.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: out[k] for k in
                      ("pyfrbus_half_life_q", "chosen", "pinned_in_code")},
                     indent=2))
    ch = out["chosen"]
    ok = (abs(ch["rho"] - us.TP_RHO) < 1e-9
          and abs(ch["theta"] - us.TP_THETA) < 5e-4)
    print("pinned constants match derivation:", ok)
    if not ok:
        raise SystemExit("us.TP_RHO/TP_THETA do not match the derivation")


if __name__ == "__main__":
    main()
