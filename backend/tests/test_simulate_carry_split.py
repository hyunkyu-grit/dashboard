# -*- coding: utf-8 -*-
"""캐리/롤다운 분리 (carry_split.py) — 엔진 대조 [OWNER, 2026-08-11].

carry_split 은 동결 이식 코드(quant_engine)를 안 건드리려고 베이스(무충격)
경로의 순캐리를 엔진 **바깥에서** 재구성한다. 그 재구성이 엔진과 같은
물리를 쓴다는 주장을 여기서 못박는다:

  1. 정산 대조 — 재구성의 일별 정산 CF(`settled_out` 계측)가 엔진이 리턴한
     `scf_b`(베이스 경로 정산 CF)와 **날·액수 모두** 일치한다. 정산액은
     ±N×(K−F)×accrual 이므로 이 일치는 스케줄·리픽싱(F: 동결 커브 잔존
     스텁 스팟)·부호가 전부 엔진과 같다는 뜻이다.
  2. 연속성 — 누적 캐리 경로는 정산일에서 점프하지 않는다: 정산 CF 는 그
     기간 액크루얼의 합이라 액크루얼 리셋과 정확히 상쇄된다. 점프가 보이면
     정산액과 액크루얼이 다른 물리를 쓰고 있다는 뜻이다.
  3. day 0 = 0 — 세타 궤적과 같은 "P&L since day 0" 기준.
"""

from __future__ import annotations

from datetime import date

import numpy as np

from irs_pricer.engine import quant_engine as qe
from irs_pricer.services.simulation.carry_split import base_cash_carry_path

PAR = [
    (1 / 365, 0.025), (0.25, 0.0255), (0.5, 0.0258), (0.75, 0.0261),
    (1.0, 0.0263), (1.5, 0.0266), (2.0, 0.0268), (3.0, 0.0272),
    (4.0, 0.0275), (5.0, 0.0278), (7.0, 0.0283), (10.0, 0.0289),
]
BASE = date(2026, 1, 15)
SIM_DAYS = 200
N = 1e10

CASES = [
    # (direction, start, maturity, K%, float%) — 리시브/페이 미러, 시즌드 5Y
    (+1, date(2025, 11, 17), date(2027, 11, 17), 2.85, 2.61),
    (-1, date(2025, 11, 17), date(2027, 11, 17), 2.85, 2.61),
    (+1, date(2024, 3, 18), date(2029, 3, 19), 3.40, 2.55),
]


def _engine_run(direction: int, start: date, mat: date, k_pct: float, flt_pct: float):
    trade = qe.IRS_Trade(start, mat, k_pct, direction, N)
    nxt = min(pd for pd in trade.pay_dates if pd > BASE)
    return trade, qe.simulate_irs_path_fm(
        par_rates=PAR,
        notional=N,
        fixed_rate_pct=k_pct,
        direction=direction,
        t_maturity=(mat - BASE).days / 365.0,
        t_next_payment=(nxt - BASE).days / 365.0,
        current_float_rate_pct=flt_pct,
        sector="IRS",
        shock_curve=[(0.0, 25.0), (30.0, 25.0)],
        days_to_simulate=SIM_DAYS,
        shock_type="ramp",
        base_date_str=BASE.isoformat(),
        start_date_str=start.isoformat(),
    )


def test_reconstructed_settlements_match_the_engines_scf_b():
    for direction, start, mat, k, flt in CASES:
        trade, (_mtm, _pvbp, _c, metrics, _rows) = _engine_run(direction, start, mat, k, flt)
        scf_b = np.asarray(metrics["scf_b"], dtype=float)

        settled = np.zeros(SIM_DAYS + 1)
        base_cash_carry_path(trade, flt, PAR, BASE, SIM_DAYS, settled_out=settled)

        eng_days = {d for d in range(1, SIM_DAYS + 1) if abs(scf_b[d]) > 1.0}
        rec_days = {d for d in range(1, SIM_DAYS + 1) if abs(settled[d]) > 1.0}
        assert rec_days == eng_days, (direction, sorted(rec_days), sorted(eng_days))
        assert eng_days, "fixture never settles inside the window"
        for d in sorted(eng_days):
            assert abs(settled[d] - scf_b[d]) <= 1.0, (direction, d, settled[d], scf_b[d])


def test_path_is_continuous_and_zero_at_day_zero():
    for direction, start, mat, k, flt in CASES:
        trade = qe.IRS_Trade(start, mat, k, direction, N)
        path = base_cash_carry_path(trade, flt, PAR, BASE, SIM_DAYS)
        assert path[0] == 0.0
        # 하루 최대 액크루얼: |K−F|max 를 3%p 로 넉넉히 잡고 주말 3일 스팬
        daily_cap = 0.03 * N / 365.0 * 3 + 2.0
        assert np.max(np.abs(np.diff(path))) <= daily_cap
