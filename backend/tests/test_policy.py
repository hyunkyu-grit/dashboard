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
    assert "bokbaserate.xlsx" in p["warnings"][0]
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
