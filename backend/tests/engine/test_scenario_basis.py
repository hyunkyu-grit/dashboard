# -*- coding: utf-8 -*-
"""Phase-6b tests: conditioning-map round-trips + linear basis + gates."""
import json
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from bigfoot.conditional import conditional_forecast  # noqa: E402
from bigfoot.conditional.residuals import load_conditioning_map  # noqa: E402
from bigfoot.solve.phase3 import FINAL_EQ24, FINAL_OPTIONS  # noqa: E402
from bigfoot.solve.system import BigfootSystem  # noqa: E402

TOL = 5e-7      # damped-fixed-point tolerance headroom


@lru_cache(maxsize=1)
def _sys() -> BigfootSystem:
    return BigfootSystem(beta_sync=1.05, eq24_form=FINAL_EQ24, T=24,
                         options=FINAL_OPTIONS)


def test_kr_policy_roundtrip_named():
    """kr_policy group (formalized 6b): conditioning on the model's own
    IRF-A policy path recovers the 25bp rule shock — the Phase-4 (ii)
    round-trip, locked under its map-group name."""
    groups = load_conditioning_map()
    assert groups["kr_policy"]["residuals"] == ["policy_rule"]
    sys_ = _sys()
    irf_a = sys_.solve({"kr_rule_bp": 25.0})
    out = conditional_forecast("kr_policy", {"i_kr": irf_a["korea"]["i_kr"]},
                               mode="exact", system=sys_)
    u = out["adjusted_residuals"]["policy_rule"]
    assert abs(u[0] - 0.25) < TOL
    assert np.max(np.abs(u[1:])) < TOL


def test_kr_demand_roundtrip():
    """kr_demand (new, exact 1:1): a KNOWN consumption-residual path is
    recovered by conditioning on the gap it generates; and conditioning on
    the model's own IRF-A gap segment reproduces that segment exactly."""
    groups = load_conditioning_map()
    assert groups["kr_demand"]["residuals"] == ["consumption"]
    sys_ = _sys()
    # (1) synthetic recovery
    u_true = np.zeros(6)
    u_true[:3] = [0.30, 0.20, -0.10]
    forced = sys_.solve({}, residuals={"consumption": u_true})
    gap_seg = forced["korea"]["y_gap"][:6]
    out = conditional_forecast("kr_demand", {"y_gap": gap_seg},
                               mode="penalized", lam=0.0, system=sys_)
    u_rec = out["adjusted_residuals"]["consumption"]
    assert np.max(np.abs(u_rec - u_true)) < 1e-5, u_rec
    # (2) IRF-A gap segment: exact-determined fit
    irf_a = sys_.solve({"kr_rule_bp": 25.0})
    seg = irf_a["korea"]["y_gap"][:6]
    out2 = conditional_forecast("kr_demand", {"y_gap": seg},
                                mode="penalized", lam=0.0, system=sys_)
    assert out2["fit_max_abs_gap"] < 1e-6
    assert np.max(np.abs(out2["korea"]["y_gap"][:6] - seg)) < 1e-6


@pytest.fixture(scope="module")
def basis():
    return json.loads((ROOT / "output" / "scenario_basis.json")
                      .read_text("utf-8"))


def test_linearity_gate_embedded(basis):
    g = basis["linearity_gate"]
    for name in ("a_policy_cpi", "b_us_exports"):
        assert g[name]["pass"], g[name]
        assert g[name]["max_curve_bp"] < 2.0
        assert g[name]["max_macro_pp"] < 0.02


def test_policy_map_lower_triangular(basis):
    """No anticipation: basis q moves nothing before quarter q; the
    diagonal is the imposed +25bp step."""
    M = np.array(basis["M_policy"])
    for t in range(8):
        for q in range(8):
            if t < q:
                assert abs(M[t][q]) < 1e-9, (t, q)
    assert np.allclose(np.diag(M), 0.25, atol=1e-9)


def test_basis_inventory(basis):
    names = set(basis["bases"])
    assert {f"policy_q{q}" for q in range(1, 9)} <= names
    assert {"cpi", "gap", "exports", "us_2q", "us_4q", "us_6q",
            "oil"} <= names
    for b in basis["bases"].values():
        assert len(b["i_kr"]) == basis["horizon_q"]
        assert len(b["irs"]["3y"]) == basis["irs_h"]
