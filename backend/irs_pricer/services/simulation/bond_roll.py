"""채권 다리의 롤다운 — 동결 민평 커브 위 잔존 단축 [OWNER, 2026-08-25].

시뮬 채권 모형은 pvbp 감쇠 × (−시나리오 충격)의 선형 모형이라, 무충격 경로에서
채권 P&L 이 캐리뿐이었다 — Tuckman 의 세 carry-roll-down 가정 중
unchanged-yields 다. 같은 북의 스왑 다리는 동결 커브 세타(롤다운 포함,
unchanged term structure — Tuckman·Nordea·Clarus, 2026-08-25 외부 재검증)를
세므로 **한 북의 두 다리가 다른 가정을 쓰고 있었다**. 이 모듈이 그 빠진 항을
채운다. 스텝(전 영업일 → 오늘)마다:

    롤 = pvbp(잔존_t) × −(y(잔존_t) − y(잔존_prev)) × 10,000

y 는 **기준일에 동결한** 민평 섹터 커브의 보간 수익률(decimal)이고, 포지션
자기 마크(mtmYield)와 커브의 차 — 개별 스프레드 — 는 불변 가정이다(문헌의
spread-unchanged 롤). pvbp 는 `calculate_daily_mtm` 과 같은 잔존 비례 감쇠 —
평가와 롤이 같은 민감도 자를 쓴다.

커브는 app 계층이 기동 시 `set_sector_curve_provider` 로 등록한다
(app/main.py). irs_pricer 는 SQL 을 모른다는 계층 규칙 그대로다. 공급자가
없거나 섹터 커브가 비면 롤은 0 인데, 그 0 은 조용히 두지 않는다 —
`provenance` 가 어느 섹터에 커브가 없었는지를 싣고 화면이 말한다.

만기 스텝: 잔존이 0 이 되는 스텝부터는 롤을 세지 않는다 —
`calculate_daily_mtm` 의 roll-off(만기 후 MTM 0) 와 같은 규약이다. 만기
직전 마지막 접근(pull-to-par 의 끝)은 선형 pvbp 모형의 해상도 밖이고, 그
한계는 평가 쪽도 똑같이 진다(같은 모형의 같은 자).
"""

from __future__ import annotations

from datetime import date
from typing import Callable

from .daily_valuation import _is_matured, get_sector_curve_key
from .models import FrontendPosition

#: {시뮬 섹터키: [(잔존연수, decimal 수익률)], 오름차순} 을 돌려주는 콜러블.
#: app/main.py 가 기동 시 등록한다. None 이면 롤 레인은 꺼진 채로 정직하게
#: provenance 에 그 사실을 싣는다.
_provider: Callable[[], dict[str, list[tuple[float, float]]]] | None = None


def set_sector_curve_provider(
    fn: Callable[[], dict[str, list[tuple[float, float]]]] | None,
) -> None:
    global _provider
    _provider = fn


def sector_curves() -> dict[str, list[tuple[float, float]]] | None:
    """등록된 공급자의 커브 — 없거나 실패하면 None (롤 0 + provenance).

    공급자 실패를 삼키는 이유: 시뮬은 SQL 이 죽어도 종전 결과(롤 없는
    unchanged-yields 판)를 돌려줄 수 있고, 그 사실이 payload 에 적히므로
    조용한 거짓이 아니다. 500 으로 세우면 스왑만 북까지 같이 죽는다.
    """
    if _provider is None:
        return None
    try:
        return _provider() or None
    except Exception:
        return None


def interp_yield(nodes: list[tuple[float, float]], years: float) -> float:
    """선형보간, 양 끝 평탄 — `app/creditmatrix.py:interp` 와 같은 규칙."""
    if not nodes:
        return 0.0
    if years <= nodes[0][0]:
        return nodes[0][1]
    if years >= nodes[-1][0]:
        return nodes[-1][1]
    for (x0, y0), (x1, y1) in zip(nodes, nodes[1:]):
        if x0 <= years <= x1:
            if x1 == x0:
                return y0
            return y0 + (years - x0) / (x1 - x0) * (y1 - y0)
    return nodes[-1][1]


def curve_for(
    curves: dict[str, list[tuple[float, float]]], p: FrontendPosition
) -> list[tuple[float, float]] | None:
    """포지션의 섹터 커브 — 시나리오 충격 조회와 같은 폴백(없으면 국채)."""
    return curves.get(get_sector_curve_key(p.sector)) or curves.get("국채")


def step_roll(
    positions: list[FrontendPosition],
    curves: dict[str, list[tuple[float, float]]] | None,
    prev_t: int,
    t: int,
    current_date: date | None = None,
) -> float:
    """스텝 (prev_t → t) 의 채권 롤다운 합(원). 스왑 세타와 같은 걸음 폭 —
    주말을 건너는 스텝은 그 며칠의 잔존 단축을 한 번에 진다."""
    if not curves or t <= prev_t:
        return 0.0
    won = 0.0
    for p in positions:
        if p.bondType == "swap":
            continue
        if current_date and _is_matured(p, current_date):
            continue
        initial_remaining = max(float(p.remainingDays or 1), 1.0)
        r_now = max(initial_remaining - t, 0.0)
        if r_now <= 0:
            continue  # 만기 roll-off — 모듈 주석
        nodes = curve_for(curves, p)
        if not nodes:
            continue  # provenance 가 말한다
        r_prev = max(initial_remaining - prev_t, 0.0)
        pvbp_now = (p.pvbp or 0.0) * (r_now / initial_remaining)
        dy_bp = (interp_yield(nodes, r_now / 365.0) - interp_yield(nodes, r_prev / 365.0)) * 10_000.0
        won += pvbp_now * (-dy_bp)
    return won


def provenance(
    positions: list[FrontendPosition],
    curves: dict[str, list[tuple[float, float]]] | None,
) -> dict:
    """롤 레인이 실제로 무엇을 셌는지 — 화면 각주의 원료.

    applied      채권 줄이 있고 커브 공급자가 살아 있었는가.
    missing      채권 줄이 쓰는 섹터 중 커브가 없어 롤 0 으로 남은 것들.
    """
    bond_sectors = sorted(
        {get_sector_curve_key(p.sector) for p in positions if p.bondType != "swap"}
    )
    if not bond_sectors:
        return {"applied": False, "missing": []}
    if not curves:
        return {"applied": False, "missing": bond_sectors}
    missing = [s for s in bond_sectors if not (curves.get(s) or curves.get("국채"))]
    return {"applied": True, "missing": missing}
