# -*- coding: utf-8 -*-
"""Phase-6b Step 2 — linear scenario basis, Korea first.

python -m bigfoot.scenario_basis.build   (writes output/scenario_basis.json)

Bases (24q horizon, deviation space, baseline = zero):
  policy_q1..q8   +25bp imposed (partial pin) in quarter q ONLY, rule
                  resumes elsewhere. Any 8-quarter step path is an EXACT
                  combination via the lower-triangular map M
                  (M[t][q] = basis_q's i_kr at t; c = M^-1 target).
  cpi             cpi_yoy +0.5pp x 4q   (kr_cpi conditioning, phillips)
  gap             y_gap  -0.5pp x 4q    (kr_demand, consumption)
  exports         x      -5%   x 4q     (kr_exports, export residual)
  us_2q/us_4q/us_6q  US policy +100bp imposed x {2,4,6}q (QPM responds;
                  us_6q added beyond the task's two so the lab's duration
                  knob {2,4,6} stays exact — reported)
  oil             oil price +10%

Per basis: quarterly paths for i_kr/kr3y/kr10y/y_gap/cpi_yoy/s/hpi/debt
plus the IRS diff path per tenor (engine CD-average contribution at
horizons 0..12q — the spread satellite cancels in scenario diffs).

LINEARITY GATE (embedded in the json): two mixed scenarios solved exactly
in residual space vs recombined from the bases. The model is linear by
construction, so the gate should sit at numerical noise; thresholds
< 2bp (policy/curve), < 0.02pp (gap/cpi).
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np

from bigfoot.conditional.hfl import kr3y_eh
from bigfoot.conditional.invert import conditional_forecast
from bigfoot.irs_curve.assembler import PHI_I_TAIL, engine_contribution
from bigfoot.solve.phase3 import BETA_SYNC_ADOPTED, FINAL_EQ24, FINAL_OPTIONS
from bigfoot.solve.system import BigfootSystem

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"

T = 24
IRS_TENOR_Y = {"1y": 1, "2y": 2, "3y": 3, "5y": 5, "10y": 10}
IRS_H = 13                      # quarterly IRS diff path, h = 0..12
# 논문 Figure 18 의 여덟 칸을 화면이 그대로 세울 수 있게 담는다 [2026-08-21].
# `x`·`m` 은 그 그림의 「Trades」 칸이고, 여태 풀어 놓고 안 담았다.
# 담기지 않은 칸 하나 — 「Nominal HH Debt(조원)」. `debt` 는 eq (44) 라
# **비율**(부채/GDP, %p)이고 명목 잔액은 편차 공간에 없다. 레벨을 지어내지
# 않고 화면이 그 칸을 비운다.
VARS = ("i_kr", "y_gap", "cpi_yoy", "s", "hpi", "debt", "kr10y",
        "x", "m")

DOMAIN = {
    "policy_bp_per_q": [-50, 50],
    "cpi_pp": [-1.0, 1.0],
    "gap_pp": [-1.0, 1.0],
    "exports_pct": [-10.0, 0.0],
    "us_bp": [0.0, 150.0],
    "us_dur_q": [2, 4, 6],
    "oil_pct": [-20.0, 20.0],
    "note": ("kernel validated to 100bp x 4q imposed US paths; beyond -> "
             "linear extrapolation (lab shows the out-of-domain badge)"),
}


def _sys() -> BigfootSystem:
    return BigfootSystem(beta_sync=BETA_SYNC_ADOPTED, eq24_form=FINAL_EQ24,
                         T=T, options=FINAL_OPTIONS)


def _irs_diff_path(i_kr_dev: np.ndarray) -> dict:
    """Engine CD-average contribution diffs per tenor, h = 0..IRS_H-1.
    The policy tail beyond T decays at PHI_I_TAIL (assembler convention)."""
    pad = np.zeros(44)
    pad[:T] = i_kr_dev
    for j in range(T, 44):
        pad[j] = pad[j - 1] * PHI_I_TAIL
    return {ten: [round(engine_contribution(pad, ty, h), 6)
                  for h in range(IRS_H)]
            for ten, ty in IRS_TENOR_Y.items()}


def _extract(sys_, out) -> dict:
    kr = out["korea"] if "korea" in out else out
    d = {v: [round(float(x), 6) for x in kr[v][:T]] for v in VARS}
    d["kr3y"] = [round(float(x), 6) for x in kr3y_eh(sys_, kr, T)]
    d["irs"] = _irs_diff_path(np.array(kr["i_kr"][:T]))
    return d


def build_bases() -> dict:
    sys_ = _sys()
    bases, resids = {}, {}

    # ---- KR policy: partial pins, one quarter each
    for q in range(8):
        pinpath = np.full(T, np.nan)
        pinpath[q] = 0.25
        out = sys_.solve({}, pin={"i_kr": pinpath})
        bases[f"policy_q{q + 1}"] = _extract(sys_, out)
        resids[f"policy_q{q + 1}"] = {
            "policy_rule": [round(float(x), 8)
                            for x in out["diagnostics"]["pin_residuals"]
                            ["i_kr"][:8]]}

    # ---- KR macro conditionals (penalized, exact-determined 1:1)
    for name, group, var, path in (
            ("cpi", "kr_cpi", "cpi_yoy", np.full(4, 0.5)),
            ("gap", "kr_demand", "y_gap", np.full(4, -0.5)),
            ("exports", "kr_exports", "x", np.full(4, -5.0))):
        out = conditional_forecast(group, {var: path}, mode="penalized",
                                   lam=0.0, T=T, system=sys_)
        bases[name] = _extract(sys_, out)
        resids[name] = {k: [round(float(x), 8) for x in v]
                        for k, v in out["adjusted_residuals"].items()}
        bases[name]["fit_max_abs_gap"] = round(float(
            out["fit_max_abs_gap"]), 8)

    # ---- external: imposed US policy paths + oil
    for name, nq in (("us_2q", 2), ("us_4q", 4), ("us_6q", 6)):
        us = sys_.usb.simulate_imposed_rate([1.0] * nq, T=max(80, T + 40))
        out = sys_.solve({}, us_override=us)
        bases[name] = _extract(sys_, out)
    out = sys_.solve({"oil_pct": 10.0})
    bases["oil"] = _extract(sys_, out)

    # ---- policy triangular map M (i_kr response of basis q at t=0..7)
    M = [[bases[f"policy_q{q + 1}"]["i_kr"][t] for q in range(8)]
         for t in range(8)]
    return sys_, bases, resids, M


# ------------------------------------------------------------ linearity gate
def _combine(bases, coefs: dict) -> dict:
    out = {v: np.zeros(T) for v in list(VARS) + ["kr3y"]}
    irs = {t: np.zeros(IRS_H) for t in IRS_TENOR_Y}
    for name, c in coefs.items():
        b = bases[name]
        for v in out:
            out[v] += c * np.array(b[v])
        for t in irs:
            irs[t] += c * np.array(b["irs"][t])
    out["irs"] = irs
    return out


def policy_coefs(M, target8, other_i_kr8) -> np.ndarray:
    """LAB SEMANTICS: the 8-quarter path builder PINS the policy path —
    the dots ARE the MPC decision (0 = deliberate hold, even against a
    macro shock; rule resumes q9). So the policy-basis coefficients solve
        M c = target - (other components' endogenous policy in q1..8)
    which by linearity reproduces the pinned exact solve."""
    return np.linalg.solve(np.array(M),
                           np.asarray(target8) - np.asarray(other_i_kr8))


def linearity_gate(sys_, bases, resids, M) -> dict:
    gates = {}

    # (a) policy [+25, +25, 0 x6] (all 8 quarters pinned) & CPI +0.25pp x 4q
    target = np.zeros(8)
    target[:2] = 0.25
    other = 0.5 * np.array(bases["cpi"]["i_kr"][:8])
    c_pol = policy_coefs(M, target, other)
    coefs = {f"policy_q{q + 1}": float(c_pol[q]) for q in range(8)}
    coefs["cpi"] = 0.5
    rec = _combine(bases, coefs)
    pinpath = np.full(T, np.nan)
    pinpath[:8] = target
    u_cpi = {k: 0.5 * np.array(v) for k, v in resids["cpi"].items()}
    exact = sys_.solve({}, pin={"i_kr": pinpath}, residuals=u_cpi)
    gates["a_policy_cpi"] = _gate_diff(sys_, exact, rec)

    # (b) US +50bp x 2q & exports -3%
    coefs = {"us_2q": 0.5, "exports": 0.6}
    rec = _combine(bases, coefs)
    us = sys_.usb.simulate_imposed_rate([0.5, 0.5], T=max(80, T + 40))
    u_exp = {k: 0.6 * np.array(v) for k, v in resids["exports"].items()}
    exact = sys_.solve({}, us_override=us, residuals=u_exp)
    gates["b_us_exports"] = _gate_diff(sys_, exact, rec)

    for g in gates.values():
        g["pass"] = bool(g["max_curve_bp"] < 2.0 and g["max_macro_pp"] < 0.02)
    return gates


def _gate_diff(sys_, exact_out, rec) -> dict:
    kr = exact_out["korea"]
    kr3 = kr3y_eh(sys_, kr, T)
    irs_e = _irs_diff_path(np.array(kr["i_kr"][:T]))
    curve_bp = max(
        float(np.max(np.abs(np.array(kr["i_kr"][:T]) - rec["i_kr"]))),
        float(np.max(np.abs(np.array(kr["kr10y"][:T]) - rec["kr10y"]))),
        float(np.max(np.abs(kr3 - rec["kr3y"]))),
        max(float(np.max(np.abs(np.array(irs_e[t]) - rec["irs"][t])))
            for t in IRS_TENOR_Y)) * 100.0
    macro_pp = max(
        float(np.max(np.abs(np.array(kr["y_gap"][:T]) - rec["y_gap"]))),
        float(np.max(np.abs(np.array(kr["cpi_yoy"][:T]) - rec["cpi_yoy"]))))
    return {"max_curve_bp": round(curve_bp, 4),
            "max_macro_pp": round(macro_pp, 6)}


def main() -> dict:
    sys_, bases, resids, M = build_bases()
    gates = linearity_gate(sys_, bases, resids, M)
    out = {
        "module": "scenario_basis",
        "as_of": date.today().isoformat(),
        "horizon_q": T, "irs_h": IRS_H,
        "policy_step_bp": 25.0,
        "basis_scales": {"cpi": 0.5, "gap": -0.5, "exports": -5.0,
                         "us_bp": 100.0, "oil_pct": 10.0},
        "M_policy": [[round(x, 8) for x in row] for row in M],
        "bases": bases,
        "conditioning_residuals": resids,
        "domain": DOMAIN,
        "linearity_gate": gates,
        "caveats": [
            "LINEAR_BASIS: scenarios are exact linear combinations of unit "
            "bases (the model is linear; gate embedded)",
            "KERNEL_DOMAIN: US tp kernel validated to 100bp x 4q imposed",
            "BETA_SYNC_SCALE: KR10y sync loading 1.05 (imposed-shock "
            "IRF-B anchor)",
            "US_6Q_BASIS_ADDED: a third US duration basis beyond the task "
            "sheet's two, so the duration knob {2,4,6}q stays exact",
        ],
    }
    (OUT / "scenario_basis.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(gates, indent=2))
    print(f"wrote {OUT / 'scenario_basis.json'} "
          f"({len(bases)} bases)")
    return out


if __name__ == "__main__":
    main()
