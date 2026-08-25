# -*- coding: utf-8 -*-
"""KRX 국채선물 표준물(합성채)의 폐형 산술 — 한 진실 [OWNER, 2026-08-25 —
"선물이랑 선물스왑도 백테스트와 시뮬레이션에 추가하기"].

KRX 국채선물의 결제 기준은 표면 5%·반기 이표·만기 고정(3Y=6기·10Y=20기)
표준물이다. 이 모듈은 그 정의식과 역함수·pvbp 만 든다:

    P(r) = Σ_{t=1..2y} 2.5/(1+r/2)^t + 100/(1+r/2)^{2y}      (액면 100)

P(5%) = 100 이 자명한 핀이고(테스트가 잰다), 단조 감소라 역산은 이분법이면
충분하다. 이 역산은 MR 세입자(app/mr.py)가 2026-08-25 에 먼저 검증해 쓰던
것을 승격한 것이다 — mr.py 가 여기서 임포트한다(같은 수를 두 곳에서 정의하지
않는다). 이분법의 구간·횟수는 그때 그대로다: 소수 금리 [-0.05, 0.30], 60회
(≈ 1e-16 폭) — MR 캐시 페이로드가 바이트 단위로 불변이어야 해서 바꾸지 않는다.

**합성채는 늙지 않는다.** 어느 날 재도 만기가 정확히 3Y/10Y 로 고정된 정의라
선물에는 잔존 감쇠도 롤다운도 없고, 액크루얼이 없으며 증거금 조달은 이 화면
바깥이다(미미·미계상 — 공란 정책) — 손익은 전부 가격(=내재금리) 변화다.
시뮬·백테스트 양쪽 엔진이 이 사실 위에 선다.

계층 규칙: irs_pricer 는 SQL 을 모른다 — 순수 산술만. 데이터(선물 종가)는
app/futures.py 가 든다.
"""

from __future__ import annotations

#: 상장 만기 — `mkt_futures_investor_close.ktb_type` 의 어휘 그대로.
FUT_YEARS: dict[str, int] = {"3Y": 3, "10Y": 10}


def _pv(r_dec: float, years: int) -> float:
    """소수 금리의 표준물 가격 — mr.py `_implied_yield.pv` 와 같은 식."""
    n = 2 * years
    d = 1.0 + r_dec / 2.0
    return sum(2.5 / d ** t for t in range(1, n + 1)) + 100.0 / d ** n


def synth_price(yield_pct: float, years: int) -> float:
    """표준물 가격(액면 100) — 퍼센트 수익률 입력."""
    return _pv(yield_pct / 100.0, years)


def implied_yield(price: float, years: int) -> float:
    """KRX 국채선물 이론가의 역함수 — 가격 → 연 수익률(%).

    단조 감소라 이분법이면 충분하다(60회 ≈ 1e-16 폭). P(5%) = 100 이 자명한
    핀이다. (원문 mr.py `_implied_yield`, 2026-08-25 — 구간·횟수 불변.)
    """
    lo_r, hi_r = -0.05, 0.30
    for _ in range(60):
        mid = (lo_r + hi_r) / 2.0
        if _pv(mid, years) > price:
            lo_r = mid
        else:
            hi_r = mid
    return (lo_r + hi_r) / 2.0 * 100.0


def synth_pvbp(yield_pct: float, years: int) -> float:
    """+1bp 의 가격 변화에 부호를 뒤집은 것(액면 100 기준) — 롱이 양수.

    포지션 원화 pvbp 는 호출부가 `× notional/100 × direction` 으로 만든다 —
    시뮬 채권 관행(pvbp 롱 양수, MTM = pvbp × −Δbp)과 같은 부호다.
    """
    return -(synth_price(yield_pct + 0.01, years) - synth_price(yield_pct, years))
