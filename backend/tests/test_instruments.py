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


def test_catalog_covers_every_tab():
    cat = I.catalog()
    # 채권 둘이 뒤에 붙었다 [OWNER, 2026-08-14]. 그 둘은 민평이 SQL 에만 있어
    # 닿지 않으면 **빈 목록**이 되므로 (`_bond_catalog` 의 폴백), 여기서는
    # 존재만 못박고 내용은 아래 live 표시가 붙은 테스트에서 잰다.
    assert set(cat) == {
        "outright", "spread", "fly", "forward", "cashbond", "assetswap",
    }
    for k in ("outright", "spread", "fly", "forward"):
        assert cat[k], k
    # 조합은 여덟 노드에서 — 열세 개로 하면 78 + 286이 되어 고를 수 없다
    assert len(cat["spread"]) == 28
    assert len(cat["fly"]) == 56


def test_kind_is_readable_from_the_id():
    assert I.kind_of("10Y") == "outright"
    assert I.kind_of("3Y-10Y") == "spread"
    assert I.kind_of("2Y-5Y-10Y") == "fly"
    # 접두사가 먼저 걸린다. `ASW:KTB:1.5Y` 에는 `x` 가 없고 `CB:KTB:3Y` 에는
    # `-` 가 없어서, 순서가 뒤바뀌면 둘 다 아웃라이트로 읽힌다.
    assert I.kind_of("CB:KTB:3Y") == "cashbond"
    assert I.kind_of("ASW:KTB:3Y") == "assetswap"
    assert I.kind_of("ASW:KTB:1.5Y") == "assetswap"
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


# ── 현금채권 · 자산스왑 ──────────────────────────────────────────────────────
#
# 민평이 SQL 에만 있어서 여기부터는 닿을 때만 돈다. 네트워크가 없다는 사실이
# 엔진의 결함으로 보고되면 게이트가 거짓말을 하는 것이다 (test_cashbond 와
# 같은 정책).


def _sql_reachable() -> bool:
    try:
        from app import creditmatrix as cm

        cm.watermark()
        return True
    except Exception:
        return False


live = pytest.mark.skipif(not _sql_reachable(), reason="credit_matrix SQL 에 닿지 않습니다")


