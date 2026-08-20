# -*- coding: utf-8 -*-
"""시나리오 앵커 (`app/labscenario.py`).

이 파일에서 하중을 지는 것은 `test_10y_carry_is_none_and_the_guard_is_not_vacuous`
하나다. 나머지는 모양을 기술하지만 그것은 **없는 값을 지어내는 유일한 통로**를
막는다.

`df()` 는 커브 밖에서도 숫자를 돌려준다. `forwards.curve_prices_span()` 은 시작점만
보고 끝점은 안 보므로, 1Y 시작 10Y 테너(=11Y)를 그냥 부르면 외삽된 숫자가 «시장이
프라이싱한 값» 이라는 얼굴로 화면에 선다. 그 통로를 이 모듈이 자기 가드로 막고,
아래 테스트가 그 가드가 실제로 뭔가를 막고 있는지 본다.
"""

import datetime as dt

import pytest

from app.dataset import Dataset
from app.engine_port import bootstrap_zero_curve
from app.forwards import forward_par_rate
from app.labscenario import (
    CD_TENOR,
    FWD_START_Y,
    IRS_TENORS,
    _carry_bp,
    _curve_last_t,
    build_anchors,
)

# 2026-08-19 실측 호가 열다섯 노드. **한 값도 지어내지 않는다** — 6Y·8Y·9Y 를
# 어림해 넣었다가 5Y 캐리가 0.3bp 어긋났고, 그 0.3bp 가 곧 이 픽스처가 가짜라는
# 신호였다. 커브는 자기 노드를 전부 알아야 같은 답을 낸다.
QUOTES: dict[str, tuple[float, float]] = {
    "1D": (1 / 365, 2.774),
    "3M": (0.25, 2.93),
    "6M": (0.5, 3.1425),
    "9M": (0.75, 3.285),
    "1Y": (1.0, 3.4375),
    "1.5Y": (1.5, 3.615),
    "2Y": (2.0, 3.7075),
    "3Y": (3.0, 3.83),
    "4Y": (4.0, 3.9025),
    "5Y": (5.0, 3.9625),
    "6Y": (6.0, 4.0025),
    "7Y": (7.0, 4.04),
    "8Y": (8.0, 4.06),
    "9Y": (9.0, 4.0825),
    "10Y": (10.0, 4.105),
}


@pytest.fixture
def zc():
    return bootstrap_zero_curve(sorted((t, r / 100.0) for t, r in QUOTES.values()))


@pytest.fixture
def dataset():
    return Dataset(
        dates=[dt.date(2026, 8, 18), dt.date(2026, 8, 19)],
        series={k: [None, v] for k, (_t, v) in QUOTES.items()},
        tenor_order=list(QUOTES),
    )


def test_10y_carry_is_none_and_the_guard_is_not_vacuous(zc):
    """커브가 10Y 에서 끝나므로 1Y 시작 10Y 는 답이 없다 — 그리고 가드를 빼면
    답이 «생긴다»."""
    assert _curve_last_t(zc) == pytest.approx(10.0)
    assert _carry_bp(zc, 10.0) is None

    # 가드가 없었다면: `df` 가 11Y 를 조용히 외삽해 그럴듯한 숫자를 낸다.
    naive = forward_par_rate(zc, FWD_START_Y, 10.0)
    assert naive == pytest.approx(naive)  # 예외가 아니라 값이 나온다는 사실이 요점
    assert 0.0 < naive < 0.10, "외삽이 터지지 않고 그럴듯한 값을 낸다 — 그래서 위험하다"


def test_carry_is_in_basis_points_not_percentage_points(zc):
    """단위. ×100 이면 pp 가 나오고 화면의 모든 숫자가 100배 작아진다."""
    one_y = _carry_bp(zc, 1.0)
    assert one_y is not None
    # 이 커브는 CD 2.93 에서 1Y 3.4375 로 가파르다 — 12개월 캐리는 수십 bp 다.
    assert 10.0 < one_y < 200.0, f"{one_y} 는 bp 자릿수가 아니다"


