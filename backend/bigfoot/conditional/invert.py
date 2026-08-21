# -*- coding: utf-8 -*-
"""Phase-4 Step 2 — the Appendix-B inversion engine (eqs B.1-B.5).

Fix some endogenous paths Y_c from outside; solve for equation residuals u
such that the model reproduces Y_c while the free endogenous block stays
model-consistent. Residual selection is governed by
config/conditioning_map.yaml — requests outside a group's allowance RAISE.

Two modes:
  exact      #adjusted residuals == #conditions per period.
             - us_block: the stacked perfect-foresight US system is
               partitioned — imposed periods fixed, later periods solved
               FREE (zero residuals, SS terminal conditions), imposed-period
               residuals read off the equation rows. This is the unique
               inversion, and it extends the conditioned path
               model-consistently beyond the conditioning window (needed by
               the EH 10y).
             - kr groups: pin-and-back-out inside the Phase-3 damped fixed
               point (PIN_SUPPORTED variables; i_kr in v1).
  penalized  scipy.optimize.least_squares on the B.5 objective
                 min_u ||Y_c - Y_c(u)||^2 + lambda * (-log f(u; Sigma))
             with f multivariate normal fitted to historical residuals
             (paper footnote 31; normalization constant dropped), i.e.
             residual rows [Y_c - Y_c(u);  sqrt(lambda/2) * u / sigma].
             lambda in [0,1] exposed. At lambda=0 with a determined system
             this reproduces the exact mode.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

from bigfoot.conditional.residuals import (check_residual_selection,
                                           fit_moments, load_conditioning_map)
from bigfoot.equations.us import USBlock
from bigfoot.solve.system import BigfootSystem

ROOT = Path(__file__).resolve().parents[2]
MOMENTS = ROOT / "output" / "residual_moments.json"

#: condition-variable -> where it lives ("us" stacked block or Korea solver)
US_VARS = {"us_y": "y", "us_pi": "pi", "us_i": "i"}


def load_sigma() -> dict:
    """Diagonal residual stds from output/residual_moments.json (Step 1);
    regenerates the file if missing."""
    if not MOMENTS.exists():
        fit_moments()
    j = json.loads(MOMENTS.read_text(encoding="utf-8"))
    return j["sigma_diagonal_std"]


def _build_system(T: int, beta_sync: float, eq24_form: str,
                  options: dict) -> BigfootSystem:
    return BigfootSystem(beta_sync=beta_sync, eq24_form=eq24_form, T=T,
                         options=options)


def _neg_log_f(u_flat: np.ndarray, sig: np.ndarray) -> float:
    """-log f(u; diagonal Sigma), normalization constant dropped."""
    return 0.5 * float(np.sum((u_flat / sig) ** 2))


def conditional_forecast(group: str, conditions: dict, mode: str = "exact",
                         lam: float = 0.0, T: int = 24,
                         residual_names: list = None,
                         beta_sync: float = 0.5, eq24_form: str = "paper",
                         options: dict = None,
                         system: BigfootSystem = None) -> dict:
    """Run a conditional forecast per Appendix B.

    conditions: {variable: array of imposed DEVIATION path, length Tc <= T}.
    Returns korea/us paths over T, the adjusted residuals, the conditioning
    fit, and the likelihood penalty of the selected residuals.
    """
    groups = load_conditioning_map()
    if group not in groups:
        raise KeyError(f"unknown conditioning group {group!r}")
    allowed_conditions = set(groups[group]["conditions"])
    illegal = [k for k in conditions if k not in allowed_conditions]
    if illegal:
        raise KeyError(f"variables {illegal} are not conditionable under "
                       f"group {group!r} (allowed: {sorted(allowed_conditions)})")
    residual_names = check_residual_selection(
        group, residual_names or groups[group]["residuals"])

    cond = {k: np.asarray(v, dtype=float) for k, v in conditions.items()}
    Tc = len(next(iter(cond.values())))
    if any(len(v) != Tc for v in cond.values()):
        raise ValueError("all imposed paths must share one length")
    if Tc > T:
        raise ValueError(f"conditioning window Tc={Tc} exceeds T={T}")

    sigma_all = load_sigma()
    sig = np.array([sigma_all[n] for n in residual_names for _ in range(Tc)])
    sys_ = system or _build_system(T, beta_sync, eq24_form, options)

    if set(cond) <= set(US_VARS):
        return _condition_us(sys_, cond, mode, lam, T, Tc,
                             residual_names, sig, group)
    return _condition_korea(sys_, cond, mode, lam, T, Tc,
                            residual_names, sig, group)


# ------------------------------------------------------------------ US block
def _condition_us(sys_, cond, mode, lam, T, Tc, residual_names, sig, group):
    usb = USBlock()
    T_us = max(80, T + 48)
    # exact mode needs the full triple; the stacked partition is only square
    # (3 residuals == 3 conditions per period) when y, pi, i are all imposed
    if mode == "exact":
        if set(cond) != set(US_VARS):
            raise ValueError("exact us_block conditioning requires all of "
                             "us_y, us_pi, us_i (else use mode='penalized')")
        paths, resid = usb.conditioned_solve(cond, T=T_us)
        u_by_name = {n: resid[n] for n in USBlock.ROW_NAMES}
        fit = 0.0                                   # imposed by construction
    else:
        n_res = len(residual_names)

        def unpack(u_flat):
            return {n: u_flat[i * Tc:(i + 1) * Tc]
                    for i, n in enumerate(residual_names)}

        def model(u_flat):
            return usb.simulate_shock(0.0, T=T_us, residuals=unpack(u_flat))

        def objective(u_flat):
            m = model(u_flat)
            rows = [m[US_VARS[k]][:Tc] - v for k, v in cond.items()]
            rows.append(np.sqrt(max(lam, 0.0) / 2.0) * (u_flat / sig))
            return np.concatenate(rows)

        sol = least_squares(objective, np.zeros(n_res * Tc), method="lm")
        paths = model(sol.x)
        u_by_name = {n: u for n, u in unpack(sol.x).items()}
        fit = max(float(np.max(np.abs(paths[US_VARS[k]][:Tc] - v)))
                  for k, v in cond.items())

    kr = sys_.solve({}, us_override=paths)
    u_flat = np.concatenate([u_by_name[n] for n in residual_names])
    return _package(group, mode, lam, T, Tc, kr, u_by_name, fit,
                    _neg_log_f(u_flat, sig))


# ---------------------------------------------------------------- Korea side
def _condition_korea(sys_, cond, mode, lam, T, Tc, residual_names, sig, group):
    if mode == "exact":
        unsupported = [k for k in cond if k not in BigfootSystem.PIN_SUPPORTED]
        if unsupported:
            raise ValueError(
                f"exact mode: variables {unsupported} are not pin-supported "
                f"({BigfootSystem.PIN_SUPPORTED}); use mode='penalized'")
        pin = {k: np.concatenate([v, np.zeros(T - Tc)]) if Tc < T else v
               for k, v in cond.items()}
        kr = sys_.solve({}, pin=pin)
        # v1: pin backs out the pinned variable's OWN equation residual;
        # kr_policy maps i_kr -> policy_rule
        u_by_name = {residual_names[0]:
                     kr["diagnostics"]["pin_residuals"][list(cond)[0]][:Tc]}
        fit = 0.0
    else:
        n_res = len(residual_names)

        def unpack(u_flat):
            return {n: u_flat[i * Tc:(i + 1) * Tc]
                    for i, n in enumerate(residual_names)}

        def objective(u_flat):
            kr_ = sys_.solve({}, residuals=unpack(u_flat))
            rows = [kr_["korea"][k][:Tc] - v for k, v in cond.items()]
            rows.append(np.sqrt(max(lam, 0.0) / 2.0) * (u_flat / sig))
            return np.concatenate(rows)

        sol = least_squares(objective, np.zeros(n_res * Tc), method="lm")
        u_by_name = unpack(sol.x)
        kr = sys_.solve({}, residuals=u_by_name)
        fit = max(float(np.max(np.abs(kr["korea"][k][:Tc] - v)))
                  for k, v in cond.items())
    u_flat = np.concatenate([u_by_name[n] for n in residual_names])
    return _package(group, mode, lam, T, Tc, kr, u_by_name, fit,
                    _neg_log_f(u_flat, sig[: len(u_flat)]))


def _package(group, mode, lam, T, Tc, kr, u_by_name, fit, penalty):
    return {
        "group": group, "mode": mode, "lambda": lam, "T": T, "Tc": Tc,
        "korea": kr["korea"], "us": kr["us"],
        "diagnostics": kr["diagnostics"],
        "adjusted_residuals": {k: np.asarray(v) for k, v in u_by_name.items()},
        "fit_max_abs_gap": fit,
        "penalty_neg_log_f": penalty,
    }
