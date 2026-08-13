"""상품 한 줄 → 스왑 다리 [OWNER, 2026-08-07].

시뮬레이션의 직접 입력이 모니터와 같은 세계를 쓴다는 것을 못 박는다:
아웃라이트·스프레드·버터플라이·포워드, 같은 id 문법, 같은 다리 규칙.
두 화면이 같은 "3s10s"를 다르게 이해하면 그 순간 비교가 불가능해진다.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from app import instruments as I
from app.backtest import BacktestError
from app.dataset import load_dataset

BASE = dt.date(2026, 8, 5)
DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"


@pytest.fixture(scope="module")
def ds():
    return load_dataset(DATA)


def test_catalog_covers_the_four_tabs():
    cat = I.catalog()
    assert set(cat) == {"outright", "spread", "fly", "forward"}
    assert all(v for v in cat.values())
    # 조합은 여덟 노드에서 — 열세 개로 하면 78 + 286이 되어 고를 수 없다
    assert len(cat["spread"]) == 28
    assert len(cat["fly"]) == 56


def test_kind_is_readable_from_the_id():
    assert I.kind_of("10Y") == "outright"
    assert I.kind_of("3Y-10Y") == "spread"
    assert I.kind_of("2Y-5Y-10Y") == "fly"
    # `x`를 먼저 본다 — 포워드에는 대시가 없다
    assert I.kind_of("1Yx1Y") == "forward"


class TestLegs:
    def test_outright_is_one_leg_paying_fixed_when_long(self, ds):
        """`+1`은 **호가 값을 롱** — 금리 롱이고, 스왑에서는 고정 지급(−1)이다.

        이 뒤집기가 한 곳(instruments.expand)에만 있어야 한다. 두 곳에 생기면
        한쪽만 고쳐지는 날 부호가 조용히 반대가 된다.
        """
        (leg,) = I.expand(ds, "10Y", +1, 1e10, BASE)
        assert leg["direction"] == -1
        assert leg["notional"] == pytest.approx(1e10)
        assert leg["tenor"] == "10Y"

    def test_spread_is_long_the_far_leg(self, ds):
        """`A-B`는 r_B − r_A로 호가되므로 롱 B / 숏 A — backtest._legs_for와 같다."""
        legs = I.expand(ds, "3Y-10Y", +1, 1e10, BASE)
        assert len(legs) == 2
        by_tenor = {l["tenor"]: l for l in legs}
        # 10Y가 기준 다리(사용자 명목), 3Y가 반대 부호
        assert by_tenor["10Y"]["notional"] == pytest.approx(1e10)
        assert by_tenor["10Y"]["direction"] == -by_tenor["3Y"]["direction"]

    def test_spread_legs_are_dv01_neutral(self, ds):
        """짧은 다리가 더 큰 명목을 진다. 그래야 호가된 스프레드가 손익의
        동인이 되고, 한쪽으로 기운 금리 베팅이 되지 않는다."""
        legs = {l["tenor"]: l for l in I.expand(ds, "3Y-10Y", +1, 1e10, BASE)}
        assert legs["3Y"]["notional"] > legs["10Y"]["notional"] * 2

    def test_fly_is_belly_against_wings(self, ds):
        """`A-B-C` = 2·r_B − r_A − r_C. 벨리가 기준이고 윙 둘이 반대 부호."""
        legs = I.expand(ds, "2Y-5Y-10Y", +1, 1e10, BASE)
        assert len(legs) == 3
        by = {l["tenor"]: l for l in legs}
        belly = by["5Y"]
        assert belly["notional"] == pytest.approx(1e10)
        for wing in ("2Y", "10Y"):
            assert by[wing]["direction"] == -belly["direction"]

    def test_forward_starts_in_the_future(self, ds):
        """1Yx1Y는 합성이 아니라 **D+1Y에 시작해 D+2Y에 끝나는 스왑**이다.

        백테스트는 이걸 못 한다 — `_legs_for`가 id를 대시로 쪼개 `1Yx1Y`를
        아웃라이트로 읽고 테너 조회에서 죽는다(그래서 BOOKABLE_GROUPS에 없다).
        시뮬레이션 엔진은 IRS_Trade가 시작일을 받으므로 자연스럽다.
        """
        (leg,) = I.expand(ds, "1Yx1Y", +1, 1e10, BASE)
        assert leg["startDate"] == "2027-08-05"
        assert leg["maturityDate"] == "2028-08-05"

    def test_forward_par_is_consistent_with_the_spot_curve(self, ds):
        """1y1y 포워드와 1Y 스팟의 평균이 2Y 스팟이어야 한다 — 커브가 스스로와
        어긋나지 않는다는 것이, 포워드 par를 따로 계산한 것이 옳다는 증거다."""
        i = ds.dates.index(BASE)
        spot_1y = ds.series["1Y"][i]
        spot_2y = ds.series["2Y"][i]
        (leg,) = I.expand(ds, "1Yx1Y", +1, 1e10, BASE)
        assert (spot_1y + leg["couponRate"]) / 2 == pytest.approx(spot_2y, abs=0.02)

    def test_direction_flips_every_leg(self, ds):
        long_ = {l["tenor"]: l["direction"] for l in I.expand(ds, "2Y-5Y-10Y", +1, 1e10, BASE)}
        short = {l["tenor"]: l["direction"] for l in I.expand(ds, "2Y-5Y-10Y", -1, 1e10, BASE)}
        assert all(long_[t] == -short[t] for t in long_)


def test_legs_carry_no_derived_fields(ds):
    """파생 필드는 0으로 나간다 — swap_inputs.py가 CD 픽싱과 스케줄에서 채운다.
    여기서 계산해 보내면 같은 값에 두 개의 진실이 생긴다."""
    for leg in I.expand(ds, "2Y-5Y-10Y", +1, 1e10, BASE):
        assert leg["remainingDays"] == 0
        assert leg["currentFloatRate"] == 0
        assert leg["krdMap"] == {}
        assert leg["bondType"] == "swap"
        assert leg["frequency"] == 4  # 원화 IRS는 분기 정산


def test_an_unknown_tenor_says_so(ds):
    with pytest.raises(BacktestError, match="99Y"):
        I.expand(ds, "99Y", +1, 1e10, BASE)


def test_maturity_arithmetic_does_not_overflow_the_month(ds):
    """2/29 + 3년은 2/28이지 3/1이 아니다. 만기가 다음 달로 새면 스케줄 전체와
    잔존일수가 하루씩 어긋난다 — 프론트의 addYearsIso와 같은 규칙."""
    assert I._add_years(dt.date(2024, 2, 29), 3) == dt.date(2027, 2, 28)
    assert I._add_years(dt.date(2024, 2, 29), 4) == dt.date(2028, 2, 29)
    assert I._add_years(dt.date(2026, 1, 31), 1) == dt.date(2027, 1, 31)
