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

## 스프레드·플라이 [OWNER, 2026-08-13 — "스프레드랑 버터플라이까지 부탁할게"]

패키지는 아웃라이트를 그대로 흉내 낼 수 없다. **DV01 중립으로 짜므로 순 DV01
이 0** 이고, 0 으로 나눈 값은 숫자가 아니다. 시장이 커브 트레이드의 리스크로
세는 것은 순 DV01 이 아니라 **한쪽 다리의 DV01** 이다 — `theta_for_package`
에 근거를 적어 뒀다. 그렇게 잡으면 패키지의 "DV01 백만원당 세타"가 다리들
값의 선형결합으로 저절로 닫힌다(스프레드 = 긴 − 짧은, 플라이 = 벨리 − 날개
절반씩). 커브 트레이드 캐리를 스프레드 bp 로 말하는 관행이 그 항등식이다.

부호 규약도 그대로 이어진다. 방향 **+1**("호가값을 롱" — `backtest._legs_for`
와 `directionLabel(id, 1)` 이 이미 쓰는 정의)이 아웃라이트에서는 페이,
스프레드에서는 스티프너, 플라이에서는 벨리 페이다. 그래서 열 전체가 한 문장을
말한다: **음수면 그 종목의 첫 번째 방향을 잡았을 때 시간이 돈을 가져간다.**

포워드와 변동성은 여전히 빠진다 — 엔진에 포워드 다리 구성이 없고(`_legs_for`
가 'x' 를 거부한다) 변동성은 비율이라 스왑이 아니다.

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
from .derive import derived_ids
from .dv01 import pv01
from .engine_port import bootstrap_zero_curve
from .forwards import forward_par_rate

# 세타는 **하루치로 적는다** [OWNER, 2026-08-14 — "세타 전부 다 하루치로"].
# 다만 **계산은 분기에서 하고 일수로 나눈다.** 두 값이 다른 이유가 이 상수 쌍의
# 전부이므로 근거를 적어 둔다.
#
# 시장 관행이 호라이즌을 고정하지 않는 것은 맞다 — Deriscope 의 정리도 "The
# horizon can be any point in time T in the future" 이고 Clarus 도 분기·월·일을
# 두루 쓴다. 문제는 이 커브에서 **한 걸음을 하루로 잡으면 롤다운이 잡음이 된다**
# 는 것이다. 파 금리를 T 와 T−1일에서 따로 구성하면 스왑 스케줄의 이산화와 노드
# 사이 보간이 진짜 롤보다 큰 점프를 만든다 (2026-08-14 실측, asof 08-13):
#
#     T      1일 Δpar     분기 Δpar 를 하루로 환산      배수
#     1Y    −1.0550bp            −0.170bp            6.2x
#     3Y    −0.3509bp            −0.023bp           15.5x
#     10Y   −0.0952bp            −0.005bp           18.9x
#
# 분기는 그 잡음이 묻힐 만큼 길고, 캐리는 시간에 선형이라 나누기가 정확하다.
# 롤다운은 "앞으로 한 분기의 하루 평균" 이 되는데, 데스크가 bp/일 을 말할 때
# 뜻하는 것도 그것이다(연간 또는 분기 수치를 나눈 값).
#
# 진짜 하루 롤이 필요해지면 커브에서 dPar/dT 를 해석적으로 뽑아야 한다 —
# 스왑을 두 번 짓는 방식으로는 못 얻는다. [미해결]
HORIZON_Y = 0.25
#: 하루치로 나누는 제수. 달력일이다 — 캐리는 달력이 흐르면 붙는다.
HORIZON_DAYS = HORIZON_Y * 365.0

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


