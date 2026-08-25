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
    """OU parameters are stationary and the shipped json matches a refit
    **on the data it was baked from**.

    [개조 2026-08-25 — 감사록 F2] 종전에는 «오늘 데이터 전량» 재적합과
    비교했다 — 데이터는 아침마다 전진하고 산출물 JSON 은 동결이라, 산출물이
    옳아도 하루만 지나면 적색이 되는 설계였다(실측: 10y μ 0.10bp 드리프트로
    상시 실패). 락은 산출물에 박힌 워터마크(`quotes_as_of`)까지 데이터를
    잘라 재적합해야 정확 대조가 되고, 데이터 전진에 면역이 된다. 신선도는
    별도 단언이 진다 — 90일 넘게 재베이크가 없으면 그때는 진짜로 소리친다.
    """
    import datetime as dt

    from bigfoot.irs_curve.data import load_clean, spreads
    j = json.loads((OUT / "irs_curve_forecast.json").read_text("utf-8"))
    wm = j["quotes_as_of"]
    sp = spreads(load_clean()).loc[:wm]
    assert len(sp), f"데이터가 워터마크({wm})까지 없다 — 베이크와 데이터를 같이 커밋했는가"
    ou = satellite.fit_ou(sp)
    for tenor, p in ou.items():
        assert 0.0 < p["phi_daily"] < 1.0
        assert 0.0 < p["phi_quarterly"] < 1.0
        shipped = j["spread_satellite"]["ou"][tenor]
        assert abs(shipped["mu_bp"] - p["mu_bp"]) < 0.05, tenor
        assert abs(shipped["phi_daily"] - p["phi_daily"]) < 1e-3, tenor
    # 신선도 — 워터마크가 90일 뒤처지면 산출물이 죽은 것이다(락 면역과 별개).
    staleness = (dt.date.today() - dt.date.fromisoformat(wm)).days
    assert staleness < 90, f"forecast 산출물이 {staleness}일 낡았다 — 재베이크 필요"


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
