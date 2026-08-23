# -*- coding: utf-8 -*-
"""엔진이 **결정된 것**으로 딛고 서는 상수 — 순수 데이터, import 없음.

## 왜 파일이 따로인가

이 상수들은 원래 `bigfoot/solve/phase3.py` 에 살았다. 그런데 그 모듈은
**차트를 그리는 모듈**이라 모듈 스코프에서 plotly 를 끌고 온다. 그래서 기저를
굽는 런타임 경로(`scenario_basis/build.py` · `conditional/hfl.py` ·
`irs_curve/assembler.py` · `wiring/edges.py` · `wiring/surfaces.py`)가 전부
「최종 옵션 셋을 읽으려고 그래프 라이브러리를 import 하는」 모양이었다
(2026-08-21 P4 진단 §C.7(b)).

여기는 **아무것도 import 하지 않는다.** 그것이 이 파일의 계약이다 — 값이
늘어나는 것은 괜찮고, import 가 한 줄이라도 생기면 그 계약이 깨진다.
`phase3.py` 는 이 값들을 그대로 재수출하므로 예전 경로도 계속 산다.

값의 유래·기각 기록은 옮기면서 한 글자도 안 고쳤다.
"""
from __future__ import annotations

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
