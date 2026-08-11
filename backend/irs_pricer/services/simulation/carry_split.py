"""스왑캐리(세타)의 캐리/롤다운 분리 — 동결 커브 순액크루얼 경로.

[OWNER, 2026-08-11 — "평가손익과 캐리 손익, 롤다운 손익으로 분리해서 …
Textbook의 기준에 맞게"]

엔진의 세타 궤적(irs_fm_mtm_theta: 커브를 base_date에 동결하고 시간만 흘린
전액 재평가)은 교과서의 carry-roll-down 합산 버킷이다. 문헌(Clarus
"Mechanics and Definitions of Carry", Tuckman unchanged-term-structure)은 그
버킷을 둘로 가른다:

  캐리   = 아무것도 하지 않아 확정되는 현금흐름 — 고정금리와 (동결 커브
           경로의) 변동 픽싱의 쿠폰 차 액크루얼 + 실제 정산 CF.
  롤다운 = 세타 − 캐리 — 커브가 그대로인데 잔존만기가 짧아져서 생기는
           클린 가격 변화(만기 압축, pull-to-par 포함).

이 모듈은 그 캐리 경로를 엔진 **바깥에서** 재구성한다(동결 이식 코드인
quant_engine 은 건드리지 않는다는 룰). 재구성이 엔진과 같은 물리를 쓰는
근거: 베이스(무충격) 경로의 리픽싱은 simulate_irs_path_fm 의 base 브랜치와
동일하게 `forward_rate_simple(0, 잔존스텁, zc_base)` — 동결 커브의 잔존
테너 **스팟**이고(HANDOFF 2026-08-10 외부 검증), 정산 CF 는 같은 스케줄
(IRS_Trade.pay_dates/accruals)의 같은 식 `±N×(K−F)/100×accrual` 이다.
`tests/test_simulate_carry_split.py` 가 재구성 정산액과 엔진의 `scf_b` 를
전 구간 대조해 이 주장을 못박는다.

백테스트 쪽 3분해(app/backtest.py — 캐리 = Δ액크루얼 + 정산현금)와 같은
정의라, 두 탭의 "캐리/롤다운"이 같은 말을 한다.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from ...engine import quant_engine as qe

DT = 1.0 / 365.0


def base_cash_carry_path(
    trade: "qe.IRS_Trade | None",
    flt_raw_pct: float,
    par_rates: list[tuple[float, float]],
    base_date: date,
    sim_days: int,
    settled_out: "np.ndarray | None" = None,
) -> np.ndarray:
    """스왑 하나의 동결 커브 누적 순캐리 경로 (길이 sim_days+1, KRW).

    day d 의 값 = base_date 이후 d일까지 (정산된 순 CF) + (현재 기간의
    미정산 순액크루얼) − (day 0 시점의 미정산 순액크루얼). 세타 궤적과 같은
    "P&L since day 0" 기준이다.

    `settled_out` (길이 sim_days+1): 주면 일별 정산 CF 를 그대로 담아 준다 —
    엔진의 `scf_b` 와 날·액수 단위로 대조하는 테스트 계측용이다. 프로덕션
    경로는 넘기지 않는다.
    """
    D = sim_days + 1
    path = np.zeros(D)
    if trade is None or not par_rates:
        return path

    # 엔진과 같은 순서: 앵커 주입은 **원본** float 값(≤0 이어도)으로, 스팟
    # 픽싱 폴백은 부트스트랩 후에.
    par_anch = qe._inject_short_anchors(par_rates, flt_raw_pct / 100.0)
    zc_base = qe.bootstrap_zero_curve(par_anch)
    flt = flt_raw_pct
    if flt <= 0.0:
        flt = qe.forward_rate_simple(0.0, 0.25, zc_base) * 100.0

    K = trade.fixed_rate_pct
    dirn = float(trade.direction)
    notional = trade.notional
    pay_dates = trade.pay_dates
    accruals = trade.accruals

    settle0 = qe.next_kr_business_day(base_date)
    # day-0 롤오버: base_date 와 settle0 사이에 지급일이 끼면 그 옛 픽싱은
    # 이미 굴러갔다 — 엔진의 Ghost-Jump 방지 로직과 동일(그쪽 주석 참조).
    if any(base_date < pd <= settle0 for pd in pay_dates):
        rem0 = [pd for pd in pay_dates if pd > settle0]
        if rem0:
            t_nn0 = max((rem0[0] - settle0).days / 365.0, DT)
            flt = qe.forward_rate_simple(0.0, t_nn0, zc_base) * 100.0

    def accrued_at(settle_d: date, flt_now: float) -> float:
        """현재 기간의 미정산 순액크루얼 (기간 시작 → settle_d, ACT/365)."""
        if settle_d <= trade.start_date or settle_d >= pay_dates[-1]:
            return 0.0
        anchor = trade.start_date
        for pd in pay_dates:
            if pd <= settle_d:
                anchor = pd
            else:
                break
        days_in = (settle_d - anchor).days
        return dirn * notional * ((K - flt_now) / 100.0) * days_in / 365.0

    acc0 = accrued_at(settle0, flt)
    settled = 0.0
    prev_settle = settle0
    for day in range(1, D):
        settle_d = qe.next_kr_business_day(base_date + timedelta(days=day))
        for i, pd in enumerate(pay_dates):
            if prev_settle < pd <= settle_d:
                cf = dirn * notional * ((K - flt) / 100.0) * accruals[i]
                settled += cf
                if settled_out is not None:
                    settled_out[day] += cf
                rem_after = [p2 for p2 in pay_dates if p2 > settle_d]
                if rem_after:
                    t_nn = max((rem_after[0] - settle_d).days / 365.0, DT)
                    flt = qe.forward_rate_simple(0.0, t_nn, zc_base) * 100.0
        if settle_d >= pay_dates[-1]:
            path[day:] = settled - acc0
            break
        path[day] = settled + accrued_at(settle_d, flt) - acc0
        prev_settle = settle_d

    return path


def base_cash_carry_paths(
    pos_trades: list[tuple],
    par_rates: list[tuple[float, float]],
    base_date: date,
    sim_days: int,
) -> np.ndarray:
    """포트폴리오 합산 경로. `pos_trades` 는 recon.build_pos_trades 의 반환
    그대로 — 엔진과 같은 스케줄 구성을 이미 거친 (IRS_Trade | None, flt_pct)
    쌍이다."""
    total = np.zeros(sim_days + 1)
    for trade, flt in pos_trades:
        total += base_cash_carry_path(trade, flt, par_rates, base_date, sim_days)
    return total
