"""The BOK base rate loader and its carry bound (app/policy.py).

The load-bearing test here is `test_step_stops_short_of_an_unverified_meeting`.
Everything else in this file describes a shape; that one describes the only way
this feature can print a wrong number on every chart at once.
"""

import datetime as dt
from pathlib import Path

import pytest

from app.policy import (
    MPC_DATES,
    BaseRate,
    PolicyFileError,
    decisions,
    load_base_rate,
    load_base_rate_auto,
    load_base_rate_ecos,
    mpc_dates_from_calendar,
    policy_step,
)

DATA = Path(__file__).resolve().parents[2] / "data" / "bokbaserate.xlsx"


@pytest.fixture(scope="module")
def base():
    return load_base_rate(DATA)


def test_loads_ascending_and_plausible(base):
    assert base.dates == sorted(base.dates)
    assert len(base.dates) == len(base.values)
    assert base.dates[0] == dt.date(2016, 1, 1)
    assert all(0.0 <= v <= 6.0 for v in base.values)
    # the file is newest-first on disk; `asof` must be the LATEST date, and a
    # loader that forgot to sort would put 2016 here and pass every other test
    assert base.asof > dt.date(2026, 1, 1)


def test_rate_in_force_is_a_step_never_an_interpolation(base):
    """`at()` answers with the last DECISION at or before the date — the whole
    point of a policy rate. A date between two decisions gets the earlier
    level exactly, not a blend of the two."""
    assert base.at(dt.date(2015, 12, 31)) is None      # before the file
    assert base.at(dt.date(2026, 7, 16)) == 2.75       # on the decision
    assert base.at(dt.date(2026, 7, 15)) == 2.5        # the day before
    # 2.5 was in force from 2025-05-29 to 2026-07-15 — every day between is 2.5
    for d in (dt.date(2025, 6, 1), dt.date(2025, 12, 31), dt.date(2026, 3, 3)):
        assert base.at(d) == 2.5


def test_decisions_are_the_corners_only(base):
    """~3,800 daily rows describe ~20 decisions. The chart gets the corners;
    sending the flat days would be sending one number thousands of times."""
    d = decisions(base)
    assert len(d) < 40 < len(base.dates)
    rates = [r for _dt, r in d]
    assert all(a != b for a, b in zip(rates, rates[1:]))  # no repeats
    assert d[0][0] == base.dates[0]                       # opening level kept
    assert d[-1] == (dt.date(2026, 7, 16), 2.75)


def test_step_carries_forward_when_no_meeting_intervened(base):
    """The workbook lags the IRS file by two weeks and the Board did not meet
    in between (last 2026-07-16, next 2026-08-27), so carrying 2.75 to the
    IRS as-of date is a fact, not a guess."""
    p = policy_step(base, dt.date(2026, 7, 30))
    assert p["through"] == "2026-07-30"
    assert p["latest"] == 2.75
    assert p["warnings"] == []


def test_step_stops_short_of_an_unverified_meeting(base):
    """THE guard. With an as-of past a meeting the workbook has not been
    refreshed through, the step must END at the workbook's own last date and
    say so — never draw the old rate across the day it may have changed.

    A regression here is invisible on screen (the line simply continues) and
    wrong on every %-unit chart simultaneously, which is why it is asserted
    rather than left to the reader to notice."""
    p = policy_step(base, dt.date(2026, 9, 1))
    assert p["through"] == base.asof.isoformat() == "2026-07-16"
    assert len(p["warnings"]) == 1
    assert "2026-08-27" in p["warnings"][0]
    # 경고는 «무엇을 갱신하라» 를 말해야 하는데, 출처가 둘이 됐다(ECOS 가 기본,
    # 이 워크북은 폴백 — 2026-09-01). 파일 이름을 박으면 ECOS 로 물러선 날
    # 읽는 사람에게 안 읽히는 파일을 갱신하라고 말하게 된다.
    assert base.source in p["warnings"][0]
    # and nothing is emitted beyond the bound
    assert all(s["date"] <= p["through"] for s in p["steps"])


def test_step_never_carries_past_a_meeting_at_any_asof(base):
    """The property behind the case above, over every meeting in the calendar:
    `through` may never span an MPC date the workbook has not reached."""
    for m in MPC_DATES:
        p = policy_step(base, m + dt.timedelta(days=1))
        through = dt.date.fromisoformat(p["through"])
        assert not [d for d in MPC_DATES if base.asof < d <= through]


def test_mpc_dates_match_the_calendar():
    """MPC_DATES is a copy of the frontend's owner-verified calendar. Copies
    rot; this is what stops it. Skips on a backend-only checkout."""
    cal = mpc_dates_from_calendar()
    if cal is None:
        pytest.skip("frontend/src/data/calendar.json not present")
    assert MPC_DATES == cal


