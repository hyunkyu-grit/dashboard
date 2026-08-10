"""BOK 이벤트 당일 구간별 MTM 분해 진단 — chart 메인 루프에서 추출 (2026-08-10).

이벤트가 낀 영업일에만 chartData 행에 `bokBreakdown` 으로 붙는 검증용
페이로드다: 채권을 3M미만/3M~1Y/1Y이상 구간으로 갈라 MTM 변화와 구간 PVBP 를
적고, IRS 는 이벤트 당일 커브로 KRD 를 재계산해 1D/3M/블렌드/장기 구간의
PVBP·추정 손익을 적는다. ~120줄이 일별 루프 안에 인라인으로 살던 것을
함수로 꺼냈다 — **바이트 동일 이식**, 골든 픽스처가 못박는다.

`daily_mtm_fn` 을 인자로 받는 이유: profiling.py(s18 T5)가
`chart.calculate_daily_mtm` **모듈 속성**을 감싼다 — build_chart_data 가
호출 시점에 자기 전역에서 해석한 (감싸졌을 수도 있는) 함수를 그대로 넘겨야
프로파일러/몽키패치 이음새가 유지된다. 여기서 daily_valuation 을 직접
임포트하면 그 이음새가 조용히 끊긴다(R3a 몽키패치 이음새 전례).
"""

from __future__ import annotations

import logging
from datetime import date

import numpy as np

from ...engine import quant_engine as qe
from .models import FrontendPosition, FrontendShockCurves

logger = logging.getLogger(__name__)


def _get_bond_zone(p: FrontendPosition, day: int) -> str:
    cr = max(float(p.remainingDays or 1) - day, 0.0)
    r = cr / 365.0
    if r < 0.25: return "short"
    if r < 1.0:  return "blend"
    return "long"


