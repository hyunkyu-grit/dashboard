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


def _numpy_bands(vals, window, k):
    v = np.asarray(vals, dtype=float)
    n = len(v)
    ma = np.full(n, np.nan)
    sd = np.full(n, np.nan)
    for i in range(window - 1, n):
        w = v[i - window + 1 : i + 1]
        ma[i] = w.mean()
        sd[i] = w.std(ddof=1)
    return ma, ma + k * sd, ma - k * sd


@pytest.mark.parametrize("window,k", [(mr.WINDOW, mr.K), (60, 1.5), (252, 2.5)])
def test_bands_match_numpy_rolling(window, k):
    rng = random.Random(11)
    vals = [50.0]
    for _ in range(300):
        vals.append(vals[-1] + rng.gauss(0, 1))
    ma, up, lo = mr._bands(vals, window, k)
    nma, nup, nlo = _numpy_bands(vals, window, k)
    for i in range(len(vals)):
        if i < window - 1:
            assert ma[i] is None and up[i] is None and lo[i] is None
        else:
            assert math.isclose(ma[i], nma[i], abs_tol=1e-9)
            assert math.isclose(up[i], nup[i], abs_tol=1e-9)
            assert math.isclose(lo[i], nlo[i], abs_tol=1e-9)


def test_options_carry_their_provenance_defaults():
    # 선택지는 근거 있는 값만 — 기본(볼린저 20·2σ)이 목록의 첫 자리다.
    assert mr.WINDOWS[0] == mr.WINDOW == 20
    assert mr.K == 2.0 and mr.K in mr.KS
    assert mr.WINDOWS == (20, 60, 120, 252)
    assert mr.KS == (1.5, 2.0, 2.5)


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
    # 선물 내재금리(%) 행이 이 환산을 실제로 쓴다 — d1·밴드폭은 bp 로 끝난다.
    body = _synthetic("%")
    pts = body["points"]
    row, history = mr._assemble("FUT-KTB3", "KTB3 내재금리", "fut", "%",
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


def _pv(r: float, years: int) -> float:
    d = 1.0 + r / 2.0
    n = 2 * years
    return sum(2.5 / d ** t for t in range(1, n + 1)) + 100.0 / d ** n


def test_implied_yield_par_and_roundtrip():
    # 표면 5% 합성채는 r=5% 에서 정확히 100 — 자명한 핀.
    assert abs(mr._implied_yield(100.0, 3) - 5.0) < 1e-9
    assert abs(mr._implied_yield(100.0, 10) - 5.0) < 1e-9
    # 왕복: 아무 금리에서나 이론가를 만들고 다시 풀면 그 금리다.
    for years in (3, 10):
        for r in (0.02, 0.038, 0.055, 0.12):
            price = _pv(r, years)
            assert abs(mr._implied_yield(price, years) - r * 100.0) < 1e-6
    # 실측 규모 확인: 2026-08-24 KTB3 종가 103.22 → 3%대 후반 (IRS 3Y 근방).
    y = mr._implied_yield(103.22, 3)
    assert 3.5 < y < 4.1


def _fake_fut():
    return {
        "FUT-KTB3": _synthetic("%", seed=101),
        "FUT-KTB10": _synthetic("%", seed=102),
        "FSW-3Y": _synthetic("bp", seed=103),
        "FSW-10Y": _synthetic("bp", seed=104),
    }


def test_build_mr_universe_shape_rank_and_exclusion():
    short = "BSS-9M"                          # 못 읽은 계열은 조용히 빠지지 않는다

    def fake_uni(sid):
        if sid == short:
            return _synthetic("bp", n=mr.WINDOW)   # 창 미달 → excluded
        return _synthetic("bp", seed=abs(hash(sid)) % 1000)

    p = mr.build_mr(None, fetch_uni=fake_uni, fetch_fut=_fake_fut)
    # `watch` = BSS 통합 한 줄 [OWNER 2026-09-01] — 랭킹 아래에 따로 선다.
    assert set(p.keys()) == {"asof", "params", "rows", "watch", "excluded", "history"}
    assert p["params"] == {"window": mr.WINDOW, "k": mr.K, "recentN": mr.RECENT_N}
    # 파라미터가 페이로드를 관통한다 — 다른 창은 다른 밴드·다른 파라미터 응답.
    p60 = mr.build_mr(None, window=60, k=1.5, fetch_uni=fake_uni, fetch_fut=_fake_fut)
    assert p60["params"]["window"] == 60 and p60["params"]["k"] == 1.5
    assert all(r["z"] is None or isinstance(r["z"], float) for r in p60["rows"])
    # 유니버스 = BSS 아홉 + 선물 내재 둘 + 퓨처스왑 둘 [OWNER 2026-08-25 —
    # "선물 들어왔는데 국채선물 롱숏이랑 퓨처스왑 롱숏도 반영하기"].
    assert len(mr.SERIES) == 13
    kinds = [kd for _, _, kd in mr.SERIES]
    assert kinds.count("bss") == 9 and kinds.count("fut") == 2 and kinds.count("fsw") == 2
    assert len(p["rows"]) == len(mr.SERIES) - 1 == len(p["history"])
    assert p["excluded"] == [{"id": short, "label": "BSS 9M",
                              "reason": f"{short}: 창({mr.WINDOW})보다 짧은 이력({mr.WINDOW})"}]
    # 행마다 정의 문장이 실린다 — 혼합 유니버스에서 숫자 옆의 «무엇인지».
    for r in p["rows"]:
        assert r["defn"] == mr.KIND_DEFN[r["kind"]]
    # 랭킹과 순위 숫자는 서버가 끝낸다 — |z| 내림차순, rank 는 1부터 연속.
    zs = [abs(r["z"]) for r in p["rows"] if r["z"] is not None]
    assert zs == sorted(zs, reverse=True)
    assert [r["rank"] for r in p["rows"]] == list(range(1, len(p["rows"]) + 1))
    # 소스별 as-of 두 가족이 다 찬다(rv B-2 의 그 분리).
    assert p["asof"]["bss"] is not None and p["asof"]["fut"] is not None
    assert {r["id"] for r in p["rows"]} == set(p["history"].keys())


def test_series_points_dispatch():
    bundle = {"FSW-3Y": {"unit": "bp", "points": []}}
    assert mr.series_points("FSW-3Y", fut_bundle=bundle)["unit"] == "bp"
    with pytest.raises(KeyError):
        mr.series_points("없는계열")


def test_bss_has_no_short_side():
    """BSS 는 국고 매수 쪽 한 방향뿐이다 [OWNER 2026-08-25 — "BSS에서 숏은
    없는거야,, 현물대차매도는 안할거거든"].

    부호의 뜻을 같이 못 박는다: 엔진의 `+1` 은 값(국고 − IRS)이 **오르면** 버는
    쪽이고, 그건 국고를 빌려 파는 다리다. 그래서 허용되는 것은 `-1` 이고 그
    이름에 「국고 매수」가 들어 있어야 한다 — 부호와 이름이 갈리면 화면이
    반대 거래를 시킨다.
    """
    d = mr.dirs_for("bss")
    assert d["allowed"] == [-1]
    assert "국고 매수" in d["minus"]["legs"] and "IRS 페이" in d["minus"]["legs"]
    assert "국고 매도" in d["plus"]["legs"]
    assert d["why"]

    # 선물은 대차가 필요 없다 — 양방향 그대로.
    for kind in ("fut", "fsw"):
        assert mr.dirs_for(kind)["allowed"] == [-1, 1]
        assert mr.dirs_for(kind)["why"] is None


def test_every_series_kind_has_a_direction_rule():
    # 계열을 늘렸는데 방향 사전을 안 늘리면 그 행의 전략 창이 KeyError 로 죽는다.
    for _, _, kind in mr.SERIES:
        assert kind in mr.TRADABLE_DIRS and kind in mr.DIR_LEGS
        assert mr.dirs_for(kind)["plus"]["short"] and mr.dirs_for(kind)["minus"]["short"]