def test_a_nonsense_rate_is_refused(tmp_path):
    """Wrong is not the same as old. A decimal slip (275 for 2.75) makes every
    chart's axis meaningless, so it raises rather than warning."""
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["종목", None, None, None])
    ws.append(["한국:기준금리", None, None, "단위: %"])
    ws.append(["일자", "현재가", "수신일시", "수신일자"])
    ws.append([dt.datetime(2026, 7, 16), 275.0, "", ""])
    p = tmp_path / "bad.xlsx"
    wb.save(p)
    with pytest.raises(PolicyFileError, match="not a policy rate"):
        load_base_rate(p)


def test_the_wrong_workbook_is_refused(tmp_path):
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["a"]); ws.append(["b"]); ws.append(["Date", "Close"])
    ws.append([dt.datetime(2026, 7, 16), 2.75])
    p = tmp_path / "wrong.xlsx"
    wb.save(p)
    with pytest.raises(PolicyFileError, match="expected"):
        load_base_rate(p)


def test_empty_history_has_no_step():
    with pytest.raises(IndexError):
        BaseRate(dates=[], values=[]).asof


# ─────────────────────────────────────────────────────────────────────────
# 출처가 ECOS 로 옮겨간 뒤 [OWNER, 2026-09-01]. 워크북은 폴백으로 남는다.
# ─────────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def ecos_base():
    """ECOS 를 못 타는 PC(키 없음·망 없음·캐시 없음)에서는 건너뛴다."""
    try:
        return load_base_rate_ecos()
    except Exception as exc:                      # noqa: BLE001 — 이유를 그대로 보인다
        pytest.skip(f"ECOS 를 못 읽는 환경: {exc}")


def test_ecos_is_percent_not_decimal(ecos_base):
    """단위 핀. `ecos.base_rate_series()` 는 **소수**(0.03)를 주고 이 모듈은
    **%**(3.00)를 쓴다. 100 을 빠뜨리면 예외가 아니라 그럴듯한 숫자가 나오고,
    그 실수는 이 리포에서 이미 한 번 캐리 항에 났다.

    `RATE_MIN_PCT` 대역 검사가 로더 안에서 그것을 막지만, 대역이 넓어지는 날을
    대비해 여기서 한 번 더 못 박는다 — 0.03 은 정책금리가 아니다.
    """
    assert 0.25 <= ecos_base.latest <= 10.0
    assert all(0.0 <= v <= 10.0 for v in ecos_base.values)


def test_ecos_agrees_with_the_workbook_where_they_overlap(base, ecos_base):
    """출처를 바꾼 근거. 겹치는 구간에서 **한 날도 안 갈린다.**

    2026-09-01 실측 — 워크북 2016-01-01~2026-07-16 의 3,850 영업일이 ECOS 에
    전부 있고, 정확한 같음으로 불일치 0. 그래서 이 교체는 값을 바꾸는 것이
    아니라 꼬리를 잇는 것이다. 갈리는 날이 생기면 그건 둘 중 하나가 틀린
    것이므로 여기서 멈춰야 한다.

    (`round(..., 6)` 이 로더에 있는 이유도 여기다 — 없으면 x100 왕복 잡티로
    1.75 가 1.7500000000000002 이 되어 이 대조가 정확한 같음으로 안 선다.)
    """
    ecos_at = dict(zip(ecos_base.dates, ecos_base.values))
    missing = [d for d in base.dates if d not in ecos_at]
    assert not missing, f"ECOS 에 없는 워크북 날짜 {len(missing)}개: {missing[:3]}"
    differing = [(d, v, ecos_at[d]) for d, v in zip(base.dates, base.values)
                 if v != ecos_at[d]]
    assert not differing, f"겹친 구간에서 갈린 날 {len(differing)}개: {differing[:3]}"


def test_ecos_reaches_further_on_both_ends(base, ecos_base):
    """더 길고 더 신선하다 — 손 export 를 대체하는 이유 그 자체다."""
    assert ecos_base.dates[0] < base.dates[0]     # 1999 대 2016
    assert ecos_base.asof >= base.asof


def test_the_workbook_catches_us_when_ecos_cannot_answer(monkeypatch):
    """폴백은 조용하면 안 된다.

    ECOS 가 못 답하면 화면은 손 스냅샷 위에 서는데, 그건 발표기관의 계열 위에
    선 것과 **다른 사실**이다. 그래서 `warnings` 에 그 사실이 남고, 캐리 가드의
    경고도 워크북 이름을 부르게 된다.
    """
    import app.policy as pol

    def boom():
        raise RuntimeError("키가 없어요")

    monkeypatch.setattr(pol, "load_base_rate_ecos", boom)
    got = pol.load_base_rate_auto(DATA)
    assert got.source == DATA.name
    assert len(got.warnings) == 1
    assert "bokbaserate.xlsx" in got.warnings[0]
    assert "키가 없어요" in got.warnings[0]
    # 그 사실이 페이로드까지 간다
    p = policy_step(got, dt.date(2026, 9, 1))
    assert any("bokbaserate.xlsx" in w for w in p["warnings"])
