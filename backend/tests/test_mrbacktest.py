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


def test_allow_dirs_blocks_one_side_without_touching_the_other():
    """한 방향을 막으면 그 진입만 사라진다 [OWNER 2026-08-25 — "BSS에서 숏은
    없는거야,, 현물대차매도는 안할거거든"].

    막힌 봉은 **거래도 비용도 아니다** — 못 한 거래에 비용을 물리면 그 자리에서
    안 한 거래가 손실이 된다. 그리고 남은 방향의 거래는 양방향 실행의 그것과
    글자 하나 다르지 않아야 한다(진입 규칙은 레벨 검사라 서로를 안 본다).
    """
    dates, vals = _fixture()
    both = bt.simulate(dates, vals, **PIN)
    only_short = bt.simulate(dates, vals, **PIN, allow_dirs=(-1,))

    assert both["blocked"] == {"spells": 0, "days": 0}
    assert all(t["direction"] == -1 for t in only_short["trades"])
    kept = [t for t in both["trades"] if t["direction"] == -1]
    assert [t["entryDate"] for t in only_short["trades"]] == [t["entryDate"] for t in kept]
    assert [round(t["pnl"], 6) for t in only_short["trades"]] == [round(t["pnl"], 6) for t in kept]
    # 막힌 쪽이 실제로 있었다 — 없으면 이 시험이 아무것도 안 잰다.
    assert any(t["direction"] == 1 for t in both["trades"])
    assert only_short["blocked"]["spells"] >= 1
    assert only_short["blocked"]["days"] >= only_short["blocked"]["spells"]

    # 막힌 봉의 손익은 0 이다(무포지션 · 비용 없음).
    dir_by_entry = {t["entryDate"]: t["direction"] for t in both["trades"]}
    blocked_dates = [d for d, v in dir_by_entry.items() if v == 1]
    by_date = {p["date"]: p for p in only_short["points"]}
    for d in blocked_dates:
        assert by_date[d]["position"] == 0
        assert by_date[d]["dailyPnl"] == 0.0


def test_blocked_spell_counts_runs_not_bars():
    """열흘 내리 막힌 것은 열 번 못 들어간 게 아니라 한 번이다."""
    dates = [f"D{i}" for i in range(12)]
    # 창 2 의 단조 상승 — 두 값의 창이라 z 는 매 봉 정확히 +1 이고(진입권),
    # 그 방향(숏)이 막혀 있으니 한 구간이 열한 봉 내리 이어진다.
    vals = [float(i) for i in range(12)]
    r = bt.simulate(dates, vals, lookback=2, entry_z=0.5, exit_z=0.1,
                    stop_z=99.0, cost_bp=0.0, notional=1.0, allow_dirs=(1,))
    assert r["trades"] == []
    assert r["blocked"] == {"spells": 1, "days": 11}


def test_breakeven_cost_is_exact_not_approximate():
    """손익분기 비용은 닫힌형이다 — 그 값으로 다시 돌리면 총손익이 0 이어야 한다.

    거래 목록이 z 에만 달려 있어 비용을 바꿔도 안 변한다는 사실이 이 닫힌형의
    전제다. 그 전제까지 같이 잰다(거래 수·진입일이 그대로여야 한다).
    """
    dates, vals = _fixture()
    base = dict(PIN, cost_bp=0.5)
    r = bt.simulate(dates, vals, **base)
    be = r["summary"]["breakevenCostBp"]
    assert be is not None

    again = bt.simulate(dates, vals, **dict(base, cost_bp=be))
    assert abs(again["summary"]["totalPnl"]) < 1e-6
    # 전제: 비용은 거래를 안 바꾼다
    assert again["summary"]["numTrades"] == r["summary"]["numTrades"]
    assert [t["entryDate"] for t in again["trades"]] == [t["entryDate"] for t in r["trades"]]


def test_open_leg_is_reported_but_not_counted():
    """미청산 다리는 밖으로 나오되 거래·승률·건수에는 안 들어간다(원본 규약).

    누적에는 있으므로 «총손익 − 거래 손익 합» 이 곧 그 다리의 MTM 이다 — 화면이
    승률 옆에 이 수를 적을 수 있어야 80% 가 무슨 뜻인지 읽힌다.
    """
    dates, vals = _fixture()
    # 마지막 봉이 진입 문턱 밖이 되도록 꼬리를 밀어 미청산 상태로 끝낸다.
    vals = list(vals) + [vals[-1] - 8.0]
    dates = list(dates) + ["D0320"]
    r = bt.simulate(dates, vals, **PIN)

    assert r["open"] is not None
    assert r["points"][-1]["position"] != 0
    assert r["open"]["entryDate"] == dates[r["open"]["bars"] * -1 - 1]

    closed = sum(t["pnl"] for t in r["trades"])
    assert math.isclose(r["summary"]["openPnl"], r["summary"]["totalPnl"] - closed, abs_tol=1e-6)
    assert r["summary"]["numTrades"] == len(r["trades"])
    # 규약 유지 — 승률의 분모는 청산된 거래뿐이다
    wins = sum(1 for t in r["trades"] if t["pnl"] > 0)
    assert math.isclose(r["summary"]["winRate"], wins / len(r["trades"]))


def test_open_leg_is_none_when_flat_at_end():
    dates, vals = _fixture()
    r = bt.simulate(dates, vals, **PIN)
    if r["points"][-1]["position"] == 0:
        assert r["open"] is None
        assert r["summary"]["openPnl"] is None
