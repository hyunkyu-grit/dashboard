# -*- coding: utf-8 -*-
"""레짐 필터·동적 비용 — **미래를 안 보는가**가 이 파일의 전부다.

백분위를 전 표본에서 재면 백테스트에서만 작동하는 필터가 나온다. 그 결함은
성과가 좋아지는 방향으로만 나타나서 눈으로는 안 걸린다.
"""
import statistics as st

from app import mrregime as rg


def _series(n: int = 600) -> list[float]:
    """결정적 톱니 + 후반부 변동성 확대. 난수를 안 쓴다(재현 가능해야 한다)."""
    out = []
    v = 0.0
    for i in range(n):
        step = (1 if i % 2 else -1) * (0.5 if i < n // 2 else 3.0)
        v += step + (0.01 * i % 0.7)
        out.append(round(v, 4))
    return out


def test_percentile_never_looks_ahead():
    """뒤쪽 자료를 잘라 내도 앞쪽 백분위가 한 칸도 안 바뀐다.

    이것이 확장 창의 정의다. 전 표본 분위를 쓰면 이 검정이 곧바로 깨진다.
    """
    vals = _series()
    full = rg.vol_percentile(vals)
    for cut in (350, 420, 500):
        part = rg.vol_percentile(vals[:cut])
        assert part == full[:cut], f"자르는 자리 {cut} 에서 앞쪽 판정이 바뀌었다"


def test_gate_never_looks_ahead():
    vals = _series()
    full = rg.vol_gate(vals)
    for cut in (350, 420, 500):
        assert rg.vol_gate(vals[:cut]) == full[:cut]


def test_gate_sleeps_until_it_has_enough_history():
    """관측이 250봉 쌓이기 전에는 아무것도 안 막는다."""
    vals = _series()
    gate = rg.vol_gate(vals)
    pct = rg.vol_percentile(vals)
    seen = 0
    for i, p in enumerate(pct):
        if p is None:
            assert gate[i] is True
            continue
        seen += 1
        if seen < rg.VOL_MIN_HIST:
            assert gate[i] is True, f"{i}봉: 근거가 쌓이기 전에 막았다"


def test_gate_blocks_the_top_decile_and_only_that():
    vals = _series()
    gate, pct = rg.vol_gate(vals), rg.vol_percentile(vals)
    seen = 0
    blocked = 0
    for g, p in zip(gate, pct):
        if p is None:
            continue
        seen += 1
        if seen < rg.VOL_MIN_HIST:
            continue
        assert g == (p < rg.VOL_BLOCK)
        blocked += 0 if g else 1
    assert blocked > 0, "이 픽스처는 막히는 봉이 있어야 검정이 성립한다"


def test_realized_vol_is_population_sigma_like_the_engine():
    """엔진의 z 와 **같은 σ** 를 쓴다 — 한 화면에 두 가지 σ 가 있으면 안 된다."""
    vals = [0.0, 1.0, 3.0, 6.0, 10.0]
    v = rg.realized_vol(vals, win=2)
    assert v[0] is None and v[1] is None
    assert abs(v[2] - st.pstdev([1.0, 2.0])) < 1e-12
    assert abs(v[4] - st.pstdev([3.0, 4.0])) < 1e-12


def test_cost_path_stays_in_the_declared_band_and_floors_the_unknown():
    vals = _series()
    path = rg.cost_path(vals)
    assert len(path) == len(vals)
    assert min(path) >= rg.COST_LO - 1e-12
    assert max(path) <= rg.COST_HI + 1e-12
    # 백분위를 못 재는 앞머리는 **하한**이다 — 모르는 날을 싸게 치지 않는다.
    pct = rg.vol_percentile(vals)
    for i, p in enumerate(pct):
        if p is None:
            assert path[i] == rg.COST_LO


def test_cost_path_never_looks_ahead():
    vals = _series()
    full = rg.cost_path(vals)
    assert rg.cost_path(vals[:400]) == full[:400]


def test_names_resolve_and_unknown_names_are_refused():
    vals = _series(300)
    assert rg.gate_for("none", vals) is None
    assert rg.cost_for("flat", vals) is None
    assert len(rg.gate_for("vol", vals)) == len(vals)
    assert len(rg.gate_for("trend", vals)) == len(vals)
    assert len(rg.cost_for("dynamic", vals)) == len(vals)
    for bad, fn in (("reentry", rg.gate_for), ("spiky", rg.cost_for)):
        try:
            fn(bad, vals)
        except ValueError:
            pass
        else:
            raise AssertionError(f"{bad!r} 를 조용히 받아들였다")


def test_trend_gate_blocks_only_when_fast_is_above_slow():
    # 단조 상승이면 단기 MA 가 장기 MA 위 → 전부 차단(창이 찬 뒤).
    up = [float(i) for i in range(400)]
    g = rg.trend_gate(up)
    assert all(g[:rg.TREND_SLOW - 1]), "창이 차기 전에는 안 막는다"
    assert not any(g[rg.TREND_SLOW:]), "확대 추세는 전부 막힌다"
    # 단조 하락이면 반대다.
    down = [float(-i) for i in range(400)]
    assert all(rg.trend_gate(down))
