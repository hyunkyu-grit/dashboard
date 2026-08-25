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
from .derive import is_key
from .forwards import KEY_FORWARDS

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
    """고를 수 있는 상품들, 모니터의 그룹 그대로. 프론트의 드롭다운이 이걸 읽는다.

    각 항목에 `key`가 붙는다 [2026-08-07] — 모니터의 표가 이미 쓰는 **주요/전체**
    구분이고 판정도 같은 곳(`derive.is_key`, `forwards.KEY_FORWARDS`)에서 나온다.
    프론트에 두 번째 목록을 두지 않는 이유가 이 함수가 있는 이유와 같다: 두 화면이
    서로 다른 "주요 스프레드"를 가지면 그 순간 비교가 불가능해진다.

    무엇을 고를 수 있는지는 **바뀌지 않는다.** 전체 106개가 그대로 다 있고, 표시
    순서만 주요가 먼저다. 버터플라이 56개를 스크롤해서 찾는 것이 고르는 게
    아니라는 것이 [OWNER]의 지적이었고, 답은 목록을 줄이는 것이 아니라 이미 있는
    큐레이션을 여기에도 적용하는 것이다.
    """
    out: dict[str, list[dict]] = {"outright": [], "spread": [], "fly": [], "forward": []}
    for t in LEG_TENORS:
        out["outright"].append({"id": t, "label": t, "key": is_key(t, "outright")})
    for a, b in combinations(COMBO_TENORS, 2):
        sid = f"{a}-{b}"
        out["spread"].append({"id": sid, "label": sid, "key": is_key(sid, "spread")})
    for a, b, c in combinations(COMBO_TENORS, 3):
        sid = f"{a}-{b}-{c}"
        out["fly"].append({"id": sid, "label": sid, "key": is_key(sid, "fly")})
    # 포워드는 자기 플래그를 따로 든다 — `is_key`가 forward를 항상 False로 답하고
    # (그 함수의 독스트링이 그렇게 적혀 있다), 주요 목록은 forwards.KEY_FORWARDS다.
    # KEY_FORWARDS의 첫 칸이 곧 id다 — ("1Yx1Y", 1.0, 1.0). 뒤 둘은 연 단위
    # 시작·기간이라 여기서는 쓰지 않는다.
    key_forwards = {label for label, *_ in KEY_FORWARDS}
    for start, span in FORWARD_GRID:
        sid = f"{start}x{span}"
        out["forward"].append({"id": sid, "label": sid, "key": sid in key_forwards})
    out.update(_bond_catalog())
    out.update(_futures_catalog())
    return out


def _futures_catalog() -> dict[str, list[dict]]:
    """고를 수 있는 선물·퓨처스왑 [OWNER, 2026-08-25]. 종가가 **SQL 에만**
    있으므로 닿지 않으면 빈 목록 — 채권 목록과 같은 강등 규율."""
    out: dict[str, list[dict]] = {"futures": [], "futuresswap": []}
    try:
        from . import futures as ft

        fut = ft.load()
    except Exception:
        return out
    for tenor in ft.FUT_TENORS:
        fs = fut.series.get(tenor)
        if fs is None or not fs.dates:
            continue
        out["futures"].append(
            {"id": f"{ft.KIND_FUT}:{tenor}", "label": ft.FUT_LABELS[tenor], "key": True}
        )
        out["futuresswap"].append(
            {"id": f"{ft.KIND_FSW}:{tenor}", "label": ft.FSW_LABELS[tenor], "key": True}
        )
    return out


def kind_of(series_id: str) -> str:
    if series_id.startswith(f"{_CB}:"):
        return "cashbond"
    if series_id.startswith(f"{_ASW}:"):
        return "assetswap"
    # 선물 접두사도 접두사 우선이다 — `FUT:3Y` 에는 '-' 가 없어 아웃라이트로
    # 읽히고, 그러면 TENOR_T 조회에서 죽는다(모듈 상단 CB 주석과 같은 이유).
    if series_id.startswith("FUT:"):
        return "futures"
    if series_id.startswith("FSW:"):
        return "futuresswap"
    if "x" in series_id:
        return "forward"
    n = series_id.count("-")
    return "outright" if n == 0 else ("spread" if n == 1 else "fly")


