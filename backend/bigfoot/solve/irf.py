# -*- coding: utf-8 -*-
"""Phase-3 IRF machinery: three shocks, beta_sync pinning, scorecard."""
from __future__ import annotations

import numpy as np

from bigfoot.solve.system import BigfootSystem, WIRING_FLAGS

SHOCKS = {"A": {"kr_rule_bp": 25.0}, "B": {"us_rule_bp": 25.0},
          "C": {"oil_pct": 10.0}}

# (irf, metric-name, extractor, band lo, band hi)
SCORECARD = [
    ("A", "gdp_gap_trough_pp", lambda r: r["korea"]["y_gap"].min(), -0.09, -0.05),
    ("A", "cpi_yoy_trough_pp", lambda r: r["korea"]["cpi_yoy"].min(), -0.07, -0.03),
    ("A", "housing_trough_pct", lambda r: r["korea"]["hpi"].min(), -0.5, -0.3),
    ("A", "debt_gdp_change_pp", lambda r: r["korea"]["debt"].min(), -0.4, -0.2),
    ("B", "gdp_gap_trough_pp", lambda r: r["korea"]["y_gap"].min(), -0.06, -0.02),
    ("C", "cpi_yoy_peak_pp", lambda r: r["korea"]["cpi_yoy"].max(), 0.12, 0.20),
    ("C", "gdp_gap_trough_pp", lambda r: r["korea"]["y_gap"].min(), -0.07, -0.03),
    ("C", "consumption_trough_pct", lambda r: r["korea"]["c"].min(), -0.11, -0.05),
]

SHAPE_CHECKS = [
    ("A", "fx_appreciation", lambda r: r["korea"]["s"].min() < -0.01
     and r["korea"]["s"][:4].max() <= 0.02),
    ("B", "fx_depreciation", lambda r: r["korea"]["s"][:6].max() > 0.005),
    ("B", "inflation_up_then_down",
     lambda r: r["korea"]["cpi_yoy"][:6].max() > 0
     and r["korea"]["cpi_yoy"].min() < 0
     and int(r["korea"]["cpi_yoy"][:6].argmax())
     < int(r["korea"]["cpi_yoy"].argmin())),
    ("A", "gdp_hump", lambda r: 1 <= int(r["korea"]["y_gap"].argmin()) <= 20
     and abs(r["korea"]["y_gap"][-1]) < 0.9 * abs(r["korea"]["y_gap"].min())),
    ("C", "gdp_hump", lambda r: 1 <= int(r["korea"]["y_gap"].argmin()) <= 20),
]


def run_all(beta_sync: float, eq24_form: str = "paper",
            options: dict = None) -> dict:
    out = {}
    for name, shock in SHOCKS.items():
        sys_ = BigfootSystem(beta_sync=beta_sync, eq24_form=eq24_form,
                             options=options)
        out[name] = sys_.solve(shock)
    return out


def pin_beta_sync(eq24_form: str = "paper", options: dict = None,
                  target: float = 0.06) -> tuple:
    """Grid-search beta_sync in [0.1, 1.5] to match IRF B's KR10y peak."""
    grid = np.round(np.arange(0.1, 1.5001, 0.05), 3)
    best, best_err, best_peak = None, np.inf, None
    for b in grid:
        sys_ = BigfootSystem(beta_sync=float(b), eq24_form=eq24_form,
                             options=options)
        r = sys_.solve(SHOCKS["B"])
        peak = float(r["korea"]["kr10y"].max())
        err = abs(peak - target)
        if err < best_err:
            best, best_err, best_peak = float(b), err, peak
    return best, best_peak


def scorecard(results: dict) -> list:
    rows = []
    for irf, name, fn, lo, hi in SCORECARD:
        val = float(fn(results[irf]))
        rows.append({"irf": irf, "metric": name, "value": round(val, 4),
                     "band": [lo, hi], "pass": bool(lo <= val <= hi)})
    for irf, name, fn in SHAPE_CHECKS:
        ok = bool(fn(results[irf]))
        rows.append({"irf": irf, "metric": f"shape:{name}", "value": None,
                     "band": None, "pass": ok})
    return rows


def summarize(rows: list) -> str:
    lines = []
    for r in rows:
        band = (f"[{r['band'][0]:+.2f},{r['band'][1]:+.2f}]" if r["band"]
                else "        ")
        val = f"{r['value']:+.4f}" if r["value"] is not None else "  --  "
        lines.append(f"  {'PASS' if r['pass'] else 'MISS'}  {r['irf']}  "
                     f"{r['metric']:28s} {val}  {band}")
    n = sum(r["pass"] for r in rows)
    lines.append(f"  => {n}/{len(rows)} pass")
    return "\n".join(lines)
