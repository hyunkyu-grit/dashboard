"""채권 일별 손익 대사 — 자기 엔진 레인 [OWNER, 2026-08-25 — "엔진 단위에서
스왑과 별개로"].

2026-08-21 판은 채권의 일별 성분을 **스왑 대사표의 열에 합산**했다. 그 판이
드러낸 문제(채권 롤다운 항 부재)를 chart.py 의 bondRolldown 누적기가 채우면서,
채권 대사는 스왑과 같은 모양의 **자기 표**로 독립한다. 이 모듈은 새 산술을
만들지 않는다 — chart.py 의 주 루프가 이미 낸 누적 계열(`decomposition_daily`)
의 차분과, 같은 루프가 쓴 감쇠 pvbp 의 표시 배분뿐이다(두 번째 정의 금지).

── 행의 항등식 (스왑 표와 같은 데스크 관행) ────────────────────────────────
    평가(백워드, 전일 대비) + 캐리·롤다운·조달(포워드, 오늘 → 다음 영업일)
    = 그날 손익
D+0 행이 첫날 밤을 싣고 마지막 행의 포워드 성분은 0, 끝의 이월 앵커 행은
종가 KRD 만 싣는다(공란 정책 — 오지 않은 날의 손익을 0 이라 말하지 않는다).

── 격자 ────────────────────────────────────────────────────────────────────
열은 **입력한 시나리오 충격 커브의 테너**다(섹터별 그룹) — 이 표의 Δbp 는
민평 호가가 아니라 사용자가 넣은 충격 경로의 그날 증분이고, KRD 는 엔진과
같은 잔존 비례 감쇠 pvbp 를 그 테너 브래킷에 선형 가중으로 배분한 것이다.
배분×노드Δ 는 선형성으로 엔진의 보간 소비와 일치하지만, 단기채 BOK 블렌드
(short_multiplier)와 램프의 잔존 이동은 노드 표시가 못 담는다 — 그 차이는
잔차(평가 − 추정)로 떨어진다. 추정은 추정이고 실측은 실측이다.

평행 충격(또는 커브 없음)은 테너 구조가 없으므로 «평행» 한 열이 선다.
"""

from __future__ import annotations

from datetime import date
from typing import Callable

from .daily_valuation import get_sector_curve_key
from .kr_calendar import next_kr_business_day
from .models import FrontendPosition, FrontendShockCurves


def _sector_nodes(
    shock_curves: FrontendShockCurves | None, sector: str
) -> list[tuple[float, str]]:
    """섹터의 시나리오 커브 노드 [(년수, 라벨)] 오름차순 — 없으면 국채 폴백."""
    if not shock_curves:
        return []
    curve = shock_curves.bondCurves.get(sector) or shock_curves.bondCurves.get("국채") or []
    pts = sorted({float(p.get("t", 0)) for p in curve})
    return [(t, _tenor_label(t)) for t in pts]


def _tenor_label(t: float) -> str:
    if t < 1.0:
        m = round(t * 12)
        return f"{m}M"
    return f"{t:g}Y"


def _node_val(shock_curves: FrontendShockCurves | None, sector: str, t: float) -> float:
    if not shock_curves:
        return 0.0
    curve = shock_curves.bondCurves.get(sector) or shock_curves.bondCurves.get("국채") or []
    for p in curve:
        if abs(float(p.get("t", 0)) - t) < 1e-9:
            return float(p.get("val", 0))
    return 0.0


def _alloc_weights(nodes: list[float], years: float) -> list[tuple[int, float]]:
    """잔존 years 의 pvbp 를 브래킷 노드에 나누는 선형 가중 — 엔진의
    interpolate_curve_shift 와 같은 규칙(끝은 평탄 = 전량 그 노드)."""
    if not nodes:
        return []
    if years <= nodes[0]:
        return [(0, 1.0)]
    if years >= nodes[-1]:
        return [(len(nodes) - 1, 1.0)]
    for i in range(len(nodes) - 1):
        lo, hi = nodes[i], nodes[i + 1]
        if lo <= years <= hi:
            if hi == lo:
                return [(i, 1.0)]
            w = (years - lo) / (hi - lo)
            return [(i, 1.0 - w), (i + 1, w)]
    return [(len(nodes) - 1, 1.0)]


