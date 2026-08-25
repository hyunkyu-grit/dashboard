# -*- coding: utf-8 -*-
"""국채선물 일별 손익 대사 — 자기 엔진 레인 [OWNER, 2026-08-25 — 엔진 단위
분리 원칙의 세 번째 표].

채권 표(bond_recon)와 같은 계약(`{groups, tenors, rows}`)이되 선물의 사실에
맞게 좁다: 합성채는 늙지 않으므로(futures_pricing 모듈 doc) KRD 감쇠가 없고,
캐리·롤다운·조달 성분은 **존재하지 않는다** — 0 이 아니라 None 이다(공란
정책: 없는 성분을 0 이라 말하지 않는다). 행의 항등은 그래서 한 줄이 된다:

    평가(백워드, 전일 대비) = 그날 손익,   잔차 = 평가 − 추정(전일 KRD × Δbp)

잔차가 싣는 것이 바로 **컨벡시티**다 — 엔진은 KRX 폐형 재값매김이고 추정은
선형 KRD 라서, 큰 충격일수록 이 칸이 커지는 것이 정직한 그림이다 [OWNER
선택, 2026-08-25]. 이 모듈은 새 산술을 만들지 않는다: 평가는 chart.py 주
루프의 누적 계열(`decomposition_daily.futMtm`) 차분이고, Δbp 는 엔진이 실제
소비한 충격(국채 커브의 상장 만기 고정 지평 × factor)의 그날 증분이다.

폴백의 규율은 bond_recon 과 같다: matrix 모드에 국채 커브가 없으면 엔진이
0 을 소비하므로 Δbp 도 0, 라벨은 «—» 다(지어내지 않는다).
"""

from __future__ import annotations

from datetime import date
from typing import Callable

from .daily_valuation import interpolate_curve_shift, parse_tenor_to_years
from .kr_calendar import next_kr_business_day
from .models import FrontendPosition, FrontendShockCurves


def build_futures_daily_recon(
    fut_positions: list[FrontendPosition],
    decomposition_daily: list[dict],
    bizday_schedule: list[tuple],
    base_date: date,
    shock_mode: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
    factor_at: Callable[[int], float],
) -> dict | None:
    """선물 표 전체 — {groups, tenors, rows}. 선물이 없으면 None."""
    if not fut_positions or not bizday_schedule:
        return None

    parallel = shock_mode == "parallel"
    ktb_curve = (shock_curves.bondCurves.get("국채") or []) if shock_curves else []

    # ── 격자: 북에 실제로 선 상장 만기만 (3Y/10Y) ───────────────────────────
    tenors = sorted(
        {str(p.tenor) for p in fut_positions}, key=lambda s: parse_tenor_to_years(s)
    )
    has_curve = parallel or bool(ktb_curve)
    cols = [
        {"key": f"국채선물:{tn}", "label": tn if has_curve else "—"} for tn in tenors
    ]
    groups = [{"label": "국채선물", "cols": cols}]
    col_keys = [c["key"] for c in cols]
    col_years = {f"국채선물:{tn}": parse_tenor_to_years(tn) for tn in tenors}

    # KRD 는 상수다(감쇠 없음) — expand 가 채운 부호 있는 pvbp(롱 양수)의 합.
    krd = {k: 0.0 for k in col_keys}
    for p in fut_positions:
        krd[f"국채선물:{p.tenor}"] += p.pvbp or 0.0

    def cum_bp(key: str, t_day: int) -> float:
        fac = factor_at(t_day)
        if parallel:
            return (base_shock_bp or 0.0) * fac
        if not ktb_curve:
            return 0.0  # 엔진이 0 을 소비 — 지어내지 않는다 (모듈 doc)
        return interpolate_curve_shift(col_years[key], ktb_curve) * fac

    # ── 누적 계열의 차분 — 엔진 주 루프가 이미 낸 futMtm 그대로 ─────────────
    bd = decomposition_daily

    def fut_at(i: int) -> float:
        return float(bd[i].get("futMtm") or 0.0) if 0 <= i < len(bd) else 0.0

    rows: list[dict] = []
    rows.append({
        "date": base_date.isoformat(),
        "day": 0,
        "pvbp": {k: round(krd[k]) for k in col_keys},
        "dailyDbp": {k: 0.0 for k in col_keys},
        "pnl": {k: 0 for k in col_keys},
        "totalEstPnl": 0,
        "valuation": 0,
        # 없는 성분은 None — 공란 정책 (모듈 doc).
        "carry": None,
        "rolldown": None,
        "funding": None,
        "actual": 0,
        "residual": 0,
    })

    prev_cal = 0
    for j, (val_date, cal_day, _dt) in enumerate(bizday_schedule):
        k = j + 1                      # decomposition_daily 자리 (0 = D+0 앵커)
        dbp = {kk: cum_bp(kk, cal_day) - cum_bp(kk, prev_cal) for kk in col_keys}
        pnl = {kk: -krd[kk] * dbp[kk] for kk in col_keys}
        est = round(sum(pnl.values()))
        val = round(fut_at(k) - fut_at(k - 1))
        rows.append({
            "date": val_date.isoformat(),
            "day": cal_day,
            "pvbp": {kk: round(krd[kk]) for kk in col_keys},
            "dailyDbp": {kk: round(dbp[kk], 4) for kk in col_keys},
            "pnl": {kk: round(pnl[kk]) for kk in col_keys},
            "totalEstPnl": est,
            "valuation": val,
            "carry": None,
            "rolldown": None,
            "funding": None,
            "actual": val,
            "residual": val - est,     # = 컨벡시티 (모듈 doc)
        })
        prev_cal = cal_day

    # 이월 앵커 — 종가 KRD 만(상수지만 계약을 지킨다), 손익 필드는 전부 None.
    co_date = next_kr_business_day(bizday_schedule[-1][0])
    rows.append({
        "date": co_date.isoformat(),
        "day": (co_date - base_date).days,
        "pvbp": {k: round(krd[k]) for k in col_keys},
        "dailyDbp": {},
        "pnl": {},
        "totalEstPnl": None,
        "valuation": None,
        "carry": None,
        "rolldown": None,
        "funding": None,
        "actual": None,
        "residual": None,
        "carryover": True,
    })

    return {"groups": groups, "tenors": col_keys, "rows": rows}
