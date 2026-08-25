# -*- coding: utf-8 -*-
"""z-스코어 평균회귀 백테스트 — 첫 PMS(krw-fi-pms) entry-signals 창의 산술 이식.

원본: `krw-fi-pms/src/lib/math/backtest.ts::simulateMeanReversion` +
`rolling-stats.ts` — 그 자신이 `irs_pricer/services/spread_backtest_service.py`
의 이식이었으니 한 바퀴 돌아 다시 파이썬이 된 셈이다. **의미를 하나도 바꾸지
않는다** [OWNER 2026-08-25 — "맨처음 만들었던 PMS 의 그 창 참고해서 구현"]:

  - 트레일링 **포함** 창 lookback · **모집단** 표준편차(pstdev, two-pass) ·
    창 미달 또는 σ=0 → z 없음
  - 진입: |z| ≥ entryZ 역행 — z>0(비쌈) 숏, z≤0(쌈) 롱. 교차 감지 아님 —
    **레벨 검사**다.
  - 청산: |z| ≤ exitZ. 손절: |z| ≥ stopZ (z-발산 손절 — 돈이 아니라 z) ·
    둘 다 참이면 손절이 이긴다.
  - **당일 종가 체결**(다음 봉 지연 없음) · 진입 봉엔 MTM 없이 비용만 ·
    청산 봉은 그날 MTM 적립 후 비용 · 비용 = notional × costBp **편도**
  - 청산 봉 재진입 금지(다음 봉부터) · 포지션은 늘 ±1 단위 · z 없음이면
    보유 중 청산 검사 건너뜀 · 표본 끝의 미청산 포지션은 MTM 만 누적에
    남고 거래·승률·건수에는 안 잡힌다
  - Sharpe = mean(daily)/pstdev(daily)×√252 — **전 봉**(무포지션 0 포함),
    무위험 0 · MDD 는 누적 PnL 의 피크 대비 낙폭(원화, 양수 보고)

이 산술이 NO-GO 로 닫힌 연구(Desktop\\bollinger-mr)의 규칙과 **다른 물건**임을
적어 둔다 — 저쪽은 밴드 재진입·익일 체결·bp 손익이고, 이쪽은 PMS 창의 재현이다.
그래서 이 엔진은 추천이 아니라 **재현 도구**다(화면 명구가 그 사실을 말한다).

적합성: `tests/test_mrbacktest.py` 의 LCG 픽스처가 PMS 가 못 박아 둔 KPI 벡터
(총손익 −3,580,000 등)와의 일치를 잰다 — 숫자가 어긋나면 이식이 의미를 바꾼
것이다.
"""
from __future__ import annotations

import math
from typing import Any


def _window_mean_std(values: list[float], start: int, end: int) -> tuple[float, float]:
    n = end - start
    s = 0.0
    for k in range(start, end):
        s += values[k]
    mean = s / n
    sq = 0.0
    for k in range(start, end):
        d = values[k] - mean
        sq += d * d
    return mean, math.sqrt(sq / n)


def rolling_series(values: list[float], lookback: int) -> dict[str, list]:
    """SMA·모집단 σ·z 를 한 번에 — 창이 차기 전은 None (원본 rollingSeries)."""
    n = len(values)
    mean: list[float | None] = [None] * n
    std: list[float | None] = [None] * n
    z: list[float | None] = [None] * n
    if lookback <= 0:
        return {"mean": mean, "std": std, "z": z}
    for i in range(lookback - 1, n):
        m, sd = _window_mean_std(values, i - lookback + 1, i + 1)
        mean[i] = m
        std[i] = sd
        z[i] = None if sd == 0 else (values[i] - m) / sd
    return {"mean": mean, "std": std, "z": z}


def simulate(dates: list[str], values: list[float], *, lookback: int,
             entry_z: float, exit_z: float, stop_z: float,
             cost_bp: float, notional: float) -> dict[str, Any]:
    """원본 simulateMeanReversion 의 바-루프 그대로. 반환 키도 그 어휘를 쓴다."""
    n = len(values)
    roll = rolling_series(values, lookback)
    z = roll["z"]

    points: list[dict[str, Any]] = []
    trades: list[dict[str, Any]] = []

    position = 0
    entry_idx: int | None = None
    entry_z_val: float | None = None
    trade_pnl = 0.0
    cumulative = 0.0

    for i in range(n):
        daily_pnl = 0.0
        zi = z[i]

        if position != 0:
            daily_pnl += position * notional * (values[i] - values[i - 1])
            trade_pnl += daily_pnl

            if zi is not None:
                should_stop = abs(zi) >= stop_z
                should_exit = abs(zi) <= exit_z
                if should_stop or should_exit:
                    exit_cost = notional * cost_bp
                    daily_pnl -= exit_cost
                    trade_pnl -= exit_cost
                    trades.append({
                        "entryDate": dates[entry_idx],
                        "exitDate": dates[i],
                        "direction": position,
                        "entryZ": entry_z_val,
                        "exitZ": zi,
                        "entryValue": values[entry_idx],
                        "exitValue": values[i],
                        "pnl": trade_pnl,
                        "exitReason": "stop" if should_stop else "exit",
                    })
                    position = 0
                    entry_idx = None
                    entry_z_val = None
                    trade_pnl = 0.0
        elif zi is not None and abs(zi) >= entry_z:
            # 평소 대비 너무 높으면 떨어진다에 건다(숏) — 너무 낮으면 롱.
            position = -1 if zi > 0 else 1
            entry_idx = i
            entry_z_val = zi
            entry_cost = notional * cost_bp
            daily_pnl -= entry_cost
            trade_pnl = daily_pnl

        cumulative += daily_pnl
        points.append({
            "date": dates[i], "value": values[i], "z": zi,
            "position": position, "dailyPnl": daily_pnl,
            "cumulativePnl": cumulative,
        })

    return {"points": points, "trades": trades,
            "summary": summarize(points, trades), "roll": roll}


def summarize(points: list[dict], trades: list[dict]) -> dict[str, Any]:
    total_pnl = points[-1]["cumulativePnl"] if points else 0.0

    max_drawdown = 0.0
    running_max = -math.inf
    for pt in points:
        running_max = max(running_max, pt["cumulativePnl"])
        max_drawdown = max(max_drawdown, running_max - pt["cumulativePnl"])

    win_rate = (sum(1 for t in trades if t["pnl"] > 0) / len(trades)) if trades else None

    sharpe = None
    daily = [pt["dailyPnl"] for pt in points]
    if len(daily) >= 2:
        m = sum(daily) / len(daily)
        sd = math.sqrt(sum((x - m) ** 2 for x in daily) / len(daily))
        if sd != 0:
            sharpe = m / sd * math.sqrt(252)

    return {"totalPnl": total_pnl, "maxDrawdown": max_drawdown,
            "winRate": win_rate, "sharpe": sharpe, "numTrades": len(trades)}