def build_bond_daily_recon(
    bond_positions: list[FrontendPosition],
    decomposition_daily: list[dict],
    bizday_schedule: list[tuple],
    base_date: date,
    shock_mode: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
    factor_at: Callable[[int], float],
    roll_basis: dict,
) -> dict | None:
    """채권 표 전체 — {groups, tenors, rows, rollBasis}. 채권이 없으면 None."""
    if not bond_positions or not bizday_schedule:
        return None

    # ── 격자: 섹터 그룹 × 그 섹터의 시나리오 커브 테너 ──────────────────────
    #
    # 폴백의 규율 [2026-08-25 실측으로 배웠다]: **Δbp 는 엔진이 실제로 소비한
    # 것만 말한다.** 평행 모드의 엔진은 base_shock 를 전 만기에 쓰므로 «평행»
    # 열이 그 값을 싣는 것이 참이지만, matrix 모드에서 섹터 커브가 비면 엔진은
    # 빈 커브를 보간해 **0** 을 쓴다(`calculate_daily_mtm`). 첫 판은 그때도
    # base_shock 램프를 그렸고 — FE 가 bondCurves 를 화석으로 비워 보내던
    # 기간에 이 표가 엔진이 안 값매긴 250bp 를 «추정»으로 지어냈다(실측:
    # 추정 −390만/일 대 평가 0, 다리 없는 잔차). 지어내지 않는다: matrix 에
    # 커브가 없으면 Δbp 0, 라벨도 «평행» 이 아니라 «—» 다.
    sectors = sorted({get_sector_curve_key(p.sector) for p in bond_positions})
    parallel = shock_mode == "parallel"
    groups: list[dict] = []
    col_nodes: dict[str, tuple[str, float]] = {}   # key → (sector, years)
    if parallel or not shock_curves:
        flat_label = "평행" if parallel else "—"
        for s in sectors:
            key = f"{s}:∥"
            groups.append({"label": s, "cols": [{"key": key, "label": flat_label}]})
            col_nodes[key] = (s, -1.0)
    else:
        for s in sectors:
            nodes = _sector_nodes(shock_curves, s)
            if not nodes:
                key = f"{s}:∥"
                groups.append({"label": s, "cols": [{"key": key, "label": "—"}]})
                col_nodes[key] = (s, -1.0)
                continue
            cols = []
            for t, lb in nodes:
                key = f"{s}:{lb}"
                cols.append({"key": key, "label": lb})
                col_nodes[key] = (s, t)
            groups.append({"label": s, "cols": cols})
    col_keys = [c["key"] for g in groups for c in g["cols"]]

    # ── 그날의 KRD 배분 (감쇠 pvbp → 노드) 과 노드 누적 충격 ────────────────
    def krd_alloc(t_day: int) -> dict[str, float]:
        out = {k: 0.0 for k in col_keys}
        for p in bond_positions:
            initial = max(float(p.remainingDays or 1), 1.0)
            rem = max(initial - t_day, 0.0)
            if rem <= 0:
                continue
            pv = (p.pvbp or 0.0) * (rem / initial)
            s = get_sector_curve_key(p.sector)
            keys = [k for k in col_keys if col_nodes[k][0] == s]
            if not keys:
                continue
            if parallel or col_nodes[keys[0]][1] < 0:
                out[keys[0]] += pv
                continue
            years = [col_nodes[k][1] for k in keys]
            for idx, w in _alloc_weights(years, rem / 365.0):
                out[keys[idx]] += pv * w
        return out

    def cum_bp(key: str, t_day: int) -> float:
        s, t_node = col_nodes[key]
        fac = factor_at(t_day)
        if t_node < 0:
            # 평행 모드만 base_shock — matrix 에 커브가 없으면 엔진이 0 을
            # 소비하므로 여기도 0 이다(모듈 상단 «지어내지 않는다» 주석).
            return (base_shock_bp or 0.0) * fac if parallel else 0.0
        return _node_val(shock_curves, s, t_node) * fac

    # ── 누적 계열의 차분 — 2026-08-21 병합판과 같은 걸음, 표만 옮겼다 ───────
    bd = decomposition_daily

    def at(i: int, key: str) -> float:
        return float(bd[i].get(key) or 0.0) if 0 <= i < len(bd) else 0.0

    def back_val(k: int) -> int:
        return round(at(k, "bondMtm") - at(k - 1, "bondMtm")) if k >= 1 else 0

    def fwd(k: int) -> tuple[int, int, int]:
        """(캐리, 롤다운, 조달) — 포워드(k → k+1). 끝에서는 0."""
        if k + 1 >= len(bd):
            return 0, 0, 0
        return (
            round(at(k + 1, "bondCarry") - at(k, "bondCarry")),
            round(at(k + 1, "bondRolldown") - at(k, "bondRolldown")),
            round(at(k + 1, "fundingCost") - at(k, "fundingCost")),
        )

    rows: list[dict] = []

    # D+0 앵커 — 평가·추정 0, 첫날 밤의 포워드 성분.
    c0, r0, f0 = fwd(0)
    prev_krd = krd_alloc(0)
    rows.append({
        "date": base_date.isoformat(),
        "day": 0,
        "pvbp": {k: round(prev_krd[k]) for k in col_keys},
        "dailyDbp": {k: 0.0 for k in col_keys},
        "pnl": {k: 0 for k in col_keys},
        "totalEstPnl": 0,
        "valuation": 0,
        "carry": c0,
        "rolldown": r0,
        "funding": f0,
        "actual": c0 + r0 + f0,
        "residual": 0,
    })

    prev_cal = 0
    for j, (val_date, cal_day, _dt) in enumerate(bizday_schedule):
        k = j + 1                      # decomposition_daily 자리 (0 = D+0 앵커)
        dbp = {kk: cum_bp(kk, cal_day) - cum_bp(kk, prev_cal) for kk in col_keys}
        pnl = {kk: -prev_krd[kk] * dbp[kk] for kk in col_keys}
        est = round(sum(pnl.values()))
        val = back_val(k)
        carry, roll, fund = fwd(k)
        rows.append({
            "date": val_date.isoformat(),
            "day": cal_day,
            "pvbp": {kk: round(prev_krd[kk]) for kk in col_keys},
            "dailyDbp": {kk: round(dbp[kk], 4) for kk in col_keys},
            "pnl": {kk: round(pnl[kk]) for kk in col_keys},
            "totalEstPnl": est,
            "valuation": val,
            "carry": carry,
            "rolldown": roll,
            "funding": fund,
            "actual": val + carry + roll + fund,
            "residual": val - est,
        })
        prev_cal = cal_day
        prev_krd = krd_alloc(cal_day)

    # 이월 앵커 — 종가 KRD 만, 손익 필드는 전부 None (공란 정책).
    co_date = next_kr_business_day(bizday_schedule[-1][0])
    rows.append({
        "date": co_date.isoformat(),
        "day": (co_date - base_date).days,
        "pvbp": {k: round(prev_krd[k]) for k in col_keys},
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

    return {
        "groups": groups,
        "tenors": col_keys,
        "rows": rows,
        "rollBasis": roll_basis,
    }
