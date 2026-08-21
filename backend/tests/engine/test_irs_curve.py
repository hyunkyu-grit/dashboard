# -*- coding: utf-8 -*-
"""Phase-5b tests: spread satellite + curve assembler consistency."""
import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bigfoot.cd_layer.adapter import BDAYS_PER_Q, policy_path_to_cd  # noqa: E402
from bigfoot.irs_curve.assembler import _cd_avg, engine_contribution  # noqa: E402
from bigfoot.irs_curve import satellite  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "output"
RAW = Path(__file__).resolve().parents[2] / "data" / "krwswapdata" / "raw"

needs_data = pytest.mark.skipif(
    not (RAW / "krwswapdata.xlsx").exists(),
    reason="company IRS export not present (data/krwswapdata/raw)")


def test_flat_policy_spread_at_mu_flat_forecast():
    """Flat policy path + spread at mu -> flat curve forecast."""
    pol = np.full(44, 2.75)
    for ty in (1, 3, 10):
        for hq in (1, 2, 4):
            assert abs(engine_contribution(pol, ty, hq)) < 1e-12
    ou = {"3y": {"mu_bp": -5.0, "phi_daily": 0.995, "latest": -0.05}}
    for h in (63, 126, 252):
        assert abs(satellite.forecast_path(ou, "3y", h) - (-0.05)) < 1e-15


def test_short_end_handshake_1y_vs_quarterly():
    """The 1y engine contribution must match the cd_layer QUARTERLY
    profile within 2bp (daily-vs-quarterly aggregation consistency)."""
    pol = np.full(44, 2.75)
    pol[4:] += 0.25                      # +25bp step at quarter 4
    cdq = policy_path_to_cd(pol, params={"spread": 0.0})["quarterly"]
    for hq in (1, 2, 4):
        daily_route = engine_contribution(pol, 1, hq)
        q_route = cdq[hq: hq + 4].mean() - cdq[0: 4].mean()
        assert abs(daily_route - q_route) < 0.02, (hq, daily_route, q_route)


def test_cd_avg_terminal_extension():
    """Tenor windows beyond the path end hold the terminal value flat."""
    cd = np.linspace(0.0, 1.0, 4 * BDAYS_PER_Q)
    long_avg = _cd_avg(cd, 0, 10)        # needs 40q, path has 4q
    assert 0.5 < long_avg < 1.0
    assert abs(_cd_avg(np.full(300, 2.0), 0, 10) - 2.0) < 1e-12


@needs_data
def test_ou_fit_sane_and_json_locked():
    """OU parameters are stationary and the shipped json matches a refit."""
    from bigfoot.irs_curve.data import load_clean, spreads
    sp = spreads(load_clean())
    ou = satellite.fit_ou(sp)
    j = json.loads((OUT / "irs_curve_forecast.json").read_text("utf-8"))
    for tenor, p in ou.items():
        assert 0.0 < p["phi_daily"] < 1.0
        assert 0.0 < p["phi_quarterly"] < 1.0
        shipped = j["spread_satellite"]["ou"][tenor]
        assert abs(shipped["mu_bp"] - p["mu_bp"]) < 0.05, tenor
        assert abs(shipped["phi_daily"] - p["phi_daily"]) < 1e-3, tenor


@needs_data
def test_forecast_json_contract():
    j = json.loads((OUT / "irs_curve_forecast.json").read_text("utf-8"))
    assert j["module"] == "irs_curve_forecast"
    for scen in ("baseline", "us_hfl"):
        for tenor in j["tenors"]:
            row = j["scenarios"][scen][tenor]
            for k in ("current", "f3m", "f6m", "f12m",
                      "model_minus_market_bp"):
                assert k in row, (scen, tenor, k)
            lo, hi = row["f12m_band"]
            assert lo <= row["f12m"] <= hi
    assert any("SPREAD_V1_OU" in c for c in j["caveats"])
