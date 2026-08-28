# -*- coding: utf-8 -*-
"""레짐 필터와 동적 거래비용 — 화면과 연구 스크립트가 **같은 것**을 쓴다
[OWNER 2026-08-28 — 실전 운용 재설계].

이 파일이 생긴 이유는 이 리포의 규율이다: 리포트가 쓴 필터와 화면이 쓰는 필터가
두 벌이면, 화면의 수가 리포트의 수와 다를 때 어느 쪽이 옳은지 판정할 자료가
없다. `backend/scripts/mr_live_wfo.py` 가 여기 것을 임포트한다.

## 미래를 안 보는 것이 이 모듈의 전부다

백분위를 **확장 창**으로 잰다. 전 표본 분위를 쓰면 「그날 그것이 상위 10% 였는가」
를 미래를 보고 판정하게 되고, 그렇게 만든 필터는 백테스트에서만 작동한다.
`tests/test_mrregime.py` 가 그 성질을 잰다: 뒤쪽 자료를 잘라 내도 앞쪽 판정이
한 칸도 안 바뀌어야 한다.

관측이 `VOL_MIN_HIST` 봉 쌓이기 전에는 필터가 **쉰다**. 표본 앞머리에서
「위험한 날」을 정의할 근거가 없기 때문이고, 그 구간을 차단으로 두면 창이 언제
시작하느냐가 곧 성과가 된다.
"""
from __future__ import annotations

import statistics as st

VOL_WIN = 30
"""실현변동성 창(영업일). 30일은 지시가 준 값이다."""

VOL_BLOCK = 0.90
"""이 백분위 이상이면 진입 금지 — 상위 10%."""

VOL_MIN_HIST = 250
"""백분위를 믿기 시작하는 관측 수. 그 전에는 필터가 쉰다."""

TREND_FAST, TREND_SLOW = 20, 120
"""추세 필터의 두 이동평균."""

COST_LO, COST_HI = 0.15, 0.25
"""동적 편도 비용의 하한·상한(bp). 지시가 준 범위다."""

REGIMES = ("none", "vol", "trend")
COST_MODELS = ("flat", "dynamic")


def realized_vol(vals: list[float], win: int = VOL_WIN) -> list[float | None]:
    """직전 `win` 봉 변화의 모집단 표준편차. 창이 안 차면 None.

    모집단 σ 를 쓰는 것은 `mrbacktest.rolling_series` 와 같은 규약이다 — 한
    화면에서 두 가지 σ 를 쓰면 같은 이름의 두 값이 생긴다.
    """
    n = len(vals)
    out: list[float | None] = [None] * n
    d: list[float | None] = [None] + [vals[i] - vals[i - 1] for i in range(1, n)]
    for i in range(win, n):
        w = [x for x in d[i - win + 1:i + 1] if x is not None]
        out[i] = st.pstdev(w) if len(w) == win else None
    return out


def vol_percentile(vals: list[float]) -> list[float | None]:
    """그날까지의 관측 안에서 그날 변동성이 놓인 자리(0~1). **과거만 본다**."""
    seen: list[float] = []
    out: list[float | None] = []
    for x in realized_vol(vals):
        if x is None:
            out.append(None)
            continue
        out.append((sum(1 for s in seen if s <= x) / len(seen)) if seen else None)
        seen.append(x)
    return out


def vol_gate(vals: list[float]) -> list[bool]:
    """변동성 상위 10% 인 봉은 진입 금지. True = 들어가도 되는 봉."""
    pct = vol_percentile(vals)
    seen = 0
    gate: list[bool] = []
    for p in pct:
        if p is None:
            gate.append(True)
            continue
        seen += 1
        gate.append(True if seen < VOL_MIN_HIST else p < VOL_BLOCK)
    return gate


def trend_gate(vals: list[float]) -> list[bool]:
    """단기 MA 가 장기 MA 위면(스프레드 확대 추세) 진입 금지.

    이 데스크가 할 수 있는 거래는 스프레드가 **좁혀질 때** 버는 쪽 하나뿐이라,
    확대 추세에서의 진입은 추세 역행이다. 다만 실측에서 이 필터는 전 영업일의
    40.7% 를 막았고 거래를 7건에서 2건으로 줄였다 — 막아서 피한 손실보다 포기한
    수익이 컸다(`docs/MR_LANE_STATE.md`). 선택지로만 둔다.
    """
    def ma(w: int) -> list[float | None]:
        out: list[float | None] = [None] * len(vals)
        for i in range(w - 1, len(vals)):
            out[i] = sum(vals[i - w + 1:i + 1]) / w
        return out
    f, s = ma(TREND_FAST), ma(TREND_SLOW)
    return [True if (f[i] is None or s[i] is None) else not (f[i] > s[i])
            for i in range(len(vals))]


def gate_for(kind: str, vals: list[float]) -> list[bool] | None:
    """이름 → 게이트. `none` 이면 None(엔진이 게이트를 아예 안 본다)."""
    if kind == "none":
        return None
    if kind == "vol":
        return vol_gate(vals)
    if kind == "trend":
        return trend_gate(vals)
    raise ValueError(f"레짐 필터 이름이 이상하다: {kind!r}")


def cost_path(vals: list[float]) -> list[float]:
    """편도 비용(bp) = 0.15 + 0.10 × 변동성 백분위 → [0.15, 0.25].

    z 가 문턱을 넘는 봉은 호가가 벌어져 있는 봉이다. 실측(BSS-3Y)에서 진입일의
    변동성 백분위 중앙값은 **0.71**, 전 영업일은 0.46 이었다 — 평시 호가를
    상수로 쓰면 진입 비용이 조직적으로 싸게 잡힌다.

    백분위를 못 재는 앞머리는 **하한**으로 둔다. 모르는 날을 싸게 치지 않는다.
    """
    return [COST_LO + (COST_HI - COST_LO) * (p if p is not None else 0.0)
            for p in vol_percentile(vals)]


def cost_for(model: str, vals: list[float]) -> list[float] | None:
    """이름 → 비용 경로. `flat` 이면 None(엔진이 스칼라 `cost_bp` 를 쓴다)."""
    if model == "flat":
        return None
    if model == "dynamic":
        return cost_path(vals)
    raise ValueError(f"비용 모델 이름이 이상하다: {model!r}")
