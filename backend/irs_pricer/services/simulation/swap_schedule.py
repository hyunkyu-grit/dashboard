"""스왑 만기/다음 변동일의 연 단위 지평 — 세 벌이던 복사본의 단일화 (2026-08-10).

같은 로직이 enrichment.enrich_irs_pvbp, chart 의 FM 사전계산 루프,
recon 의 IRS_Trade 사전 빌드에 각각 살아 있었다 — 문자 그대로 같은 식이었지만
세 곳이라, 하나를 고치면 나머지가 조용히 어긋나는 자리였다("병렬 수학 금지"
원칙 위반). 이 모듈이 유일한 정의다.

**바이트 동일 이식**: 식·클램프·폴백 전부 원본 그대로다. 골든 픽스처
(test_simulate_api)가 결과 불변을 못박는다.

※ chart 의 BOK 이벤트 진단(bok_breakdown.py)에는 **다른** 변형이 있다 —
   이벤트 당일로 에이징한 뒤 지난 픽싱일을 91일 단위로 미래로 롤링하는
   버전. 의미가 달라(시점이 base_date 가 아니라 이벤트 당일) 여기로
   합치지 않는다. 그 변형은 bok_breakdown._aged_t_next 에 산다.
"""

from __future__ import annotations

from datetime import date


def resolve_swap_horizon(
    remaining_days: float | int | None,
    next_fixing_date: object,
    base_date_str: str,
) -> tuple[float, float]:
    """(t_maturity, t_next_payment) — 연 단위, 기준일 시점.

    t_maturity: 잔존일/365, 하한 1일.
    t_next: nextFixingDate 가 있으면 기준일로부터의 일수(하한 1일)/365,
      파싱 실패 시 0.25(분기 근사). 없으면 만기가 3M 미만일 때 만기의 10%,
      아니면 0.25. 마지막으로 [1일, 만기] 로 클램프 — 다음 변동일이 만기를
      넘거나 0 이 되는 좌표는 엔진에 넣지 않는다.
    """
    t_mat = max(float(remaining_days or 0) / 365.0, 1 / 365)
    if next_fixing_date:
        try:
            nfd = date.fromisoformat(str(next_fixing_date)[:10])
            ref = date.fromisoformat(str(base_date_str)[:10])
            t_next = max((nfd - ref).days, 1) / 365.0
        except Exception:
            t_next = 0.25
    else:
        t_next = t_mat * 0.1 if t_mat < 0.25 else 0.25
    t_next = max(min(t_next, t_mat), 1.0 / 365.0)
    return t_mat, t_next
