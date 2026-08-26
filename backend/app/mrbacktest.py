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
  - `allow_dirs` — 부를 사람이 «이 방향은 우리가 못 한다» 를 말할 수 있는
    자리다(기본은 양방향이라 원본 산술 그대로). 막힌 방향의 진입 신호는
    **조용히 사라지지 않고** `blocked` 로 세어서 돌아온다.
  - 청산: |z| ≤ exitZ. 손절: |z| ≥ stopZ (z-발산 손절 — 돈이 아니라 z) ·
    둘 다 참이면 손절이 이긴다.
  - **당일 종가 체결**(다음 봉 지연 없음) · 진입 봉엔 MTM 없이 비용만 ·
    청산 봉은 그날 MTM 적립 후 비용 · 비용 = notional × costBp **편도**
  - 청산 봉 재진입 금지(다음 봉부터) · 포지션은 늘 ±1 단위 · z 없음이면
    보유 중 청산 검사 건너뜀 · 표본 끝의 미청산 포지션은 MTM 만 누적에
    남고 거래·승률·건수에는 안 잡힌다
  - Sharpe = mean(daily)/pstdev(daily)×√252 — **전 봉**(무포지션 0 포함),
    무위험 0 · MDD 는 누적 PnL 의 피크 대비 낙폭(원화, 양수 보고)

