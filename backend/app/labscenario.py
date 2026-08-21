# -*- coding: utf-8 -*-
"""시나리오 앵커 — Lab 시나리오 화면이 오늘의 시장에 닿는 유일한 지점.

프런트의 `src/lab/scenario/`가 구운 선형 기저로 **편차**를 만들고, 이 모듈이
그 편차를 얹을 **오늘의 값**을 답한다. 둘의 덧셈은 프런트의 `assemble.ts`
한 곳에서 일어난다(손잡이를 끌 때마다 서버를 왕복할 수는 없다).

## 왜 포워드 레벨이 아니라 캐리를 보내나

이 화면의 다섯째 칸은 `모형 Δ − 시장이 이미 프라이싱한 이동`이다. 전망이
맞아도 시장이 그만큼 프라이싱했으면 포지션이 없으므로, 트레이드는 **캐리
대비**에서만 나온다.

그런데 스팟에 출처가 둘이다.

    유니버스 호가        Main 표가 보여주는 숫자
    포워드 행렬의 SPOT   같은 커브를 부트스트랩해 다시 읽은 par 금리

실측 2026-08-19 로 둘의 차가 0.00~0.18bp 다(3Y 가 0.18bp). 작지만 0 이 아니라,
호가로 «현재»를 그리고 부트스트랩 포워드 **레벨**을 빼면 그 차가 다섯째 칸에
샌다. 포워드의 본질은 레벨이 아니라 캐리이므로 **같은 부트스트랩 안에서 뺀
차이만** 내보낸다.

    carry12mBp = [ 1Y 시작 τ 포워드 − 같은 커브의 τ 스팟 ] × 100

그러면 «현재»는 호가라 Main 표와 일치하고, 다섯째 칸은 `Δ − carry` 라 누수가
0 이다.

## 10Y 는 캐리가 없다

`forward_par_rate` 는 `df(start + tenor)` 를 요구한다. 1Y 시작 10Y 테너는 11Y
할인계수를 부르는데 IRS 커브는 **10Y 에서 끝난다**(`universe.TENORS`).

`forwards.curve_prices_span()` 은 **왼쪽만** 본다 — 시작점이 첫 노드보다 앞서면
거절하지만, 끝점이 마지막 노드를 넘는 것은 안 막는다. 지금까지 문제가 안 된
것은 기존 격자의 최장 구간이 5Y×5Y = 10Y 로 정확히 마지막 노드였기 때문이다.
이 모듈은 10Y 를 부르므로 **오른쪽 가드를 자기가 진다**. `df()` 는 커브 밖에서도
숫자를 돌려주지만 그 숫자는 관측이 아니라 외삽이고, 외삽으로 «시장이 프라이싱한
값» 을 만들면 그 칸만 성질이 다른 숫자가 된다.

없는 값은 `None` 이다. 화면이 이유를 말하고, 0 으로 굴러떨어지지 않는다.

## live 는 자릿수가 아니라 확신이다

포워드의 시작·끝이 **둘 다** 라이브 호가 노드일 때만 `live` 다(`forwards` §7 의
규칙 그대로 승계). 실측: 1Y·2Y 는 끝점이 2Y·3Y 라 live, 3Y·5Y 는 끝점이 4Y·6Y 라
아니다. 같은 소수점 자리를 갖고도 부트스트랩이 메운 자리라는 뜻이라, 화면이
그것을 말해야 한다.
"""

from __future__ import annotations

import numpy as np

from .curves import build_basis_curves  # noqa: F401 — 호출부가 넘겨 쓴다
from .dataset import Dataset
from .forwards import forward_par_rate, is_live_point

#: 시나리오 표가 드는 다섯 테너. BIGFOOT 기저가 이 다섯만 갖고 있다
#: (`replay_ref.IRS_TENORS`) — 여기서 늘리려면 기저를 다시 구워야 한다.
IRS_TENORS: list[tuple[str, str, float]] = [
    ("1Y", "1y", 1.0),
    ("2Y", "2y", 2.0),
    ("3Y", "3y", 3.0),
    ("5Y", "5y", 5.0),
    ("10Y", "10y", 10.0),
]

# KTB 현물은 앵커에 없다. `dataset.series` 가 드는 것은 IRS 노드와 국채**선물**
# 이고, 국고 현물 커브는 `credit_matrix` 쪽이다(surface3d 의 govt 풀). 리플레이의
# KTB 두 줄은 그래서 **편차 그대로** 그린다 — 베이스라인 대비 pp 이고, 화면이
# 그렇게 이름 붙인다. 절대 레벨을 만들려고 다른 파이프를 끌어오면 표(오늘 대비)와
# 스파크라인(베이스라인 대비)의 기준이 섞인 채로 한 화면에 서게 된다.

