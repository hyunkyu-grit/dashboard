"""상품 한 줄 → 시뮬레이션이 받는 스왑 다리들 [OWNER, 2026-08-07].

왜 이게 생겼나. 시뮬레이션의 직접 입력이 처음에는 **단일 스왑 한 줄**이었다.
그런데 이 화면 옆에 있는 모니터는 이미 아웃라이트·스프레드·버터플라이·포워드로
세상을 나눠 보여주고 있고, 트레이더가 넣고 싶은 것은 "3년 수취"가 아니라
"3s10s 100억"이다. 다리를 손으로 둘 만들고 명목을 눈대중으로 맞추라고 하는 것은
도구가 할 일을 사람에게 미루는 것이다.

전개가 백엔드에 있는 이유는 하나다: **DV01 중립 가중에는 커브가 필요하다.**
브라우저는 계산하지 않는다(design spec §16). 프론트는 상품 id와 명목만 보내고
바로 페이로드에 실을 수 있는 다리들을 돌려받는다.

다리 규칙은 새로 쓰지 않았다 — `backtest._legs_for` / `_build_legs`가 이미
정한 것을 그대로 쓴다. 두 화면이 같은 "3s10s"를 다르게 이해하면 그 순간
비교가 불가능해진다:

    아웃라이트  10Y          → 10Y 한 다리
    스프레드    3Y-10Y       → r_10Y − r_3Y 이므로 롱 10Y / 숏 3Y
    버터플라이  2Y-5Y-10Y    → 2·r_5Y − r_2Y − r_10Y 이므로 벨리 2, 윙 각 1
    포워드      1Yx1Y        → **시작일이 미래인 한 다리** (아래 참고)

포워드는 백테스트가 못 하던 것이고 여기서는 자연스럽다. 백테스트의
`_legs_for`는 id를 "-"로 쪼개므로 `1Yx1Y`를 아웃라이트로 읽고 TENOR_T 조회에서
죽는다(그래서 BOOKABLE_GROUPS에 없다). 시뮬레이션 엔진은 다르다 —
`IRS_Trade(start, maturity, ...)`가 시작일을 받으므로, 1Yx1Y는 그냥
**D+1Y에 시작해 D+2Y에 끝나는 스왑**이다. 합성이 아니라 그 상품 자체다.

부호 관례. `direction=+1`은 언제나 "그 상품의 호가 값을 롱"이다 — 모니터와
백테스트가 쓰는 것과 같은 정의다. 스왑 다리로 내려가면 +1 = 고정 수취인데,
이 둘은 다른 층위의 같은 부호라 헷갈리기 쉽다. 아웃라이트에서 "10Y 롱"은
"금리가 오르면 이득"이고 그것은 **고정 지급**이다. 그래서 leg sign을 그대로
direction으로 넘기지 않고 아래 `_LEG_TO_SWAP`에서 한 번 뒤집는다.
"""

from __future__ import annotations

import datetime as dt
from itertools import combinations

from .backtest import BacktestError, _build_legs, _index_on_or_after
from .curves import TENOR_T
from .dataset import Dataset

# 다리로 세울 수 있는 노드. 데이터가 있는 par 테너만 — 1D(콜)와 3M(CD)은
# 스왑의 다리가 아니라 커브의 짧은 끝이다.
LEG_TENORS: list[str] = ["6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y"]

# 스프레드·플라이를 만들 때 쓰는 노드. 전체 13개로 조합하면 78 + 286 = 364개가
# 되어 고르기가 불가능해진다. 모니터의 DISPLAY_TENORS와 같은 여덟 개다.
COMBO_TENORS: list[str] = ["6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"]

# 포워드로 제시할 (시작, 기간). 모니터의 포워드 탭이 쓰는 격자를 그대로 따르지
# 않고 사람이 실제로 말하는 것만 남겼다 — 1Yx1Y, 2Yx1Y 같은 것들.
FORWARD_GRID: list[tuple[str, str]] = [
    ("6M", "6M"), ("6M", "1Y"), ("1Y", "1Y"), ("1Y", "2Y"),
    ("2Y", "1Y"), ("2Y", "2Y"), ("2Y", "3Y"), ("3Y", "2Y"),
    ("5Y", "5Y"),
]


def _years(tenor: str) -> float:
    t = TENOR_T.get(tenor)
    if t is None:
        raise BacktestError(f"unknown tenor {tenor!r}")
    return t


def catalog() -> dict[str, list[dict]]:
    """고를 수 있는 상품들, 모니터의 그룹 그대로. 프론트의 드롭다운이 이걸 읽는다."""
    out: dict[str, list[dict]] = {"outright": [], "spread": [], "fly": [], "forward": []}
    for t in LEG_TENORS:
        out["outright"].append({"id": t, "label": t})
    for a, b in combinations(COMBO_TENORS, 2):
        out["spread"].append({"id": f"{a}-{b}", "label": f"{a}-{b}"})
    for a, b, c in combinations(COMBO_TENORS, 3):
        out["fly"].append({"id": f"{a}-{b}-{c}", "label": f"{a}-{b}-{c}"})
    for start, span in FORWARD_GRID:
        out["forward"].append({"id": f"{start}x{span}", "label": f"{start}x{span}"})
    return out


