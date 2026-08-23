# -*- coding: utf-8 -*-
"""Phase-4 tests: Appendix-B inversion round-trips + map discipline.

The two round-trips are MANDATED by the phase spec:
  (i)  conditioning on the baseline itself returns u = 0 (machine tol)
  (ii) conditioning on the model's OWN IRF-A policy-rate path recovers the
       original 25bp rule shock — the inversion is the solver's true inverse
"""
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bigfoot.conditional import ConditioningMapError, conditional_forecast  # noqa: E402
from bigfoot.conditional.residuals import check_residual_selection  # noqa: E402
from bigfoot.equations.us import USBlock  # noqa: E402
from bigfoot.solve.config import FINAL_EQ24, FINAL_OPTIONS  # noqa: E402
from bigfoot.solve.system import BigfootSystem  # noqa: E402

TOL_FP = 5e-8      # the Korea solver's damped fixed point runs at tol 1e-8


@lru_cache(maxsize=1)
def _system() -> BigfootSystem:
    return BigfootSystem(beta_sync=0.5, eq24_form=FINAL_EQ24,
                         options=FINAL_OPTIONS)


# ------------------------------------------------------- round-trip (i): zero
def test_roundtrip_baseline_us_exact():
    """Conditioning the US block on the baseline (all-zero deviations)
    returns u = 0 and leaves every Korean variable at baseline."""
    z = np.zeros(12)
    out = conditional_forecast(
        "us_block", {"us_y": z, "us_pi": z, "us_i": z}, mode="exact",
        system=_system())
    for name, u in out["adjusted_residuals"].items():
        assert np.max(np.abs(u)) < 1e-12, name
    for k, path in out["korea"].items():
        assert np.max(np.abs(path)) < TOL_FP, k
    assert out["penalty_neg_log_f"] < 1e-20


def test_roundtrip_baseline_us_penalized():
    z = np.zeros(8)
    out = conditional_forecast(
        "us_block", {"us_y": z, "us_pi": z, "us_i": z}, mode="penalized",
        lam=0.5, system=_system())
    for name, u in out["adjusted_residuals"].items():
        assert np.max(np.abs(u)) < 1e-10, name
    assert out["fit_max_abs_gap"] < 1e-10


# --------------------------------------------- round-trip (ii): IRF-A inverse
def test_roundtrip_irf_a_policy_rate():
    """Conditioning on the model's own IRF-A policy-rate path must recover
    the original 25bp rule shock: u_policy = [0.25, 0, 0, ...]."""
    sys_ = _system()
    irf_a = sys_.solve({"kr_rule_bp": 25.0})
    out = conditional_forecast(
        "kr_policy", {"i_kr": irf_a["korea"]["i_kr"]}, mode="exact",
        system=sys_)
    u = out["adjusted_residuals"]["policy_rule"]
    assert abs(u[0] - 0.25) < TOL_FP
    assert np.max(np.abs(u[1:])) < TOL_FP
    # and the conditioned solve reproduces the whole IRF-A state
    for k, path in irf_a["korea"].items():
        assert np.max(np.abs(out["korea"][k] - path)) < TOL_FP, k


# ------------------------------------------------ exact == penalized at lam=0
def test_us_exact_matches_penalized_lambda0():
    """Determined system: the B.5 objective at lambda=0 reproduces the
    exact partition inversion."""
    usb = USBlock()
    shock = usb.simulate_shock(shock_bp=25.0, T=80)
    cond = {"us_y": shock["y"][:8], "us_pi": shock["pi"][:8],
            "us_i": shock["i"][:8]}
    sys_ = _system()
    a = conditional_forecast("us_block", cond, mode="exact", system=sys_)
    b = conditional_forecast("us_block", cond, mode="penalized", lam=0.0,
                             system=sys_)
    for name in a["adjusted_residuals"]:
        assert np.allclose(a["adjusted_residuals"][name],
                           b["adjusted_residuals"][name], atol=1e-8), name
    # conditioning on the block's own 25bp-shock path recovers that shock
    u = a["adjusted_residuals"]["us_rule"]
    assert abs(u[0] - 0.25) < 1e-10
    assert np.max(np.abs(u[1:])) < 1e-10
    assert np.max(np.abs(a["adjusted_residuals"]["us_is"])) < 1e-10
    assert np.max(np.abs(a["adjusted_residuals"]["us_pc"])) < 1e-10


# ------------------------------------------------------------- map discipline
def test_conditioning_map_raises():
    """Residuals outside the requested group must raise — silent
    cross-channel conditioning is forbidden."""
    with pytest.raises(ConditioningMapError):
        check_residual_selection("kr_cpi", ["phillips", "consumption"])
    with pytest.raises(ConditioningMapError):
        check_residual_selection("no_such_group", ["phillips"])
    with pytest.raises(KeyError):
        conditional_forecast("kr_policy", {"cpi_yoy": np.zeros(4)},
                             system=_system())
    with pytest.raises(ConditioningMapError):
        conditional_forecast("kr_cpi", {"cpi_yoy": np.zeros(4)},
                             residual_names=["export"], system=_system())


def test_residual_solver_names_cover_map():
    """Every residual the map may move must exist in the solver (US rows or
    Korea RESIDUAL_EQS) — a map entry the solver cannot honor is a defect."""
    from bigfoot.conditional.residuals import load_conditioning_map
    known = set(BigfootSystem.RESIDUAL_EQS) | set(USBlock.ROW_NAMES)
    for g, spec in load_conditioning_map().items():
        for r in spec["residuals"]:
            assert r in known, (g, r)
