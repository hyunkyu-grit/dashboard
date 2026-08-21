# -*- coding: utf-8 -*-
"""문체 — 백엔드가 화면에 보내는 문장은 해요체다.

## 왜 가드가 필요한가

이 앱의 문체는 **해요체 · 한 문장 한 사실**이다. 그런데 화면 문장의 단일 출처가
백엔드라(프런트에 두면 두 벌이 되고 한쪽만 고치면 갈린다) 문체 규율도 백엔드에
걸려야 한다. 눈으로는 안 잡힌다 — 실측 둘:

    2026-08-20   `labscenario.CAVEATS` 가 해라체로 남아 결과 탭 바닥에서
                 앱의 나머지와 두 목소리가 섰다
    2026-08-21   `issuance_gloss` 의 RP매입 한 줄이 «돈을 풉니다» 로 남았다.
                 그 파일은 어미를 통째로 옮긴 뒤였는데 «풉니다» 가 «습니다» 도
                 «입니다» 도 아니라 눈에 안 걸렸다

둘 다 **페이로드를 통째로 읽는 검사**가 잡았다. 그래서 이 파일의 하중은
`test_the_lab_payloads_speak_one_register` 에 있다 — 소스를 읽지 않고 나가는
것을 읽는다.

## 무엇을 덮고 무엇을 아직 안 덮나

지금 덮는 것은 **Lab 세 세입자**의 페이로드다(발행 캘린더 · 시나리오). 그 밖의
레인은 아직이다 — 실측 2026-08-21 기준 `cashbond.py` 20건, `ecos.py` 8건,
`funding.py` 7건, `main.py` 7건이 합니다체 리터럴을 들고 있고, 그중 화면에 닿는
것과 로그로만 가는 것이 섞여 있다. 한 번에 옮기는 것은 별개의 레인이라 여기
경계를 적어 둔다: **`COVERED` 에 한 줄을 더하는 것이 그 레인의 마지막 걸음이다.**

## 사본은 경계에서 옮긴다

`issuance_strength.py` 는 원본의 글자 그대로라 합니다체 문장 19개를 들고 있고
고칠 수 없다(`test_the_strength_module_is_a_verbatim_copy` 가 잠근다). 그래서
`issuance.py` 가 페이로드로 내보낼 때 `issuance_gloss.speak()` 로 어미만 옮긴다.
이 파일이 그 변환기의 규칙도 같이 잠근다 — 규칙이 눈으로 고르는 것이 되면
«업무이에요» 같은 것이 남는다.
"""

import datetime as dt
import json
import re

import pytest

from app import issuance
from app.issuance import IssuanceUnavailable, build, day_detail, months_from
from app.issuance_gloss import to_haeyo
from app.policy import MPC_DATES

MPC = [d.isoformat() for d in MPC_DATES]

#: 합니다체·해라체의 흔적. 인용 부호 안팎을 안 가리고 **나가는 글자 전부**를 본다.
FORMAL = re.compile(r".{0,45}(니다|한다\.|이다\.|않는다\.).{0,20}")

#: 지금 이 가드가 덮는 레인. 한 줄 더하는 것이 그 레인 문체 정리의 마지막 걸음이다.
COVERED = ("발행 캘린더", "시나리오")


def _has_data() -> bool:
    try:
        issuance.data_stamp()
        return True
    except IssuanceUnavailable:
        return False


needs_data = pytest.mark.skipif(not _has_data(), reason="rawData CSV 가 없는 환경")


def _formal_in(payload) -> list[str]:
    """페이로드에 남은 합니다체·해라체 조각들."""
    return FORMAL.findall(json.dumps(payload, ensure_ascii=False))


# ── 변환기 ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "formal, casual",
    [
        # 받침이 «이에요/예요» 를 가른다. 눈으로 고르면 «업무이에요» 가 남는다.
        ("상위 25% 안에 드는 수요입니다.", "상위 25% 안에 드는 수요예요."),
        ("응찰이 평년 수준입니다.", "응찰이 평년 수준이에요."),
        ("가장 높은 금리입니다.", "가장 높은 금리예요."),
        ("가장 큰 하루 물량입니다.", "가장 큰 하루 물량이에요."),
        ("눈이 갈렸다는 뜻입니다.", "눈이 갈렸다는 뜻이에요."),
        # «않습니다» 는 «않어요» 가 아니다 — 좁은 규칙이 먼저 서야 한다.
        ("강도를 판단하지 않습니다.", "강도를 판단하지 않아요."),
        ("두 종목 합계로 과거와 견줍니다.", "두 종목 합계로 과거와 견줘요."),
        # 남는 «습니다» 는 전부 과거형 뒤다.
        ("같은 날 입찰됐습니다.", "같은 날 입찰됐어요."),
        ("돈을 거뒀습니다", "돈을 거뒀어요"),
        ("예치로 묶였습니다", "예치로 묶였어요"),
        ("3bp 벌어졌습니다 —", "3bp 벌어졌어요 —"),
    ],
)
def test_the_converter_picks_the_ending_by_arithmetic(formal, casual):
    assert to_haeyo(formal) == casual