# 패키지의 다리 계수 — **방향 +1**("호가값을 롱")에서 각 다리의 부호와,
# 기준 다리의 DV01 을 1 로 봤을 때 그 다리가 지는 DV01 의 크기다. 리스트는
# 언제나 테너 오름차순(`derive.derived_ids` 가 그렇게 만든다).
#
#   스프레드 A-B  → 스티프너 = 긴 다리 B 페이 · 짧은 다리 A 리시브
#   플라이  A-B-C → 벨리 B 페이 · 양 날개 리시브, 날개는 각각 벨리의 절반
#
# `backtest._legs_for` 와 `dv01.dv01_payload` 의 가중이 바로 이것이다. 세
# 곳이 같은 수를 세 벌 들고 있으면 언젠가 갈라지므로 `test_theta` 가 이
# 계수와 `dv01_payload` 의 노셔널 비율을 대조한다.
PACKAGE_COEF: dict[str, tuple[float, ...]] = {
    "spread": (-1.0, 1.0),
    "fly": (-0.5, 1.0, -0.5),
}

# 기준 다리 = 두 종류 모두 가운데(인덱스 1). 스프레드는 긴 다리, 플라이는
# 벨리 — `dv01.py` 가 100 으로 정규화하는 바로 그 다리다. "DV01 백만원당"의
# 그 DV01 이 이 다리의 것이라는 뜻이고, 그게 커브 트레이드의 표준 리스크
# 단위다(Actrix, "2bp profit on about $90k DV01 of risk" — 순 DV01 이 아니라
# 한쪽 다리의 DV01).
PACKAGE_REF = 1


def _unit_theta(
    zc: np.ndarray, tenor_years: float, cd_decimal: float
) -> tuple[float, float, float, float]:
    """단위 노셔널당 **페이** 캐리·롤다운과, 오늘·호라이즌 연금.

    반환 (carry, roll, a_now, a_horizon). 앞의 둘은 노셔널 1원당 원이라
    노셔널을 곱하면 현금이 된다.
    """
    T = tenor_years
    h = HORIZON_Y

    # 진입 = 오늘 커브의 파 금리. 호라이즌에서는 (T−h) 스팟으로 마킹된다.
    k = forward_par_rate(zc, T, None)
    roll_in = forward_par_rate(zc, T - h, None)

    a_now = pv01(zc, T)          # 오늘 연금 = 단위노셔널 DV01
    a_horizon = pv01(zc, T - h)  # 호라이즌 잔존 스왑의 연금

    # 페이: 고정 k 를 주고 CD 를 받는다.
    carry = (cd_decimal - k) * h
    # 페이의 마킹 손익 = (마킹금리 − 진입금리) × 연금. 우상향이면 음수.
    roll = (roll_in - k) * a_horizon
    return carry, roll, a_now, a_horizon


def _leg_cache(zc: np.ndarray, cd_decimal: float):
    """테너 → `_unit_theta`, 한 번만 계산하는 조회 함수.

    다리 계산은 이 모듈에서 압도적으로 비싼 부분(측정 0.22ms)인데, 84개
    패키지가 저마다 자기 다리를 다시 구해서 **237번** 부르고 있었다 — 서로
    다른 테너는 13개뿐인데. 표 하나당 33ms 였고 그게 `wall_summary` 전체의
    22.8% 였다.

    `functools.lru_cache` 는 못 쓴다: 커브가 numpy 배열이라 해시가 안 된다.
    그래서 커브와 CD 를 클로저로 묶은 조회 함수를 표 만들 때 한 번 세운다 —
    캐시의 수명이 그 커브의 수명과 같아지므로 낡은 커브의 값이 살아남을 수가
    없다. `theta_for`/`theta_for_package` 는 안 받으면 자기 것을 하나 만든다
    (한 종목만 볼 때는 캐시가 무의미하고, 테스트가 그렇게 부른다)."""
    cache: dict[float, tuple[float, float, float, float]] = {}

    def leg(tenor_years: float) -> tuple[float, float, float, float]:
        hit = cache.get(tenor_years)
        if hit is None:
            hit = cache[tenor_years] = _unit_theta(zc, tenor_years, cd_decimal)
        return hit

    return leg


