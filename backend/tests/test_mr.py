# -*- coding: utf-8 -*-
"""Mean Reversion 측정면 — 밴드 산술·상태 판정·페이로드 모양.

SQL 을 안 만진다: `build_mr` 의 주입 자리(fetch_irs/fetch_uni)에 합성 계열을
넣는다. 밴드 산술은 독립 구현(순수 파이썬 O(n) 누적합)이라 numpy rolling 과
값으로 대조한다 — 검증 레인(bollinger-mr)이 pandas rolling 으로 낸 값과 같은
정의(ddof=1)여야 화면과 검증이 같은 밴드를 말한다.
"""
import math
import random

import numpy as np
import pytest

from app import mr


def _numpy_bands(vals):
    v = np.asarray(vals, dtype=float)
    n = len(v)
    ma = np.full(n, np.nan)
    sd = np.full(n, np.nan)
    for i in range(mr.WINDOW - 1, n):
        w = v[i - mr.WINDOW + 1 : i + 1]
        ma[i] = w.mean()
        sd[i] = w.std(ddof=1)
    return ma, ma + mr.K * sd, ma - mr.K * sd


def test_bands_match_numpy_rolling():
    rng = random.Random(11)
    vals = [50.0]
    for _ in range(300):
        vals.append(vals[-1] + rng.gauss(0, 1))
    ma, up, lo = mr._bands(vals)
    nma, nup, nlo = _numpy_bands(vals)
    for i in range(len(vals)):
        if i < mr.WINDOW - 1:
            assert ma[i] is None and up[i] is None and lo[i] is None
        else:
            assert math.isclose(ma[i], nma[i], abs_tol=1e-9)
            assert math.isclose(up[i], nup[i], abs_tol=1e-9)
            assert math.isclose(lo[i], nlo[i], abs_tol=1e-9)


def _flat_bands(n, lo_v=-1.0, up_v=1.0):
    return [0.0] * n, [up_v] * n, [lo_v] * n


def test_state_below_counts_consecutive_days():
    n = 30
    _, up, lo = _flat_bands(n)
    vals = [0.0] * n
    vals[-3:] = [-1.5, -1.2, -1.1]          # 사흘째 하단 밖
    assert mr._state(vals, up, lo) == {"kind": "below", "days": 3}


def test_state_reentry_and_expiry():
    n = 30
    _, up, lo = _flat_bands(n)
    vals = [0.0] * n
    vals[-4] = -1.5                          # 밖 → 이틀 전 복귀
    vals[-3:] = [-0.5, -0.2, 0.1]
    assert mr._state(vals, up, lo) == {"kind": "reentry-low", "days": 3}
    vals2 = [0.0] * n
    vals2[-10] = 1.5                         # 복귀한 지 RECENT_N 을 넘으면 안이다
    assert mr._state(vals2, up, lo) == {"kind": "inside", "days": None}


def test_state_needs_full_window_of_history():
    # 창이 차기 전 구간(None 밴드)은 밖도 재진입도 아니다.
    vals = [0.0] * 30
    ma, up, lo = mr._bands(vals[: mr.WINDOW - 1] )
    assert mr._state(vals[: mr.WINDOW - 1], up, lo)["kind"] == "inside"


def _synthetic(unit: str, last_two=(3.50, 3.60), n=120, seed=3):
    rng = random.Random(seed)
    vals = [10.0]
    for _ in range(n - 3):
        vals.append(vals[-1] + rng.gauss(0, 0.05))
    vals += list(last_two)
    dates = [f"2026-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}" for i in range(len(vals))]
    return {"unit": unit, "points": [{"t": t, "v": v} for t, v in zip(dates, vals)]}


def test_assemble_scales_percent_series_to_bp():
    body = _synthetic("%")
    pts = body["points"]
    row, history = mr._assemble("IRS-3Y", "IRS 3Y", "outright", "%",
                                [p["t"] for p in pts], [p["v"] for p in pts])
    assert row["unit"] == "%" and row["dUnit"] == "bp"
    assert math.isclose(row["d1"], (pts[-1]["v"] - pts[-2]["v"]) * 100, abs_tol=1e-6)
    # 밴드 관계식 — %B 와 z 는 같은 밴드의 두 표현이다.
    assert math.isclose(row["pctB"], (row["z"] + mr.K) / (2 * mr.K) * 100, abs_tol=0.2)
    assert len(history["points"]) == min(mr.HISTORY_N, len(pts))
    assert history["points"][-1]["up"] is not None


def test_assemble_rejects_short_series():
    with pytest.raises(ValueError):
        mr._assemble("BSS-3Y", "BSS 3Y", "bss", "bp",
                     ["2026-01-01"] * mr.WINDOW, [1.0] * mr.WINDOW)


def test_build_mr_shape_sorting_and_asof():
    def fake_irs(sid):
        return _synthetic("%", seed=hash(sid) % 1000)

    def fake_uni(sid):
        u = "가격" if sid.startswith("FUT-") else "bp"
        return _synthetic(u, seed=hash(sid) % 1000)

    p = mr.build_mr(None, fetch_irs=fake_irs, fetch_uni=fake_uni)
    assert set(p.keys()) == {"asof", "params", "rows", "history"}
    assert p["params"] == {"window": mr.WINDOW, "k": mr.K, "recentN": mr.RECENT_N}
    assert len(p["rows"]) == len(mr.SERIES) == len(p["history"])
    # 랭킹은 서버가 끝낸다 — |z| 내림차순.
    zs = [abs(r["z"]) for r in p["rows"] if r["z"] is not None]
    assert zs == sorted(zs, reverse=True)
    # 소스별 as-of 세 칸이 다 찬다.
    assert all(p["asof"][k] for k in ("irs", "bss", "futures"))
    # id 는 URL 에 드는 값 — 히스토리 키와 행 id 가 같은 사전이다.
    assert {r["id"] for r in p["rows"]} == set(p["history"].keys())
