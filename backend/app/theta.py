"""테너별 세타 — 캐리 + 롤다운을, 표에 상시로 띄울 수 있는 형태로.

[OWNER, 2026-08-13 — "테너별 역캐리 및 헤지비용 바로 눈에 띄게 표시하기 …
Notional 100억 기준으로 Theta(캐리 + 롤오버) 전부 연산하기, 그리고 이를 DV01
백만원 기준으로 다 환산한 Theta를 도출하기"]

**백테스트를 눌러야 알 수 있는 숫자가 아니다.** 세타는 커브를 동결하고
(unchanged term structure — Tuckman; Clarus "Mechanics and Definitions of
Carry in Swap Markets") 시간만 흘렸을 때의 손익이라, 과거도 시뮬레이션도 필요
없이 **오늘 커브 하나로 닫힌 식**이 나온다. 그래서 백테스트와 달리 굽기
산출물에 실릴 수 있고, 실려야 한다 — 트레이더가 창을 열고 실행을 누르지
않아도 보이는 것이 이 요구의 전부다.

교과서가 가르는 두 성분 그대로다:

    캐리   = 고정과 변동 픽싱의 쿠폰 차 액크루얼      (현금흐름)
    롤다운 = 커브가 그대로여도 잔존만기가 줄며 생기는 마킹 변화
    세타   = 캐리 + 롤다운

부호는 **페이(고정 지급) 고정**이다 [OWNER, 2026-08-13]. 표의 행은 종목이지
포지션이 아니라 방향이 없고, 이 열이 답하는 질문이 "이 테너로 헤지하면 얼마가
나가나"이기 때문이다. 그래서 우상향 커브에서는 전 구간이 음수 — 그 음수가 곧
역캐리이자 헤지비용이다. 리시브는 부호만 뒤집으면 된다(화면이 그렇게 적는다).

정규화는 **DV01 백만원당**이다. 100억을 그대로 비교하면 테너마다 리스크가
달라서(1Y 98만원 vs 10Y 821만원) 순위가 뒤집힌다 — 100억 기준으로는 10Y가
제일 커 보이고, 리스크당으로는 1Y가 6.4배 크다. 트레이더가 테너를 고를 때
보는 것은 후자다. 100억 기준 금액은 툴팁으로 남는다.

`perDv01` 은 노셔널에 **무관**하다(세타도 DV01도 노셔널에 비례하므로 약분).
100억은 툴팁의 현금 금액을 위해서만 쓴다.

## 재사용

DV01 은 `dv01.pv01` — 제품에 이미 하나뿐인 정의(파 스왑 연금)다. 파 금리는
`forwards.forward_par_rate(zc, T, None)` — 포워드 탭이 쓰는 그 함수다. 둘 다
빌려 쓰는 이유는 같다: 같은 양을 두 번 구현하면 두 화면이 서로 다른 말을
하는 날이 오고, 이 리포의 반복 결함이 정확히 그 부류다.

**진입금리를 시장 호가(`now`)가 아니라 커브의 파 금리로 잡는다.** 호가 노드
(QUOTED_NODES)에서는 둘이 같지만, 보간된 노드에서는 다르다 — 진입은 호가로
잡고 롤인은 커브로 잡으면 그 차이가 통째로 롤다운에 실려 커브 기울기가 아닌
것을 기울기라고 말하게 된다. 진입과 롤인이 같은 구성에서 나와야 차이가 순수한
기울기다.
"""

from __future__ import annotations

import numpy as np

from .curves import TENOR_T, par_rates_at
from .dataset import Dataset
from .dv01 import pv01
from .engine_port import bootstrap_zero_curve
from .forwards import forward_par_rate

# 호라이즌 3개월 — 시장 표준(Clarus 는 bp/월 로도 적지만 카드 단위는 분기다).
HORIZON_Y = 0.25

# 툴팁의 현금 금액이 서는 노셔널. 원화 IRS 의 거래 단위가 100억이다 [OWNER].
# `perDv01` 은 이 값에 무관하다 — 위 주석 참조.
NOTIONAL = 10_000_000_000  # 100억

