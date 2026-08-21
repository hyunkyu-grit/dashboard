# -*- coding: utf-8 -*-
"""Phase-3 deliverable runner: final IRFs, chart, summary contract.

python -m bigfoot.solve.phase3
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from bigfoot.solve.irf import SHOCKS, run_all, scorecard
from bigfoot.solve.system import WIRING_FLAGS

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"

# final configuration (phase3_debug_log.md) — 12/13
# 2026-08-21 — the four phillips levers are gone. eq (23)/(24) are printed
# on paper pp.25-26 and are now wired as printed, so there is nothing to
# permute (`phillips_perm`) and no expectation to bolt on (`phillips_exp*`).
# What is left here are the levers the paper genuinely does not pin.
FINAL_OPTIONS = {"oil_sign": -1.0,
                 "qrate_cons": False, "qrate_debt": False,
                 "pac_beta": 0.99, "core_form": "dev",
                 "us_shock_impl": "imposed"}   # SHOCK_IMPL_B_IMPOSED (4.8)
FINAL_EQ24 = "paper"
# Phase-3.1 Step 3: the photographed (A.1) explicit EC form (free A0,
# estimated on level differences) was implemented and run — still 12/13,
# and the sole miss WORSENS (A CPI trough -0.0788 -> -0.0866, away from the
# band floor) while every other metric moves < 0.003.  Adopting it would
# only degrade the one failing metric, so core_form stays "dev"; the
# estimator remains available via options["core_form"] = "a1_ec".
A1_EC_RESULT = {"tried": True, "adopted": False,
                "cpi_trough_dev": -0.0788, "cpi_trough_a1_ec": -0.0866,
                "note": "sole miss worsens under FORM_A1_EC; others ~flat"}
# Tag rule (Phase-3.1, declared in advance, binding): 13/13 after Step 1 or
# Step 3 -> v1-paper-faithful; still 12/13 after both -> v1-waiver + the
# caveat below, then STOP.
WAIVER_CAVEAT = ("A CPI trough -0.079pp vs self-constructed band floor "
                 "-0.07 (paper point estimate 'up to 0.05pp'); all other "
                 "metrics and shapes pass")
# Phase-4.8 FINAL re-pin (SUPERSEDES 4.7's 1.4; tp/sync lane CLOSED by
# declaration): IRF B now runs SHOCK_IMPL_B_IMPOSED (+25bp exogenized 1q,
# rule resumes — a 25bp-shock anchor sees an actual 25bp move,
# kernel-family-consistent). us10y peak +0.0567; the grid pins INTERIOR
# at 1.05 (KR10y peak +0.0594 vs +0.06), scorecard 12/13 all shapes ->
# ADOPTED. The owner's pre-registered prediction [0.70, 0.75] did NOT
# hold — FINDING: the prediction assumed the imposed one-off would show
# pyfrbus's 10y response (+0.083), but the RULE-RESUMPTION dynamics stay
# QPM's (hard easing from q3, i trough -0.195), leaving the one-off 10y
# ~31% below the pyfrbus family. The residual mismatch lives in the
# untouchable SOURCE_QPM2008 rule persistence, not the shock
# implementation. History: Phase-3 boundary-degenerate (refused); 4.5
# 0.55 (AR(1), superseded); 4.7 1.4 (out-of-family doubling, superseded).
BETA_SYNC_ADOPTED = 1.05
SYNC_PIN_RESULT = {"grid_argmin": 1.05, "kr10y_peak_at_argmin": 0.0594,
                   "target": 0.06, "adopted": BETA_SYNC_ADOPTED,
                   "degenerate": False, "interior": True,
                   "phase": "4.8 (imposed IRF-B, FINAL)",
                   "prediction_0.70_0.75": "OUTSIDE — see debug log"}

ACTIVE_FLAGS = [
    "SOURCE_QPM2008", "PLACEHOLDER_RW",
    "CALIBRATED_LW", "RESOLVED_A13", "CALIBRATED_BETA", "PROVISIONAL_PHILLIPS",
    "FORM_SWITCH_EQ24=nested", "EXOG_V1", "SIGN_NOTE",
    "WIRING_PHILLIPS_EXP", "WIRING_OIL_SIGN=-1",
    # Phase 4.7: tp_us = FIR kernel on the policy-deviation history, fitted
    # to pyfrbus across shock shapes with an out-of-sample holdout
    # (supersedes 4.5's CALIBRATED_PYFRBUS + SOURCE_PYFRBUS_PASSTHROUGH);
    # kernel is linear, fitted on shocks up to 100bp x 4q — extrapolation
    # beyond that magnitude/persistence unvalidated; QPM-internal IRFs
    # drive it out-of-family (IRF-B caveat)
    "FORM_TP_FIR", "CALIBRATED_PYFRBUS_KERNEL", "TP_TRUTH_PYFRBUS",
    # Phase 4.8 (FINAL tp/sync round): IRF-B shock imposed (not a QPM rule
    # innovation) so the anchor sees an actual 25bp move; beta_sync 1.05
    "SHOCK_IMPL_B_IMPOSED", "SYNC_REPINNED_ADOPTED=1.05",
    "FORM_A1_EC_TRIED_NOT_ADOPTED",
    # paper eqs (11)(14)(19)(22)(30)(32) carry expectation sums; in v1 only
    # consumption (eq 8) is PAC-wired — the rest run as plain ECM growth
    "PLAIN_ECM_NON_CONSUMPTION",
] + WIRING_FLAGS

# chart palette (reference dataviz palette, as in earlier modules)
C_LINE, C_BAND = "#2a78d6", "rgba(42,120,214,0.10)"
SURFACE, PAGE, INK, INK2, MUTED = "#fcfcfb", "#f9f9f7", "#0b0b0b", "#52514e", "#898781"
GRID, BASE = "#e1e0d9", "#c3c2b7"

PANELS = {           # (irf, var, title, band or None)
    "A": [("y_gap", "GDP갭 (pp)", (-0.09, -0.05)),
          ("cpi_yoy", "CPI YoY (pp)", (-0.07, -0.03)),
          ("hpi", "주택가격 (%)", (-0.5, -0.3)),
          ("debt", "부채/GDP (pp)", (-0.4, -0.2))],
    "B": [("y_gap", "GDP갭 (pp)", (-0.06, -0.02)),
          ("cpi_yoy", "CPI YoY (pp)", None),
          ("kr10y", "KR 10y (pp, 캘리브레이션)", None),
          ("s", "환율 log% (+=절하)", None)],
    "C": [("cpi_yoy", "CPI YoY (pp)", (0.12, 0.20)),
          ("y_gap", "GDP갭 (pp)", (-0.07, -0.03)),
          ("c", "소비 (%)", (-0.11, -0.05)),
          ("i_kr", "기준금리 (pp)", None)],
}
SHOCK_TITLES = {"A": "A. 국내 정책금리 +25bp",
                "B": "B. 미국 정책금리 +25bp",
                "C": "C. 유가 +10%"}


def render(results: dict) -> None:
    fig = make_subplots(
        rows=3, cols=4, vertical_spacing=0.10, horizontal_spacing=0.06,
        subplot_titles=[f"{SHOCK_TITLES[irf].split('.')[0]}: {t}"
                        for irf in "ABC" for _, t, _b in PANELS[irf]])
    x = list(range(24))
    for i, irf in enumerate("ABC"):
        for j, (var, _title, band) in enumerate(PANELS[irf]):
            row, col = i + 1, j + 1
            y = results[irf]["korea"][var]
            # NB: trace FIRST — add_hrect/add_hline(row=..) silently no-op
            # on a subplot that has no trace yet (plotly 6.9)
            fig.add_trace(go.Scatter(
                x=x, y=y, mode="lines", line=dict(color=C_LINE, width=2),
                showlegend=False,
                hovertemplate="q%{x}: %{y:.4f}<extra></extra>"),
                row=row, col=col)
            if band is not None:
                fig.add_hrect(y0=band[0], y1=band[1], line_width=0,
                              fillcolor="rgba(42,120,214,0.16)", layer="below",
                              row=row, col=col)
            fig.add_hline(y=0, line=dict(color=BASE, width=1), row=row, col=col)
            if band is not None:      # keep the whole band visible
                lo = min(float(np.min(y)), band[0], 0.0)
                hi = max(float(np.max(y)), band[1], 0.0)
                pad = 0.08 * (hi - lo)
                fig.update_yaxes(range=[lo - pad, hi + pad], row=row, col=col)
    fig.update_layout(
        template="none", height=900, width=1240,
        paper_bgcolor=SURFACE, plot_bgcolor=SURFACE,
        font=dict(family='system-ui, -apple-system, "Segoe UI", sans-serif',
                  color=INK, size=11),
        margin=dict(l=50, r=24, t=54, b=36))
    fig.update_xaxes(gridcolor=GRID, linecolor=BASE, tickfont=dict(color=MUTED))
    fig.update_yaxes(gridcolor=GRID, linecolor=BASE, tickfont=dict(color=MUTED))
    for a in fig.layout.annotations:
        a.font = dict(size=11.5, color=INK2)

    header = f"""
    <div style="max-width:1240px;margin:0 auto;padding:16px 8px 4px;
                font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:{INK}">
      <h1 style="font-size:19px;margin:0 0 6px">BIGFOOT Phase 3 — IRF 검증
        <span style="font-weight:400;color:{INK2}">vs BOK WP 2025-3 Fig.18-20 밴드
        (음영 = 페이퍼 밴드) · {date.today().isoformat()}</span></h1>
      <div style="font-size:12px;color:{INK2};line-height:1.5">
        스코어카드 12/13 → <b>v1-waiver</b> (유일 미스: A CPI 트로프 −0.079 vs [−0.07,−0.03]) ·
        Phase 3.1: PAC 기대항 = A.11–A.16 정확 가중치(RESOLVED_A13) · A.1 EC형 미채택(토글) ·
        <b>Phase 4.7–4.8: tp_us = FIR 커널(홀드아웃 0.4bp) + IRF-B 부과형 쇼크
        (SHOCK_IMPL_B_IMPOSED) → β_sync 내부 핀 1.05 채택, tp/sync 레인 종결</b>
        (KR10y 피크 +0.059 vs 앵커 +0.06; 사전등록 예측 [0.70,0.75] 밖 — QPM 룰 복귀
        동학이 잔여 요인) · KR10y는 캘리브레이션 대상이라 채점 제외<br>
        <span style="color:{MUTED}">활성 플래그: {", ".join(ACTIVE_FLAGS[:9])} 외 —
        전체는 irf_summary.json caveats · 시도 이력: phase3_debug_log.md</span>
      </div>
    </div>"""
    body = fig.to_html(full_html=False, include_plotlyjs=True,
                       config={"displaylogo": False})
    html = (f"<!DOCTYPE html><html lang='ko'><head><meta charset='utf-8'>"
            f"<title>BIGFOOT IRF validation</title></head>"
            f"<body style='margin:0;background:{PAGE}'>{header}"
            f"<div style='max-width:1240px;margin:0 auto'>{body}</div></body></html>")
    (OUT / "irf_charts.html").write_text(html, encoding="utf-8")


def main() -> None:
    results = run_all(beta_sync=BETA_SYNC_ADOPTED, eq24_form=FINAL_EQ24,
                      options=FINAL_OPTIONS)
    rows = scorecard(results)
    # A.11-A.16 exact-weight diagnostics (same for every shock: rebuilt
    # per system but deterministic given coefficients)
    from bigfoot.solve.system import BigfootSystem
    pac_info = BigfootSystem(beta_sync=BETA_SYNC_ADOPTED,
                             eq24_form=FINAL_EQ24,
                             options=FINAL_OPTIONS).pac_info
    n_pass = sum(r["pass"] for r in rows)
    diags = {irf: results[irf]["diagnostics"]["max_iter_used"]
             for irf in results}

    render(results)

    full = n_pass == len(rows)
    summary = {
        "module": "irf_validation",
        "as_of": date.today().isoformat(),
        "headline": {"passed": n_pass, "total": len(rows),
                     "tag": "v1-paper-faithful" if full else "v1-waiver",
                     "beta_sync_pinned": BETA_SYNC_ADOPTED,
                     "beta_sync_pin": SYNC_PIN_RESULT,
                     "form_a1_ec": A1_EC_RESULT},
        "metrics": [
            {"irf": r["irf"], "metric": r["metric"], "value": r["value"],
             "band": r["band"], "pass": r["pass"]} for r in rows],
        "solver": {"max_iterations_per_period": diags,
                   "tolerance": 1e-8, "damping": 0.6},
        "pac_exact_a13": {"consumption": pac_info},
        "caveats": ACTIVE_FLAGS,
    }
    if not full:
        summary["waiver"] = WAIVER_CAVEAT
    js = json.dumps(summary, indent=2, ensure_ascii=False)
    (OUT / "irf_summary.json").write_text(js, encoding="utf-8")
    print(js)
    print(f"\nwrote {OUT / 'irf_charts.html'}, {OUT / 'irf_summary.json'}")
    print(f"scorecard {n_pass}/{len(rows)} -> tag "
          f"{'v1-paper-faithful' if full else 'v1-waiver (per Phase-3.1 rule)'}")


if __name__ == "__main__":
    main()
