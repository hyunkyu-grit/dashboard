# -*- coding: utf-8 -*-
"""Phase-5a tests: CD event-study contract + the policy->CD adapter."""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bigfoot.cd_layer.adapter import (  # noqa: E402
    BDAYS_PER_Q,
    DEFAULT_PARAMS,
    policy_path_to_cd,
    step_profile,
)

OUT = Path(__file__).resolve().parents[2] / "output"


def test_flat_path_flat_cd():
    """A flat policy path returns flat CD at the mean spread."""
    out = policy_path_to_cd([2.5] * 8)
    assert np.allclose(out["daily"], 2.5 + DEFAULT_PARAMS["spread"])
    assert np.allclose(out["quarterly"], 2.5 + DEFAULT_PARAMS["spread"])
    # deviation-space call: spread overridden to zero
    dev = policy_path_to_cd(np.zeros(8), params={"spread": 0.0})
    assert np.all(dev["daily"] == 0.0)


def test_single_step_reproduces_event_profile():
    """A single +25bp step reproduces the estimated average event shape:
    pre-reflection at D-1, pre+jump at D, exponential residual after."""
    p = DEFAULT_PARAMS
    path = [2.00] * 2 + [2.25] * 6
    out = policy_path_to_cd(path)
    d0 = 2 * BDAYS_PER_Q                       # change day
    base = 2.00 + p["spread"]
    resp = (out["daily"] - base) / 0.25
    assert abs(resp[d0 - p["pre_window_days"]] - 0.0) < 1e-12
    assert abs(resp[d0 - 1] - p["pre_reflection_ratio"]) < 1e-12
    cum_d = p["pre_reflection_ratio"] + p["jump_ratio"]
    assert abs(resp[d0] - cum_d) < 1e-12
    k = 15
    expect = 1.0 - (1.0 - cum_d) * np.exp(-k / p["exp_tau_days"])
    assert abs(resp[d0 + k] - expect) < 1e-12
    # long-run convergence to full pass-through
    assert resp[-1] > 0.95 or len(path) < 8
    # monotone non-decreasing response for a positive step
    assert np.all(np.diff(resp[d0 - p["pre_window_days"]:]) > -1e-12)


def test_params_overridable():
    out = policy_path_to_cd([1.0, 1.5], params={
        "spread": 0.0, "pre_reflection_ratio": 0.0, "jump_ratio": 1.0,
        "exp_tau_days": 1.0})
    d0 = BDAYS_PER_Q
    assert abs(out["daily"][d0 - 1] - 1.0) < 1e-12      # no anticipation
    assert abs(out["daily"][d0] - 1.5) < 1e-12          # full jump at D


def test_defaults_match_study_json():
    """Adapter constants are consistency-locked to the Step-1 estimates."""
    j = json.loads((OUT / "cd_passthrough.json").read_text(encoding="utf-8"))
    h = j["headline"]
    assert abs(DEFAULT_PARAMS["pre_reflection_ratio"]
               - h["pre_reflection_ratio"]) < 1e-9
    assert abs(DEFAULT_PARAMS["jump_ratio"] - h["jump_ratio"]) < 1e-9
    assert abs(DEFAULT_PARAMS["exp_tau_days"]
               - h["exp_tau_days_from_terminal"]) < 1e-9
    assert abs(DEFAULT_PARAMS["spread"] - j["cd_base_spread_mean_pp"]) < 1e-9
    # the half-life is right-censored — the adapter must NOT be built on
    # an uncensored-subset median (regression lock on the 5a finding)
    assert h["half_life_censored"] is True


def test_profile_zero_before_window():
    rel = np.array([-30, -11])
    assert np.all(step_profile(rel) == 0.0)