def kind_of(series_id: str) -> str:
    if "x" in series_id:
        return "forward"
    n = series_id.count("-")
    return "outright" if n == 0 else ("spread" if n == 1 else "fly")


def _add_years(d: dt.date, years: float) -> dt.date:
    """기준일 + n년. 월 단위로 더한 뒤 그 달에 없는 날만 말일로 내린다 —
    프론트의 addYearsIso와 같은 규칙이고, 같은 이유(2/29가 3/1로 새는 것)다."""
    months = int(round(years * 12))
    y, m = divmod((d.year * 12 + d.month - 1) + months, 12)
    m += 1
    day = min(d.day, [31, 29 if (y % 4 == 0 and (y % 100 or y % 400 == 0)) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return dt.date(y, m, day)


def expand(
    dataset: Dataset, series_id: str, direction: int, notional: float, base_date: dt.date
) -> list[dict]:
    """상품 한 줄 → FrontendPosition 모양의 다리들.

    반환되는 각 줄은 시뮬레이션 페이로드에 그대로 실린다: 파생 필드
    (remainingDays·nextFixingDate·currentFloatRate)는 0으로 두고 백엔드의
    swap_inputs가 채운다. 여기서 계산하면 진실이 둘이 된다.
    """
    kind = kind_of(series_id)
    i = _index_on_or_after(dataset.dates, base_date)
    as_of = dataset.dates[i]

    if kind == "forward":
        start_s, span_s = series_id.split("x", 1)
        start = _add_years(as_of, _years(start_s))
        mat = _add_years(start, _years(span_s))
        # 포워드 par는 커브에서 나온다. 여기서는 그 구간의 스왑을 만들되 고정
        # 금리를 비워 보내면 엔진이 시작일 커브로 친다 — 그게 곧 포워드 par다.
        rate = _forward_par(dataset, i, _years(start_s), _years(span_s))
        return [_leg_row(series_id, 0, start, mat, rate, direction * -1, notional, span_s)]

    # 아웃라이트·스프레드·플라이는 백테스트의 다리 기계를 그대로 쓴다.
    legs = _build_legs(dataset, series_id, notional, i)
    rows: list[dict] = []
    for n, leg in enumerate(legs):
        mat = _add_years(as_of, _years(leg.tenor))
        # leg.sign은 "호가 값을 롱"일 때의 부호다. 스왑에서 금리 롱은 고정
        # **지급**(−1)이므로 한 번 뒤집는다. 위 모듈 주석 참고.
        swap_dir = direction * leg.sign * -1
        rows.append(
            _leg_row(series_id, n, as_of, mat, leg.entry_rate * 100.0, swap_dir, leg.notional, leg.tenor)
        )
    return rows


def _forward_par(dataset: Dataset, i: int, start_y: float, span_y: float) -> float:
    """포워드 par(퍼센트).

    par swap 정의 그대로: (DF(t0) − DF(t1)) / 분기 연금. 할인계수는
    `engine_port.df` — 이 리포가 커브를 읽는 유일한 함수이고, 여기서
    보간을 다시 쓰면 같은 커브에 두 개의 읽는 법이 생긴다.
    """
    from .backtest import _curve_at
    from .engine_port import df

    zc = _curve_at(dataset, i)
    t0, t1 = start_y, start_y + span_y
    steps = max(int(round(span_y * 4)), 1)          # 원화 IRS는 분기 정산
    dt_ = span_y / steps
    ann = sum(df(t0 + (k + 1) * dt_, zc) * dt_ for k in range(steps))
    return ((df(t0, zc) - df(t1, zc)) / ann) * 100.0 if ann else 0.0


def _leg_row(
    series_id: str, n: int, start: dt.date, mat: dt.date, rate_pct: float,
    direction: int, notional: float, tenor: str,
) -> dict:
    return {
        "id": f"{series_id}#{n}",
        "name": f"{series_id} · {tenor}",
        "book": "직접입력",
        "bondType": "swap",
        "sector": "IRS",
        "maturityDate": mat.isoformat(),
        "couponRate": rate_pct,
        "frequency": 4,
        "notional": notional,
        "entryYield": 0.0,
        "entryYieldPurchase": 0.0,
        "evaluationAmount": 0.0,
        "duration": 0.0,
        "pvbp": 0.0,
        "tenor": tenor,
        "remainingDays": 0.0,      # 백엔드가 채운다
        "durationWeight": 0.0,
        "krdMap": {},              # 백엔드가 채운다
        "direction": direction,
        "currentFloatRate": 0.0,   # 백엔드가 CD 픽싱에서 채운다
        "startDate": start.isoformat(),
    }
