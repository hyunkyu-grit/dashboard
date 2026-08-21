# -*- coding: utf-8 -*-
"""Phase-5a Step 2 — the policy->CD adapter.

policy_path_to_cd maps an engine QUARTERLY policy-rate path into a CD 91d
path (daily, then quarterly means) using the Step-1 event-study estimates:
a linear anticipation ramp over the 10 business days before each modeled
change, the announcement-day jump, and an exponential approach of the
residual gap afterwards, plus the sample-mean CD-base spread in level.

Defaults = output/cd_passthrough.json estimates, pinned here as constants
(consistency-locked by tests/test_cd_layer.py against the json):
    pre_reflection 0.113, jump 0.558, tau 78.8bd (two-point D->D+15 gap
    decay — the within-window half-life is right-censored), spread 0.2147.
All overridable via `params`.

Convention: policy changes occur on the FIRST business day of each
quarter (the engine's quarterly timing has no intra-quarter information).
A flat path returns flat CD at policy + spread. Deviation-space callers
(engine IRFs/conditionals) should pass spread=0.
"""
from __future__ import annotations

import numpy as np

BDAYS_PER_Q = 63

DEFAULT_PARAMS = {
    "pre_reflection_ratio": 0.113,
    "jump_ratio": 0.558,
    "exp_tau_days": 78.8,
    "spread": 0.2147,
    "pre_window_days": 10,
}


def step_profile(rel_days: np.ndarray, params: dict = None) -> np.ndarray:
    """Cumulative CD reflection of a unit policy change vs business days
    relative to the change day (the Step-1 average event shape)."""
    p = dict(DEFAULT_PARAMS, **(params or {}))
    pre, jump = p["pre_reflection_ratio"], p["jump_ratio"]
    tau, w = p["exp_tau_days"], p["pre_window_days"]
    rel = np.asarray(rel_days, dtype=float)
    out = np.zeros_like(rel)
    ramp = (rel >= -w) & (rel < 0)
    out[ramp] = pre * (rel[ramp] + w) / (w - 1.0)
    at = rel >= 0
    cum_d = pre + jump
    out[at] = 1.0 - (1.0 - cum_d) * np.exp(-rel[at] / tau)
    return out


def policy_path_to_cd(quarterly_policy_path, params: dict = None) -> dict:
    """Quarterly policy path -> {'daily': array, 'quarterly': array}.

    quarterly_policy_path: sequence of policy-rate LEVELS (or deviations;
    pass spread=0 in params) per quarter. Changes are placed on the first
    business day of each quarter.
    """
    p = dict(DEFAULT_PARAMS, **(params or {}))
    q = np.asarray(quarterly_policy_path, dtype=float)
    n_d = len(q) * BDAYS_PER_Q
    day = np.arange(n_d)
    cd = np.full(n_d, q[0] + p["spread"])
    for j in range(1, len(q)):
        delta = q[j] - q[j - 1]
        if delta == 0.0:
            continue
        cd += delta * step_profile(day - j * BDAYS_PER_Q, p)
    quarterly = cd.reshape(len(q), BDAYS_PER_Q).mean(axis=1)
    return {"daily": cd, "quarterly": quarterly}
