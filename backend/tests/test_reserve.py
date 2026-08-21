# -*- coding: utf-8 -*-
"""지준 적립기간 표 (`app/reserve.py`).

이 파일에서 하중을 지는 것은 `test_the_table_consumes_the_bok_pdf_exactly` 다.
나머지는 표의 성질을 기술하지만, 그 하나는 **옮겨 적기가 틀렸는지**를 본다.

## 왜 파서를 안 쓰나

한국은행 PDF 는 텍스트에 칸 구분이 없다. «7.9» 와 «8.5» 와 «7.16» 이 붙어
«7.98.57.16» 으로 나오고, 탐욕 파서는 «8.57» 같은 없는 날짜를 조용히 고른다
(원본 리포가 실측으로 겪은 함정이고, 실제로 2026-08-57 이 나왔다고 적어 두었다).

반대 방향은 모호함이 없다. **날짜를 우리가 알고 있으므로** 커서에서 그 날짜가
«M.D» 또는 «YY.M.D» 로 서 있는지만 보면 되고, 둘 다 고정 문자열이다. 원문이
남김없이 소비되면 표가 맞다 — 한 자리라도 틀리면 커서가 어긋나 멈춘다.
연도 접두어가 언제 붙는지는 조판의 사정이라 모델링하지 않는다.

## 네트워크가 없으면 건너뛴다

이 검사만 건너뛴다. 건너뛴 검사는 아무것도 보증하지 않으므로, 표의 성질
(체인 연속·길이 28/35·요일)은 네트워크와 무관하게 늘 돈다.
"""

import calendar as cal
import datetime as dt
import io
import re

import pytest

from app import reserve
from app.policy import MPC_DATES

W = "월화수목금토일"


def _raw_pdf_text() -> str | None:
    """한국은행 PDF 원문. 못 읽으면 None — 그 검사만 건너뛴다."""
    try:
        import requests
        from pypdf import PdfReader
    except ImportError:
        return None
    try:
        r = requests.get(reserve.SOURCE_URL, timeout=60)
    except Exception:  # noqa: BLE001 — 네트워크 예외가 여러 갈래다
        return None
    if r.status_code != 200 or r.content[:4] != b"%PDF":
        return None
    return re.sub(
        r"\s+", "",
        "".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(r.content)).pages),
    )


def test_the_table_consumes_the_bok_pdf_exactly():
    """**이 파일의 하중.** 표로 원문을 끝까지 먹는다 — 한 자리도 안 남기고.

    남은 글자가 있거나 커서가 어긋나면 옮겨 적기가 틀린 것이다.
    """
    raw = _raw_pdf_text()
    if raw is None:
        pytest.skip("한국은행 PDF 를 못 읽는 환경")

    head = ("2026년지준계산기간및적립기간계산기간적립기간"
            "통화정책방향결정회의시작일마감일시작일마감일")
    assert raw.startswith(head), f"표 머리가 바뀌었어요: {raw[:60]}"
    i = len(head)
    mpc = iter(reserve.MPC_IN_TABLE)

    def eat_date(d: dt.date, where: str) -> None:
        """«M.D» 또는 «YY.M.D». 둘 다 고정 문자열이라 고를 여지가 없다."""
        nonlocal i
        for lit in (f"{d.year % 100}.{d.month}.{d.day}", f"{d.month}.{d.day}"):
            if raw.startswith(lit, i):
                i += len(lit)
                return
        raise AssertionError(f"{where}: {d} 가 커서 {i} 에 없어요 — «{raw[i:i+18]}…»")

    #: 금통위가 없는 달의 자리표. 표에 그렇게 찍혀 있다.
    NONE_MARK = "―"
    for (cy, cm), start, end in reserve.PERIODS:
        tag = f"{cy}-{cm:02d}"
        for lit in (f"{cy % 100}.{cm}월", f"{cm}월"):
            if raw.startswith(lit, i):
                i += len(lit)
                break
        else:
            raise AssertionError(f"{tag}: 월 머리가 없어요 — «{raw[i:i+12]}…»")
        # 계산기간은 그 달 1일~말일이다. 이 사실이 앞 두 칸을 못 박는다.
        eat_date(dt.date(cy, cm, 1), f"{tag} 계산 시작")
        eat_date(dt.date(cy, cm, cal.monthrange(cy, cm)[1]), f"{tag} 계산 마감")
        eat_date(start, f"{tag} 적립 시작")
        eat_date(end, f"{tag} 적립 마감")
        if raw.startswith(NONE_MARK, i):
            i += len(NONE_MARK)
        else:
            m = next(mpc)
            eat_date(m, f"{tag} 금통위")
            mark = f"({W[m.weekday()]})"
            assert raw.startswith(mark, i), f"{tag}: 금통위 요일이 {mark} 가 아니에요"
            i += len(mark)

    assert i == len(raw), f"원문이 남았어요: «{raw[i:]}»"
    assert next(mpc, None) is None, "표에 안 쓰인 금통위가 남았어요"