@live
class TestBondInstruments:
    """[OWNER, 2026-08-14 — "시뮬레이션 포지션에 스왑 뿐만아니라 현금채권이랑
    자산스왑 추가해줘"].

    여기서 못박는 것은 **엔진이 실제로 읽는 칸들**이다. 시뮬레이션 엔진은
    채권을 이미 값매기지만, 안 채워 보내면 조용한 0 이 된다:

      pvbp            0 이면 금리가 아무리 움직여도 MTM 0
      mtmYield        0 이면 쿠폰을 한 푼도 못 받고 조달만 낸다
      remainingDays   0 이면 만기 판정과 감쇠가 무너진다
      sector          틀리면 **다른 커브**로 충격을 받는다 (조용히)
    """

    N = 1e10

    def test_a_cash_bond_is_one_row_and_an_asset_swap_is_two(self, ds):
        cb_rows = I.expand(ds, "CB:KTB:3Y", 1, self.N, BASE)
        asw_rows = I.expand(ds, "ASW:KTB:3Y", 1, self.N, BASE)
        assert [r["bondType"] for r in cb_rows] == ["bond"]
        # 채권 매수 + 같은 명목 페이 고정. 한 줄로 접으면 둘 중 하나의 산술을 잃는다.
        assert [r["bondType"] for r in asw_rows] == ["bond", "swap"]
        assert asw_rows[0]["direction"] == 1
        assert asw_rows[1]["direction"] == -1        # −1 = 고정 지급
        assert asw_rows[1]["notional"] == asw_rows[0]["notional"] == self.N

    def test_the_engine_reads_every_field_it_needs(self, ds):
        row = I.expand(ds, "CB:KTB:3Y", 1, self.N, BASE)[0]
        assert row["pvbp"] > 0, "롱 채권은 pvbp 가 양수여야 한다 (엔진: pvbp × −Δbp)"
        assert row["mtmYield"] > 0, "여기가 비면 쿠폰 없이 조달만 낸다"
        assert row["remainingDays"] == pytest.approx(3 * 365.0)
        assert row["evaluationAmount"] == pytest.approx(self.N, rel=1e-9)
        assert row["frequency"] == 4                 # 3개월 이표채 — 백테스트와 같다
        assert row["krdMap"], "KRD 가 비면 PVBP 표가 채권을 못 센다"

    def test_the_entry_price_is_par_so_the_evaluation_equals_the_notional(self, ds):
        """표면수익률 = 할인율 = 민평이므로 진입가가 정확히 par 다 [OWNER].
        평가액이 명목과 다르면 그 등식이 깨진 것이고, 캐리가 그 평가액을 쓴다."""
        for tenor in ("6M", "3Y", "10Y"):
            row = I.expand(ds, f"CB:KTB:{tenor}", 1, self.N, BASE)[0]
            assert row["evaluationAmount"] == pytest.approx(self.N, rel=1e-9), tenor
            assert row["couponRate"] == pytest.approx(row["mtmYield"])

    def test_duration_is_the_pvbp_it_ships(self, ds):
        """duration 과 pvbp 가 서로 딴소리를 하면 안 된다 — 같은 가격에서 왔다."""
        row = I.expand(ds, "CB:KTB:5Y", 1, self.N, BASE)[0]
        implied = row["pvbp"] * 1e4 / row["evaluationAmount"]
        assert row["duration"] == pytest.approx(implied, rel=1e-9)
        assert 4.0 < row["duration"] < 5.0, row["duration"]

    @pytest.mark.parametrize(
        "bond_type,sector,curve",
        [
            ("KTB", "국고채", "국채"),
            ("MSB", "통안채", "국채"),
            ("KDB", "특은채", "특은채"),   # 산금채 — 이름 그대로 넘기면 국채로 샌다
            ("SPB", "공사채", "특은채"),
            ("BD", "시은채", "은행채"),
            ("CB1", "회사채", "회사채"),
            ("CARD", "여전채", "카드채"),
            ("OFB", "여전채", "카드채"),   # 캐피탈채 — 이것도 국채로 샜다
        ],
    )
    def test_every_sector_lands_on_its_own_shock_curve(self, ds, bond_type, sector, curve):
        """조용히 틀릴 수 있는 자리라 여덟 개를 다 잰다.

        `get_sector_curve_key` 는 **부분문자열**로 커브를 고른다. 민평 이름을
        그대로 넘기면 "산금채 AAA" 와 "캐피탈채 AA-" 가 어느 갈래에도 안 걸려
        국채 커브를 타고, 아무 데서도 안 터진다.
        """
        from irs_pricer.services.simulation.daily_valuation import get_sector_curve_key

        row = I.expand(ds, f"CB:{bond_type}:2Y", 1, self.N, BASE)[0]
        assert row["sector"] == sector
        assert get_sector_curve_key(row["sector"]) == curve

    def test_selling_a_bond_is_refused(self, ds):
        """백테스트와 같은 거절 [OWNER, 2026-08-14 — "국고채는 매도는 없는거고"].
        대차료를 모르는 채로 0 으로 두면 공매도가 늘 이기는 시뮬이 된다."""
        with pytest.raises(BacktestError, match="매수만"):
            I.expand(ds, "CB:KTB:3Y", -1, self.N, BASE)

    def test_an_asset_swap_the_curve_cannot_carry_says_so(self, ds):
        with pytest.raises(BacktestError, match="자산스왑"):
            I.expand(ds, "ASW:KTB:20Y", 1, self.N, BASE)

    def test_an_unknown_bond_id_says_so(self, ds):
        for sid in ("CB:XXX:3Y", "CB:KTB:99Y", "CB:KTB"):
            with pytest.raises(BacktestError):
                I.expand(ds, sid, 1, self.N, BASE)

    def test_the_catalog_lists_both_families(self):
        cat = I.catalog()
        ids = {o["id"] for o in cat["cashbond"]}
        assert "CB:KTB:3Y" in ids
        assert "CB:MSB:3Y" in ids
        assert "CB:MSB:5Y" not in ids          # 통안채는 3년까지 — 데이터가 강제한다
        asw = {o["id"] for o in cat["assetswap"]}
        assert "ASW:KTB:3Y" in asw
        assert "ASW:KTB:20Y" not in asw        # 양쪽에 있는 만기만
        # 주요는 국고채 — 90줄을 스크롤해서 고르는 건 고르는 게 아니다
        assert all(
            o["key"] is (o["id"].split(":")[1] == "KTB") for o in cat["cashbond"]
        )
        assert any(o["key"] for o in cat["cashbond"])

    def test_my_pvbp_agrees_with_the_engines_own_reval(self, ds):
        """엔진은 채권 pvbp 를 자기가 다시 판다(`enrich_bond_dv01`) — 와이어
        값은 재평가가 실패했을 때의 폴백이다. 둘이 크게 벌어지면 둘 중 하나가
        틀린 것이므로, 실측 0.10% 를 여유 있게 감싸 못박는다."""
        from irs_pricer.services.simulation.enrichment import enrich_bond_dv01
        from irs_pricer.services.simulation.models import FrontendPosition

        row = I.expand(ds, "CB:KTB:3Y", 1, self.N, BASE)[0]
        out = enrich_bond_dv01([FrontendPosition(**row)], BASE.isoformat())[0]
        assert out.pvbp == pytest.approx(row["pvbp"], rel=0.01)
