# -*- coding: utf-8 -*-
"""Phase-6b — Python REFERENCE for the lab's scenario recombination and
curve-replay sampling (INTERNAL; the krw-fi-pms export contract was
retired mid-phase by owner amendment — no export surface exists).

The lab's embedded JS implements the same pure functions; tests execute
that JS block under node and assert value parity against this module
(tolerance 1e-9). Replay frames: 13 monthly snapshots D+0..D+360 at
30-day intervals, monotone piecewise-linear-sampled from the quarterly
path (nodes at day q*91.3125, 0 at D+0) — a declared display-side
assumption; frame-to-frame tweening in the lab is visual only.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"

DAY_GRID = list(range(0, 361, 30))          # 13 replay frames
Q_DAYS = 91.3125
KTB_TENORS = ("3y", "10y")
IRS_TENORS = ("1y", "2y", "3y", "5y", "10y")

ZERO_KNOBS = {"policy_bp": [0] * 8, "cpi_pp": 0.0, "gap_pp": 0.0,
              "exports_pct": 0.0, "us_bp": 0.0, "us_dur_q": 4,
              "oil_pct": 0.0}


def load_basis() -> dict:
    return json.loads((OUT / "scenario_basis.json").read_text("utf-8"))


def observed_curve() -> dict:
    """Latest observed levels for the replay's absolute-curve display:
    KTB from the ECOS daily caches, IRS from the (gitignored) clean
    parquet. One day's snapshot, embedded in the lab page."""
    from bigfoot.data.ecos import daily
    from bigfoot.irs_curve.data import load_clean
    ktb, dates = {}, []
    for t, name in (("3y", "bigfoot_ktb3y_d"), ("10y", "bigfoot_ktb10y_d")):
        s = daily(name)
        ktb[t] = float(s.iloc[-1])
        dates.append(str(s.index[-1].date()))
    clean = load_clean()
    irs = {t: float(clean[f"irs_{t}"].iloc[-1]) for t in IRS_TENORS}
    dates.append(str(clean.index[-1].date()))
    return {"ktb": ktb, "irs": irs, "as_of": max(dates)}


def forward_sub(M, b):
    n = len(b)
    c = [0.0] * n
    for i in range(n):
        s = b[i] - sum(M[i][j] * c[j] for j in range(i))
        c[i] = s / M[i][i]
    return c


def combine(basis: dict, knobs: dict) -> dict:
    """Scenario diffs: per-variable 24q paths + per-tenor IRS paths.
    LAB SEMANTICS: the 8 policy dots ARE the MPC decision — the first 8
    quarters of i_kr are pinned to the chosen path (0 = deliberate hold),
    so the policy coefficients target (path - other components'
    endogenous policy); rule resumes q9."""
    b = basis["bases"]
    sc = basis["basis_scales"]
    coefs = {
        "cpi": knobs["cpi_pp"] / sc["cpi"],
        "gap": knobs["gap_pp"] / sc["gap"],
        "exports": knobs["exports_pct"] / sc["exports"],
        f"us_{int(knobs['us_dur_q'])}q": knobs["us_bp"] / sc["us_bp"],
        "oil": knobs["oil_pct"] / sc["oil_pct"],
    }
    other8 = [sum(c * b[n]["i_kr"][t] for n, c in coefs.items() if c)
              for t in range(8)]
    target8 = [v / 100.0 for v in knobs["policy_bp"]]
    c_pol = forward_sub(basis["M_policy"],
                        [target8[t] - other8[t] for t in range(8)])
    for q in range(8):
        coefs[f"policy_q{q + 1}"] = c_pol[q]

    T = basis["horizon_q"]
    varnames = ["i_kr", "kr3y", "kr10y", "y_gap", "cpi_yoy", "s",
                "hpi", "debt"]
    out = {v: [0.0] * T for v in varnames}
    irs = {t: [0.0] * basis["irs_h"] for t in IRS_TENORS}
    for name, c in coefs.items():
        if not c:
            continue
        for v in varnames:
            for t in range(T):
                out[v][t] += c * b[name][v][t]
        for ten in IRS_TENORS:
            for h in range(basis["irs_h"]):
                irs[ten][h] += c * b[name]["irs"][ten][h]
    out["irs"] = irs
    out["_coefs"] = coefs
    return out


def interp_at_day(qpath, day: float) -> float:
    if day <= 0:
        return 0.0
    q = day / Q_DAYS
    k = int(q)
    lo = qpath[k - 1] if k >= 1 else 0.0
    if k >= len(qpath):
        return float(qpath[-1])
    return float(lo + (q - k) * (qpath[k] - lo))


def replay_frames(basis: dict, observed: dict, knobs: dict) -> list:
    """The 13 replay snapshots: absolute rates + per-tenor diffs (bp)."""
    diffs = combine(basis, knobs)
    ktb_map = {"3y": "kr3y", "10y": "kr10y"}
    frames = []
    for d in DAY_GRID:
        f = {"day": d, "irs": {}, "ktb": {}, "dy_bp": {}}
        for t in IRS_TENORS:
            # ALIGNMENT: irs paths are h-indexed with h=0 == day 0 (zero
            # by construction); interp nodes start at day Q_DAYS, so drop
            # the h=0 element (regression-locked in tests/test_lab.py)
            dv = interp_at_day(diffs["irs"][t][1:], d)
            f["irs"][t] = observed["irs"][t] + dv
            f["dy_bp"]["irs_" + t] = dv * 100.0
        for t in KTB_TENORS:
            dv = interp_at_day(diffs[ktb_map[t]], d)
            f["ktb"][t] = observed["ktb"][t] + dv
            f["dy_bp"]["ktb_" + t] = dv * 100.0
        frames.append(f)
    return frames


def sentence(knobs: dict, diffs: dict) -> str:
    path = "·".join(f"{int(v):+d}" if v else "0" for v in knobs["policy_bp"])
    irs3_12m = diffs["irs"]["3y"][4] * 100.0
    return (f"금통위 경로 [{path}]bp와 설정 조건이 프라이싱되면, "
            f"모형 정합적 IRS 3y 12개월 이동은 {irs3_12m:+.0f}bp입니다.")