# 세타를 낼 수 있는 노드 = 스왑의 다리가 될 수 있는 테너.
# 1D(콜)와 3M(CD)은 스왑의 다리가 아니라 커브의 짧은 끝이라 빠진다
# (instruments.LEG_TENORS 와 같은 목록 — 거기 것을 빌리지 않는 이유는
# instruments 가 backtest 를 끌고 오고, 굽기 경로에 그 무게를 들일 이유가
# 없기 때문이다. 두 목록이 갈라지면 test_theta 가 잡는다).
THETA_TENORS: list[str] = [
    "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "4Y", "5Y",
    "6Y", "7Y", "8Y", "9Y", "10Y",
]

# 변동 다리의 픽싱 = CD 91일. 원화 IRS 의 변동 다리 그 자체다.
CD_TENOR = "3M"

BP = 1e-4


def theta_for(zc: np.ndarray, tenor_years: float, cd_decimal: float) -> dict:
    """한 테너의 세타 블록 (페이 기준, 원 단위).

    `cd_decimal` 은 CD 91일 종가(소수). 반환 금액은 `NOTIONAL` 기준이고
    `perDv01` 만 노셔널에 무관하다.
    """
    T = tenor_years
    h = HORIZON_Y

    # 진입 = 오늘 커브의 파 금리. 호라이즌에서는 (T−h) 스팟으로 마킹된다.
    k = forward_par_rate(zc, T, None)
    roll_in = forward_par_rate(zc, T - h, None)

    a_now = pv01(zc, T)        # 오늘 연금 = 단위노셔널 DV01
    a_horizon = pv01(zc, T - h)  # 호라이즌 잔존 스왑의 연금

    # 페이: 고정 k 를 주고 CD 를 받는다.
    carry = (cd_decimal - k) * NOTIONAL * h
    # 페이의 마킹 손익 = (마킹금리 − 진입금리) × 연금. 우상향이면 음수.
    roll = (roll_in - k) * a_horizon * NOTIONAL
    cash = carry + roll

    dv01 = a_now * BP * NOTIONAL  # 원/bp
    per_dv01 = cash / (dv01 / 1_000_000) if dv01 else 0.0

    # 본전 금리: (T−h) 금리가 몇 bp **올라야** 세타를 상쇄하나. 페이의 세타가
    # 음수면 양수로 나온다 — "3개월 안에 33bp 올라야 본전".
    denom = a_horizon * NOTIONAL * BP
    be_bp = (-cash / denom) if denom else 0.0

    return {
        "perDv01": round(per_dv01),
        "cash": round(cash),
        "carry": round(carry),
        "roll": round(roll),
        "dv01": round(dv01),
        "beBp": round(be_bp, 2),
        "entry": round(k * 100, 4),
        "rollIn": round(roll_in * 100, 4),
    }


def theta_table(dataset: Dataset) -> tuple[dict[str, dict], dict]:
    """(테너 id → 세타 블록, 기준 메타). 값을 낼 수 없는 테너는 아예 빠진다.

    CD 가 없으면 캐리를 지어낼 수 없으므로 **표 전체가 빈다** — 없는 것이
    화면에 보여야 한다는 규칙(§) 그대로, 절반만 맞는 숫자를 내지 않는다.
    """
    rates = dict(par_rates_at(dataset, dataset.asof))
    cd = rates.get(TENOR_T[CD_TENOR])
    meta = {
        "horizonMonths": round(HORIZON_Y * 12),
        "notional": NOTIONAL,
        "side": "pay",
        "cd": round(cd * 100, 4) if cd is not None else None,
    }
    if cd is None or not rates:
        return {}, meta

    zc = bootstrap_zero_curve(par_rates_at(dataset, dataset.asof))
    out: dict[str, dict] = {}
    for tenor in THETA_TENORS:
        t = TENOR_T.get(tenor)
        # 호가가 없는 노드에는 세타를 붙이지 않는다. 커브가 보간으로 값을
        # 내주기는 하지만, 그 행의 레벨 칸은 이미 em dash 다 — 레벨이 없는
        # 행에 파생 숫자만 찍히면 그 숫자의 출처를 아무도 못 찾는다.
        if t is None or t not in rates:
            continue
        if t - HORIZON_Y < 0.25 - 1e-9:
            continue  # 호라이즌을 지나면 남는 스왑이 없다
        out[tenor] = theta_for(zc, t, cd)
    return out, meta
