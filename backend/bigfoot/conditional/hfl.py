# -*- coding: utf-8 -*-
"""Phase-4 Step 3 — first desk deliverable: the conditional Korean rate path
under the pyfrbus higher-for-longer US scenario.

python -m bigfoot.conditional.hfl

Conditioning: the HFL DIFF paths (output/hfl_paths.csv, 12 quarters) are
imposed on the US block —  rff -> us_i, xgap2 -> us_y, picxfe -> us_pi —
via the exact Appendix-B inversion (us_is/us_pc/us_rule residuals move; the
US block continues model-consistently beyond the window for the EH 10y).
rg10 is NOT imposed: the sync/tp_us channel is degenerate until Phase 4.5
(TP_US_PENDING) — the KR 10y response is flagged UNDERSTATED.

Free Korean responses reported: policy rate, GDP gap, CPI YoY, KTB 3y
(EH-only construction), KTB 10y, USDKRW (log% dev, + = depreciation).

Sanity gate (report, don't tune): the KR GDP-gap trough is compared with
IRF B x (HFL US-gap trough / IRF-B US-gap trough); a raw ratio beyond 3-5x
of the IRF-B trough triggers a residual-magnitude dump + flag.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from bigfoot.conditional.invert import conditional_forecast
from bigfoot.solve.config import BETA_SYNC_ADOPTED, FINAL_EQ24, FINAL_OPTIONS
from bigfoot.solve.system import BigfootSystem

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"

SCENARIO = "us_hfl_100bp_4q"
T_SOLVE = 24          # solver horizon; the deliverable reports the 12q window
HEADLINE_Q = 4        # "12개월 시점" = 4 quarters after scenario start

# palette (project dataviz conventions; imposed panels wear muted gray by
# design — context, not a data series; every imposed panel is labeled)
C_KR, C_IMP = "#2a78d6", "#898781"
SURFACE, PAGE, INK, INK2, MUTED = ("#fcfcfb", "#f9f9f7", "#0b0b0b",
                                   "#52514e", "#898781")
GRID, BASE = "#e1e0d9", "#c3c2b7"

CAVEATS = [
    "FORM_TP_FIR / CALIBRATED_PYFRBUS_KERNEL / TP_TRUTH_PYFRBUS: US 10y = "
    "EH + FIR kernel on the imposed policy history (K=12, ridge-NNLS, fit "
    "on one-off 25bp + HFL 100bpx4q, holdout 50bpx2q mean |gap| 0.4bp); "
    "kernel is linear, fitted on shocks up to 100bp x 4q — extrapolation "
    "beyond that magnitude/persistence unvalidated. beta_sync interior "
    "pin 1.05 (Phase 4.8 FINAL, imposed-shock IRF-B anchor; tp/sync lane "
    "closed). rg10 NOT imposed: the model prices its own US 10y from the "
    "imposed short path (handshake gap reported)",
    "KR3Y_EH_ONLY: KTB 3y = 12q expectations-hypothesis mean of the domestic "
    "short-rate path (construction; no term/sync premium)",
    "DEV_SPACE_BASELINE_ZERO: model solves in deviations — baseline is the "
    "zero path, conditional == diff by construction",
    "RESID_PF_EXPECTATIONS / RESID_DEV_FORM: Sigma fitted on deviation-form "
    "historical residuals with perfect-foresight leads (footnote-31 normal "
    "approximation)",
]


def load_hfl_conditions() -> tuple:
    df = pd.read_csv(OUT / "hfl_paths.csv")
    piv = df.pivot(index="quarter", columns="variable", values="diff")
    piv = piv.sort_index()
    quarters = list(piv.index)
    cond = {"us_i": piv["rff"].values, "us_y": piv["xgap2"].values,
            "us_pi": piv["picxfe"].values}
    return cond, quarters


def kr3y_eh(sys_: BigfootSystem, korea: dict, T: int) -> np.ndarray:
    """EH 12-quarter mean readout from the solved state path (KR3Y_EH_ONLY)."""
    S, J = sys_.engine.S, sys_.engine._J()
    acc, P = np.zeros_like(S), np.eye(S.shape[0])
    for _ in range(12):
        acc += P
        P = P @ S
    w12 = (J @ (acc / 12.0))[2]
    lag = lambda k, t: korea[k][t - 1] if t >= 1 else 0.0
    out = np.zeros(T)
    for t in range(T):
        x_t = np.array([korea["pi_core"][t], korea["y_gap"][t],
                        korea["i_kr"][t], lag("pi_core", t),
                        lag("y_gap", t), lag("i_kr", t)])
        out[t] = float(w12 @ x_t)
    return out


def run() -> dict:
    cond, quarters = load_hfl_conditions()
    Tc = len(quarters)
    sys_ = BigfootSystem(beta_sync=BETA_SYNC_ADOPTED, eq24_form=FINAL_EQ24,
                         T=T_SOLVE, options=FINAL_OPTIONS)

    out = conditional_forecast("us_block", cond, mode="exact", T=T_SOLVE,
                               system=sys_)
    kr = out["korea"]
    kr3y = kr3y_eh(sys_, kr, T_SOLVE)

    # ---- sanity gate vs IRF B (report, don't tune)
    irf_b = sys_.solve({"us_rule_bp": 25.0})
    kr_trough = float(kr["y_gap"][:Tc].min())
    b_kr_trough = float(irf_b["korea"]["y_gap"].min())
    b_us_trough = float(irf_b["us"]["y"].min())
    hfl_us_trough = float(np.min(cond["us_y"]))
    raw_ratio = kr_trough / b_kr_trough
    us_input_ratio = hfl_us_trough / b_us_trough
    per_unit = raw_ratio / us_input_ratio if us_input_ratio else np.nan
    sanity = {
        "kr_gdp_gap_trough_pp": round(kr_trough, 4),
        "irf_b_kr_trough_pp": round(b_kr_trough, 4),
        "raw_ratio_vs_irf_b": round(raw_ratio, 2),
        "imposed_us_gap_trough": round(hfl_us_trough, 4),
        "irf_b_us_gap_trough": round(b_us_trough, 4),
        "us_input_ratio": round(us_input_ratio, 2),
        "per_unit_of_us_gap_ratio": round(per_unit, 2),
        "gate_3x_5x_raw": "ABOVE" if abs(raw_ratio) > 5 else (
            "INSIDE" if abs(raw_ratio) >= 3 else "BELOW"),
    }
    flags = list(CAVEATS)
    if abs(raw_ratio) > 5:
        u_dump = {k: {"max_abs": round(float(np.max(np.abs(v))), 4),
                      "max_abs_over_sigma": round(float(
                          np.max(np.abs(v)) / _sigma()[k]), 2)}
                  for k, v in out["adjusted_residuals"].items()}
        sanity["residual_magnitudes"] = u_dump
        flags.append(
            f"SANITY_RATIO_ABOVE_GATE: raw KR-gap ratio {raw_ratio:.1f}x "
            f"IRF-B exceeds the 3-5x band, but the IMPOSED US-gap trough is "
            f"itself {us_input_ratio:.1f}x IRF-B's US-gap trough (sustained "
            f"4q +100bp != 4x a one-off 25bp); per unit of imposed US gap "
            f"the KR response is {per_unit:.2f}x IRF B — reported, not tuned")

    # ---- handshake: model US 10y (EH + tp_us) vs pyfrbus rg10 diff
    df = pd.read_csv(OUT / "hfl_paths.csv")
    rg10_py = df[df["variable"] == "rg10"].sort_values("quarter")["diff"].values
    us10y_model = out["us"]["us10y"][:Tc]
    handshake = {
        "pyfrbus_rg10_diff_pp": [round(float(x), 4) for x in rg10_py],
        "model_us10y_pp": [round(float(x), 4) for x in us10y_model],
        "mean_abs_gap_bp": round(float(
            np.mean(np.abs(us10y_model - rg10_py))) * 100.0, 1),
        "note": "cross-check only, no gate — the two engines shaking hands",
    }

    # ---- lambda sensitivity (penalized mode; exact == lam 0 determined)
    lam_sens = {}
    for lam in (0.0, 0.5, 1.0):
        o = conditional_forecast("us_block", cond, mode="penalized", lam=lam,
                                 T=T_SOLVE, system=sys_)
        lam_sens[str(lam)] = {
            "kr_policy_12m_shift_bp": round(
                float(o["korea"]["i_kr"][HEADLINE_Q]) * 100.0, 1),
            "fit_max_abs_gap": round(float(o["fit_max_abs_gap"]), 6),
            "penalty_neg_log_f": round(float(o["penalty_neg_log_f"]), 3),
        }

    shift_bp = round(float(kr["i_kr"][HEADLINE_Q]) * 100.0, 1)
    headline = {
        # single source of truth for every surface (hub + this module's
        # HTML render the IDENTICAL string; drift test in tests/test_hub.py)
        "sentence_ko": (f"연준이 SEP 대비 4분기간 +100bp 높게 가면, "
                        f"모형 정합적 국내 기준금리 경로는 12개월 시점 "
                        f"{shift_bp:+.0f}bp 이동합니다."),
        "kr_policy_12m_shift_bp": shift_bp,
        "kr_gdp_gap_peak_pp": round(float(
            kr["y_gap"][:Tc][np.argmax(np.abs(kr["y_gap"][:Tc]))]), 4),
        "kr_cpi_peak_pp": round(float(
            kr["cpi_yoy"][:Tc][np.argmax(np.abs(kr["cpi_yoy"][:Tc]))]), 4),
        "definition": ("12m shift = conditional i_kr deviation at quarter "
                       f"index {HEADLINE_Q} ({quarters[HEADLINE_Q]}), bp; "
                       "peaks = signed extrema over the 12q window"),
    }

    var_paths = {
        "us_i": out["us"]["i"], "us_y": out["us"]["y"], "us_pi": out["us"]["pi"],
        "i_kr": kr["i_kr"], "y_gap": kr["y_gap"], "cpi_yoy": kr["cpi_yoy"],
        "kr3y": kr3y, "kr10y": kr["kr10y"], "s": kr["s"],
    }
    paths = {
        v: [{"quarter": q, "baseline": 0.0,
             "conditional": round(float(arr[i]), 5),
             "diff": round(float(arr[i]), 5)}
            for i, q in enumerate(quarters)]
        for v, arr in var_paths.items()
    }

    summary = {
        "module": "conditional_forecast",
        "scenario": SCENARIO,
        "as_of": date.today().isoformat(),
        "group": "us_block", "mode": "exact",
        "lambda": 0.0,
        "headline": headline,
        "paths": paths,
        "adjusted_residuals": {k: [round(float(x), 5) for x in v]
                               for k, v in out["adjusted_residuals"].items()},
        "penalty_neg_log_f": round(float(out["penalty_neg_log_f"]), 3),
        "lambda_sensitivity": lam_sens,
        "sanity_gate": sanity,
        "handshake_us10y": handshake,
        "caveats": flags,
    }
    (OUT / "hfl_conditional.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    render(summary, quarters, var_paths, kr3y, Tc)
    return summary


def _sigma() -> dict:
    from bigfoot.conditional.invert import load_sigma
    return load_sigma()


# ------------------------------------------------------------------ chart
PANELS = [  # (key, title, imposed?)
    ("us_i", "미국 정책금리 (pp, 부과)", True),
    ("us_y", "미국 GDP갭 (pp, 부과)", True),
    ("us_pi", "미국 근원 인플레이션 (pp, 부과)", True),
    ("i_kr", "국내 기준금리 (pp)", False),
    ("y_gap", "국내 GDP갭 (pp)", False),
    ("cpi_yoy", "국내 CPI YoY (pp)", False),
]


def render(summary: dict, quarters: list, var_paths: dict,
           kr3y: np.ndarray, Tc: int) -> None:
    # plotly 는 **여기 안에서만** import 한다. 모듈 스코프에 두면 이 파일을
    # `load_hfl_conditions` 하나 때문에 import 하는 런타임 경로
    # (`irs_curve/assembler.py`)가 그래프 라이브러리를 같이 끌고 온다
    # (2026-08-21 P4 §C.7(b)). `cd_layer/study.py` 와 `irs_curve/assembler.py`
    # 가 이미 같은 모양이다.
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    # single source of truth — rendered VERBATIM (drift test vs the hub)
    sentence = summary["headline"]["sentence_ko"]
    fig = make_subplots(rows=2, cols=3, vertical_spacing=0.14,
                        horizontal_spacing=0.07,
                        subplot_titles=[t for _, t, _i in PANELS])
    for idx, (key, _title, imposed) in enumerate(PANELS):
        row, col = idx // 3 + 1, idx % 3 + 1
        y = var_paths[key][:Tc]
        fig.add_trace(go.Scatter(
            x=quarters, y=y, mode="lines",
            line=dict(color=C_IMP if imposed else C_KR, width=2,
                      dash="dot" if imposed else "solid"),
            showlegend=False,
            hovertemplate="%{x}: %{y:.3f}<extra></extra>"), row=row, col=col)
        fig.add_hline(y=0, line=dict(color=BASE, width=1), row=row, col=col)
    fig.update_layout(
        template="none", height=560, width=1240,
        paper_bgcolor=SURFACE, plot_bgcolor=SURFACE,
        font=dict(family='system-ui, -apple-system, "Segoe UI", sans-serif',
                  color=INK, size=11),
        margin=dict(l=50, r=24, t=40, b=40))
    fig.update_xaxes(gridcolor=GRID, linecolor=BASE,
                     tickfont=dict(color=MUTED), tickangle=0, nticks=6)
    fig.update_yaxes(gridcolor=GRID, linecolor=BASE, tickfont=dict(color=MUTED))
    for a in fig.layout.annotations:
        a.font = dict(size=11.5, color=INK2)

    # KTB / FX readout table (12m point + window extremum)
    rows = []
    for key, label, unit in [("kr3y", "KTB 3y (EH-only)", "pp"),
                             ("kr10y", "KTB 10y (FIR tp + sync 1.05)", "pp"),
                             ("s", "USDKRW (log%, +=절하)", "%")]:
        arr = var_paths[key][:Tc]
        ext = float(arr[np.argmax(np.abs(arr))])
        rows.append(f"<tr><td>{label}</td>"
                    f"<td style='text-align:right'>{arr[HEADLINE_Q]:+.3f}</td>"
                    f"<td style='text-align:right'>{ext:+.3f}</td>"
                    f"<td style='color:{MUTED}'>{unit}</td></tr>")
    sens = summary["lambda_sensitivity"]
    sens_line = " · ".join(
        f"λ={k}: {v['kr_policy_12m_shift_bp']:+.1f}bp" for k, v in sens.items())
    gate = summary["sanity_gate"]

    header = f"""
    <div style="max-width:1240px;margin:0 auto;padding:16px 8px 4px;
                font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:{INK}">
      <h1 style="font-size:19px;margin:0 0 6px">HFL 조건부 전망 — 국내 금리 경로
        <span style="font-weight:400;color:{INK2}">Appendix B 잔차 역산 ·
        {SCENARIO} · {date.today().isoformat()}</span></h1>
      <div style="font-size:14px;font-weight:600;margin:2px 0 8px">
        {sentence}
      </div>
      <div style="font-size:12px;color:{INK2};line-height:1.5">
        회색 점선 = pyfrbus HFL 경로 부과(rg10은 모형 자체 프라이싱 —
        US10y 핸드셰이크 평균 |갭| {summary['handshake_us10y']['mean_abs_gap_bp']:.0f}bp) ·
        파랑 = 모형 정합적 국내 반응 · 조건화 창 12분기, 이후 모형 자율 지속<br>
        <span style="color:{MUTED}">GDP갭 트로프 {gate['kr_gdp_gap_trough_pp']}pp
        = IRF B의 {gate['raw_ratio_vs_irf_b']}x (부과된 미국 갭 자체가 IRF B의
        {gate['us_input_ratio']}x — 미국 갭 단위당 {gate['per_unit_of_us_gap_ratio']}x) ·
        λ 민감도(페널티 모드): {sens_line}</span>
      </div>
    </div>"""
    table = f"""
    <div style="max-width:1240px;margin:0 auto;padding:0 8px 16px;
                font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
      <table style="border-collapse:collapse;font-size:12px;color:{INK}">
        <tr style="color:{INK2};border-bottom:1px solid {GRID}">
          <th style="text-align:left;padding:4px 16px 4px 0">금리·환율 반응</th>
          <th style="text-align:right;padding:4px 16px 4px 0">12개월 시점</th>
          <th style="text-align:right;padding:4px 16px 4px 0">창 내 극값</th><th></th></tr>
        {''.join(rows)}
      </table>
      <div style="font-size:11px;color:{MUTED};margin-top:10px;line-height:1.5">
        {'<br>'.join(summary['caveats'])}
      </div>
    </div>"""
    body = fig.to_html(full_html=False, include_plotlyjs=True,
                       config={"displaylogo": False})
    html = (f"<!DOCTYPE html><html lang='ko'><head><meta charset='utf-8'>"
            f"<title>HFL conditional forecast</title></head>"
            f"<body style='margin:0;background:{PAGE}'>{header}"
            f"<div style='max-width:1240px;margin:0 auto'>{body}</div>"
            f"{table}</body></html>")
    (OUT / "hfl_conditional.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    s = run()
    print(json.dumps({k: s[k] for k in
                      ("headline", "sanity_gate", "lambda_sensitivity",
                       "penalty_neg_log_f")},
                     indent=2, ensure_ascii=False))
    print(f"wrote {OUT / 'hfl_conditional.json'}, "
          f"{OUT / 'hfl_conditional.html'}")