def test_carry_matches_the_live_forward_matrix(zc):
    """같은 커브에서 뽑으면 `/api/forwards` 격자와 같은 값이 나온다.

    2026-08-19 라이브 실측(2자리 반올림): 1Y 55.17 · 2Y 33.29 · 3Y 24.01 · 5Y 16.72.
    이 테스트가 깨지면 부트스트랩이나 포워드 규약이 바뀐 것이지 이 모듈의 취향이
    바뀐 것이 아니다.
    """
    expected = {1.0: 55.17, 2.0: 33.29, 3.0: 24.01, 5.0: 16.72}
    for tenor_y, want in expected.items():
        got = _carry_bp(zc, tenor_y)
        assert got == pytest.approx(want, abs=0.01), f"{tenor_y}Y: {got} != {want}"


def test_carry_takes_both_legs_from_the_same_curve(zc, dataset):
    """캐리는 부트스트랩 안에서만 뺀다 — 호가와 섞지 않는다.

    섞으면 두 출처의 차(실측 ≤0.18bp)가 캐리에 실린다. 확인 방법: 호가를 통째로
    흔들어도 `_carry_bp` 는 커브만 보므로 안 움직인다.
    """
    before = {t: _carry_bp(zc, t) for _l, _k, t in IRS_TENORS}
    for key in dataset.series:
        dataset.series[key] = [None, 99.0]
    after = {t: _carry_bp(zc, t) for _l, _k, t in IRS_TENORS}
    assert before == after


def test_live_follows_the_forward_matrix_rule(zc, dataset):
    """끝점이 호가 노드인 테너만 live 다. 3Y·5Y 는 끝점이 4Y·6Y 라 아니다."""
    a = build_anchors(dataset, {"now": zc})
    assert a["irs"]["1y"]["live"] is True
    assert a["irs"]["2y"]["live"] is True
    assert a["irs"]["3y"]["live"] is False
    assert a["irs"]["5y"]["live"] is False
    assert a["irs"]["10y"]["live"] is False


def test_anchor_shape(zc, dataset):
    a = build_anchors(dataset, {"now": zc}, base_rate=2.75)
    assert a["asof"] == "2026-08-19", "as-of 는 Dataset.asof (= dates[-1]) 다"
    assert a["base"] == 2.75
    assert a["cd"] == QUOTES[CD_TENOR][1]
    assert set(a["irs"]) == {"1y", "2y", "3y", "5y", "10y"}
    assert a["irs"]["3y"]["spot"] == 3.83, "현재는 호가다 — 부트스트랩 값이 아니다"
    assert a["irs"]["10y"]["carry12mBp"] is None
    assert a["curveLastTenorY"] == pytest.approx(10.0)
    assert any("TENOR_10Y_NO_CARRY" in c for c in a["caveats"])


def test_base_rate_is_optional_and_never_invented(zc, dataset):
    """기준금리를 안 넘기면 None 이다. 이 모듈이 두 번째 사본을 만들지 않는다."""
    assert build_anchors(dataset, {"now": zc})["base"] is None


def test_a_missing_node_drops_the_row_rather_than_filling_it(zc, dataset):
    """as-of 그날 호가가 없는 테너는 표에서 빠진다 — 0 이나 **직전 값**으로 안 채운다.

    직전 값을 갖다 쓰면 며칠 전 숫자가 오늘 얼굴로 앉는다. 그래서 `Dataset.latest()`
    (그날 값)를 쓰지 뒤로 걸어가지 않는다 — 아래에서 앞날만 비우고 어제를 남긴다.
    """
    dataset.series["5Y"] = [3.95, None]
    a = build_anchors(dataset, {"now": zc})
    assert "5y" not in a["irs"]
    assert "3y" in a["irs"], "한 노드가 비었다고 나머지가 같이 죽지 않는다"
