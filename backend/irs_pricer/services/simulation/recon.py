"""IRS 일별 손익 대사표 — chart.build_chart_data 에서 추출 (2026-08-10).

영업일마다: 그날의 쇼크 par 커브를 부트스트랩하고 KRD_TENORS 를 범프해
포트폴리오 KRD 를 재계산, 전일(start-of-day) KRD × 당일 Δbp 선형 추정을
FM 엔진의 실제 증분과 나란히 적는다. 응답의 `irsDailyReconciliation` 이
이 함수의 반환값 그대로다.

**바이트 동일 이식**: 로직·라운딩·필드 전부 chart.py 에 있던 그대로다.
골든 픽스처(test_simulate_api)가 결과 불변을 못박는다. 추출로 달라진 것
하나는 **계산 시점**이다 — IRS_Trade 사전 빌드와 평균 float 유도가 종전엔
skip_recon=True(분포 밴드 런)에서도 돌았는데, 이제 대사표를 만들 때만
돈다. 산출물에는 안 닿는 순수 낭비 제거다.

curve_cache 계약(chart.py 모듈 주석과 동일): 부트스트랩은 반드시
`qe.bootstrap_zero_curve` 모듈 속성 조회로 — 메모 래퍼가 끼어들 자리다.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from ...engine import quant_engine as qe
from .kr_calendar import next_kr_business_day
from .models import FrontendPosition
from .swap_schedule import resolve_swap_horizon


def build_pos_trades(
    irs_positions: list[FrontendPosition],
    base_date: date,
    base_date_str: str,
) -> list[tuple]:
    """포지션별 IRS_Trade 사전 빌드 (불변 스케줄, 대사 루프 밖에서 1회).

    반환: [(IRS_Trade | None, float_rate_pct)] — 만기가 시작일보다 이르면
    None(대사에서 제외). startDate 가 없으면 다음 변동일에서 분기(3M)를
    역산해 시작일을 근사한다.
    """
    pos_trades: list[tuple] = []
    for _rp in irs_positions:
        _rt0, _t_nxt_r = resolve_swap_horizon(_rp.remainingDays, _rp.nextFixingDate, base_date_str)
        _flt_r = float(_rp.currentFloatRate or 0.0)
        _fr_r  = float(_rp.couponRate or 0.0)
        _dir_r = int(_rp.direction or 1)
        _N_r   = float(_rp.notional or 0.0)
        _sec_r = _rp.sector or "IRS"

        _mat_dt_r = qe._modfol_bd(base_date + timedelta(days=round(_rt0 * 365)))
        _freq_m_r = 3   # quarterly (float_freq=0.25)
        _start_dt_r = None
        _sdate_str  = str(_rp.startDate)[:10] if _rp.startDate else ""
        if _sdate_str:
            try:
                _start_dt_r = date.fromisoformat(_sdate_str)
            except Exception:
                pass
        if _start_dt_r is None:
            _nxt_raw_r  = base_date + timedelta(days=max(round(_t_nxt_r * 365), 1))
            _nxt_adj_r  = qe._next_business_day(_nxt_raw_r)
            _start_dt_r = qe._modfol_bd(qe._subtract_months(_nxt_adj_r, _freq_m_r))

        if _mat_dt_r > _start_dt_r:
            _trade_r = qe.IRS_Trade(_start_dt_r, _mat_dt_r, _fr_r, _dir_r, _N_r, sector=_sec_r)
        else:
            _trade_r = None
        pos_trades.append((_trade_r, _flt_r))
    return pos_trades


def build_irs_daily_recon(
    *,
    irs_positions: list[FrontendPosition],
    par_rates: list[tuple[float, float]],
    base_date: date,
    base_date_str: str,
    sim_days: int,
    shock_type: str,
    irs_sc_t: np.ndarray,
    irs_sc_bp: np.ndarray,
    path_factor_arr: "np.ndarray | None",
    funding_events: list[dict],
    bizday_schedule: list[tuple],
    irs_fm_mtm: np.ndarray,
    irs_fm_mtm_theta: np.ndarray,
    irs_daily_scf: np.ndarray,
    irs_fm_carry_cash: np.ndarray | None = None,
) -> list[dict]:
    """IRS 일별 손익 대사 — 정확한 일별 KRD 재계산.

    전략: 선형 에이징 완전 폐기 → IRS_Trade 기반 실시간 KRD.
    최적화: 일당 12개 범프 커브 1회 빌드 + 배치 DF LUT → 종목별 순수 NPV
    차분만 수행. 호출자는 `par_rates 가 있고 skip_recon 이 아닐 때만` 부른다
    — 빈 대사표 분기(배포 계약 보정)는 chart.py 쪽 주석 참조.
    """
    _recon_names  = qe.KRD_NAMES
    _recon_tenors = qe.KRD_TENORS

    # ── BOK 이벤트 목록 (계단식 충격 모델에 사용) ───────────────────────────
    # 1D/3M: BOK 이벤트 누적 bp (계단식)
    # 3M~6M: BOK ↔ IRS ramp 선형 보간
    # 6M+:   IRS shock_curve × 누적 factor (기존 ramp/step)
    try:
        _bok_evts_r = sorted(
            [{"day": (date.fromisoformat(ev["date"]) - base_date).days,
              "bp":  float(ev.get("shiftBp", 0))}
             for ev in (funding_events or [])
             if ev.get("date") and 0 <= (date.fromisoformat(ev["date"]) - base_date).days <= sim_days],
            key=lambda x: x["day"],
        )
    except Exception:
        _bok_evts_r = []

    def _cum_bok_r(day: int) -> float:
        """BOK 이벤트 누적 bp (day 이하 이벤트 합산, 계단식)."""
        return sum(e["bp"] for e in _bok_evts_r if e["day"] <= day)

    # 램프 충격을 영업일 기준으로 정규화(주말 skip) — simulate_irs_path_fm
    # (irs_fm_mtm)과 동일한 기준을 써야 "추정"과 "실제"가 일관된다. 캘린더
    # 일수로 나누면 월요일에 토+일+월 3일치가 한꺼번에 반영되어 부풀어 보인다.
    _biz_ranks_r  = qe.biz_day_ranks(base_date, sim_days)
    _biz_total_r  = int(_biz_ranks_r[-1]) if _biz_ranks_r[-1] > 0 else max(sim_days, 1)

    def _ramp_factor_r(day: int) -> float:
        return float(_biz_ranks_r[min(max(day, 0), len(_biz_ranks_r) - 1)]) / _biz_total_r

    def _cum_shock_r(tau: float, day: int) -> float:
        """테너별 누적 충격 bp (계단식 1D/3M → 선형 소멸 at 1Y → ramp 1Y+).

        SIM2-4: 경로 정합이 활성화된 요청은 1Y+ ramp 성분이 biz-ranked ramp
        대신 설계 경로 팩터를 따른다 — FM 엔진(irs_fm_mtm)과 같은 기준을 써야
        "추정"과 "실제"가 일관된다는 기존 원칙 그대로다.
        """
        if path_factor_arr is not None:
            _fac = float(path_factor_arr[min(max(day, 0), sim_days)])
        else:
            _fac = _ramp_factor_r(day) if shock_type == "ramp" else (1.0 if day > 0 else 0.0)
        _ramp_bp = float(np.interp(tau, irs_sc_t, irs_sc_bp)) * _fac
        if not _bok_evts_r:
            return _ramp_bp
        _bok_bp = _cum_bok_r(day)
        if tau <= 0.25:          # 1D, 3M: BOK 계단식 100% 직결
            return _bok_bp
        elif tau < 1.0:          # 3M~1Y: BOK 선형 소멸 (6M≈67%, 9M≈33%)
            w = (tau - 0.25) / 0.75
            return _bok_bp * (1.0 - w) + _ramp_bp * w
        else:                    # 1Y+: IRS shock_curve ramp만 적용
            return _ramp_bp

    # ── 포지션별 IRS_Trade + Day 0 평균 float ───────────────────────────────
    _pos_trades = build_pos_trades(irs_positions, base_date, base_date_str)
    _flts_r    = [flt for (_, flt) in _pos_trades if flt > 0]
    _avg_flt0  = float(np.mean(_flts_r)) / 100.0 if _flts_r else 0.03   # Day 0 기준 float (소수)

    # ── 일자 t 의 쇼크 커브 + 포트폴리오 KRD (루프 본문과 시드가 공유) ─────
    # 마켓 컨벤션: "N일자 KRD/PVBP"는 N의 결제일(다음 영업일) 기준으로 재평가한
    # 값을 보고한다 — irs_fm_mtm(simulate_irs_path_fm 내부에서 이미 동일 규칙
    # 적용됨)과 일관되도록 여기서도 val_date를 결제일로 한 번 밀어서 넘긴다.
    def _krd_at(_vd: date, _cd: int) -> dict[str, float]:
        # par 커브 구성: 6M+ ramp + 1D/3M BOK 계단 앙커. 6M+ par 노드는
        # ramp 충격 그대로, 1D/3M 앙커는 기본 float rate + BOK 누적 bp.
        _par_day: list[tuple[float, float]] = [
            (t_p, r_p + float(np.interp(t_p, irs_sc_t, irs_sc_bp))
             * (_ramp_factor_r(_cd) if shock_type == "ramp" else (1.0 if _cd > 0 else 0.0))
             * 1e-4)
            for t_p, r_p in par_rates
        ]
        _par_anch = qe._inject_short_anchors(_par_day, _avg_flt0 + _cum_bok_r(_cd) * 1e-4)
        # 기준 + KRD_TENORS 범프 커브 (일당 1회 빌드) → 포트폴리오 KRD 합산
        _zc_b = qe.bootstrap_zero_curve(_par_anch)
        return qe.portfolio_krd_day(_pos_trades, next_kr_business_day(_vd), _zc_b, qe.build_bumped_curves(_par_anch))

    # ── 전일(start-of-day) KRD 시드 [OWNER, 2026-08-10 — 교과서 관행 정합] ──
    # 선형 추정은 **전일 KRD × 당일 Δbp** 다. 종전에는 당일(end-of-day) KRD 를
    # 썼는데, P&L explain 의 민감도 방식 표준은 "어제의 민감도 × 오늘의 변동"
    # 이다(외부 검증 2026-08-10) — 이벤트·리픽싱으로 KRD 가 점프하는 날에는
    # 이동 후 민감도로 이동분을 설명하는 순서 역전이 된다. 행의 `pvbp` 필드는
    # 계속 **그날의** KRD 다(일별 KRD 표가 보여주는 수준값); 추정만 전일 것을
    # 쓴다. 시드는 day 0(기준일, 쇼크 전) 의 KRD 다.
    _pvbp_prev_r = _krd_at(base_date, 0)

    irs_daily_recon: list[dict] = []
    _prev_cal_r = 0
    for _val_date_r, _cal_day, _dt_cal in bizday_schedule:
        # ── 테너별 누적 충격 bp 계산 (계단식 1D/3M + ramp 6M+) ─────────────
        _cum_r    = {_n: _cum_shock_r(_tau, _cal_day)    for _n, _tau in zip(_recon_names, _recon_tenors)}
        _cum_prev = {_n: _cum_shock_r(_tau, _prev_cal_r) for _n, _tau in zip(_recon_names, _recon_tenors)}
        _daily_dbp_r = {_n: _cum_r[_n] - _cum_prev[_n] for _n in _recon_names}

        _pvbp_r = _krd_at(_val_date_r, _cal_day)

        _pnl_r       = {_n: -_pvbp_prev_r[_n] * _daily_dbp_r[_n] for _n in _recon_names}
        _total_est   = round(sum(_pnl_r.values()))
        _settle      = round(float(np.sum(irs_daily_scf[_prev_cal_r + 1:_cal_day + 1])))
        _total_act   = round(float(irs_fm_mtm[_cal_day] - irs_fm_mtm[_prev_cal_r]))
        _npv_change  = _total_act - _settle
        _residual    = _total_act - _total_est     # 잔차: 실제P&L − 추정P&L (양수=모델 과소추정)
        # 세타손익: 커브를 base_date 시점에 고정한 궤적(irs_fm_mtm_theta)의 같은 구간 변화.
        # 평가손익(=마켓무브): 실제P&L에서 세타손익을 뺀 나머지 — "그날 실제로 커브가
        # 움직여서 생긴" 손익만 분리한 값.
        _theta_pnl   = round(float(irs_fm_mtm_theta[_cal_day] - irs_fm_mtm_theta[_prev_cal_r]))
        _valuation_pnl = _total_act - _theta_pnl
        # [OWNER, 2026-08-11 — 교과서 3분해] 세타의 같은 구간 변화를 캐리
        # (동결 커브 순액크루얼+정산, carry_split.py)와 롤다운(잔여)으로 가른다.
        # 라운딩 후 잔차로 롤다운을 잡아 행 단위 가산성(캐리+롤다운 == 세타)을
        # 표시 정밀도에서 보존한다.
        _carry_pnl = (
            round(float(irs_fm_carry_cash[_cal_day] - irs_fm_carry_cash[_prev_cal_r]))
            if irs_fm_carry_cash is not None
            else 0
        )
        _rolldown_pnl = _theta_pnl - _carry_pnl
        irs_daily_recon.append({
            "date":         _val_date_r.isoformat(),
            "day":          _cal_day,
            "pvbp":         {_n: round(_pvbp_r[_n]) for _n in _recon_names},
            "cumulativeBp": {_n: round(_cum_r[_n], 3) for _n in _recon_names},
            "dailyDbp":     {_n: round(_daily_dbp_r[_n], 4) for _n in _recon_names},
            "pnl":          {_n: round(_pnl_r[_n]) for _n in _recon_names},
            "totalEstPnl":  _total_est,
            "totalActual":  _total_act,
            "settleCf":     _settle,
            "npvChange":    _npv_change,
            "residual":     _residual,
            "thetaPnl":     _theta_pnl,
            "valuationPnl": _valuation_pnl,
            "carryPnl":     _carry_pnl,
            "rolldownPnl":  _rolldown_pnl,
        })
        _prev_cal_r  = _cal_day
        _pvbp_prev_r = _pvbp_r

    return irs_daily_recon
