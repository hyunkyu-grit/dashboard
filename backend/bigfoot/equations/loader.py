# -*- coding: utf-8 -*-
"""Appendix D loader + slot->symbol resolution registry.

Phase 2.1: full symbol mapping from the owner's PDF reading (all 17 tables
photographed, 2026-08-05). Values unchanged; names/groupings only.

Remaining PROVISIONAL items (never guessed silently):
  P1  T1 c^j/τ_Y^j split between eq (4)'s own-lag and output-gap loading:
      chosen c^j = own-lag (0.02), τ_Y^j = output-gap loading (0.05) on
      symbol-notation grounds (τ indexed by Y = loading on Y; c = generic
      own/constant term). Owner instruction: this pair stays PROVISIONAL.
  P2  T8 eq (23) printed term order not in my source: φ₁→lagged core,
      φ₂→attractor π∞, φ₃→output gap per owner fallback instruction —
      flag PROVISIONAL_PHILLIPS.
  P3  T11/T12 α_px,1/2 and α_pm,1/2: symbols fixed, but WHICH term each
      multiplies follows eq (30)/(32) printed order not transcribed —
      candidates recorded.
  P4  Functional forms constructed here (eq 24 adaptive expectation, loan
      funding mix, UIP rp equation) are register items, not table facts.

Every slot of config/appendix_d.yaml appears in RESOLUTION exactly once;
tests/test_equations.py::test_yaml_integrity enforces the bijection.
"""
from __future__ import annotations

from pathlib import Path

import yaml

from bigfoot.equations.base import (
    EXOG_V1,
    PROVISIONAL,
    RESOLVED,
    UNRESOLVED,
    Coefficient,
)

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config"

_OWNER = "owner PDF reading 2026-08-05"


