"""build_chart_data — the per-scenario engine run (R3a, moved verbatim from
simulation_service.py; 2026-08-10 에 세 조각을 모듈로 꺼냈다 — 아래).

One call = one full scenario: IRS FM precompute (simulate_irs_path_fm per
swap — the ~82s full-book hotspot, measurement-only, do not optimize here),
the per-business-day valuation loop, and the decomposition accumulators whose
float identity (bondMtm + bondCarry + bondRolldown + fundingCost + swapMtm +
swapCarry + swapRolldown == totalPnL) the FE waterfall consumes.

2026-08-10 분해 (동작 바이트 동일 — 골든 픽스처가 못박는다):
  - 일별 대사표          → recon.build_irs_daily_recon
  - BOK 이벤트 당일 진단  → bok_breakdown.build_bok_breakdown
  - t_mat/t_next 유도     → swap_schedule.resolve_swap_horizon (세 벌 → 하나)
  - 반환은 ChartRun(NamedTuple) — 종전 7-튜플 언패킹과 호환되면서,
    decomposition dict 에 밀수하던 daily/swapContributions 가 자기 필드로
    나왔다(9필드; 위치 언패킹하던 두 호출처는 이름 접근으로 전환).

curve_cache contract: every bootstrap goes through `qe.bootstrap_zero_curve`
module-attribute lookup so the installed memo wrapper is picked up — never
import the function name directly.

The s18 T5 profiler (profiling.py) wraps THIS module's calculate_daily_mtm /
calculate_daily_carry attributes: build_chart_data resolves them from these
globals at call time. 추출 모듈(bok_breakdown)에는 그렇게 해석한 함수를
**인자로 넘긴다** — 직접 임포트하면 이 이음새가 조용히 끊긴다.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import NamedTuple

import numpy as np

from ...engine import quant_engine as qe
from .. import funding_basis
from .bok_breakdown import build_bok_breakdown
from .daily_valuation import (
    _is_matured,
    calc_dynamic_funding_rate,
    calculate_daily_carry,
    calculate_daily_funding_cost,
    calculate_daily_mtm,
    get_position_shock_bp,
    interpolate_curve_shift,
)
from . import bond_roll
from .bond_recon import build_bond_daily_recon
from .carry_split import base_cash_carry_paths
from .kr_calendar import build_bizday_schedule
from .models import FrontendPosition, FrontendShockCurves
from .recon import build_irs_daily_recon, build_pos_trades
from .swap_schedule import resolve_swap_horizon

logger = logging.getLogger(__name__)


class ChartRun(NamedTuple):
    """한 시나리오 런의 산출물 전부.

    앞 7필드는 종전 7-튜플과 순서·내용이 같다 — 위치 언패킹 호환. 뒤 2필드는
    종전에 decomposition dict 안에 "daily"/"swapContributions" 로 밀수되던
    것을 꺼낸 것이다(orchestrator 가 pop 하던 그 값 그대로; decomposition
    에는 이제 다섯 성분 + total 만 산다).
    """

    chart_data: list[dict]
    summary: dict
    settlement_events: list[dict]
    daily_recon: list[dict]
    funding_curve: list[dict]
    decomposition: dict
    rate_path: list[dict]
    decomposition_daily: list[dict]
    swap_contributions: list[dict]
    #: 채권 일별 대사 — 자기 표 [OWNER, 2026-08-25]. 채권 없는 런은 None.
    bond_daily_recon: dict | None = None


def _build_irs_shock_curve(
    shock_mode: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
) -> list[tuple[float, float]]:
    """IRS FM용 (tenor_years, shock_bp) 충격 커브 구성.
    평행이동: [(0, bp), (30, bp)] 플랫 커브.
    비평행이동: swapCurve [{t, val}] → [(t, val), ...] 변환.

    ※ swapCurve.val은 프론트엔드에서 이미 bp 절댓값(baseShockBp + irsSpread)으로 전달됨.
       base_shock_bp를 곱하면 이중 스케일 오류이므로 val을 그대로 사용한다.
       (run_simulation()에서 irs_shock_curve_prebuilt가 항상 주입되므로 이 함수는 fallback 경로)
    """
    if shock_mode == "parallel" or not shock_curves or not shock_curves.swapCurve:
        return [(0.0, base_shock_bp), (30.0, base_shock_bp)]
    parsed = [
        (float(p.get("t", 0)), float(p.get("val", 0)))  # val = bp 절댓값, 곱셈 불필요
        for p in shock_curves.swapCurve
        if float(p.get("t", 0)) > 0
    ]
    return parsed if parsed else [(0.0, base_shock_bp), (30.0, base_shock_bp)]


def build_chart_data(
    positions: list[FrontendPosition],
    shock_curves: FrontendShockCurves | None,
    funding_rate: float,
    funding_events: list[dict],
    sim_days: int,
    shock_type: str,
    shock_mode: str,
    base_shock_bp: float,
    base_date_str: str,
    irs_curves: list[dict] | None = None,
    irs_shock_curve_prebuilt: list[tuple[float, float]] | None = None,
    custom_path: list[dict] | None = None,
    skip_recon: bool = False,
    funding_rate_fixed: bool = False,
    funding_stepping: bool = False,
) -> ChartRun:
    """ChartRun (필드 목록·의미는 클래스 doc).

    rate_path (s18 T3): 이 런이 소비한 국채 3Y 누적 충격 경로 [{day, bp}] —
    chart_data와 같은 day 축. 분포 밴드의 금리 팬(이중축 분리) 원천.

    funding_curve (s11 T4): 시뮬레이션 타임스텝별 조달금리/포지션 운용수익률/캐리 bp.
    chartData와 같은 영업일 스케줄(+day 0 앵커)로 정렬된다.

    skip_recon (s11 T3): 분포 밴드용 퍼센타일 런은 IRS 일별 대사표가 필요 없어
    그 계산(영업일당 커브 부트스트랩+범프, IRS_Trade 사전 빌드까지 통째로)을
    건너뛴다. 기본 False — 원본 경로의 산출물은 변하지 않는다.

    funding_rate_fixed (s15 T1): True면 조달금리 쪽 계산(_funding_row·캐리의
    active_rate)이 funding_events 계단 스테핑을 받지 않고 funding_rate 상수를
    전 기간 그대로 쓴다. 금리 경로(쇼크) 쪽의 funding_events 사용(BOK 계단,
    FM 엔진 경로)은 영향받지 않는다 — 소유자 스펙: 조달은 상수, 시나리오
    금리 경로는 그대로.

    decomposition (s15 T2): 만기 시점 Total Return의 성분 분해(라운딩 전 float).
    bondMtm + bondCarry + bondRolldown + fundingCost + swapMtm + swapCarry +
    swapRolldown == totalPnL(비라운딩)이 부동소수점 항등으로 성립한다 — 모두
    같은 루프의 같은 누적기에서 나온 같은 float들이다(bondCarry는 총
    이자수익+재투자수익, fundingCost는 음수, bondRolldown 은 2026-08-25 에
    합류한 동결 민평 커브 롤 — bond_roll.py).
    """
    try:
        base_date = date.fromisoformat(base_date_str)
    except Exception:
        base_date = date.today()

    chart_data: list[dict] = []
    cumulative_bond_carry = 0.0   # 채권 캐리 + 만기 재투자 수익
    cumulative_irs_carry  = 0.0   # IRS 일별 캐리 누적
    cumulative_funding    = 0.0   # s15 T2: 조달 비용 병렬 누적 (양수; 분해 전용)
    break_even_day = -1
    is_broken_even = False
    # HARDEN-1: 스왑 세타/평가 최종값(비라운딩) + 일별 분해 경로. 루프가 한 번도
    # 돌지 않는 극단(sim_days=0 미만)에서도 정의되도록 여기서 초기화한다.
    # [OWNER, 2026-08-11] 세타는 다시 캐리(순액크루얼+정산)와 롤다운(세타−캐리)
    # 으로 갈린다 — carry_split.py 모듈 doc 참조.
    swap_theta_pnl = 0.0
    swap_valuation_pnl = 0.0
    swap_carry_cash_pnl = 0.0
    swap_rolldown_pnl = 0.0
    decomposition_daily: list[dict] = []

    # s15 T1: 조달 비용 쪽이 보는 이벤트 목록 — 고정 조달 모드에서는 비운다.
    # 금리 경로(쇼크) 쪽 funding_events 사용은 아래에서 원본 그대로다.
    # SIM2-5 (ruling ④): 고정 모드에서도 옵트인 시 조달 비용이 금통위 이벤트로
    # 스테핑한다(base = 정책 상수). 기본(False)은 종전 고정 동작 그대로.
    _cost_events = [] if (funding_rate_fixed and not funding_stepping) else (funding_events or [])

    # 만기 채권을 재투자 Cash Pool로 추적
    bond_positions = [p for p in positions if p.bondType != "swap"]
    irs_positions  = [p for p in positions if p.bondType == "swap"]

    # 커스텀 경로 사전 처리 (웨이포인트 기반 factor 보간) — SIM2-4에서 IRS FM
    # 사전 계산보다 먼저 쓰이도록 함수 상단으로 이동(동작 불변).
    _sorted_cp = sorted(
        [{"day": int(p.get("day", 0)), "bp": float(p.get("bp", 0))} for p in (custom_path or [])],
        key=lambda x: x["day"],
    ) if custom_path else []

    def _factor(t: int) -> float:
        if _sorted_cp and base_shock_bp != 0:
            if t <= _sorted_cp[0]["day"]:
                return _sorted_cp[0]["bp"] / base_shock_bp
            if t >= _sorted_cp[-1]["day"]:
                return _sorted_cp[-1]["bp"] / base_shock_bp
            for i in range(len(_sorted_cp) - 1):
                lo, hi = _sorted_cp[i], _sorted_cp[i + 1]
                if lo["day"] <= t <= hi["day"]:
                    if hi["day"] == lo["day"]:
                        return lo["bp"] / base_shock_bp
                    r = (t - lo["day"]) / (hi["day"] - lo["day"])
                    return (lo["bp"] + r * (hi["bp"] - lo["bp"])) / base_shock_bp
        return (t / sim_days) if shock_type == "ramp" else (1.0 if t > 0 else 0.0)

    # ── SIM2-4 (ruling ③) — 스왑 경로 정합 활성화 조건 ──────────────────────
    # 경로 팩터는 설계 경로가 '비자명'할 때만 FM 엔진에 전달한다. 비자명 =
    # 웨이포인트가 캘린더 선형 램프(target × day/simDays)에서 벗어남. 자명한
    # 경로(빈 customPath, 정확한 선형 램프 — 골든 캡처의 대표 픽스처 포함)는
    # 종전 step/biz-ramp 레짐과 바이트 동일하게 남는다(절대-파라미터-부재
    # 바이트 동일성 게이트가 구조적으로 성립). 배열은 채권 쪽과 '같은'
    # _factor에서 뽑는다 — 병렬 수학 없음.
    _path_factor_arr: "np.ndarray | None" = None
    if _sorted_cp and base_shock_bp != 0 and any(
        abs(p["bp"] - base_shock_bp * p["day"] / sim_days) > 1e-9 for p in _sorted_cp
    ):
        _path_factor_arr = np.array([_factor(d) for d in range(sim_days + 1)], dtype=float)

    # ── IRS FM(Full Revaluation) 경로 사전 계산 ─────────────────────────────
    par_rates       = qe.parse_irs_curves(irs_curves or [], base_date=base_date)
    irs_fm_mtm      = np.zeros(sim_days + 1)   # 포트폴리오 합산 MTM 궤적 (실제 P&L = 세타+평가)
    irs_fm_mtm_theta = np.zeros(sim_days + 1)  # 세타손익 궤적 — 커브는 base_date 시점에 고정(zc_base),
                                                # 시간만 경과. metrics['npv_b']/['scf_b']에서 재구성.
    irs_fm_carry    = np.zeros(sim_days + 1)   # FM 파생 일별 캐리 (리픽싱 비선형 포함)
    irs_daily_scf   = np.zeros(sim_days + 1)   # 일별 리픽싱 정산 CF 합산 (scf_s)
    irs_shock_curve = (
        irs_shock_curve_prebuilt
        if irs_shock_curve_prebuilt is not None
        else _build_irs_shock_curve(shock_mode, base_shock_bp, shock_curves)
    )
    # 대사/진단의 KRD 재계산용 — 쇼크커브 numpy 배열로 미리 변환
    _irs_sc_t  = np.array([_st for _st, _ in irs_shock_curve], dtype=float) if irs_shock_curve else np.array([0.0, 30.0])
    _irs_sc_bp = np.array([_sb for _, _sb in irs_shock_curve], dtype=float) if irs_shock_curve else np.array([0.0,  0.0])
    irs_settlement_events: list[dict] = []
    # 2026-08-06 (추가 전용): 포지션별 만기 시점 기여. 아래 스왑 루프가 이미
    # 만들어 놓고 버리던 궤적의 마지막 값을 줍는다.
    swap_contributions: list[dict] = []
    _base_dt = None
    try:
        _base_dt = date.fromisoformat(base_date_str[:10]) if base_date_str else None
    except Exception:
        pass

    for i, p in enumerate(irs_positions):
        t_mat, t_next = resolve_swap_horizon(p.remainingDays, p.nextFixingDate, base_date_str)

        try:
            mtm_arr, _, carry_arr, metrics, *_ = qe.simulate_irs_path_fm(
                par_rates              = par_rates,
                notional               = p.notional or 0.0,
                fixed_rate_pct         = p.couponRate or 0.0,
                direction              = int(p.direction or 1),
                t_maturity             = t_mat,
                t_next_payment         = t_next,
                current_float_rate_pct = p.currentFloatRate or 0.0,
                sector                 = p.sector or "IRS",
                shock_curve            = irs_shock_curve,
                days_to_simulate       = sim_days,
                shock_type             = shock_type,
                base_date_str          = base_date_str,
                start_date_str         = str(p.startDate)[:10] if p.startDate else "",
                funding_events         = funding_events,
                # SIM2-4: 비자명 설계 경로일 때만 값이 있다(위 활성화 조건).
                path_factor            = _path_factor_arr,
            )
            irs_fm_mtm   += mtm_arr
            irs_fm_carry += carry_arr

            # 2026-08-06 (추가 전용) — 포지션별 만기 시점 기여.
            #
            # 엔진은 이미 스왑 하나하나의 궤적(mtm_arr / carry_arr)을 만들고 그
            # 자리에서 합산해 버린다. 마지막 값만 따로 붙들어 두면 추가 엔진
            # 실행 없이 "어느 스왑이 손익을 끌었나"에 답할 수 있다 — 버려지던
            # 정보를 줍는 것이지 새로 계산하는 것이 아니다.
            #
            # 궤적 전체가 아니라 **마지막 값만** 담는다: 377건 × 181일이면
            # 페이로드가 응답 전체보다 커지는데, 이 표가 답하는 질문("누가
            # 끌었나")에는 마지막 값 하나면 충분하다.
            _last = lambda a: float(a[-1]) if len(a) else 0.0  # noqa: E731
            swap_contributions.append({
                "positionId":   getattr(p, "id", "") or "",
                "positionName": getattr(p, "name", "") or getattr(p, "id", "") or "",
                "book":         getattr(p, "book", "") or "",
                "notional":     float(p.notional or 0.0),
                "direction":    int(p.direction or 1),
                "fixedRate":    float(p.couponRate or 0.0),
                "maturityDate": str(p.maturityDate)[:10] if p.maturityDate else None,
                "mtm":          _last(mtm_arr),
                "carry":        _last(carry_arr),
                "total":        _last(mtm_arr) + _last(carry_arr),
            })

            # 세타손익 궤적 재구성: npv_b(커브 고정 zc_base)와 scf_b(같은 커브 기준 정산CF)로
            # mtm_pnl과 동일한 방식(누적 정산CF + 클린 NPV 변화)으로 조립 — 커브가 base_date
            # 그대로 고정되어 있으니 이 궤적의 day-to-day 변화가 곧 "순수 세타"다.
            _npv_b_arr = np.asarray(metrics.get("npv_b", []), dtype=float)
            _scf_b_arr = np.asarray(metrics.get("scf_b", []), dtype=float)
            if _npv_b_arr.size > 0:
                _clip_b = min(_npv_b_arr.size, sim_days + 1)
                _mtm_b = (_npv_b_arr[:_clip_b] - _npv_b_arr[0]) + np.cumsum(_scf_b_arr[:_clip_b])
                irs_fm_mtm_theta[:_clip_b] += _mtm_b

            # 정산 이벤트 수집 (scf_s 배열에서 0이 아닌 날 = 리픽싱 정산일)
            scf_arr = metrics.get("scf_s", [])
            _scf_np = np.array(scf_arr, dtype=float)
            _clip   = min(len(_scf_np), sim_days + 1)
            if _clip > 0:
                irs_daily_scf[:_clip] += _scf_np[:_clip]

            for day_idx, scf in enumerate(scf_arr):
                if day_idx > 0 and abs(float(scf)) > 1:
                    event_date = (_base_dt + timedelta(days=day_idx)).isoformat() if _base_dt else None
                    irs_settlement_events.append({
                        "day":          day_idx,
                        "date":         event_date,
                        "positionName": getattr(p, "name", "") or getattr(p, "id", ""),
                        "positionId":   getattr(p, "id", ""),
                        "notional":     p.notional or 0,
                        "direction":    int(p.direction or 1),
                        "fixedRate":    p.couponRate or 0,
                        "settledCf":    round(float(scf)),
                    })
        except Exception as e:
            logger.exception("=== [CRITICAL] 엔진 크래시 상세 추적 (%s) ===", getattr(p, "id", ""))
            raise ValueError(f"FM Engine Crash ({getattr(p, 'id', '')}): {e}") from e

    # ── 세타의 캐리/롤다운 분리용 동결 커브 순캐리 경로 [OWNER, 2026-08-11] ──
    # carry_split.py 재구성(엔진 base 브랜치와 같은 스케줄·같은 리픽싱 물리 —
    # 모듈 doc + test_simulate_carry_split 대조). skip_recon(분포 밴드) 런에도
    # 계산한다: decomposition 이 모든 런의 산출물이라, 안 쓰는 필드라도 0 으로
    # 채워 거짓말하게 두지 않는다(스왑당 부트스트랩 1회 — 엔진 호출 대비 미미).
    irs_fm_carry_cash = (
        base_cash_carry_paths(
            build_pos_trades(irs_positions, base_date, base_date_str),
            par_rates, base_date, sim_days,
        )
        if (irs_positions and par_rates)
        else np.zeros(sim_days + 1)
    )

    # 영업일 스케줄 (한국 공휴일+주말 제외) — recon/메인 시뮬 루프 공용
    _bizday_schedule = build_bizday_schedule(base_date, sim_days)

    # 단기 이벤트 계단 함수: funding_events 날짜 → D+N 변환
    try:
        _short_evts = sorted(
            [
                {
                    "day": (date.fromisoformat(ev["date"]) - base_date).days,
                    "bp":  float(ev.get("shiftBp", 0)),
                }
                for ev in (funding_events or [])
                if ev.get("date") and 0 <= (date.fromisoformat(ev["date"]) - base_date).days <= sim_days
            ],
            key=lambda x: x["day"],
        )
        _cum_short = sum(e["bp"] for e in _short_evts)
    except Exception:
        _short_evts = []
        _cum_short = 0.0

    def _short_factor(t: int) -> float:
        """잔존 1Y 미만 채권용: BOK 이벤트 누적 변동 기준 정규화 계단 함수."""
        if not _short_evts or _cum_short == 0:
            return _factor(t)
        cum_t = sum(e["bp"] for e in _short_evts if e["day"] <= t)
        return cum_t / _cum_short

    # ── s11 T4: 시간축 조달금리/캐리 스트립 ─────────────────────────────────
    def _weighted_position_rate(t: int, multiplier: float, cur_date: date) -> float | None:
        """비만기 채권의 평가액가중 쿠폰(마크) 수익률(소수). calculate_daily_carry
        와 같은 정의여야 캐리 표기가 엔진의 캐리 계산과 어긋나지 않는다 —
        [OWNER, 2026-08-25 — "충격 미가산"] 캐리가 쿠폰 고정으로 정정되면서
        여기서도 경로 충격 가산을 걷어냈다(감사록 F1). 살아있는 채권이 없으면
        None. `multiplier` 인자는 호출부 계약 유지용으로 남는다."""
        tot_eval = 0.0
        acc = 0.0
        for p in bond_positions:
            initial_remaining = max(float(p.remainingDays or 0), 0.0)
            matured = _is_matured(p, cur_date) or (initial_remaining > 0 and t >= initial_remaining)
            if matured:
                continue
            ev = p.evaluationAmount or 0.0
            if ev <= 0:
                continue
            acc += ev * (p.mtmYield or 0.0)
            tot_eval += ev
        return (acc / tot_eval) / 100.0 if tot_eval > 0 else None

    # SIM2-7 (owner ruling): 고정 모드의 조달 '베이스'는 날짜별 실적 기준금리
    # (BOK 시계열, 커버리지 내) + 스프레드 — 조인 이후는 정책 상수. 명시적
    # fundingRate(레거시/골든 경로)는 종전 그대로. SIM2-5 이벤트 스테핑은
    # calc_dynamic_funding_rate가 이 베이스 위에 쌓는다(이중 계상 없음).
    def _funding_base(cur_date: date) -> float:
        return funding_basis.funding_rate_at(cur_date) if funding_rate_fixed else funding_rate

    def _funding_row(t: int, cur_date: date, multiplier: float) -> dict:
        rate = calc_dynamic_funding_rate(_funding_base(cur_date), _cost_events, cur_date)
        pos_rate = _weighted_position_rate(t, multiplier, cur_date)
        return {
            "day": t,
            "date": cur_date.isoformat(),
            "fundingRate": rate,        # 소수 (0.042 = 4.2%)
            "positionRate": pos_rate,   # 소수; 살아있는 채권 없으면 None
            "carryBp": None if pos_rate is None else round((pos_rate - rate) * 10000.0, 2),
        }

    funding_curve: list[dict] = []

    # ── s18 T3: 이 런이 실제로 소비한 국채 3Y 누적 충격 경로 (bp) ────────────
    # 금리 팬(이중축 분리의 1축)은 "라벨이 진실인" 금리 분위수 밴드를 그린다 —
    # 그 원천은 엔진이 채권 쇼크에 실제로 쓴 것과 같은 변수들이다: matrix 모드는
    # 국채 커브의 3Y 노드 보간 × multiplier, parallel 모드는 base_shock_bp ×
    # multiplier. 새 수식이 아니라 calculate_daily_mtm이 소비하는 항의 3Y 단면.
    def _ktb3y_bp(mult: float) -> float:
        if shock_mode == "parallel" or not shock_curves:
            return (base_shock_bp or 0.0) * mult
        ktb = shock_curves.bondCurves.get("국채") or []
        return interpolate_curve_shift(3.0, ktb) * mult

    rate_path: list[dict] = []

    # Day 0 초기 항목 (모든 P&L = 0)
    chart_data.append({"day": 0, "mtmPnL": 0, "cumulativeCarry": 0, "swapPnL": 0, "totalPnL": 0,
                        "swapThetaPnL": 0, "swapValuationPnL": 0,
                        "swapCashCarryPnL": 0, "swapRolldownPnL": 0, "bondRolldownPnL": 0})
    # HARDEN-1: 일별 분해 경로도 chartData와 같은 day 축 — day 0 = 전 성분 0.
    decomposition_daily.append({
        "day": 0, "fundingCost": 0.0, "bondMtm": 0.0, "bondCarry": 0.0,
        "bondRolldown": 0.0,
        "swapMtm": 0.0, "swapCarry": 0.0, "swapRolldown": 0.0, "total": 0.0,
    })
    funding_curve.append(_funding_row(0, base_date, _factor(0)))
    rate_path.append({"day": 0, "bp": _ktb3y_bp(_factor(0))})

    prev_cal        = 0
    prev_short_mult = _short_factor(0)
    bond_mtm  = 0.0   # 루프가 비어도(영업일 0일) 분해가 정의되도록 초기화
    irs_mtm_t = 0.0
    # ── 채권 롤다운 레인 [OWNER, 2026-08-25] — bond_roll 모듈 doc 참조 ──────
    # 동결 민평 커브는 app 계층이 등록한 공급자에서 온다. 없으면(SQL 다운·
    # 미등록) 롤 0 + provenance 가 그 사실을 싣는다 — 종전(unchanged-yields)
    # 동작으로 정직하게 강등.
    _bond_curves = bond_roll.sector_curves() if bond_positions else None
    _bond_roll_basis = bond_roll.provenance(bond_positions, _bond_curves)
    cumulative_bond_roll = 0.0
    for current_date, cal_day, dt_cal in _bizday_schedule:
        t = cal_day
        multiplier = _factor(t)
        short_mult  = _short_factor(t)
        active_rate = calc_dynamic_funding_rate(_funding_base(current_date), _cost_events, current_date)

        # 채권: 기존 선형 MTM / IRS: FM 결과 직접 사용 (내부에서 이미 ramp/step 적용)
        bond_mtm  = calculate_daily_mtm(bond_positions, shock_mode, shock_type, base_shock_bp, shock_curves, multiplier, t, current_date, short_mult)
        irs_mtm_t = float(irs_fm_mtm[t])

        # BOK 이벤트 당일/영업일: 구간별 MTM 변화 분해 (검증용, bok_breakdown.py)
        bok_breakdown = None
        if _short_evts and short_mult != prev_short_mult:
            bok_breakdown = build_bok_breakdown(
                bond_positions=bond_positions,
                irs_positions=irs_positions,
                shock_mode=shock_mode,
                shock_type=shock_type,
                base_shock_bp=base_shock_bp,
                shock_curves=shock_curves,
                multiplier=multiplier,
                short_mult=short_mult,
                t=t,
                prev_cal=prev_cal,
                current_date=current_date,
                prev_date_bd=base_date + timedelta(days=prev_cal),
                prev_mult_bd=_factor(prev_cal),
                prev_sf_bd=_short_factor(prev_cal),
                dt_cal=dt_cal,
                sim_days=sim_days,
                short_evts=_short_evts,
                path_factor_arr=_path_factor_arr,
                irs_sc_t=_irs_sc_t,
                irs_sc_bp=_irs_sc_bp,
                par_rates=par_rates,
                # 프로파일러/몽키패치 이음새 — 모듈 doc 참조: 호출 시점에 이
                # 모듈 전역에서 해석한 (감싸졌을 수도 있는) 함수를 넘긴다.
                daily_mtm_fn=calculate_daily_mtm,
            )
        # 일별 캐리: 채권만 calculate_daily_carry, IRS는 FM 엔진 리턴 값 사용 (리픽싱 비선형 반영)
        bond_carry  = calculate_daily_carry(bond_positions, shock_mode, shock_type, base_shock_bp, shock_curves, active_rate, multiplier, t, current_date, dt_cal=dt_cal)
        # s15 T2: 같은 인자의 조달 비용 성분만 병렬 누적 (분해 전용 — 기존 수치 불변)
        cumulative_funding += calculate_daily_funding_cost(bond_positions, active_rate, t, current_date, dt_cal=dt_cal)
        irs_carry_t = float(np.sum(irs_fm_carry[prev_cal + 1:t + 1]))
        # 만기 채권의 재투자 수익: Notional 기준으로 Funding Cost와 정확히 상쇄
        reinvested_cash = sum(
            p.notional or 0.0
            for p in bond_positions
            if float(p.remainingDays or 0) <= t
        )
        daily_cash_return = reinvested_cash * active_rate * dt_cal / 365.0

        cumulative_bond_carry += (bond_carry or 0.0) + daily_cash_return
        cumulative_irs_carry  += (irs_carry_t or 0.0)
        # 채권 롤다운 — 동결 민평 커브 위 잔존 단축, 스왑 세타와 같은 걸음.
        cumulative_bond_roll += bond_roll.step_roll(
            bond_positions, _bond_curves, prev_cal, t, current_date
        )

        # 스왑손익 = IRS MTM + 누적 IRS 캐리
        swap_pnl  = irs_mtm_t + cumulative_irs_carry
        total_pnl = bond_mtm + cumulative_bond_carry + cumulative_bond_roll + swap_pnl
        total_mtm = bond_mtm + irs_mtm_t   # BEP 체크용 — 마크무브만, 롤은 세타 쪽

        # 스왑손익 분해: 세타손익(커브 고정, 시간경과만) + 평가손익(그날 실제 커브변동)
        # irs_fm_mtm_theta는 irs_fm_mtm과 동일한 방식(누적 정산CF+클린NPV변화)으로 조립된
        # "커브 고정" 궤적이라, 둘의 차이가 곧 누적 평가손익이다(일별 대사표와 동일 정의).
        swap_theta_pnl      = float(irs_fm_mtm_theta[t]) + cumulative_irs_carry
        swap_valuation_pnl  = swap_pnl - swap_theta_pnl
        # [OWNER, 2026-08-11] 세타 안의 캐리(동결 경로 순액크루얼+정산)와
        # 롤다운(잔여 = 만기 압축의 클린 가격 변화). 합은 세타와 동일하므로
        # 평가+캐리+롤다운 == 스왑손익이 그대로 성립한다.
        swap_carry_cash_pnl = float(irs_fm_carry_cash[t]) + cumulative_irs_carry
        swap_rolldown_pnl   = swap_theta_pnl - swap_carry_cash_pnl

        if total_pnl >= 0 and total_mtm < 0 and not is_broken_even:
            break_even_day = t
            is_broken_even = True

        entry: dict = {
            "day": t,
            "mtmPnL":         round(bond_mtm)             if bond_mtm             else 0,
            "cumulativeCarry": round(cumulative_bond_carry) if cumulative_bond_carry else 0,
            "swapPnL":        round(swap_pnl)              if swap_pnl             else 0,
            "totalPnL":       round(total_pnl)             if total_pnl            else 0,
            "swapThetaPnL":     round(swap_theta_pnl)      if swap_theta_pnl       else 0,
            "swapValuationPnL": round(swap_valuation_pnl)  if swap_valuation_pnl   else 0,
            "swapCashCarryPnL": round(swap_carry_cash_pnl) if swap_carry_cash_pnl  else 0,
            "swapRolldownPnL":  round(swap_rolldown_pnl)   if swap_rolldown_pnl    else 0,
            "bondRolldownPnL":  round(cumulative_bond_roll) if cumulative_bond_roll else 0,
        }
        # HARDEN-1: 일별 누적 성분 분해(비라운딩 float) — 최종 decomposition과
        # 같은 누적기에서 나온 같은 float들이라 매일
        # fundingCost + bondMtm + bondCarry + swapMtm + swapCarry + swapRolldown
        # == total 이 성립한다(±1원 핀). 스왑 성분은 평가/캐리/롤다운 3분해
        # (아래 decomposition 주석 참조) — 종전 swapCarry(세타 전액)는
        # swapCarry(순캐리) + swapRolldown 으로 갈라졌고 합은 동일하다.
        decomposition_daily.append({
            "day":         t,
            "fundingCost": -cumulative_funding,
            "bondMtm":     bond_mtm,
            "bondCarry":   cumulative_bond_carry + cumulative_funding,
            "bondRolldown": cumulative_bond_roll,
            "swapMtm":     swap_valuation_pnl,
            "swapCarry":   swap_carry_cash_pnl,
            "swapRolldown": swap_rolldown_pnl,
            "total":       total_pnl,
        })
        if bok_breakdown:
            entry["bokBreakdown"] = bok_breakdown
        chart_data.append(entry)
        funding_curve.append(_funding_row(t, current_date, multiplier))
        rate_path.append({"day": t, "bp": _ktb3y_bp(multiplier)})

        prev_cal        = t
        prev_short_mult = short_mult

    last = chart_data[-1] if chart_data else {}
    summary = {
        "finalMTM":   last.get("mtmPnL", 0),
        "finalCarry": last.get("cumulativeCarry", 0),
        "finalSwap":  last.get("swapPnL", 0),
        "finalTotal": last.get("totalPnL", 0),
        "breakEvenDay": break_even_day,
    }

    # ── 일별 손익 대사표 — 스왑·채권 **각자 자기 표** [OWNER, 2026-08-25] ──
    #
    # 2026-08-21 판은 채권 성분을 스왑 표에 합산했다. 엔진 단위 분리 룰링으로
    # 스왑 표는 v1 계약(스왑만·par 커브 필요)으로 돌아가고, 채권은 아래
    # `bond_recon` 이 자기 표를 세운다 — 같은 루프의 `decomposition_daily`
    # 차분이라 두 번째 정의는 여전히 없다.
    #
    # 배포 계약 보정(종전 주석 승계): 실제 프론트 브리지는 irsCurves 를 비워
    # 보내고 스왑이 있을 때만 스냅샷에서 채워진다. 스왑이 있는데 커브가 없으면
    # 원본과 동일하게 FM 경로에서 먼저 실패한다.
    irs_daily_recon: list[dict] = (
        build_irs_daily_recon(
            irs_positions=irs_positions,
            par_rates=par_rates,
            base_date=base_date,
            base_date_str=base_date_str,
            sim_days=sim_days,
            shock_type=shock_type,
            irs_sc_t=_irs_sc_t,
            irs_sc_bp=_irs_sc_bp,
            path_factor_arr=_path_factor_arr,
            funding_events=funding_events,
            bizday_schedule=_bizday_schedule,
            irs_fm_mtm=irs_fm_mtm,
            irs_fm_mtm_theta=irs_fm_mtm_theta,
            irs_daily_scf=irs_daily_scf,
            irs_fm_carry_cash=irs_fm_carry_cash,
        )
        if (par_rates and irs_positions and not skip_recon)
        else []
    )
    bond_daily_recon: dict | None = (
        build_bond_daily_recon(
            bond_positions=bond_positions,
            decomposition_daily=decomposition_daily,
            bizday_schedule=_bizday_schedule,
            base_date=base_date,
            shock_mode=shock_mode,
            base_shock_bp=base_shock_bp,
            shock_curves=shock_curves,
            factor_at=_factor,
            roll_basis=_bond_roll_basis,
        )
        if (bond_positions and not skip_recon)
        else None
    )

    # s15 T2 — 만기 시점 Total Return 분해 (비라운딩 float; 문서화된 항등:
    # bondMtm + bondCarry + fundingCost + swapMtm + swapCarry + swapRolldown
    # == 최종 totalPnL, ±1원). bondCarry = 총 이자수익 + 만기 재투자 수익
    # (= net 누적 + 조달 누적), fundingCost = -조달 누적. 모두 위 루프의 같은
    # float 누적기에서 나온다.
    #
    # HARDEN-1 (스왑캐리 어드주디케이션, route ii — 경위는 git 기록): 스왑도
    # 채권처럼 평가 vs 캐리로 나눴다(swapCarry = 세타 전액).
    #
    # [OWNER, 2026-08-11 — 교과서 3분해]: 세타 버킷을 문헌(Clarus carry 정의,
    # Tuckman unchanged-term-structure)대로 다시 가른다 — swapCarry = 동결
    # 커브 경로의 순액크루얼+정산(캐리: "아무것도 안 해서 확정되는" 몫),
    # swapRolldown = 세타 − 캐리(만기 압축의 클린 가격 변화), swapMtm =
    # 평가손익(전체 − 세타, 종전 그대로). 셋의 합은 종전 스왑 전액과 동일하다.
    # 백테스트의 3분해(app/backtest.py)와 같은 정의라 두 탭이 같은 말을 한다.
    #
    # (2026-08-10) "daily"/"swapContributions" 는 더 이상 이 dict 에 밀수하지
    # 않는다 — ChartRun 의 자기 필드로 나간다.
    decomposition = {
        "bondMtm":     bond_mtm,
        "bondCarry":   cumulative_bond_carry + cumulative_funding,
        # [OWNER, 2026-08-25] 채권 다리의 빠져 있던 항 — 동결 민평 커브 위
        # 잔존 단축(bond_roll.py). 스왑 다리와 같은 unchanged-term-structure
        # 가정이 되면서 총액 자체가 이 항만큼 옳아진다.
        "bondRolldown": cumulative_bond_roll,
        "fundingCost": -cumulative_funding,
        "swapMtm":     swap_valuation_pnl,
        "swapCarry":   swap_carry_cash_pnl,
        "swapRolldown": swap_rolldown_pnl,
        "total":       bond_mtm + cumulative_bond_carry + cumulative_bond_roll
                       + irs_mtm_t + cumulative_irs_carry,
    }

    return ChartRun(
        chart_data=chart_data,
        summary=summary,
        settlement_events=irs_settlement_events,
        daily_recon=irs_daily_recon,
        funding_curve=funding_curve,
        decomposition=decomposition,
        rate_path=rate_path,
        decomposition_daily=decomposition_daily,
        swap_contributions=swap_contributions,
        bond_daily_recon=bond_daily_recon,
    )
