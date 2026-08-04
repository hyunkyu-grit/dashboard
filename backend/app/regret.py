"""라고 할 때 살걸 — the change log, priced in hindsight [OWNER, 2026-08-04].

For each change-log line of the last REPLAY_LOOKBACK business days (rule (c)
replayed as of each day — events.replay_leading_events), assume the reader
followed the line's own direction the NEXT business day with a standard
notional, and value that position to the as-of date through the backtest
engine — full revaluation, DV01-neutral legs, maturity cap, carry, the same
`_run_one` the 실행 button runs. The list rides in the wall summary, so the
static tree carries it like every other precomputed answer (§16, §21).

Every convention here is a choice, so each is stated:

- **Entry is the NEXT business row after the event date.** The event is
  computed from that day's close; entering on the same close would trade on a
  print the reader had not seen yet. This is the one place the regret list is
  allowed to differ from the backtest's own "the entry date is the date you
  clicked" — a click points at a day, a log line IS that day's close.
- **Direction FOLLOWS the move** (the sign of `deltaBp`): the joke is
  "따라갈걸", not "받아칠걸". A line whose deltaBp is exactly 0 (a pure
  window-shift transition) has no direction to follow and is skipped.
- **Notional is a flat 100억 on the reference leg** — a scale for reading the
  figure, not a recommendation. The legs beyond it are DV01-neutral exactly
  as the backtest builds any position.
- **Yesterday's lines are skipped**: their entry would be today, held zero
  days, and a guaranteed 0원 line says nothing.
- The signed P&L is served as it comes: a negative figure is the honest
  answer ("안 따라가길 잘했다") and deleting it would make the list a
  highlight reel.
"""

from __future__ import annotations

import numpy as np

from .backtest import Position, _run_one
from .dataset import Dataset
from .events import replay_leading_events

NOTIONAL = 1e10  # 100억, reference leg


def regret_payload(dataset: Dataset) -> list[dict]:
    """[{date, id, label, kind, unit, deltaBp, reasons, direction, entry,
    matured, pnl}], newest event first — the wall summary's `regret` block."""
    dates = dataset.dates
    n = len(dates)
    cache: dict[int, np.ndarray] = {}
    out: list[dict] = []
    for ev in replay_leading_events(dataset):
        j = ev["dateIndex"]
        if j + 1 >= n - 1:  # entry would be today — nothing held yet
            continue
        if not ev["deltaBp"]:
            continue
        direction = 1 if ev["deltaBp"] > 0 else -1
        record, _series, _prev = _run_one(
            dataset,
            Position(
                series_id=ev["id"],
                direction=direction,
                notional=NOTIONAL,
                entry=dates[j + 1],
            ),
            [n - 1],
            cache,
        )
        out.append({
            "date": dates[j].isoformat(),
            "id": ev["id"],
            "label": ev["label"],
            "kind": ev["kind"],
            "unit": ev["unit"],
            "deltaBp": ev["deltaBp"],
            "reasons": ev["reasons"],
            "direction": direction,
            "entry": record["entry"],
            "matured": record["matured"],
            "pnl": record["pnl"],
        })
    return out