def load_appendix_d() -> dict:
    with open(CONFIG / "appendix_d.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _e(symbol, status, basis, candidates=None):
    return {"symbol": symbol, "status": status, "basis": basis,
            "candidates": candidates or []}


_FOREIGN_SLOTS = [
    _e("c_j", PROVISIONAL,
       f"{_OWNER}: c/τ_Y pair belongs to eq (4) import-gap equation; "
       "assigned c_j = own-lag on symbol-notation grounds (P1) — owner: "
       "pair stays PROVISIONAL",
       ["eq (4) own-lag", "eq (4) output-gap loading"]),
    _e("tau_Y", PROVISIONAL,
       f"{_OWNER}: assigned τ_Y = eq (4) output-gap loading (τ indexed by "
       "Y); pair stays PROVISIONAL (P1)",
       ["eq (4) output-gap loading", "eq (4) own-lag"]),
    _e("rho_Y", RESOLVED, f"{_OWNER}: eq (5) own-lag"),
    _e("beta_Y", RESOLVED, f"{_OWNER}: eq (5) spillover loading"),
    _e("gamma_Y", RESOLVED, f"{_OWNER}: eq (5) oil-gap coefficient"),
]

RESOLUTION = {
    "foreign.china.slots": _FOREIGN_SLOTS,
    "foreign.japan.slots": _FOREIGN_SLOTS,
    "foreign.eu.slots": _FOREIGN_SLOTS,
    "foreign.ea.slots": _FOREIGN_SLOTS,

    "consumption.target.slots": [
        _e("beta_c0", RESOLVED, f"{_OWNER}: const"),
        _e("beta_c1", RESOLVED, f"{_OWNER}: debt"),
        _e("beta_c2", RESOLVED, f"{_OWNER}: GFC dummy"),
        _e("beta_c3", RESOLVED, f"{_OWNER}: Covid dummy"),
    ],
    "consumption.growth.slots": [
        _e("alpha_C0", RESOLVED, f"{_OWNER}: EC loading (eq 8)"),
        _e("alpha_C1", RESOLVED, f"{_OWNER}: AR"),
        _e("gamma_C1", RESOLVED, f"{_OWNER}: output gap"),
        _e("gamma_C2", RESOLVED, f"{_OWNER}: household rate"),
        _e("gamma_C3", RESOLVED, f"{_OWNER}: debt growth"),
        _e("gamma_C4", RESOLVED, f"{_OWNER}: purchasing power"),
    ],

    "investment_fi.target.slots": [
        _e("beta_I0", RESOLVED, f"{_OWNER}: const"),
        _e("beta_I1", RESOLVED, f"{_OWNER}: potential"),
        _e("beta_I2", RESOLVED, f"{_OWNER}: Covid dummy"),
    ],
    "investment_fi.growth.slots": [
        _e("alpha_I0", RESOLVED, f"{_OWNER}: EC loading"),
        _e("alpha_I1", RESOLVED, f"{_OWNER}: AR"),
        _e("gamma_I1", RESOLVED, f"{_OWNER}: output gap"),
        _e("gamma_I2", RESOLVED, f"{_OWNER}: deflator"),
        _e("gamma_I3", RESOLVED,
           f"{_OWNER}: semiconductor — SIGN_NOTE: negative as printed, kept"),
    ],

    "construction.target.slots": [
        _e(f"beta_IH{i}", EXOG_V1,
           f"{_OWNER}: symbols read (const/potential-analog/dummy); "
           "construction held at trend in Phase 2") for i in range(3)
    ],
    "construction.growth.slots": [
        _e(s, EXOG_V1, f"{_OWNER}: symbols read; held at trend in Phase 2")
        for s in ["alpha_IH0_ec", "alpha_IH1_ar", "gamma_IH1_gap",
                  "gamma_IH2_deflator", "gamma_IH3_housing", "gamma_IH4_bci"]
    ],
    "government.target.slots": [
        _e(s, EXOG_V1, f"{_OWNER}: symbols read; held at trend in Phase 2")
        for s in ["beta_G0_const", "beta_G1_potential", "beta_G2_elderly"]
    ],
    "government.growth.slots": [
        _e(s, EXOG_V1, f"{_OWNER}: symbols read; held at trend in Phase 2")
        for s in ["c_G", "alpha_G0_ec", "alpha_G1_gap"]
    ],

    "export.target.slots": [
        _e("beta_X0", RESOLVED, f"{_OWNER}: const"),
        _e("beta_X1", RESOLVED, f"{_OWNER}: world demand"),
    ],
    "export.growth.slots": [
        _e("c_X", RESOLVED, f"{_OWNER}: const"),
        _e("alpha_X0", RESOLVED, f"{_OWNER}: EC loading"),
        _e("alpha_X1", RESOLVED, f"{_OWNER}: demand growth"),
        _e("alpha_X2", RESOLVED, f"{_OWNER}: exchange rate"),
    ],
    "export.demand_weights.slots": [
        _e(s, RESOLVED,
           f"{_OWNER}: CORRECTED order US·EU·CH·EA·JP·RW (prior candidate "
           "order US·CH·JP·EU·EA·RW was wrong)")
        for s in ["zeta_X_us", "zeta_X_eu", "zeta_X_cn", "zeta_X_ea",
                  "zeta_X_jp", "zeta_X_rw"]
    ],

    "import_.target.slots": [
        _e("beta_M0", RESOLVED, f"{_OWNER}: const"),
        _e("beta_M1", RESOLVED, f"{_OWNER}: absorption demand"),
    ],
    "import_.growth.slots": [
        _e("c_M", RESOLVED, f"{_OWNER}: const"),
        _e("alpha_M0", RESOLVED, f"{_OWNER}: EC loading"),
        _e("alpha_M1", RESOLVED, f"{_OWNER}: demand growth"),
        _e("alpha_M2", RESOLVED, f"{_OWNER}: exchange rate"),
    ],
    "import_.demand_weights.slots": [
        _e(s, RESOLVED, f"{_OWNER}: order C·FI·IH·G·X confirmed")
        for s in ["zeta_M_c", "zeta_M_fi", "zeta_M_ih", "zeta_M_g", "zeta_M_x"]
    ],

    "core_cpi.slots": [
        _e("phi1", PROVISIONAL,
           f"{_OWNER}: eq (23) coefficient; term = lagged core inflation per "
           "owner fallback — PROVISIONAL_PHILLIPS (P2)",
           ["lagged core inflation", "other eq (23) term order"]),
        _e("phi2", PROVISIONAL,
           f"{_OWNER}: eq (23); term = attractor π∞ per owner fallback — "
           "PROVISIONAL_PHILLIPS (P2)",
           ["attractor pi_inf", "other eq (23) term order"]),
        _e("phi3", PROVISIONAL,
           f"{_OWNER}: eq (23); term = output gap per owner fallback — "
           "PROVISIONAL_PHILLIPS (P2)",
           ["output gap", "other eq (23) term order"]),
        _e("pi_star", RESOLVED, f"{_OWNER}: inflation target"),
        _e("delta1", RESOLVED,
           f"{_OWNER}: eq (24) adaptive-expectation coefficient 1; "
           "OBSERVED: δ1+δ2=1.0396>1, recorded, not renormalized"),
        _e("delta2", RESOLVED,
           f"{_OWNER}: eq (24) adaptive-expectation coefficient 2"),
    ],

    "cpi.target.named": {"w_core": _e(
        "nu_cpi", RESOLVED, f"{_OWNER}: weight of core in headline")},
    "cpi.growth.slots": [
        _e("c_cpi", RESOLVED, f"{_OWNER}: const"),
        _e("alpha_cpi0", RESOLVED, f"{_OWNER}: EC loading"),
        _e("alpha_cpi1", RESOLVED, f"{_OWNER}: Δcore"),
        _e("alpha_cpi2", RESOLVED, f"{_OWNER}: Δimport price"),
    ],

    "housing.target.slots": [
        _e("beta_hpi0", RESOLVED, f"{_OWNER}: const"),
        _e("beta_hpi1", RESOLVED,
           f"{_OWNER}: CPI (prior provisional 'income' was wrong)"),
        _e("beta_hpi2", RESOLVED, f"{_OWNER}: household rate"),
    ],
    "housing.growth.slots": [
        _e("c_hpi", RESOLVED, f"{_OWNER}: const"),
        _e("alpha_hpi0", RESOLVED, f"{_OWNER}: EC loading"),
        _e("alpha_hpi1", RESOLVED, f"{_OWNER}: AR"),
        _e("alpha_hpi2", RESOLVED, f"{_OWNER}: rate"),
    ],

    "export_price.target.slots": [
        _e("beta_px0", RESOLVED, f"{_OWNER}: const"),
        _e("beta_px1", RESOLVED, f"{_OWNER}: world price, unit constraint"),
    ],
    "export_price.growth.slots": [
        _e("c_px", RESOLVED, f"{_OWNER}: const"),
        _e("alpha_px0", RESOLVED, f"{_OWNER}: EC loading"),
        _e("alpha_px1", PROVISIONAL,
           f"{_OWNER}: symbol fixed; term per eq (30) printed order not "
           "transcribed (P3)",
           ["fx-change pass-through", "world-price growth pass-through"]),
        _e("alpha_px2", PROVISIONAL, f"{_OWNER}: symbol fixed; term per eq "
           "(30) printed order not transcribed (P3)",
           ["world-price growth pass-through", "fx-change pass-through"]),
    ],

    "import_price.target.slots": [
        _e("beta_pm0", RESOLVED, f"{_OWNER}: const"),
        _e("beta_pm1", RESOLVED, f"{_OWNER}: world import price"),
        _e("beta_pm2", RESOLVED, f"{_OWNER}: oil"),
    ],
    "import_price.growth.slots": [
        _e("c_pm", RESOLVED, f"{_OWNER}: const"),
        _e("alpha_pm0", RESOLVED, f"{_OWNER}: EC loading"),
        _e("alpha_pm1", PROVISIONAL, f"{_OWNER}: symbol fixed; term per eq "
           "(32) printed order not transcribed (P3)",
           ["world-price+fx growth", "oil growth"]),
        _e("alpha_pm2", PROVISIONAL, f"{_OWNER}: symbol fixed; term per eq "
           "(32) printed order not transcribed (P3)",
           ["oil growth", "world-price+fx growth"]),
    ],

    "fx.slots": [
        _e("alpha_EXR0", RESOLVED, f"{_OWNER}: UIP weight"),
        _e("alpha_EXR1", RESOLVED, f"{_OWNER}: ln steady-state (≈1110원)"),
        _e("alpha_EXR2", RESOLVED, f"{_OWNER}: risk-premium scale"),
        _e("c_UIP", RESOLVED, f"{_OWNER}: eq (34) constant"),
    ],

    "policy_rule.named": {
        "phi_i": _e("phi_i", RESOLVED, f"{_OWNER}: smoothing (was 'rho')"),
        "phi_pi": _e("phi_pi", RESOLVED, f"{_OWNER}"),
        "phi_y": _e("phi_y", RESOLVED, f"{_OWNER}"),
        "pi_star": _e("pi_star", RESOLVED,
                      f"{_OWNER}: CORRECTION — 4th value is the inflation "
                      "target π*, not r*; labels only, no numeric change"),
    },
    "calibration.r_star.named": {
        "r_star": _e("r_star", RESOLVED,
                     "CALIBRATED_LW: Laubach–Williams mean, footnote 24 — "
                     "calibrated outside Appendix D"),
    },

    "corp_bond.slots": [
        _e("rho_CB", RESOLVED, f"{_OWNER}: AR"),
        _e("eta_bar_CB", RESOLVED,
           f"{_OWNER}: MEAN spread (mean-reversion parameterization; prior "
           "'intercept' reading corrected)"),
        _e("alpha_CB", RESOLVED, f"{_OWNER}: gap"),
    ],

    "loan_rates.household.slots": [
        _e("nu_HH", RESOLVED,
           f"{_OWNER}: CORRECTION — groups were swapped; ν_HH=0.36 group is "
           "the HOUSEHOLD equation (households closer to long rates)"),
        _e("rho_HH", RESOLVED, f"{_OWNER}: smoothing"),
        _e("eta_bar_HH", RESOLVED, f"{_OWNER}: mean spread"),
        _e("alpha_HH", RESOLVED, f"{_OWNER}: pass-through"),
    ],
    "loan_rates.firm.slots": [
        _e("nu_Firm", RESOLVED, f"{_OWNER}: CORRECTION — ν_Firm=0.64 group "
           "is the FIRM equation"),
        _e("rho_Firm", RESOLVED, f"{_OWNER}: smoothing"),
        _e("eta_bar_Firm", RESOLVED, f"{_OWNER}: mean spread"),
        _e("alpha_Firm", RESOLVED, f"{_OWNER}: pass-through"),
    ],
    "loan_rates.shared.named": {
        "eta_cb": _e("eta_bar_CB_ref", RESOLVED,
                     f"{_OWNER}: corp-bond spread reference in eqs 42-43 "
                     "(shared; moved out of the old 'corporate' slot list)"),
    },

    "debt_gdp.slots": [
        _e("c_debt", RESOLVED, f"{_OWNER}: const"),
        _e("alpha_debt1", RESOLVED,
           f"{_OWNER}: gap (prior candidates income/housing were wrong)"),
        _e("alpha_debt2", RESOLVED, f"{_OWNER}: housing YoY"),
        _e("alpha_debt3", RESOLVED, f"{_OWNER}: household rate"),
    ],
}


# ------------------------------------------------------------------ helpers
def _iter_yaml_slots(cfg: dict):
    """Yield (path, kind, index_or_name, value) over all coefficient entries."""
    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if k in ("note", "meta"):
                    continue
                if k == "slots":
                    for i, val in enumerate(v):
                        yield (f"{path}.slots", "slot", i, val)
                elif k == "named":
                    for nm, val in v.items():
                        yield (f"{path}.named", "named", nm, val)
                else:
                    yield from walk(v, f"{path}.{k}" if path else k)
    yield from walk(cfg, "")


def coefficient(cfg: dict, path: str, index) -> Coefficient:
    """Fetch a Coefficient (value + provenance) for a YAML slot or named key."""
    node = cfg
    for part in path.split(".")[:-1]:
        node = node[part]
    leaf = path.split(".")[-1]
    if leaf == "named":
        value = node["named"][index]
        entry = RESOLUTION[path][index]
    else:
        value = node["slots"][index]
        entry = RESOLUTION[path][index]
    return Coefficient(value=float(value), symbol=entry["symbol"],
                       status=entry["status"],
                       source=f"appendix_d: {path}[{index}]",
                       basis=entry["basis"], candidates=entry["candidates"])


def resolve(write: bool = True) -> dict:
    """Cross-walk YAML x RESOLUTION; optionally write appendix_d_resolved.yaml."""
    cfg = load_appendix_d()
    out, problems = {}, []
    for path, kind, idx, val in _iter_yaml_slots(cfg):
        if path not in RESOLUTION:
            problems.append(f"no resolution for {path}")
            continue
        entry = (RESOLUTION[path][idx] if kind == "slot"
                 else RESOLUTION[path].get(idx))
        if entry is None:
            problems.append(f"no resolution for {path}[{idx}]")
            continue
        out.setdefault(path, {})[str(idx)] = {
            "value": val, "symbol": entry["symbol"], "status": entry["status"],
            "basis": entry["basis"],
            **({"candidates": entry["candidates"]}
               if entry["candidates"] else {}),
        }
    if problems:
        raise KeyError(f"unresolved YAML coverage: {problems}")
    if write:
        with open(CONFIG / "appendix_d_resolved.yaml", "w",
                  encoding="utf-8") as f:
            yaml.safe_dump(out, f, allow_unicode=True, sort_keys=True)
    return out
