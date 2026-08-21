# -*- coding: utf-8 -*-
"""Phase-5b Step 3 — the IRS curve assembler (THE product).

python -m bigfoot.irs_curve.assembler   (writes output/irs_curve_forecast
                                         .json + .html)

IRS_tau forecast at horizon h =
    current IRS_tau
  + [avg expected CD over the next tau years, starting at h] - [same at 0]
        (the engine's contribution, via cd_layer on a quarterly policy
         path in LEVELS)
  + [OU spread mean-reversion path at h] - [latest spread]
        (SPREAD_V1_OU satellite; band = empirical h-step change quantiles)

model_minus_market_bp (per tenor) = mu_trimmed - latest spread: how far
the current swap spread sits from the satellite's equilibrium — positive
means the spread side alone pulls the IRS UP as it normalizes.

Scenarios: "baseline" (policy flat at the current base rate — the
engine's zero-deviation path in levels) and "us_hfl" (base rate + the
v1.3 HFL conditional i_kr deviations, quarterly).
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from bigfoot.cd_layer.adapter import BDAYS_PER_Q, policy_path_to_cd
from bigfoot.irs_curve import satellite
from bigfoot.irs_curve.data import KTB_LEGS, load_clean, spreads

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"

TENOR_Y = {"1y": 1, "2y": 2, "3y": 3, "5y": 5, "10y": 10}
HORIZONS = {"f3m": 1, "f6m": 2, "f12m": 4}          # quarters
IRS_COL = {t: f"irs_{t}" for t in TENOR_Y}

CAVEATS = [
    "SPREAD_V1_OU: swap spread = per-tenor OU mean reversion, no "
    "structural drivers (supply/hedging flows out of scope in v1); "
    "uncertainty band = empirical 10/90 quantiles of h-step spread "
    "changes (stress episodes included, non-Gaussian)",
    "CD_STALENESS: cd_layer estimates ride quotes with ~82% zero-change "
    "days; anticipation/jump timing is coarse at the day level",
    "KERNEL_DOMAIN: the engine's US-side tp kernel is fitted on shocks "
    "up to 100bp x 4q (imposed paths); extrapolation beyond unvalidated",
    "BETA_SYNC_SCALE: KR 10y sync loading 1.05 pinned on the imposed-shock "
    "IRF-B anchor; one-off 10y sits ~31% below the pyfrbus family "
    "(QPM rule-resumption dynamics, untouchable)",
    "KTB_2Y_SHORT_SAMPLE: 2y spread history starts 2021-03",
    "ENGINE_QUARTERLY: policy paths are quarterly; changes placed on the "
    "first business day of each quarter (cd_layer convention)",
    "POLICY_TAIL_DECAY_085: HFL deviations beyond the engine's T=24 decay "
    "at the rule smoothing 0.85/quarter (long-tenor averages only)",
    "V1_NO_TERM_PREMIUM_IN_IRS: the assembler prices IRS as expected-CD "
    "average + OU spread only; the engine's tp/sync channel (KTB 10y "
    "+43bp peak under HFL) is NOT passed into the IRS leg in v1, so "
    "long-tenor HFL forecasts are conservative and the implied IRS-KTB "
    "spread tightens mechanically under US shocks",
]


def _cd_avg(cd_daily: np.ndarray, start_q: int, tenor_years: int) -> float:
    """Mean CD over [start, start + tenor] (business days), holding the
    path's terminal value flat beyond its end."""
    a = start_q * BDAYS_PER_Q
    b = a + tenor_years * 4 * BDAYS_PER_Q
    path = cd_daily
    if b > len(path):
        path = np.concatenate([path, np.full(b - len(path), path[-1])])
    return float(path[a:b].mean())


def engine_contribution(policy_q: np.ndarray, tenor_years: int,
                        h_q: int) -> float:
    """[avg expected CD over tau at h] - [same at 0] (pp)."""
    cd = policy_path_to_cd(policy_q, params={"spread": 0.0})["daily"]
    return _cd_avg(cd, h_q, tenor_years) - _cd_avg(cd, 0, tenor_years)


HFL_24Q_CACHE = OUT / "hfl_policy_24q.json"
PHI_I_TAIL = 0.85               # rule smoothing; POLICY_TAIL_DECAY_085