#: 포워드 시작점. 12개월 = 1.0년.
FWD_START_Y = 1.0

#: CD 91일이 사는 자리. `dataset.py` 가 IRS 3M 노드를 CD 로 읽는다.
CD_TENOR = "3M"

#: 화면이 그대로 출력하는 문장들이라 **해요체**다.
#:
#: 이 파일의 주석과 docstring 은 이 리포의 규율대로 «~다» 로 쓰지만, 여기 문자열은
#: 트레이더가 읽는 화면 글자다. 해라체로 두었더니 결과 탭 바닥에서 앱의 나머지와
#: 두 목소리가 섰다(발행 캘린더의 이식한 설명이 겪은 것과 같은 병이고, 답도 같다).
CAVEATS = [
    "CARRY_NOT_EXPECTATION: 캐리는 커브가 함의하는 이동이지 정책 기대가 "
    "아니에요 — 기간프리미엄이 섞여 있어요. 시장이 인상을 «예상» 한다는 진술로 "
    "읽으면 안 돼요",
    "TENOR_10Y_NO_CARRY: IRS 커브가 10Y 에서 끝나 1Y 시작 10Y 포워드는 "
    "커브 밖이에요. 외삽하지 않고 비워 둬요",
    "LIVE_ENDPOINTS: 3Y·5Y 의 12개월 포워드는 끝점(4Y·6Y)이 호가 노드가 "
    "아니라 부트스트랩이 메운 자리예요",
]


def _curve_last_t(zc: np.ndarray) -> float:
    """이 제로커브가 정직하게 답할 수 있는 마지막 만기(년)."""
    return float(zc[-1, 0])


def _spot_quote(dataset: Dataset, tenor: str) -> float | None:
    """유니버스가 보여주는 그 숫자. 부트스트랩이 아니라 호가다.

    `Dataset.latest()` 를 쓴다 — **as-of 그날의 값**이다. 뒤로 걸어가며 마지막
    비어 있지 않은 값을 찾으면 그날 호가가 없는 노드에 며칠 전 값이 조용히 앉는다.
    없는 날은 없는 것이 맞고, 그 테너는 표에서 빠진다.
    """
    if tenor not in dataset.series:
        return None
    v = dataset.latest(tenor)
    return None if v is None else float(v)


def _carry_bp(zc: np.ndarray, tenor_y: float) -> float | None:
    """12개월 캐리, bp. 커브 밖이면 None.

    같은 커브 안에서 뺀다 — 스팟도 부트스트랩 값을 쓴다. 호가와 섞으면 두 출처의
    차(실측 ≤0.18bp)가 캐리에 실린다.
    """
    if FWD_START_Y + tenor_y > _curve_last_t(zc) + 1e-9:
        return None
    # `forward_par_rate` 는 **소수**를 돌려준다(0.039892 = 3.9892%). bp 로 가려면
    # 10,000 이다 — 100 을 곱하면 pp 가 나오고 화면의 모든 숫자가 100배 작아진다.
    fwd = forward_par_rate(zc, FWD_START_Y, tenor_y)
    spot = forward_par_rate(zc, tenor_y, None)
    return round((fwd - spot) * 10_000.0, 4)


def build_anchors(dataset: Dataset, curves: dict[str, np.ndarray],
                  base_rate: float | None = None) -> dict:
    """시나리오 화면이 한 번 받아 가는 앵커 한 벌.

    손잡이와 무관하다 — 커브가 바뀔 때만 바뀐다. 그래서 재조합이 로컬일 수 있다.
    """
    zc = curves["now"]
    last_t = _curve_last_t(zc)

    irs: dict[str, dict] = {}
    for tenor, key, t in IRS_TENORS:
        spot = _spot_quote(dataset, tenor)
        if spot is None:
            # 노드가 통째로 비었다. 그 테너는 표에서 빠지는 것이 맞다 —
            # 0 이나 직전 값으로 채우면 화면이 없는 호가를 있다고 말한다.
            continue
        carry = _carry_bp(zc, t)
        irs[key] = {
            "spot": spot,
            "carry12mBp": carry,
            "live": bool(carry is not None and is_live_point(FWD_START_Y, t)),
        }

    return {
        "asof": dataset.asof.isoformat(),
        "cd": _spot_quote(dataset, CD_TENOR),
        # 그날 유효한 한국은행 기준금리. 경로 빌더가 "여기서 −25" 를 그릴 기준선이라
        # 호출부가 `policy` 페이로드에서 넘겨준다 — 이 모듈이 두 번째 사본을 만들지
        # 않는다.
        "base": base_rate,
        "irs": irs,
        "curveLastTenorY": last_t,
        "fwdStartY": FWD_START_Y,
        "caveats": CAVEATS,
    }
