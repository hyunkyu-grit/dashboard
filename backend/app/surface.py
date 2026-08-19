"""커브 표면 — 테너 × 날짜 × 금리 (Lab, 2026-08-14).

Lab 탭의 두 번째 세입자. 첫 세입자(라고 할 때 살걸)가 내려간 자리이고, 오너가
외부 리서치를 보고 고른 화면이다 [OWNER, 2026-08-14 — "Yield Surface … 시계열
이랑 기간 구조 합친 거"]. 판정 근거와 대안 비교는 `docs/YIELD_SURFACE.md`.

**답해야 하는 질문은 하나다: 커브 모양이 언제 어떻게 바뀌었나.** 이 못이 필요한
이유는 DESIGN §확대뷰에 기록이 있다 — **테너 × 날짜 격자는 이 제품에서 이미 한
번 지워졌다**(커브 히트맵, carry session Pass C). 사유 둘 중 하나가 "어느 구간이
움직였나는 표의 어제 열이 더 빨리 답한다" 였다. 표면이 그 질문을 다시 답하면
같은 이유로 다시 지워진다. 여기서 파는 것은 표가 **못** 답하는 것 — 기울기·역전·
혹이 들어왔다 빠진 역사 — 이고, 그래서 단면(한 날짜의 커브)이 일급 시민이다.

나머지 사유는 "10년치를 일 단위로 깔면 소음" 이었고, 그건 설계로 막는다:
**주별이 기본이다**(`STRIDE`). 일별 전체 격자는 39,330칸/58KB gzip 으로 서빙
자체는 아무 문제가 없지만, 지워진 히트맵이 죽은 조건이 정확히 그것이다.

── 노드 집합 ─────────────────────────────────────────────────────────────────
오너는 "라이브 10노드" 를 골랐다. 그 10 은 `dataset.QUOTED_NODES` 이고 1D(콜)이
들어 있는데, **여기서는 9 다** — 1D 를 뺀다. 이 제품에는 "커브" 가 무엇인지에
대한 판정이 이미 있고(`ui/CurveView.tsx::CURVE_NODES`, [OWNER, 2026-08-05]
"3m부터 10Y까지 빠짐없이"), 거기 1D 가 빠진 사유가 그대로 여기 적용된다: 콜금리는
앵커이지 누가 거래하는 커브 점이 아니다. 실측으로도 결측 19칸이 전부 1D·3M 에
몰려 있고, 1D 는 SQL 과 엑셀이 서로 다른 계열이다.

즉 이 집합 = **라이브 호가**(QUOTED_NODES) ∩ **커브**(CURVE_NODES). 보간 노드
(4Y·6Y~9Y)를 빼는 이유는 표면의 매끄러움이 그 자체로 "여기 값이 있다" 는 주장이라,
업스트림 보간기가 그린 선을 시장으로 보이게 둘 수 없기 때문이다. 표에서는 점
마커 하나로 구분되지만 표면 위에서는 구분이 사라진다.

이 목록은 `QUOTED_NODES` 에서 **유도한다** — 손으로 다시 적으면 호가 노드가
바뀔 때 두 곳이 갈라진다.

── §16 ───────────────────────────────────────────────────────────────────────
브라우저는 좌표를 만들 뿐 값을 만들지 않는다. 금리는 여기서 반올림해 나가고,
역전 판정의 재료(2s10s bp)도 여기서 계산한다 — 프론트가 10Y−2Y 를 스스로
빼면 표의 스프레드 행과 표시 정밀도에서 어긋날 수 있다.
"""

from __future__ import annotations

from .dataset import QUOTED_NODES, Dataset, tenor_years
from .derive import spread_series

# 커브 노드 = 라이브 호가 ∩ 커브(1D 제외). 짧은 쪽부터.
SURFACE_NODES: list[str] = sorted(
    (t for t in QUOTED_NODES if t != "1D"), key=tenor_years
)

# 능선 하나 = 영업일 5일. 주별인 이유는 위 도크스트링(지워진 히트맵의 사유 2).
# 마지막 능선이 **반드시 as-of** 가 되도록 뒤에서부터 센다 — 앞에서부터 세면
# 굽는 날마다 마지막 능선이 최대 4영업일 과거가 되고, 그 4일은 이 제품이 §7
# 에서 가장 조심하는 종류의 조용한 낡음이다.
STRIDE = 5

# 역전을 재는 짝. 2s10s 는 이 시장에서도 커브 방향을 말할 때 쓰는 그 짝이고,
# `spread_series` 의 부호 규약이 곧 이 필드의 규약이다(long − short, bp).
# 음수 = 역전.
INVERSION_PAIR = ("2Y", "10Y")


def _stride_indices(n: int, stride: int = STRIDE) -> list[int]:
    """뒤에서부터 `stride` 간격으로 고른 인덱스, 오름차순. 마지막은 항상 n-1."""
    if n <= 0:
        return []
    idx = list(range(n - 1, -1, -stride))
    idx.reverse()
    return idx


def surface_payload(dataset: Dataset) -> dict:
    """커브 표면 페이로드. 리더 입력에 의존하지 않으므로 굽어서 나간다 (§21)."""
    idx = _stride_indices(len(dataset.dates))
    dates = [dataset.dates[i].isoformat() for i in idx]

    tenors = [t for t in SURFACE_NODES if t in dataset.series]
    missing = [t for t in SURFACE_NODES if t not in dataset.series]

    # 값은 표면의 z. 4dp = series 페이로드와 같은 정밀도이므로 표면에서 읽은
    # 값과 차트에서 읽은 값이 어긋나지 않는다.
    z = [
        [
            None if (v := dataset.series[t][i]) is None else round(v, 4)
            for i in idx
        ]
        for t in tenors
    ]

    short, long = INVERSION_PAIR
    if short in dataset.series and long in dataset.series:
        spread = spread_series(dataset, short, long)
        inversion = [
            None if spread[i] is None else round(spread[i], 2) for i in idx
        ]
    else:
        inversion = [None] * len(idx)

    return {
        "asof": dataset.asof.isoformat(),
        "unit": "%",
        "stride": STRIDE,
        "tenors": tenors,
        "dates": dates,
        "z": z,
        # 역전 판정의 재료. 프론트는 부호만 읽고 뺄셈은 하지 않는다 (§16).
        "inversionPair": f"{short}-{long}",
        "inversionBp": inversion,
        # 없는 노드는 조용히 사라지지 않고 이름이 나간다 — 표면에서 빠진 테너는
        # 격자가 한 칸 좁아진 것으로만 보여서 눈으로는 절대 안 잡힌다.
        "missingNodes": missing,
    }