def build_bok_breakdown(
    *,
    bond_positions: list[FrontendPosition],
    irs_positions: list[FrontendPosition],
    shock_mode: str,
    shock_type: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
    multiplier: float,
    short_mult: float,
    t: int,
    prev_cal: int,
    current_date: date,
    prev_date_bd: date,
    prev_mult_bd: float,
    prev_sf_bd: float,
    dt_cal: int,
    sim_days: int,
    short_evts: list[dict],
    path_factor_arr: "np.ndarray | None",
    irs_sc_t: np.ndarray,
    irs_sc_bp: np.ndarray,
    par_rates: list[tuple[float, float]],
    daily_mtm_fn,
) -> dict:
    """이벤트 당일의 구간별(3M미만/3M~1Y/1Y이상) MTM 변화 분해 (검증용)."""
    bd: dict[str, object] = {}
    for zone_name in ("short", "blend", "long"):
        z_cur  = [p for p in bond_positions if p.bondType != "swap" and _get_bond_zone(p, t)       == zone_name]
        z_prev = [p for p in bond_positions if p.bondType != "swap" and _get_bond_zone(p, prev_cal) == zone_name]
        cur_m  = daily_mtm_fn(z_cur,  shock_mode, shock_type, base_shock_bp, shock_curves, multiplier,    t,       current_date, short_mult)  if z_cur  else 0.0
        prev_m = daily_mtm_fn(z_prev, shock_mode, shock_type, base_shock_bp, shock_curves, prev_mult_bd, prev_cal, prev_date_bd, prev_sf_bd)  if z_prev else 0.0
        # 구간 현재 PVBP 합산 (에이징 반영) — 암묵적 bp 역산용
        zone_pvbp = sum(
            (p.pvbp or 0.0) * max(float(p.remainingDays or 1) - t, 0.0) / max(float(p.remainingDays or 1), 1.0)
            for p in z_cur
        )
        bd[f"{zone_name}Delta"] = round(cur_m - prev_m)
        bd[f"{zone_name}Pvbp"]  = round(zone_pvbp)

    # IRS KRD 구간별 분해: BOK 이벤트 당일 에이징된 par커브로 KRD 재계산
    # 단기(1D/3M): BOK 정책금리 직결 → _bok_event_bp 그대로 사용
    # 장기(1Y+):  [SIM2-4] 비자명 설계 경로가 활성화된 요청은 IRS FM이
    #              그 경로를 타므로 이 진단도 같은 경로 팩터를 쓴다;
    #              그 외에는 종전 linear ramp(factor=day/sim_days).
    _bok_event_bp  = sum(e["bp"] for e in short_evts if prev_cal < e["day"] <= t)
    if path_factor_arr is not None:
        _irs_ramp_step = float(
            path_factor_arr[min(t, sim_days)] - path_factor_arr[min(max(prev_cal, 0), sim_days)]
        )
    else:
        _irs_ramp_step = dt_cal / max(sim_days, 1)  # 영업일 기간 ramp 증분 (월요일=3/sim_days)
    _KRD_PAIRS = [
        ("1D", 1/365), ("3M", 0.25), ("6M", 0.5),  ("9M", 0.75),
        ("1Y", 1.0),   ("1.5Y", 1.5), ("2Y", 2.0), ("3Y", 3.0),
        ("4Y", 4.0),   ("5Y", 5.0),  ("7Y", 7.0),  ("10Y", 10.0),
    ]
    _irs_1p = _irs_3p = _irs_bp = _irs_lp = 0.0  # PVBP 합산
    _irs_1d = _irs_3d = _irs_bd = _irs_ld = 0.0  # P&L 합산
    # BOK 이벤트 당일 shocked par 커브 — [SIM2-4] 경로 활성 시 설계 팩터.
    _fac_irs = (
        float(path_factor_arr[min(t, sim_days)])
        if path_factor_arr is not None
        else t / max(sim_days, 1)
    )
    _par_t   = [(tau, r + float(np.interp(tau, irs_sc_t, irs_sc_bp)) * _fac_irs * 1e-4)
                for tau, r in par_rates]
    _FLOAT_Q = 0.25  # 분기 픽싱 표준
    for _p in irs_positions:
        _t_mat_0 = max(float(_p.remainingDays or 0) / 365.0, 1.0/365.0)
        _t_mat_t = max(_t_mat_0 - t / 365.0, 1.0/365.0)
        if _t_mat_t < 2.0/365.0:   # 사실상 만기 → 스킵
            continue
        # 에이징된 다음 변동일 — swap_schedule.resolve_swap_horizon 의 기준일
        # 버전과 **다른 변형**이다(그쪽 모듈 주석 참조): 시점이 이벤트 당일이라
        # nextFixingDate 를 current_date 까지 에이징하고, 지난 픽싱일이면
        # 91일(분기 근사) 단위로 미래로 롤링한다. enrich_irs_pvbp 의 t_next
        # 계산과 동일 방식 → pvbpSensitivity 일치.
        if _p.nextFixingDate:
            try:
                _nfd = date.fromisoformat(str(_p.nextFixingDate)[:10])
                _days_to_nfd = (_nfd - current_date).days
                while _days_to_nfd <= 0:
                    _days_to_nfd += 91  # 분기 근사 롤링
                _t_nxt_t = max(min(_days_to_nfd / 365.0, _t_mat_t), 1.0/365.0)
            except Exception:
                _k_fl    = int(_t_mat_t / _FLOAT_Q)
                _t_nxt_t = _t_mat_t - _k_fl * _FLOAT_Q
                if _t_nxt_t < 1.0/365.0: _t_nxt_t = _FLOAT_Q
                _t_nxt_t = max(min(_t_nxt_t, _t_mat_t), 1.0/365.0)
        else:
            # nextFixingDate 없으면 backward-from-maturity fallback
            _k_fl    = int(_t_mat_t / _FLOAT_Q)
            _t_nxt_t = _t_mat_t - _k_fl * _FLOAT_Q
            if _t_nxt_t < 1.0/365.0: _t_nxt_t = _FLOAT_Q
            _t_nxt_t = max(min(_t_nxt_t, _t_mat_t), 1.0/365.0)
        try:
            _krd = qe.compute_irs_krd_map(
                par_rates              = _par_t,
                notional               = _p.notional or 0.0,
                fixed_rate_pct         = _p.couponRate or 0.0,
                direction              = int(_p.direction or 1),
                t_maturity             = _t_mat_t,
                t_next_payment         = _t_nxt_t,
                current_float_rate_pct = _p.currentFloatRate or 0.0,
                sector                 = _p.sector or "IRS",
                sim_date               = current_date,
            )
        except Exception as _krd_err:
            logger.warning(
                "[BOK KRD] t=%s pos=%s t_mat=%.3f t_nxt=%.3f err=%s",
                t, _p.sector, _t_mat_t, _t_nxt_t, _krd_err,
            )
            # 재계산 실패 시 만기 비율로 t=0 KRD를 1차 근사 스케일링
            _age_scale = _t_mat_t / max(_t_mat_0, 1.0/365.0)
            _krd = {k: v * _age_scale for k, v in (_p.krdMap or {}).items()}
        for _tn, _ty in _KRD_PAIRS:
            _kv = _krd.get(_tn, 0.0) or 0.0
            if abs(_kv) < 1:
                continue
            # 해당 테너의 IRS ramp 증분: 쇼크 커브에서 τ별 크기 보간 × (dt_cal/sim_days)
            _irs_d_bp = float(np.interp(_ty, irs_sc_t, irs_sc_bp)) * _irs_ramp_step
            if _ty < 0.1:         # 1D — BOK 정책금리 직결
                _irs_1p += _kv;  _irs_1d -= _kv * _bok_event_bp
            elif _ty <= 0.25:     # 3M — BOK 직결
                _irs_3p += _kv;  _irs_3d -= _kv * _bok_event_bp
            elif _ty <= 1.0:      # 3M~1Y — BOK ↔ IRS ramp 선형 블렌드
                _w   = (_ty - 0.25) / 0.75
                _dbp = _bok_event_bp * (1 - _w) + _irs_d_bp * _w
                _irs_bp += _kv;  _irs_bd -= _kv * _dbp
            else:                 # 1Y이상 — IRS linear ramp 기준 (채권 커스텀 경로와 무관)
                _irs_lp += _kv;  _irs_ld -= _kv * _irs_d_bp
    # 블렌드/장기 대표 변동폭: IRS 쇼크 커브의 5Y 기준 × ramp 증분
    _irs_long_d_bp = float(np.interp(5.0, irs_sc_t, irs_sc_bp)) * _irs_ramp_step
    _blend_mid_bp  = round((_bok_event_bp * 0.5 + _irs_long_d_bp * 0.5) * 10) / 10
    bd.update({
        "irs1dPvbp":    round(_irs_1p), "irs1dDelta":    round(_irs_1d),
        "irs3mPvbp":    round(_irs_3p), "irs3mDelta":    round(_irs_3d),
        "irsBlendPvbp": round(_irs_bp), "irsBlendDelta": round(_irs_bd),
        "irsLongPvbp":  round(_irs_lp), "irsLongDelta":  round(_irs_ld),
        "bokShortBp":   round(_bok_event_bp    * 10) / 10,  # BOK 이벤트 실제 bp
        "bokBlendBp":   _blend_mid_bp,                        # IRS 블렌드 중간점
        "bokLongBp":    round(_irs_long_d_bp   * 10) / 10,  # IRS 5Y 기준 장기 변동폭
    })
    return bd
