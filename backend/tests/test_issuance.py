# -*- coding: utf-8 -*-
"""발행 캘린더 (`app/issuance.py`).

이 파일에서 하중을 지는 것은 `test_the_strength_module_is_a_verbatim_copy` 다.
나머지는 페이로드의 모양을 기술하지만, 그 하나는 **같은 입찰에 두 판정이 생기는
것**을 막는다.

`issuance_strength.py` 는 `Codex/rawData/src/strength.py` 를 글자 그대로 옮긴
것이다. 손대면 발행 캘린더의 원본 화면과 이 화면이 같은 입찰에 다른 등급을 붙이고,
그건 화면이 아니라 데이터의 문제로 보인다.

CSV 가 없는 환경(다른 PC·CI)에서는 데이터를 읽는 검사만 건너뛴다. 건너뛴 검사는
아무것도 보증하지 않으므로, 사본 대조는 CSV 와 무관하게 늘 돈다.
"""

import datetime as dt
import pathlib

import pytest

from app import issuance
from app.issuance import IssuanceUnavailable, build, day_detail, months_from
from app.policy import MPC_DATES

MPC = [d.isoformat() for d in MPC_DATES]

#: 원본. 없으면 사본 대조만 건너뛴다 — 이 리포 밖의 파일이다.
ORIGINAL = pathlib.Path(
    r"C:\Users\infomax\Desktop\Codex\rawData\src\strength.py"
)


def _has_data() -> bool:
    try:
        issuance.data_stamp()
        return True
    except IssuanceUnavailable:
        return False


needs_data = pytest.mark.skipif(not _has_data(), reason="rawData CSV 가 없는 환경")


def test_the_strength_module_is_a_verbatim_copy():
    """판정 코드가 원본과 글자 그대로 같다.

    머리글(docstring)만 다르다 — 이식 사실과 되돌아가는 길을 적었다. 그 아래
    본문이 한 글자라도 갈리면 두 화면이 같은 입찰에 다른 등급을 붙인다.
    """
    if not ORIGINAL.exists():
        pytest.skip("원본 리포가 이 PC 에 없음")
    mine = pathlib.Path(issuance.__file__).with_name("issuance_strength.py")
    body = lambda p: p.read_text(encoding="utf-8").split('"""', 2)[2]  # noqa: E731
    assert body(ORIGINAL) == body(mine), "판정 코드가 원본과 갈렸어요"


def test_unavailable_names_the_path():
    """CSV 를 못 읽으면 화면이 이유를 말할 수 있어야 한다."""
    old = issuance.DATA_DIR
    try:
        issuance.DATA_DIR = pathlib.Path("Z:/없는경로")
        with pytest.raises(IssuanceUnavailable) as e:
            issuance.data_stamp()
        assert "없는경로" in str(e.value)
    finally:
        issuance.DATA_DIR = old


def test_months_from_wraps_the_year():
    assert months_from(2026, 11, 3) == [(2026, 11), (2026, 12), (2027, 1)]


@needs_data
def test_a_month_grid_is_a_whole_month():
    p = build(months_from(2026, 8, 1), MPC, today=dt.date(2026, 8, 20))
    m = p["months"]["2026-08"]
    assert len(m["days"]) == 31
    # 2026-08-01 은 토요일 — 격자 앞을 다섯 칸 비운다.
    assert m["lead"] == 5
    assert [d["d"] for d in m["days"]][:3] == [1, 2, 3]


@needs_data
def test_the_substitute_holiday_is_not_a_business_day():
    """2026-08-15(광복절)이 토요일이라 8/17(월)이 대체공휴일이다.

    영업일 판정을 이 리포의 것(`engine_port._is_kr_business_day`)에 맡긴 이유가
    이것이다 — 대체공휴일을 손으로 관리하면 해마다 틀린다.
    """
    p = build(months_from(2026, 8, 1), MPC, today=dt.date(2026, 8, 20))
    biz = {d["d"]: d["biz"] for d in p["months"]["2026-08"]["days"]}
    assert biz[17] is False, "대체공휴일이 영업일로 잡혔어요"
    assert biz[18] is True


@needs_data
def test_sectors_keep_their_seat_even_at_zero():
    """발행이 0 인 섹터도 목록에서 안 빠진다 — 날마다 늘었다 줄었다 하면 필터가
    어디 있었는지 못 찾는다(원본의 규칙)."""
    p = build(months_from(2026, 8, 1), MPC, today=dt.date(2026, 8, 20))
    assert [s["k"] for s in p["sectors"]] == issuance.SECTORS


@needs_data
def test_the_server_does_not_pre_sum_the_sectors():
    """하루치가 섹터별로 갈려 있어야 화면의 필터가 달력을 바꿀 수 있다."""
    p = build(months_from(2026, 8, 1), MPC, today=dt.date(2026, 8, 20))
    days = [d for d in p["months"]["2026-08"]["days"] if d["isec"]]
    assert days, "이 달에 발행이 하나도 없어요 — 픽스처가 이상해요"
    assert all(isinstance(d["isec"], dict) and d["isec"] for d in days)
    assert all(set(d["isn"]) <= set(d["isec"]) for d in days)


@needs_data
def test_the_horizon_is_reported():
    """발행 공시가 닿는 끝과 입찰 결과가 나온 끝. 그 뒤의 빈칸은 «없음» 이 아니다."""
    p = build(months_from(2026, 8, 1), MPC, today=dt.date(2026, 8, 20))
    assert p["issuanceThrough"] and p["auctionThrough"]
    assert any("SHELF_HORIZON" in c for c in p["caveats"])
    assert any("ISSUANCE_ONLY" in c for c in p["caveats"])


@needs_data
def test_a_scheduled_meeting_without_a_decision_is_not_the_same_as_no_meeting():
    """8/27 은 달력에 있고 결과표에는 아직 없다.

    한 필드에 접으면 «회의가 없는 날» 과 «회의는 있는데 아직 안 열린 날» 이
    구분되지 않는다 — 화면이 «오늘 금통위예요, 결과는 아직» 을 말할 수 있어야 한다.
    """
    upcoming = day_detail("2026-08-27", MPC)["mpc"]
    assert upcoming == {"scheduled": True, "decision": None}
    assert day_detail("2026-08-10", MPC)["mpc"] is None


@needs_data
def test_the_auction_strength_rides_along():
    """같은 연물 52주 판정이 그날 상세에 붙는다.

    2026-08-10 의 3년물 경쟁입찰이 실측 앵커다 — 응찰률 257.3%, 평년 271.9%,
    등급 «약한 수요». 이 값이 바뀌면 판정 코드나 데이터가 바뀐 것이다.
    """
    comp = [
        a for a in day_detail("2026-08-10", MPC)["auctions"] if a["kind"] == "경쟁입찰"
    ]
    assert comp, "그날 경쟁입찰이 없어요"
    s = comp[0]["strength"]
    assert s is not None
    assert s["label"] == "3년물"
    assert s["pct"] is not None, "표본이 있는데 등급을 안 냈어요"
    assert 0 <= s["pct"] <= 100


@needs_data
def test_issuance_only():
    """만기도래는 페이로드에 없다 [OWNER]."""
    d = day_detail("2026-08-10", MPC)
    assert set(d) == {"date", "issuing", "auctions", "omo", "mpc"}
    assert all("maturityDue" not in r for r in d["issuing"])