산술은 위가 전부다. 그 아래 **파생 둘**은 같은 수를 다시 말하는 것이라 규약을
바꾸지 않는다(적합성 벡터가 그대로 통과한다):

  - `open` · `summary.openPnl` — 표본 끝의 미청산 다리. 원본 규약대로 거래·
    승률·건수에는 **안** 들어가고, 그 사실을 화면이 말할 수 있게 밖으로만 낸다.
    승률 80% 가 «미청산 1건을 뺀 15건 중 12건» 이라는 뜻임을 카드가 스스로
    말하지 못하면, 열려 있는 손실 포지션이 승률에서 조용히 사라진다.
  - `summary.breakevenCostBp` — 총손익이 0 이 되는 편도 비용(`breakeven_cost_bp`).

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
             cost_bp: float, notional: float,
             allow_dirs: tuple[int, ...] = (-1, 1),
             gate: list[Any] | None = None) -> dict[str, Any]:
    """원본 simulateMeanReversion 의 바-루프 그대로. 반환 키도 그 어휘를 쓴다.

    `allow_dirs` 만 원본에 없던 자리다 — 실행할 수 있는 방향(+1 = 값이 오르면
    버는 쪽)의 목록이고, 기본값은 양방향이라 **기본 호출은 원본과 같은 수**를
    낸다(적합성 벡터가 그 사실을 잰다). 막힌 방향의 진입 신호는 세어서
    `blocked` 로 돌려준다 — 화면이 «몇 번을 못 들어갔는지» 를 말할 수 있어야
    하고, 말 없는 누락은 «신호가 없었다» 로 읽힌다.

    ## `gate` — 「z 문턱이 났는데도 안 들어가는」 자리

    봉마다의 참/거짓 목록이고, **진입에만** 듣는다. `None` 이면 게이트가 없는
    것이고 그때의 수는 예전과 완전히 같다.

    청산과 손절은 **게이트를 안 본다**. 이건 취향이 아니라 안전 규칙이다 —
    나가는 문까지 조건을 달면 조건이 꺼진 동안 포지션이 갇히고, 보유기간이
    규칙이 아니라 지표의 부산물이 된다. 들어갈 때만 고르고, 일단 들어갔으면
    원래 규칙대로 나온다.

    게이트가 지운 신호는 `gated` 로 **세어서 돌려준다**(`blocked` 와 같은 규율:
    구간 수와 일수 둘 다). 필터를 달면 거래 수가 줄고 승률은 거의 반드시
    올라가므로, 몇 건이 사라졌는지를 화면이 말하지 못하면 그 승률은 읽는 사람을
    속인다. `blocked`(방향 때문에 못 하는 거래)와 따로 세는 이유도 그것이다 —
    방향은 이 데스크의 제약이고 게이트는 **우리가 고른 것**이라, 둘을 한
    숫자로 합치면 선택의 대가가 제약 뒤에 숨는다.

    warm-up 으로 아직 값이 없는 봉(`None`)은 거짓으로 친다 — 지표가 못 서는
    구간에 «조건이 맞았다» 고 할 수는 없다. 다만 그것도 `gated` 에 세므로
    창 앞머리에서 몇 건이 그렇게 빠졌는지가 숫자로 남는다.
    """
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
    # 비용을 문 횟수 — 진입 한 번·청산 한 번이 각각 편도 하나다. 손익분기
    # 비용을 닫힌형으로 풀려면 이 수가 필요하고, 표본 끝의 미청산 다리는
    # 진입만 물었으므로 청산 수(=거래 수)와 따로 세야 한다.
    entry_events = 0
    # 막힌 진입 — 일수와 «구간» 둘 다 센다. 열흘 내리 막힌 것은 열 번이 아니라
    # 한 번 못 들어간 것이고, 그 둘을 한 숫자로 말하면 어느 쪽이든 거짓이 된다.
    blocked_days = 0
    blocked_spells = 0
    blocked_prev = False
    # 게이트가 지운 신호 — 방향 때문에 못 한 것(blocked)과 **따로** 센다.
    gated_days = 0
    gated_spells = 0
    gated_prev = False

    for i in range(n):
        daily_pnl = 0.0
        zi = z[i]
        blocked_now = False
        gated_now = False

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
            want = -1 if zi > 0 else 1
            if want not in allow_dirs:
                # 못 하는 거래는 안 한 것으로 둔다 — 비용도 손익도 없다.
                # 방향을 **먼저** 본다: 애초에 실행 불가능한 신호를 두고
                # 「게이트가 걸렀다」고 세면 필터의 공이 부풀려진다.
                blocked_now = True
                blocked_days += 1
                if not blocked_prev:
                    blocked_spells += 1
            elif gate is not None and not gate[i]:
                # 할 수 있었는데 **우리가 안 한** 거래. 여기 세는 것이 필터의 대가다.
                gated_now = True
                gated_days += 1
                if not gated_prev:
                    gated_spells += 1
            else:
                position = want
                entry_idx = i
                entry_z_val = zi
                entry_events += 1
                entry_cost = notional * cost_bp
                daily_pnl -= entry_cost
                trade_pnl = daily_pnl

        blocked_prev = blocked_now
        gated_prev = gated_now
        cumulative += daily_pnl
        points.append({
            "date": dates[i], "value": values[i], "z": zi,
            "position": position, "dailyPnl": daily_pnl,
            "cumulativePnl": cumulative,
        })

    # 표본 끝의 미청산 다리 — 누적에는 있고 거래·승률·건수에는 없다(원본 규약).
    # 규약을 바꾸지 않고 «없다는 사실» 만 밖으로 낸다: 화면이 승률 옆에 그것을
    # 말할 수 있어야 80% 가 «15건 중 12건» 이라는 뜻으로 읽힌다.
    open_leg = None
    if position != 0 and entry_idx is not None:
        open_leg = {"entryDate": dates[entry_idx], "direction": position,
                    "entryZ": entry_z_val, "entryValue": values[entry_idx],
                    "pnl": trade_pnl, "bars": n - 1 - entry_idx}

    summary = summarize(points, trades)
    summary["openPnl"] = open_leg["pnl"] if open_leg else None
    summary["breakevenCostBp"] = breakeven_cost_bp(
        summary["totalPnl"], cost_bp, notional, entry_events + len(trades))

    return {"points": points, "trades": trades,
            "summary": summary, "roll": roll, "open": open_leg,
            "blocked": {"spells": blocked_spells, "days": blocked_days},
            "gated": {"spells": gated_spells, "days": gated_days}}


def breakeven_cost_bp(total_pnl: float, cost_bp: float, notional: float,
                      cost_events: int) -> float | None:
    """총손익이 0 이 되는 편도 비용(bp) — 닫힌형이다.

    진입·청산·손절 판정이 **z 에만** 달려 있어 비용을 올려도 거래 목록이 안
    바뀐다. 그래서 총손익은 비용의 정확한 일차식이고, 기울기는 비용을 문 횟수
    × 명목이다:  PnL(c) = PnL(c₀) − notional·(c − c₀)·events.

    노브를 돌려 가며 0 을 찾는 대신 한 번에 답한다 — 「이 구성이 얼마짜리
    호가폭까지 견디는가」 는 비용 노브의 값보다 먼저 알아야 할 사실이다.
    음수가 나오면(이미 손실) None 이 아니라 그 음수를 준다 — «비용이 0 이어도
    안 된다» 는 것도 답이다.
    """
    if cost_events <= 0 or notional <= 0:
        return None
    return cost_bp + total_pnl / (notional * cost_events)


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
