# -*- coding: utf-8 -*-
"""진단 넷 — 「승률이 어디서 왔는가」·「최근에도 유지되는가」.

이 파일이 지키는 것 둘.
  ① `forward_edge` 는 **실행 가능한 방향만** 센다. 방향을 빼먹으면 답이 뒤집힌다
     (실측 2026-08-28: |z| 로 세면 −0.374bp·47%, 방향을 넣으면 +1.842bp·72%).
  ② `period_split` 은 조각의 손익을 **조각에서** 센다. 엔진의 누적을 그대로 쓰면
     앞 구간의 누적이 이 구간의 손익으로 잡힌다.
"""
import math

from app import mrbacktest as bt
from app import mrdiag as dg

N = 1_000_000.0


def _trade(why, pnl, bars=5):
    return {"exitReason": why, "pnl": pnl, "bars": bars}


def test_exit_tally_keeps_a_fixed_order_and_skips_absent_reasons():
    tr = [_trade("time", -1.0), _trade("exit", 5.0), _trade("stop", -9.0),
          _trade("exit", 3.0)]
    out = dg.exit_tally(tr, N)
    assert [r["why"] for r in out] == ["exit", "stop", "time"], "빈도순이 아니라 고정순"
    e = out[0]
    assert e["n"] == 2 and e["wins"] == 2 and e["winRate"] == 1.0
    assert math.isclose(e["sumBp"], 8.0 / N)


def test_exit_tally_counts_every_trade_exactly_once():
    """사유를 하나라도 빠뜨리면 그 표는 거짓이 된다."""
    tr = [_trade(w, 1.0) for w in ("exit", "stop", "reverse", "time", "open")]
    out = dg.exit_tally(tr, N)
    assert sum(r["n"] for r in out) == len(tr)
    assert {r["why"] for r in out} == {"exit", "stop", "reverse", "time", "open"}


def test_payoff_separates_high_win_rate_from_a_good_payoff():
    """승률 90% 인데 손익비가 나쁜 판 — 승률만 보면 구별이 안 된다."""
    tr = [_trade("exit", 1.0) for _ in range(9)] + [_trade("stop", -20.0)]
    p = dg.payoff(tr, N)
    assert p["wins"] == 9 and p["losses"] == 1
    assert math.isclose(p["payoff"], 1.0 / 20.0)
    assert math.isclose(p["profitFactor"], 9.0 / 20.0)
    assert p["profitFactor"] < 1.0, "승률 90% 인데 돈은 잃는다"


def test_payoff_is_none_when_one_side_is_empty():
    assert dg.payoff([_trade("exit", 1.0)], N) is None
    assert dg.payoff([_trade("stop", -1.0)], N) is None


def _ramp():
    """z 가 양쪽으로 크게 벌어지는 계열. 한쪽만 실행 가능하게 만들어 검정한다."""
    vals = []
    v = 100.0
    for i in range(400):
        v += (2.5 if (i // 25) % 2 else -2.5)
        vals.append(v)
    return vals


def test_forward_edge_counts_only_the_tradable_direction():
    """한 방향만 허용하면 반대쪽 신호일은 **비신호**로 간다.

    양방향으로 세면 못 하는 거래의 수익이 섞인다 — 그 혼입이 실제로 부호를
    뒤집었던 자리다.
    """
    vals = _ramp()
    z = bt.rolling_series(vals, 20)["z"]
    one = dg.forward_edge(vals, z, entry_z=1.0, allow_dirs=(-1,), horizon=5)
    both = dg.forward_edge(vals, z, entry_z=1.0, allow_dirs=(-1, 1), horizon=5)
    assert one["onSignal"]["n"] < both["onSignal"]["n"]
    # 한쪽만 셀 때의 신호일 수 = 양쪽에서 z>0 인 것만
    n_pos = sum(1 for i in range(len(vals) - 5)
                if z[i] is not None and z[i] >= 1.0)
    assert one["onSignal"]["n"] == n_pos


def test_forward_edge_direction_sign_is_applied_not_absolute_value():
    """부호를 안 붙이면(절대값) 신호일 평균이 늘 양수로 나온다 — 그건 검정이 아니다."""
    vals = _ramp()
    z = bt.rolling_series(vals, 20)["z"]
    r = dg.forward_edge(vals, z, entry_z=1.0, allow_dirs=(-1,), horizon=5)
    # 이 픽스처는 톱니라 z>0 뒤에 값이 더 오르는 구간이 있어 **음수**가 나와야 한다.
    assert r["onSignal"]["meanBp"] < 0, "부호가 안 붙었으면 이 검정이 통과한다"


def test_forward_edge_partitions_every_scored_bar():
    vals = _ramp()
    z = bt.rolling_series(vals, 20)["z"]
    H = 5
    r = dg.forward_edge(vals, z, entry_z=1.0, allow_dirs=(-1,), horizon=H)
    scored = sum(1 for i in range(len(vals) - H) if z[i] is not None)
    assert r["onSignal"]["n"] + r["offSignal"]["n"] == scored


def test_forward_edge_uses_the_entry_mode_it_is_given():
    vals = _ramp()
    z = bt.rolling_series(vals, 20)["z"]
    lvl = dg.forward_edge(vals, z, entry_z=1.0, allow_dirs=(-1,), entry_mode="level")
    tch = dg.forward_edge(vals, z, entry_z=1.0, allow_dirs=(-1,), entry_mode="touch")
    assert lvl["onSignal"]["n"] != tch["onSignal"]["n"], "규칙이 다르면 신호일도 다르다"


def test_period_split_measures_each_slice_on_its_own_pnl():
    """엔진의 누적을 그대로 쓰면 앞 구간이 뒤 구간 손익으로 샌다."""
    pts = [{"dailyPnl": 10.0, "cumulativePnl": 10.0 * (i + 1)} for i in range(300)]
    dates = [f"D{i:03d}" for i in range(300)]
    out = dg.period_split(dates, pts, parts=3)
    assert len(out) == 3
    for seg in out:
        assert math.isclose(seg["totalPnl"], 1000.0), "조각마다 100봉 × 10원"
        assert seg["maxDrawdown"] == 0.0
    assert [s["days"] for s in out] == [100, 100, 100]
    assert out[0]["from"] == "D000" and out[-1]["to"] == "D299"


def test_period_split_is_empty_when_there_is_not_enough_to_split():
    pts = [{"dailyPnl": 1.0, "cumulativePnl": float(i)} for i in range(30)]
    assert dg.period_split([f"D{i}" for i in range(30)], pts, parts=3) == []


def test_period_split_shows_decay_as_decay_not_as_a_break():
    """크기만 줄면 부호가 유지된다 — 과거적합(부호가 뒤집힘)과 모양이 다르다."""
    daily = [3.0] * 100 + [2.0] * 100 + [1.0] * 100
    pts = []
    cum = 0.0
    for x in daily:
        cum += x
        pts.append({"dailyPnl": x, "cumulativePnl": cum})
    out = dg.period_split([f"D{i:03d}" for i in range(300)], pts, parts=3)
    tot = [s["totalPnl"] for s in out]
    assert tot == sorted(tot, reverse=True) and all(t > 0 for t in tot)
