# -*- coding: utf-8 -*-
"""라고 할 때 살걸 — the regret list (app/regret.py + events.replay).

Two properties carry the feature and both are pinned here:

1. **The replay is the daily rule, not a second rule.** What the list claims
   the log said on day j must be exactly what `detect_event_clusters` says
   when the dataset is truncated at j — same firings, same collapse, same
   leader (1D aside, which the replay excludes at the source).

2. **The P&L is the backtest's own answer.** Each line's figure must equal
   `run_backtest` on the equivalent position, to the won. The regret list is
   the 실행 button pressed by a robot, never a second pricing path.
"""

import datetime as dt
import json
from pathlib import Path

import pytest

from app.backtest import Position, run_backtest
from app.dataset import load_dataset
from app.events import REPLAY_LOOKBACK, detect_event_clusters, replay_leading_events
from app.regret import NOTIONAL, regret_payload

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"


@pytest.fixture(scope="module")
def ds():
    return load_dataset(DATA)


@pytest.fixture(scope="module")
def payload(ds):
    return regret_payload(ds)


def test_replay_matches_the_daily_rule_on_a_truncated_dataset(ds):
    """Rule-identity: replaying day j == running the daily detector on the
    file as it stood on day j. Checked on the newest replayed day that fired."""
    replay = replay_leading_events(ds)
    assert replay, "no event in the lookback window — widen it for this file"
    j = replay[0]["dateIndex"]

    truncated = load_dataset(DATA)
    truncated.dates = truncated.dates[: j + 1]
    truncated.series = {k: v[: j + 1] for k, v in truncated.series.items()}
    daily = [
        c["leading"] for c in detect_event_clusters(truncated)
        if c["leading"]["id"] != "1D"
    ]

    replayed_j = [e for e in replay if e["dateIndex"] == j]
    assert {e["id"] for e in replayed_j} <= {d["id"] for d in daily}
    for e in replayed_j:
        d = next(x for x in daily if x["id"] == e["id"])
        assert e["deltaBp"] == d["deltaBp"]
        assert e["reasons"] == d["reasons"]


def test_replay_window_and_exclusions(ds):
    n = len(ds.dates)
    for e in replay_leading_events(ds):
        assert n - 2 - REPLAY_LOOKBACK + 1 <= e["dateIndex"] <= n - 2
        assert e["id"] != "1D"
        assert e["kind"] in ("outright", "spread", "fly")


def test_pnl_is_the_backtest_answer_to_the_won(ds, payload):
    """The load-bearing one: same instrument, same direction, entry on the
    next business row, 100억 — run_backtest must reproduce the figure."""
    assert payload, "no regret line to check — widen the lookback for this file"
    for e in payload[:3]:
        run = run_backtest(ds, [Position(
            series_id=e["id"],
            direction=e["direction"],
            notional=NOTIONAL,
            entry=dt.date.fromisoformat(e["entry"]),
        )])
        assert run["positions"][0]["pnl"] == e["pnl"]
        assert run["positions"][0]["entry"] == e["entry"]


def test_direction_follows_the_move_and_degenerates_are_gone(ds, payload):
    n = len(ds.dates)
    for e in payload:
        assert e["deltaBp"] != 0
        assert e["direction"] == (1 if e["deltaBp"] > 0 else -1)
        # the event day is a real row, and entry is the NEXT business row
        j = ds.dates.index(dt.date.fromisoformat(e["date"]))
        assert j + 1 <= n - 2, "entry-today lines must be skipped"
        assert e["entry"] == ds.dates[j + 1].isoformat()


def test_newest_first_and_json_serializable(payload):
    dates = [e["date"] for e in payload]
    assert dates == sorted(dates, reverse=True)
    json.dumps(payload)  # the summary must be able to carry it verbatim