# ── 현금채권 · 자산스왑 ──────────────────────────────────────────────────────
#
# [OWNER, 2026-08-14 — "시뮬레이션 포지션에 스왑 뿐만아니라 현금채권이랑
# 자산스왑 추가해줘"]. 백테스트 쪽 Cash Bond 탭과 **같은 상품·같은 id 문법**
# (`CB:KTB:3Y` · `ASW:KTB:3Y`)이다. 같은 문자열이 두 화면에서 같은 것을 뜻해야
# 비교가 되고, 그건 이 모듈이 스왑 쪽에서 이미 지키고 있는 규칙이다.
#
# 시뮬레이션 엔진은 채권을 **이미 값매긴다** — `daily_valuation` 의
# `bondType != "swap"` 갈래가 MTM(`pvbp × −Δbp`, 잔존으로 감쇠)과 캐리
# (`평가액 × mtmYield` − 조달)를 둘 다 들고 있다. 새로 쓸 산술이 없다.
#
# 다만 **채권은 enrichment 를 그냥 통과한다**(그 모듈: "채권 포지션은 그대로
# 통과"). 스왑은 pvbp·krdMap 을 엔진이 채워 주지만 채권은 아무도 안 채운다 —
# 안 채우고 보내면 pvbp 0 이라 금리가 아무리 움직여도 손익이 0 이고, 그건
# 화면에 조용한 0 으로 나온다. 그래서 여기서 채워 보낸다.

_CB = "CB"
_ASW = "ASW"

#: 민평 종목군 → 시뮬레이션의 섹터 어휘(`sim/types/portfolio.ts` 의 열거형).
#
# 사상을 **명시적으로** 적는 이유가 있다. `daily_valuation.get_sector_curve_key`
# 가 부분문자열로 충격 커브를 고르는데, 민평 이름을 그대로 넘기면 "산금채 AAA"
# 와 "캐피탈채 AA-" 가 어느 갈래에도 안 걸려 조용히 **국채 커브**를 탄다.
# 여덟 중 둘이 틀린 커브로 충격을 받고, 아무 데서도 안 터진다.
_SIM_SECTOR: dict[str, str] = {
    "KTB": "국고채",   # → 국채
    "MSB": "통안채",   # → 국채
    "KDB": "특은채",   # 산금채 = 특수은행채 → 특은채
    "SPB": "공사채",   # → 특은채
    "BD": "시은채",    # 은행채 = 시중은행채 → 은행채
    "CB1": "회사채",   # → 회사채
    "CARD": "여전채",  # → 카드채
    "OFB": "여전채",   # 캐피탈 = 여신전문금융 → 카드채
}


def _bond_catalog() -> dict[str, list[dict]]:
    """고를 수 있는 채권들. 민평이 **SQL 에만** 있으므로 닿지 않으면 빈 목록을
    돌려준다 — 스왑 목록까지 같이 죽는 것보다 낫다(그때는 채권 종류만 비어
    보이고 나머지 화면은 그대로 선다).

    `key`(주요)는 국고채다. 여덟 종목군 × 만기 열넷이면 90줄이 넘어 스크롤로
    고를 수가 없고, 그 문제의 답은 목록을 줄이는 게 아니라 순서를 주는
    것이라는 판단이 이 파일 위쪽 `catalog` 주석에 이미 있다.
    """
    out: dict[str, list[dict]] = {"cashbond": [], "assetswap": []}
    try:
        from . import cashbond as cb
        from . import creditmatrix as cm

        m = cm.load()
    except Exception:
        return out
    for bond_type in cm.BOND_TYPES:
        for tenor in cm.TENOR_LABELS:
            if not m.has(bond_type, tenor):
                continue
            key = bond_type == "KTB"
            out["cashbond"].append({
                "id": f"{_CB}:{bond_type}:{tenor}",
                "label": cb.instrument_label(_CB, bond_type, tenor),
                "key": key,
            })
            if tenor in cb.ASW_TENORS:
                out["assetswap"].append({
                    "id": f"{_ASW}:{bond_type}:{tenor}",
                    "label": cb.instrument_label(_ASW, bond_type, tenor),
                    "key": key,
                })
    return out