def test_the_converter_leaves_casual_text_alone():
    """이미 해요체인 문장은 한 글자도 안 바뀐다 — 두 번 돌아도 같아야 한다."""
    already = "한국은행이 채권을 사고 돈을 풀어요. 단기자금이 그만큼 늘어나요."
    assert to_haeyo(already) == already
    assert to_haeyo(to_haeyo("응찰이 평년 수준입니다.")) == "응찰이 평년 수준이에요."


# ── 나가는 것 ───────────────────────────────────────────────────────────────


@needs_data
def test_the_lab_payloads_speak_one_register():
    """**이 파일의 하중.** 소스가 아니라 나가는 페이로드를 읽는다.

    한 달치 달력과 그 달 평일 전부의 상세를 훑는다. 하루만 보면 그날 없던
    레인의 문장을 놓친다 — 실측 2026-08-21: RP매입의 «풉니다» 는 8/18 과 7/16
    에만 떴고 다른 날에는 없었다.
    """
    left = _formal_in(build(months_from(2026, 8, 1), MPC, today=dt.date(2026, 8, 20)))
    for day in (dt.date(2026, 8, i) for i in range(1, 29)):
        left += _formal_in(day_detail(day.isoformat(), MPC))
    assert not left, f"합니다체가 화면으로 나가요: {sorted(set(left))[:5]}"


@needs_data
def test_no_screen_sentence_carries_markdown():
    """강조는 «» 다. 이 앱의 문장은 마크다운을 지나지 않는다.

    **실측 결함, 2026-08-21:** 방향 단서가 «재료 자체가 미는 쪽» 을 별표로
    감싸고 있어서 시트 바닥에 별표가 그대로 찍혔다. 소스 주석에서는 별표가
    읽기를 돕지만 문자열 안에서는 화면에 나간다.
    """
    from app.labscenario import CAVEATS

    payload = json.dumps(
        {
            "cal": build(months_from(2026, 8, 1), MPC, today=dt.date(2026, 8, 20)),
            "days": [day_detail(f"2026-08-{d:02d}", MPC) for d in range(3, 22)],
            "scenario": CAVEATS,
        },
        ensure_ascii=False,
    )
    stars = re.findall(r".{0,40}\*\*.{0,20}", payload)
    assert not stars, f"화면 문장에 마크다운이 있어요: {stars[:3]}"


@needs_data
def test_no_machine_key_reaches_the_sheet():
    """`KEY:` 접두어는 페이로드의 `caveats` 목록 규약이지 화면 문장이 아니다.

    **실측 결함, 2026-08-21:** 민평 단서에 접두어를 붙여 뒀더니 시트 바닥에
    «MP_BENCHMARK:» 가 그대로 떴다. 화면이 그대로 찍는 자리에는 문장만 간다.
    """
    d = day_detail("2026-08-13", MPC)
    rendered = [d["mp"]["caveat"], d["mp"]["note"], d["gloss"]["ktb"]["biasCaveat"]]
    bad = [t for t in rendered if t and re.match(r"^[A-Z][A-Z_0-9]+:", t)]
    assert not bad, f"화면 문장에 기계 열쇠가 붙어 있어요: {bad}"
    # 목록 쪽은 반대다 — 거기선 접두어가 규약이다.
    cal = build(months_from(2026, 8, 1), MPC, today=dt.date(2026, 8, 20))
    assert all(re.match(r"^[A-Z][A-Z_0-9]+:", c) for c in cal["caveats"])


def test_the_scenario_caveats_speak_the_same_register():
    """시나리오 결과 탭 바닥의 단서들. 2026-08-20 에 해라체로 남아 있었다."""
    from app.labscenario import CAVEATS

    assert not _formal_in(CAVEATS), "시나리오 단서가 앱의 다른 목소리로 말해요"


def test_the_covered_lanes_are_named():
    """덮는 범위를 이 파일이 스스로 적는다.

    안 덮는 레인이 있는 것은 사실이고, 그 사실이 문서에만 있으면 다음 세션은
    이 가드를 «백엔드 전부» 로 읽는다. 목록이 곧 경계다.
    """
    assert COVERED == ("발행 캘린더", "시나리오")
    assert "COVERED" in __doc__ and "cashbond" in __doc__
