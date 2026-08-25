# -*- coding: utf-8 -*-
"""전략 재현 엔진 — PMS 원본과의 적합성 벡터 + 규칙 의미 핀.

적합성 픽스처는 krw-fi-pms `backtest-kpi-fixture.test.tsx` 의 것 그대로다:
LCG(seed 42) 320일 시리즈에 기본 파라미터를 걸면 KPI 가 정확히 그 숫자여야
한다. **숫자를 다시 뽑아 맞추지 말 것** — 어긋나면 이식이 의미를 바꾼 것이다.
"""
import math

from app import mrbacktest as bt

PIN = dict(lookback=60, entry_z=2.0, exit_z=0.5, stop_z=3.5,
           cost_bp=0.05, notional=1_000_000)


def _fixture():
    """원본 fixtureSeries(): LCG seed 42 · 320일 · 사인 + 노이즈 + 점프 둘."""
    s = 42
    vals, dates = [], []
    day0 = 0
    for i in range(320):
        s = (s * 1664525 + 1013904223) % (2 ** 32)
        rand = s / 0xFFFFFFFF - 0.5
        v = 50 + 6 * math.sin(i / 14) + rand * 4
        if 120 <= i < 180:
            v += 9
        if i >= 240:
            v -= 7
        vals.append(round(v * 100) / 100)
        dates.append(f"D{day0 + i:04d}")
    return dates, vals


def test_kpi_conformance_vector_matches_pms():
    dates, vals = _fixture()
    r = bt.simulate(dates, vals, **PIN)
    s = r["summary"]
    # 2026-07-16 캡처(원본 s16 head 2a52654) — 표기 반올림까지 그대로.
    assert round(s["totalPnl"]) == -3_580_000
    assert round(s["maxDrawdown"]) == 18_800_000
    assert round(s["winRate"] * 100) == 33
    assert f"{s['sharpe']:.2f}" == "-0.16"
    assert s["numTrades"] == 3


def test_rule_semantics_pins():
    dates, vals = _fixture()
    r = bt.simulate(dates, vals, **PIN)
    roll = r["roll"]
    # 창 미달·σ=0 → z 없음 (트레일링 포함 창).
    assert all(roll["z"][i] is None for i in range(PIN["lookback"] - 1))
    assert roll["z"][PIN["lookback"] - 1] is not None
    # 진입 봉은 MTM 없이 비용만 — dailyPnl == -notional*costBp.
    by_date = {p["date"]: p for p in r["points"]}
    for t in r["trades"]:
        entry = by_date[t["entryDate"]]
        assert math.isclose(entry["dailyPnl"], -PIN["notional"] * PIN["cost_bp"])
        # 방향은 z 역행 — entryZ 의 부호와 반대.
        assert t["direction"] == (-1 if t["entryZ"] > 0 else 1)
        # 손절은 z-발산: 청산 z 절대값이 stopZ 이상일 때만 "stop".
        if t["exitReason"] == "stop":
            assert abs(t["exitZ"]) >= PIN["stop_z"]
        else:
            assert abs(t["exitZ"]) <= PIN["exit_z"]
    # 누적 = 일별 합 (표본 끝 미청산 MTM 포함).
    assert math.isclose(r["points"][-1]["cumulativePnl"],
                        sum(p["dailyPnl"] for p in r["points"]))


def test_population_std_not_sample():
    # 모집단 σ — 표본 σ(ddof=1)와 다르다. 원본 pstdev 의 핀.
    vals = [1.0, 2.0, 3.0, 4.0]
    roll = bt.rolling_series(vals, 4)
    assert math.isclose(roll["std"][3], math.sqrt(5.0 / 4.0))


def test_no_reentry_on_exit_bar():
    # 청산 봉의 else-if 는 건너뛴다 — 같은 봉 재진입 금지. z 가 계속 진입권이어도
    # 다음 봉에야 다시 들어간다. 합성: 창 2, 진입 후 즉시 청산이 반복되는 계열.
    dates = [f"D{i}" for i in range(8)]
    vals = [0.0, 10.0, 0.0, 10.0, 0.0, 10.0, 0.0, 10.0]
    r = bt.simulate(dates, vals, lookback=2, entry_z=0.9, exit_z=0.95,
                    stop_z=99.0, cost_bp=0.0, notional=1.0)
    for a, b in zip(r["trades"], r["trades"][1:]):
        assert b["entryDate"] > a["exitDate"]