def test_the_second_thursday_rule_is_wrong():
    """**규칙으로 찍으면 안 되는 이유.**

    시중에 도는 «매월 둘째 목요일» 규칙이 열둘 중 둘에서 어긋난다. 지준 마감은
    콜금리가 조이는 날이라 하루가 곧 뜻이고, 여섯 달에 한 번 틀린 날짜를 세우는
    화면은 없느니만 못하다. 이 검사가 빨강이 되면 규칙이 맞다는 뜻이므로
    그때 다시 생각하면 된다.
    """
    off = []
    for _m, start, _e in reserve.PERIODS:
        first = dt.date(start.year, start.month, 1)
        nxt = dt.date(start.year + (start.month == 12), start.month % 12 + 1, 1)
        thu = [first + dt.timedelta(days=k) for k in range((nxt - first).days)
               if (first + dt.timedelta(days=k)).weekday() == 3]
        if start != thu[1]:
            off.append((start, thu[1]))
    assert [s for s, _ in off] == [dt.date(2026, 5, 7), dt.date(2026, 8, 6)]


def test_the_periods_chain_without_a_gap():
    """앞 기간 마감 다음 날이 다음 기간 시작이다. 하루도 안 비고 안 겹친다."""
    for a, b in zip(reserve.PERIODS, reserve.PERIODS[1:]):
        assert a[2] + dt.timedelta(days=1) == b[1], f"{a[2]} → {b[1]}"


def test_every_period_is_four_or_five_weeks_thursday_to_wednesday():
    """길이는 28일 아니면 35일, 목요일에 시작해 수요일에 끝난다."""
    for _m, start, end in reserve.PERIODS:
        assert (end - start).days + 1 in (28, 35), f"{start}~{end}"
        assert start.weekday() == 3, f"{start} 가 목요일이 아니에요"
        assert end.weekday() == 2, f"{end} 가 수요일이 아니에요"


def test_the_same_pdf_confirms_the_meeting_calendar():
    """이 표가 든 금통위 날짜가 `calendar.json` 과 같다.

    두 출처가 독립이라 서로를 확인한다. 갈리면 둘 중 하나가 틀린 것이고,
    그건 조용히 지나가면 안 되는 사실이다(실측 2026-08-21: 8/8 일치).
    """
    ours = [d for d in MPC_DATES if d.year == 2026]
    assert ours == reserve.MPC_IN_TABLE


def test_the_events_land_on_the_right_days():
    """`events()` 가 시작·마감을 각각 열두 번씩 세운다."""
    ev = reserve.events()
    starts = [k for k, v in ev.items() if "지준 시작" in v]
    ends = [k for k, v in ev.items() if "지준 마감" in v]
    assert len(starts) == len(ends) == 12
    assert "2026-08-06" in starts, "8월 적립기간 시작이 빠졌어요"
    assert "2026-08-05" in ends, "7월 적립기간 마감이 빠졌어요"


def test_outside_the_table_nothing_is_invented():
    """표가 2027-01-06 에서 끝난다. 그 밖에는 아무것도 안 세운다."""
    lo, hi = reserve.covered()
    assert (lo, hi) == (dt.date(2026, 1, 8), dt.date(2027, 1, 6))
    assert reserve.detail("2027-02-11") is None
    assert reserve.period_of(dt.date(2025, 12, 1)) is None


def test_the_detail_counts_the_days_left():
    """마감이 다가올수록 평균을 맞출 여지가 준다 — 그 «다가옴» 은 날수로만 보인다."""
    start = reserve.detail("2026-08-06")
    assert start["kind"] == "지준 시작"
    assert start["days"] == 35 and start["leftDays"] == 35
    end = reserve.detail("2026-08-05")
    assert end["kind"] == "지준 마감" and end["leftDays"] == 0
    assert reserve.detail("2026-08-10") is None