def _block(carry: float, roll: float, dv01: float, a_h_ref: float) -> dict:
    """현금 캐리·롤다운(원)을 화면이 읽는 블록으로. `dv01` 은 기준 다리의
    DV01(원/bp), `a_h_ref` 는 그 다리의 호라이즌 연금.

    들어오는 것은 **분기치**이고 나가는 것은 **하루치**다 — 위 상수 주석의
    근거대로 계산 창과 표기 단위를 분리한다. 나누는 자리가 여기 하나뿐이라
    아웃라이트·스프레드·플라이가 저절로 같은 단위로 나온다.
    """
    carry /= HORIZON_DAYS
    roll /= HORIZON_DAYS
    cash = carry + roll
    denom = a_h_ref * NOTIONAL * BP
    return {
        "perDv01": round(cash / (dv01 / 1_000_000)) if dv01 else 0,
        "cash": round(cash),
        "carry": round(carry),
        "roll": round(roll),
        "dv01": round(dv01),
        # 본전: 이 종목의 **호가값**이 몇 bp 움직여야 세타가 상쇄되나.
        # 아웃라이트면 금리, 스프레드·플라이면 그 스프레드다 — 어느 쪽이든
        # 그 행의 레벨 칸이 쓰는 단위와 같다.
        "beBp": round((-cash / denom) if denom else 0.0, 2),
    }


def theta_for(
    zc: np.ndarray, tenor_years: float, cd_decimal: float, leg=None
) -> dict:
    """아웃라이트 한 테너의 세타 블록 (페이 기준, 원 단위, `NOTIONAL` 기준).
    `perDv01` 만 노셔널에 무관하다. `leg` 은 `_leg_cache` 의 조회 함수."""
    carry_u, roll_u, a_now, a_h = (leg or _leg_cache(zc, cd_decimal))(tenor_years)
    return _block(
        carry_u * NOTIONAL, roll_u * NOTIONAL, a_now * BP * NOTIONAL, a_h
    )


def theta_for_package(
    zc: np.ndarray,
    tenor_years: list[float],
    kind: str,
    cd_decimal: float,
    leg=None,
) -> dict:
    """스프레드·플라이의 세타 블록 — **DV01 중립으로 짠 방향 +1 패키지**.

    아웃라이트를 그대로 흉내 낼 수가 없다. 패키지는 DV01 중립이라 **순 DV01
    이 0** 이고, 0 으로 나눈 값은 숫자가 아니다. 그래서 시장이 커브 트레이드의
    리스크로 세는 것은 순 DV01 이 아니라 **한쪽 다리의 DV01** 이다 — 스프레드
    2bp 가 다리 DV01 $90k 위에서 $180k 라고 말할 때의 그 DV01(Actrix,
    "How To Hedge DV01"). 여기서도 기준 다리(`PACKAGE_REF`)의 DV01 로 나눈다.

    그렇게 잡으면 결과가 저절로 닫힌다: DV01 중립 가중 아래에서 패키지의
    "DV01 백만원당 세타"는 **다리들 값의 같은 계수 선형결합**이 된다
    (스프레드 = 긴 다리 − 짧은 다리, 플라이 = 벨리 − 날개 절반씩). 곱하고
    나누는 과정에서 노셔널이 약분되기 때문이고, `test_theta` 가 그 항등식을
    직접 잡는다. 커브 트레이드의 캐리를 스프레드 bp 로 말하는 관행이 이
    항등식의 다른 이름이다.

    방향 +1 은 제품이 이미 쓰는 정의다 — `backtest._legs_for` 의 "호가값을
    롱", 화면의 `directionLabel(id, 1)`. 아웃라이트에서 그것이 곧 페이이므로
    부호 규약이 종목 종류를 건너 일관된다: **세타가 음수면 그 종목의 첫 번째
    방향을 잡았을 때 시간이 돈을 가져간다.**
    """
    coefs = PACKAGE_COEF[kind]
    if len(coefs) != len(tenor_years):
        raise ValueError(f"{kind}: {len(tenor_years)} legs, {len(coefs)} coefficients")

    get = leg or _leg_cache(zc, cd_decimal)
    legs = [get(t) for t in tenor_years]
    a_ref = legs[PACKAGE_REF][2]
    a_h_ref = legs[PACKAGE_REF][3]

    carry = roll = 0.0
    for coef, (carry_u, roll_u, a_now, _a_h) in zip(coefs, legs):
        # 이 다리의 노셔널: DV01 이 기준 다리의 |coef| 배가 되도록.
        notional = abs(coef) * a_ref * NOTIONAL / a_now
        sign = 1.0 if coef > 0 else -1.0
        carry += sign * carry_u * notional
        roll += sign * roll_u * notional

    return _block(carry, roll, a_ref * BP * NOTIONAL, a_h_ref)