def _bond_krd(
    m, bond_type: str, tenor: str, i: int, coupon: float, n: int, notional: float
) -> dict[str, float]:
    """민평 노드를 1bp 올렸을 때의 가치 변화에 부호를 뒤집은 것(원/bp).

    `cashbond._krd_bond` 와 같은 규칙이다. 단일수익률 할인이라 잔존만기를 감싸는
    **두 노드에만** 실린다 — 그 표와 이 표가 같은 리스크를 말해야 한다.
    """
    from . import cashbond as cb
    from . import creditmatrix as cm

    out: dict[str, float] = {}
    pts = cm.curve_points(m, bond_type, i)
    if not pts:
        return out
    years = cm.TENOR_YEARS[tenor]
    base_y = cm.interp(pts, years)
    base = cb.price(base_y, coupon, n, 0.0)[0]
    for label, node_y in cm.TENOR_YEARS.items():
        bumped = [(y, r + (1e-4 if abs(y - node_y) < 1e-9 else 0.0)) for y, r in pts]
        y_b = cm.interp(bumped, years)
        if y_b == base_y:
            continue  # 이 노드는 그 잔존만기를 감싸지 않는다
        v = -(cb.price(y_b, coupon, n, 0.0)[0] - base) * notional
        if v:
            out[label] = v
    return out


def _expand_bond(
    dataset: Dataset, series_id: str, direction: int, notional: float, base_date: dt.date
) -> list[dict]:
    """`CB:KTB:3Y` · `ASW:KTB:3Y` → 시뮬레이션이 받는 줄들.

    현금채권은 한 줄, 자산스왑은 **두 줄**이다 — 채권 매수 + 같은 명목의 페이
    고정(`cashbond._swap_leg` 의 par-par 규약 그대로). 두 줄로 보내는 것이
    맞는 이유: 엔진이 채권과 스왑을 다른 갈래로 값매기므로 한 줄로 접으면
    둘 중 하나의 산술을 잃는다.
    """
    from . import cashbond as cb
    from . import creditmatrix as cm

    parts = series_id.split(":")
    if len(parts) != 3:
        raise BacktestError(f"unknown instrument {series_id!r}")
    kind, bond_type, tenor = parts
    if bond_type not in cm.BOND_TYPES or tenor not in cm.TENOR_YEARS:
        raise BacktestError(f"unknown instrument {series_id!r}")
    if direction != 1:
        # 백테스트 쪽과 같은 거절이다 [OWNER, 2026-08-14 — "국고채는 매도는
        # 없는거고"]: 공매도는 채권을 빌리는 것이고 그 대차료를 이 화면은
        # 모른다. 모르는 비용을 0 으로 두면 공매도가 늘 이기는 시뮬이 된다.
        raise BacktestError("채권은 매수만 세울 수 있습니다.")

    m = cm.load()
    if not m.has(bond_type, tenor):
        raise BacktestError(
            f"{cm.BOND_TYPES.get(bond_type, bond_type)} 에는 {tenor} 민평이 없습니다."
        )
    i = cm.index_on_or_before(m.dates, base_date)
    as_of = m.dates[i]
    years = cm.TENOR_YEARS[tenor]
    n = cb.periods_for(tenor)
    y = cm.yield_at(m, bond_type, i, years)      # decimal
    # 표면수익률 = 민평 [OWNER, 2026-08-14]. 그래서 진입일 가격이 정확히 par 다
    # (`test_entry_price_is_exactly_par`), 곧 평가액 = 명목이다.
    dirty = cb.price(y, y, n, 0.0)[0]
    value = notional * dirty
    # pvbp 는 **롱이 양수**다 — 엔진이 `pvbp × (−Δbp)` 로 MTM 을 만들므로
    # (daily_valuation), 금리가 오르면 손실이 되려면 이 부호여야 한다.
    pvbp = -(cb.price(y + 1e-4, y, n, 0.0)[0] - dirty) * notional
    mod_dur = (pvbp * 1e4 / value) if value else 0.0

    rows = [{
        "id": f"{series_id}#0",
        "name": cb.instrument_label(kind, bond_type, tenor),
        "book": "직접입력",
        "bondType": "bond",
        "sector": _SIM_SECTOR.get(bond_type, "국고채"),
        "maturityDate": _add_years(as_of, years).isoformat(),
        "couponRate": y * 100.0,
        "frequency": 4,                       # 3개월 이표채 가정 — 백테스트와 같다
        "notional": notional,
        "entryYield": y * 100.0,
        "entryYieldPurchase": y * 100.0,
        # 캐리가 읽는 칸이다(`calculate_daily_carry`: 평가액 × mtmYield/100).
        # 여기가 비면 채권이 쿠폰을 한 푼도 못 받고 조달만 낸다.
        "mtmYield": y * 100.0,
        "evaluationAmount": value,
        "duration": mod_dur,
        "pvbp": pvbp,
        "tenor": tenor,
        "remainingDays": years * 365.0,
        "durationWeight": 0.0,
        "krdMap": _bond_krd(m, bond_type, tenor, i, y, n, notional),
        "direction": 1,
        "startDate": as_of.isoformat(),
    }]

    if kind == _ASW:
        if tenor not in cb.ASW_TENORS:
            raise BacktestError(
                f"{tenor} 는 자산스왑을 세울 수 없습니다 — 채권과 IRS 양쪽에 "
                f"있는 만기만 가능합니다 ({'·'.join(cb.ASW_TENORS)})."
            )
        j = _index_on_or_after(dataset.dates, base_date)
        swap_as_of = dataset.dates[j]
        legs = _build_legs(dataset, tenor, notional, j)
        for k, leg in enumerate(legs, start=1):
            rows.append(_leg_row(
                series_id, k, swap_as_of, _add_years(swap_as_of, _years(leg.tenor)),
                leg.entry_rate * 100.0,
                # 채권 매수 = 페이 고정. `_leg_row` 의 부호는 +1 이 고정 수취다.
                -1,
                leg.notional, leg.tenor,
            ))
    return rows