def _hfl_dev_24q() -> np.ndarray:
    """Full T=24 conditional i_kr deviation path (the hfl_conditional.json
    contract stores only the 12q window — a snap-back to baseline at q13
    would corrupt the 3y+ tenor averages). Built once from the engine and
    cached as a derived, committable input."""
    if HFL_24Q_CACHE.exists():
        return np.array(json.loads(
            HFL_24Q_CACHE.read_text(encoding="utf-8"))["i_kr_dev"])
    from bigfoot.conditional.hfl import load_hfl_conditions
    from bigfoot.conditional.invert import conditional_forecast
    from bigfoot.solve.phase3 import (BETA_SYNC_ADOPTED, FINAL_EQ24,
                                      FINAL_OPTIONS)
    from bigfoot.solve.system import BigfootSystem
    cond, _q = load_hfl_conditions()
    sys_ = BigfootSystem(beta_sync=BETA_SYNC_ADOPTED, eq24_form=FINAL_EQ24,
                         T=24, options=FINAL_OPTIONS)
    out = conditional_forecast("us_block", cond, mode="exact", T=24,
                               system=sys_)
    dev = [round(float(x), 5) for x in out["korea"]["i_kr"]]
    HFL_24Q_CACHE.write_text(json.dumps(
        {"module": "hfl_policy_24q", "source": "v1.3 HFL conditional, T=24",
         "i_kr_dev": dev}, indent=2), encoding="utf-8")
    return np.array(dev)


def scenario_paths(base_rate_now: float, horizon_q: int = 44) -> dict:
    """Quarterly policy LEVEL paths per scenario. Beyond the engine's T=24,
    deviations decay at the rule smoothing phi_i = 0.85/quarter
    (POLICY_TAIL_DECAY_085) so long-tenor averages see no cliff."""
    flat = np.full(horizon_q, base_rate_now)
    dev24 = _hfl_dev_24q()
    dev = np.zeros(horizon_q)
    dev[: len(dev24)] = dev24
    for j in range(len(dev24), horizon_q):
        dev[j] = dev[j - 1] * PHI_I_TAIL
    return {"baseline": flat, "us_hfl": flat + dev}