def theta_table(dataset: Dataset) -> tuple[dict[str, dict], dict]:
    """(종목 id → 세타 블록, 기준 메타). 값을 낼 수 없는 종목은 아예 빠진다.

    CD 가 없으면 캐리를 지어낼 수 없으므로 **표 전체가 빈다** — 없는 것이
    화면에 보여야 한다는 규칙 그대로, 절반만 맞는 숫자를 내지 않는다.
    """
    rates = dict(par_rates_at(dataset, dataset.asof))
    cd = rates.get(TENOR_T[CD_TENOR])
    meta = {
        # 하루치다 [OWNER, 2026-08-14]. 계산 창은 분기이고 표기만 일 단위라는
        # 사실은 `_block` 과 `HORIZON_Y` 의 주석에 있다 — 화면은 "하루" 만
        # 말하면 되고, 그것이 거짓이 아니다(캐리는 선형, 롤은 분기 평균).
        "horizonDays": 1,
        "notional": NOTIONAL,
        "side": "pay",
        "cd": round(cd * 100, 4) if cd is not None else None,
    }
    if cd is None or not rates:
        return {}, meta

    zc = bootstrap_zero_curve(par_rates_at(dataset, dataset.asof))
    # 다리 계산을 테너당 한 번으로 — 근거는 `_leg_cache`.
    leg = _leg_cache(zc, cd)

    def priceable(tenor: str) -> float | None:
        # 호가가 없는 노드에는 세타를 붙이지 않는다. 커브가 보간으로 값을
        # 내주기는 하지만, 그 행의 레벨 칸은 이미 em dash 다 — 레벨이 없는
        # 행에 파생 숫자만 찍히면 그 숫자의 출처를 아무도 못 찾는다.
        t = TENOR_T.get(tenor)
        if t is None or t not in rates or tenor not in THETA_TENORS:
            return None
        # 호라이즌을 지나고도 **한 분기는 남아야** 세타가 뜻이 있다. 호라이즌이
        # 하루로 짧아졌다고 이 문턱까지 하루로 내리면, 잔존 이틀짜리 스왑에
        # 롤다운을 붙이게 된다 — 그 구간의 파 금리는 커브의 가장자리라
        # 보간·외삽이 지배한다. 문턱은 상품의 성질이지 호라이즌의 함수가 아니다.
        if t - HORIZON_Y < 0.25 - 1e-9:
            return None
        return t

    out: dict[str, dict] = {}
    for tenor in THETA_TENORS:
        t = priceable(tenor)
        if t is not None:
            out[tenor] = theta_for(zc, t, cd, leg)

    # 스프레드·플라이. 다리 하나라도 값을 못 내면 그 패키지도 안 낸다 —
    # 다리 둘로 그린 플라이는 완성돼 보이면서 틀린다(백테스트 창의 같은 규칙).
    for sid, kind, legs in derived_ids():
        if kind not in PACKAGE_COEF:
            continue
        ts = [priceable(leg) for leg in legs]
        if any(t is None for t in ts):
            continue
        out[sid] = theta_for_package(
            zc, [t for t in ts if t is not None], kind, cd, leg
        )

    return out, meta
