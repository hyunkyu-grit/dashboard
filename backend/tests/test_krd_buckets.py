"""팬텀 KRD 버킷 회귀 — 커브에 없는 라벨이 인접 노드 범프를 복제하던 결함.

2026-08-11 교과서 대사 검증에서 발견: 표준 12노드 와이어 커브(6y/8y/9y 노드
없음)에서 `build_bumped_curves`/`compute_irs_krd_map` 의 "가장 가까운 노드"
매핑이 6Y→5y, 8Y→7y, 9Y→10y 로 충돌해 **같은 범프 커브가 두 버킷으로
합산**됐다. 일별 대사표의 pvbp 가 6Y==5Y 로 매일 동일했고, totalEstPnl 은
대표 북에서 매일 +1.88M 의 유령 손익을 실어 미설명분이 310%였다(팬텀 제거
시 21.7%). 실제 P&L(완전 재평가)은 무영향 — 오염된 것은 추정/잔차 열과
일별 KRD 표뿐.

수정: 노드를 라벨 거리 기준 가장 가까운 버킷 **하나에만** 배속(파티션,
`_krd_bucket_nodes`). 소유 노드 없는 버킷 KRD = 0, Σ버킷 = 평행 DV01.

여기 단언들은 세 가지를 못박는다:
  1. 12노드 커브에서 유령 버킷(6Y/8Y/9Y)이 정확히 0 (양쪽 경로 모두).
  2. Σ버킷 ≈ 평행 +1bp DV01 (파티션 가산성 — 이중 계상이면 크게 초과).
  3. 15라벨 완전 커브에서는 버킷:노드 1:1 — 과도한 0 처리 방지.
"""

from __future__ import annotations

from datetime import date

import numpy as np

from irs_pricer.engine import quant_engine as qe

# 대표 요청과 같은 12노드 와이어 커브 (라벨 T — 충돌 구조는 노드 좌표만으로
# 결정되므로 날짜 해석 없이 라벨 그대로 쓴다)
PAR_12 = [
    (1 / 365, 0.025), (0.25, 0.0255), (0.5, 0.0258), (0.75, 0.0261),
    (1.0, 0.0263), (1.5, 0.0266), (2.0, 0.0268), (3.0, 0.0272),
    (4.0, 0.0275), (5.0, 0.0278), (7.0, 0.0283), (10.0, 0.0289),
]
# 15개 KRD 라벨 전부에 노드가 있는 커브
PAR_15 = [(t, 0.027 + 0.0001 * i) for i, (t, _n) in
          enumerate(zip(qe.KRD_TENORS, qe.KRD_NAMES))]

BASE = date(2026, 1, 15)
PHANTOMS = ("6Y", "8Y", "9Y")


def _ten_year_trade() -> qe.IRS_Trade:
    return qe.IRS_Trade(
        start_date=date(2025, 12, 15),
        maturity_date=date(2035, 12, 17),
        fixed_rate_pct=2.85,
        direction=1,
        notional=1e10,
    )


def _parallel_dv01(trade: qe.IRS_Trade, par: list[tuple[float, float]]) -> float:
    """전 노드 +1bp 평행 범프의 ΔNPV — 버킷 합의 기준값."""
    val = qe.next_kr_business_day(BASE)
    zc0 = qe.bootstrap_zero_curve(par)
    zc1 = qe.bootstrap_zero_curve([(t, r + 0.0001) for t, r in par])
    return -(trade.compute_npv(val, zc1, 2.6) - trade.compute_npv(val, zc0, 2.6))


def test_daily_path_phantom_buckets_are_zero():
    """portfolio_krd_day: 12노드 커브에서 6Y/8Y/9Y 버킷은 정확히 0."""
    trade = _ten_year_trade()
    zc_base = qe.bootstrap_zero_curve(PAR_12)
    krd = qe.portfolio_krd_day(
        [(trade, 2.6)], qe.next_kr_business_day(BASE), zc_base,
        qe.build_bumped_curves(PAR_12),
    )
    for name in PHANTOMS:
        assert krd[name] == 0.0, f"{name} 버킷이 유령 리스크를 실었다: {krd[name]:,.0f}"
    # 실제 노드가 있는 버킷은 살아 있어야 한다
    assert abs(krd["5Y"]) > 0
    assert abs(krd["10Y"]) > 0


def test_daily_path_buckets_sum_to_parallel_dv01():
    """Σ버킷 ≈ 평행 DV01. 종전 이중 계상은 10Y 스왑에서 합을 수십 % 부풀렸다."""
    trade = _ten_year_trade()
    zc_base = qe.bootstrap_zero_curve(PAR_12)
    krd = qe.portfolio_krd_day(
        [(trade, 2.6)], qe.next_kr_business_day(BASE), zc_base,
        qe.build_bumped_curves(PAR_12),
    )
    total = sum(krd.values())
    parallel = _parallel_dv01(trade, PAR_12)
    # 파티션 가산성: 비선형 잔차만 남는다 (실측 ≪1%; 이중 계상이면 ~30% 초과)
    assert abs(total - parallel) < 0.02 * abs(parallel), (
        f"버킷 합 {total:,.0f} vs 평행 DV01 {parallel:,.0f}"
    )


def test_single_swap_map_phantom_buckets_are_zero():
    """compute_irs_krd_map: 만기가 충돌 라벨을 넘는 스왑에서 같은 결함이 있었다."""
    krd = qe.compute_irs_krd_map(
        par_rates=PAR_12, notional=1e10, fixed_rate_pct=2.85, direction=1,
        t_maturity=9.92, t_next_payment=0.17, current_float_rate_pct=2.6,
        sector="IRS",
    )
    for name in PHANTOMS:
        assert krd[name] == 0.0, f"{name} 버킷이 유령 리스크를 실었다: {krd[name]:,.0f}"
    assert abs(krd["5Y"]) > 0 and abs(krd["7Y"]) > 0 and abs(krd["10Y"]) > 0


def test_full_label_curve_keeps_every_bucket():
    """15라벨 완전 커브: 파티션은 1:1 — 만기 안쪽 버킷이 전부 살아 있어야
    (과도한 0 처리 방지). 6Y 는 이 커브에서 실제 노드다."""
    owned = qe._krd_bucket_nodes([t for t, _r in PAR_15])
    assert all(len(nodes) == 1 for nodes in owned), owned
    trade = _ten_year_trade()
    zc_base = qe.bootstrap_zero_curve(PAR_15)
    krd = qe.portfolio_krd_day(
        [(trade, 2.6)], qe.next_kr_business_day(BASE), zc_base,
        qe.build_bumped_curves(PAR_15),
    )
    assert abs(krd["6Y"]) > 0, "완전 커브의 6Y 는 실제 리스크다 — 0이면 과도한 컷"