def assemble() -> dict:
    clean = load_clean()
    sp = spreads(clean)
    ou = satellite.fit_ou(sp)
    mom = satellite.moments(sp)
    stress = satellite.stress_excursions(sp)

    base_rate_now = 2.75            # 722Y001 latest (2026-07-16 hike)
    paths = scenario_paths(base_rate_now)
    asof = str(clean.index[-1].date())

    scenarios = {}
    for scen, pol in paths.items():
        rows = {}
        for tenor, ty in TENOR_Y.items():
            cur = float(clean[IRS_COL[tenor]].iloc[-1])
            s_now = ou[tenor]["latest"]
            row = {"current": round(cur, 4)}
            for hname, hq in HORIZONS.items():
                eng = engine_contribution(pol, ty, hq)
                spr = satellite.forecast_path(ou, tenor, hq * 63) - s_now
                fc = cur + eng + spr
                lo, hi = satellite.band(sp, tenor, hq * 63)
                row[hname] = round(fc, 4)
                row[hname + "_band"] = [round(fc + lo, 4), round(fc + hi, 4)]
                row[hname + "_engine_bp"] = round(eng * 100, 1)
                row[hname + "_spread_bp"] = round(spr * 100, 1)
            row["model_minus_market_bp"] = round(
                ou[tenor]["mu_bp"] - s_now * 100, 1)
            rows[tenor] = row
        scenarios[scen] = rows

    out = {
        "module": "irs_curve_forecast",
        "as_of": date.today().isoformat(),
        "quotes_as_of": asof,
        "base_rate_now": base_rate_now,
        "tenors": list(TENOR_Y),
        "horizons_quarters": HORIZONS,
        "scenarios": scenarios,
        "spread_satellite": {"ou": {k: {kk: vv for kk, vv in v.items()
                                        if kk != "latest"}
                                    for k, v in ou.items()},
                             "moments": mom,
                             "stress_excursions": stress},
        "ktb_legs": {k: v[2] for k, v in KTB_LEGS.items()},
        "caveats": CAVEATS,
    }
    (OUT / "irs_curve_forecast.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    render(out)
    return out


# ------------------------------------------------------------------ chart
C_CUR, C_BASE, C_HFL = "#898781", "#2a78d6", "#eb6834"
SURFACE, PAGE, INK, INK2, MUTED = ("#fcfcfb", "#f9f9f7", "#0b0b0b",
                                   "#52514e", "#898781")
GRID, BASE_C = "#e1e0d9", "#c3c2b7"


def render(out: dict) -> None:
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    tenors = out["tenors"]
    xs = [TENOR_Y[t] for t in tenors]
    fig = make_subplots(rows=1, cols=2, horizontal_spacing=0.08,
                        subplot_titles=("기준 시나리오", "미국 HFL 조건부"))
    for col, scen in ((1, "baseline"), (2, "us_hfl")):
        rows = out["scenarios"][scen]
        cur = [rows[t]["current"] for t in tenors]
        f12 = [rows[t]["f12m"] for t in tenors]
        lo = [rows[t]["f12m_band"][0] for t in tenors]
        hi = [rows[t]["f12m_band"][1] for t in tenors]
        fig.add_trace(go.Scatter(
            x=xs + xs[::-1], y=hi + lo[::-1], fill="toself", mode="lines",
            fillcolor="rgba(42,120,214,0.10)" if scen == "baseline"
            else "rgba(235,104,52,0.10)",
            line=dict(width=0), showlegend=False, hoverinfo="skip"),
            row=1, col=col)
        fig.add_trace(go.Scatter(
            x=xs, y=cur, mode="lines+markers", name="현재",
            line=dict(color=C_CUR, width=2, dash="dot"),
            marker=dict(size=7), showlegend=(col == 1),
            hovertemplate="%{x}y: %{y:.3f}%<extra>현재</extra>"),
            row=1, col=col)
        fig.add_trace(go.Scatter(
            x=xs, y=f12, mode="lines+markers", name="12개월 전망",
            line=dict(color=C_BASE if scen == "baseline" else C_HFL,
                      width=2.2),
            marker=dict(size=7), showlegend=(col == 1),
            hovertemplate="%{x}y: %{y:.3f}%<extra>12m</extra>"),
            row=1, col=col)
    fig.update_layout(
        template="none", height=440, width=1240,
        paper_bgcolor=SURFACE, plot_bgcolor=SURFACE,
        font=dict(family='system-ui, -apple-system, "Segoe UI", sans-serif',
                  color=INK, size=11),
        legend=dict(orientation="h", y=1.14, x=0.0, font=dict(color=INK2)),
        margin=dict(l=54, r=24, t=64, b=44))
    fig.update_xaxes(gridcolor=GRID, linecolor=BASE_C,
                     tickfont=dict(color=MUTED), title_text="테너 (년)",
                     title_font=dict(size=11, color=MUTED),
                     tickvals=xs)
    fig.update_yaxes(gridcolor=GRID, linecolor=BASE_C,
                     tickfont=dict(color=MUTED), ticksuffix="%")
    for a in fig.layout.annotations:
        a.font = dict(size=12, color=INK2)

    b = out["scenarios"]["baseline"]
    h = out["scenarios"]["us_hfl"]
    tbl_rows = "".join(
        f"<tr><td>{t}</td>"
        f"<td style='text-align:right'>{b[t]['current']:.3f}</td>"
        f"<td style='text-align:right'>{b[t]['f3m']:.3f}</td>"
        f"<td style='text-align:right'>{b[t]['f6m']:.3f}</td>"
        f"<td style='text-align:right'>{b[t]['f12m']:.3f}</td>"
        f"<td style='text-align:right;color:{INK2}'>{b[t]['model_minus_market_bp']:+.0f}</td>"
        f"<td style='text-align:right;color:{C_HFL}'>{h[t]['f12m']:.3f}</td></tr>"
        for t in out["tenors"])
    header = f"""
    <div style="max-width:1240px;margin:0 auto;padding:16px 8px 4px;
                font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:{INK}">
      <h1 style="font-size:19px;margin:0 0 6px">KRW IRS 커브 전망 — BIGFOOT 프로덕트
        <span style="font-weight:400;color:{INK2}">엔진 정책경로 → CD 어댑터 → 스프레드 위성 ·
        호가 {out['quotes_as_of']} · {date.today().isoformat()}</span></h1>
      <table style="border-collapse:collapse;font-size:12px;margin:6px 0">
        <tr style="color:{INK2};border-bottom:1px solid {GRID}">
          <th style="text-align:left;padding:3px 14px 3px 0">테너</th>
          <th style="padding:3px 14px 3px 0">현재</th>
          <th style="padding:3px 14px 3px 0">3M</th>
          <th style="padding:3px 14px 3px 0">6M</th>
          <th style="padding:3px 14px 3px 0">12M</th>
          <th style="padding:3px 14px 3px 0">모델−시장(bp)</th>
          <th style="padding:3px 14px 3px 0">HFL 12M</th></tr>
        {tbl_rows}
      </table>
      <div style="font-size:11px;color:{MUTED};line-height:1.5">
        {'<br>'.join(out['caveats'][:4])}
      </div>
    </div>"""
    body = fig.to_html(full_html=False, include_plotlyjs=True,
                       config={"displaylogo": False})
    html = (f"<!DOCTYPE html><html lang='ko'><head><meta charset='utf-8'>"
            f"<title>KRW IRS curve forecast</title></head>"
            f"<body style='margin:0;background:{PAGE}'>{header}"
            f"<div style='max-width:1240px;margin:0 auto'>{body}</div>"
            f"</body></html>")
    (OUT / "irs_curve_forecast.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    o = assemble()
    for scen in ("baseline", "us_hfl"):
        print(f"--- {scen}")
        for t, r in o["scenarios"][scen].items():
            print(f"  {t:4s} cur {r['current']:.3f}  f3m {r['f3m']:.3f}  "
                  f"f6m {r['f6m']:.3f}  f12m {r['f12m']:.3f}  "
                  f"mm {r['model_minus_market_bp']:+.1f}bp")