def _expand_futures(
    dataset: Dataset, series_id: str, direction: int, notional: float,
    base_date: dt.date, entry_price: float | None = None,
) -> list[dict]:
    """`FUT:3Y` · `FSW:3Y` → 시뮬레이션이 받는 줄들 [OWNER, 2026-08-25].

    선물은 한 줄(bondType="futures" — 엔진의 자기 분기: KRX 폐형 재값매김·
    고정 지평·캐리 0), 퓨처스왑은 **두 줄**이다 — 선물 다리 + 같은 만기 IRS
    다리(진입일 DV01 중립 [OWNER: "3선이면 3년 IRS"], +1 = 스프레드 롱 =
    선물 매도 + IRS 리시브 — app/futures.py 의 방향 관례 그대로).

    ── `entry_price` [OWNER 결정 2, 2026-08-25 — 선물 진입가는 편집 가능하게] ──
    None 이면 그 날 벤더 내재금리를 읽는다(기존 동작, 한 자도 안 바뀐다).
    값이 오면 **그 가격이 진입 수준을 정한다**: 선물은 가격으로 거래되므로
    사람이 아는 수는 «104.36 에 샀다» 이지 «3.4575% 에 샀다» 가 아니다.

    환산은 **서버가 한다**(§16 — 브라우저는 계산하지 않는다). KRX 표준물의
    폐형을 역함수로 한 번 통과시킬 뿐이고 새 산술이 아니다
    (`futures_pricing.implied_yield` — 백테스트 엔진이 쓰는 그 함수).

    이 자리는 «수준» 이다. **손익은 여전히 차분**이고 조정가 위에서 난다 —
    FUTURES_LANE_STATE §Phase 2 의 계약 그대로다.

    퓨처스왑에 오면 **선물 다리의 진입가**다(IRS 다리는 그 날 커브에서 나온다).
    선물 다리의 y0 가 바뀌면 DV01 도 바뀌므로 중립 가중된 스왑 명목도 따라
    움직인다 — 그게 «그 가격에 들어간 퓨처스왑» 의 뜻이다.
    """
    from . import futures as ft
    from irs_pricer.services.simulation.futures_pricing import (
        FUT_YEARS,
        implied_yield,
        synth_price,
        synth_pvbp,
    )

    try:
        kind, tenor = ft.parse_id(series_id)
    except ft.FuturesError as exc:
        # expand 의 호출부(라우트·시뮬)는 BacktestError 를 422 로 옮긴다.
        raise BacktestError(str(exc))
    if direction not in (1, -1):
        raise BacktestError("direction must be +1 or -1")
    fut = ft.load()
    fs = fut.series.get(tenor)
    if fs is None or not fs.dates:
        raise BacktestError(f"{tenor} 선물 종가가 없습니다.")
    from .backtest import _index_on_or_before

    i = _index_on_or_before(fs.dates, base_date)
    as_of = fs.dates[i]
    years = FUT_YEARS[tenor]
    # 시뮬의 선물 충격은 **금리 공간**에서 걸린다(daily_valuation: y0 + shock 을
    # 폐형에 넣고 두 가격의 차를 손익으로 낸다). 그 y0 는 수준이므로 벤더 값을
    # 읽는다 — 조정가 역산이 아니다(FUTURES_LANE_STATE §Phase 1 항목 1).
    # 두 걸음이 갈리는 자리이기도 하다: **수준은 벤더**, **손익은 차분**.
    if entry_price is None:
        try:
            y0 = ft.implied_at_index(fs, i, tenor)
        except ft.FuturesError as exc:
            raise BacktestError(str(exc))
    else:
        # 폐형의 정의역 밖(가격 ≤ 0)은 금리를 말할 수 없다. 명문으로 죽는다 —
        # 조용히 근사하면 시뮬이 없는 사실을 말한다(implied_at_index 와 같은 규율).
        if not (entry_price > 0):
            raise BacktestError("선물 진입가는 0보다 커야 해요.")
        y0 = implied_yield(entry_price, years)

    fut_dir = -direction if kind == ft.KIND_FSW else direction
    # pvbp 는 롱이 양수 — 시뮬 채권 관행(MTM = pvbp × −Δbp)과 같은 부호.
    pvbp = fut_dir * (notional / 100.0) * synth_pvbp(y0, years)
    dirty = synth_price(y0, years)
    mod_dur = (synth_pvbp(y0, years) * 1e4 / dirty) if dirty else 0.0
    label = (ft.FUT_LABELS if kind == ft.KIND_FUT else ft.FSW_LABELS)[tenor]

    rows = [{
        "id": f"{series_id}#0",
        "name": label if kind == ft.KIND_FUT else f"{label} · 선물",
        "book": "직접입력",
        "bondType": "futures",
        "sector": "국채선물",          # get_sector_curve_key → 국채
        "maturityDate": _add_years(as_of, years).isoformat(),
        "couponRate": 5.0,             # KRX 표준물 표면 — 표시용
        "frequency": 2,
        "notional": notional,
        "entryYield": y0,
        "entryYieldPurchase": y0,
        # 엔진의 폐형 재값매김이 읽는 기준 내재금리(%).
        "mtmYield": y0,
        # 평가액 0 — 선물은 현금 지출이 없다(증거금 미계상). 캐리·조달이
        # 평가액을 읽는 어떤 경로도 여기서 0 이 된다(이중 안전).
        "evaluationAmount": 0.0,
        "duration": mod_dur,
        "pvbp": pvbp,
        "tenor": tenor,
        "remainingDays": years * 365.0,
        "durationWeight": 0.0,
        "krdMap": {tenor: pvbp},
        "direction": fut_dir,
        "startDate": as_of.isoformat(),
    }]

    if kind == ft.KIND_FSW:
        j = _index_on_or_after(dataset.dates, base_date)
        swap_as_of = dataset.dates[j]
        leg = _build_legs(dataset, tenor, 1.0, j)[0]
        if leg.dv01 <= 0:
            raise BacktestError(f"{series_id}: 스왑 DV01 을 셀 수 없습니다.")
        fut_dv01_won = (notional / 100.0) * synth_pvbp(y0, years)
        # `Leg.dv01` 은 연금계수(pv01) — 실제 원/bp = dv01 × 명목 × 1e-4
        # (app/futures.py fsw_swap_leg 의 같은 주석·같은 실측 결함).
        swap_notional = fut_dv01_won / (leg.dv01 * 1e-4)
        rows.append(_leg_row(
            series_id, 1, swap_as_of,
            _add_years(swap_as_of, _years(tenor)),
            leg.entry_rate * 100.0,
            # `_leg_row` 의 부호는 +1 이 고정 수취 — FSW +1 = IRS 리시브.
            direction,
            swap_notional, tenor,
        ))
    return rows


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
    dataset: Dataset, series_id: str, direction: int, notional: float,
    base_date: dt.date, entry_price: float | None = None,
) -> list[dict]:
    """상품 한 줄 → FrontendPosition 모양의 다리들.

    반환되는 각 줄은 시뮬레이션 페이로드에 그대로 실린다: 파생 필드
    (remainingDays·nextFixingDate·currentFloatRate)는 0으로 두고 백엔드의
    swap_inputs가 채운다. 여기서 계산하면 진실이 둘이 된다.
    """
    kind = kind_of(series_id)
    if kind in ("cashbond", "assetswap"):
        return _expand_bond(dataset, series_id, direction, notional, base_date)
    if kind in ("futures", "futuresswap"):
        return _expand_futures(dataset, series_id, direction, notional, base_date,
                               entry_price)
    if entry_price is not None:
        # 선물 말고는 «진입가» 라는 입력이 없다. 받아 놓고 버리면 화면이 먹히는
        # 척하는 컨트롤을 갖게 된다 — 이 리포가 이름 붙인 claim-vs-behaviour.
        raise BacktestError(f"{series_id}: 진입가는 국채선물·퓨처스왑에만 있어요.")

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
