# -*- coding: utf-8 -*-
"""Mean Reversion 측정면 — 밴드 산술·상태 판정·페이로드 모양.

SQL 을 안 만진다: `build_mr` 의 주입 자리(fetch_uni)에 합성 계열을 넣는다.
밴드 산술은 독립 구현(순수 파이썬 O(n) 누적합)이라 numpy rolling 과 값으로
대조한다 — 검증 레인(bollinger-mr)이 pandas rolling 으로 낸 값과 같은
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
    vals = [0.0] * (mr.WINDOW - 1)
    ma, up, lo = mr._bands(vals)
    assert mr._state(vals, up, lo)["kind"] == "inside"


def _synthetic(unit: str, last_two=(3.50, 3.60), n=120, seed=3):
    rng = random.Random(seed)
    vals = [10.0]
    for _ in range(n - 3):
        vals.append(vals[-1] + rng.gauss(0, 0.05))
    vals += list(last_two)
    dates = [f"2026-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}" for i in range(len(vals))]
    return {"unit": unit, "points": [{"t": t, "v": v} for t, v in zip(dates, vals)]}


def test_assemble_scales_percent_series_to_bp():
    # BSS 는 bp 지만 단위 규칙은 함수의 것이다 — %-계열 환산이 살아 있는지 잰다.
    body = _synthetic("%")
    pts = body["points"]
    row, history = mr._assemble("IRS-3Y", "IRS 3Y", "%",
                                [p["t"] for p in pts], [p["v"] for p in pts])
    assert row["unit"] == "%" and row["dUnit"] == "bp"
    assert math.isclose(row["d1"], (pts[-1]["v"] - pts[-2]["v"]) * 100, abs_tol=1e-6)
    # 밴드 관계식 — %B 와 z 는 같은 밴드의 두 표현이다.
    assert math.isclose(row["pctB"], (row["z"] + mr.K) / (2 * mr.K) * 100, abs_tol=0.2)
    assert len(history["points"]) == min(mr.HISTORY_N, len(pts))
    assert history["points"][-1]["up"] is not None


def test_assemble_rejects_short_series():
    with pytest.raises(ValueError):
        mr._assemble("BSS-3Y", "BSS 3Y", "bp",
                     ["2026-01-01"] * mr.WINDOW, [1.0] * mr.WINDOW)


def test_build_mr_bss_only_shape_rank_and_exclusion():
    short = "BSS-9M"                          # 못 읽은 테너는 조용히 빠지지 않는다

    def fake_uni(sid):
        if sid == short:
            return _synthetic("bp", n=mr.WINDOW)   # 창 미달 → excluded
        return _synthetic("bp", seed=abs(hash(sid)) % 1000)

    p = mr.build_mr(None, fetch_uni=fake_uni)
    assert set(p.keys()) == {"asof", "params", "rows", "excluded", "history"}
    assert p["params"] == {"window": mr.WINDOW, "k": mr.K, "recentN": mr.RECENT_N}
    # 유니버스는 BSS 전 테너뿐이다 [OWNER 2026-08-25 — "일단 본드스왑만"].
    assert all(sid.startswith("BSS-") for sid, _ in mr.SERIES)
    assert len(mr.SERIES) == 9
    assert len(p["rows"]) == len(mr.SERIES) - 1 == len(p["history"])
    assert p["excluded"] == [{"id": short, "label": "BSS 9M",
                              "reason": f"{short}: 창({mr.WINDOW})보다 짧은 이력({mr.WINDOW})"}]
    # 랭킹과 순위 숫자는 서버가 끝낸다 — |z| 내림차순, rank 는 1부터 연속.
    zs = [abs(r["z"]) for r in p["rows"] if r["z"] is not None]
    assert zs == sorted(zs, reverse=True)
    assert [r["rank"] for r in p["rows"]] == list(range(1, len(p["rows"]) + 1))
    assert p["asof"]["bss"] is not None
    assert {r["id"] for r in p["rows"]} == set(p["history"].keys())
