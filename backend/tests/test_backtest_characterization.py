# -*- coding: utf-8 -*-
"""CHARACTERIZATION PIN over `to_irs_trade` → `value_booked_trade` (MEMO-1).

WHY THIS EXISTS. The backtest path carries 64 tests and every one of them is a
PROPERTY test — identity, sign, telescoping, mirroring, neutrality. They are
good tests and they are not what this file is. None of them pins a number, so
none of them can adjudicate the standard a memoization pass has to meet:
*byte-identical output, not "faster and basically the same"*. The two tests
called `test_ported_bodies_byte_identical_to_frozen_source` pin the ported
SOURCE TEXT against the frozen krw-fi-pms repo; they would not notice a cache
that returned a subtly wrong schedule, only an edit to a ported body.

So this file pins the OUTPUT, and it exists to be the thing a later pass diffs
against. It is deliberately dumb: run the book, compare every number.

TWO LAYERS, because the published payload is already rounded.

  1. `test_payload_is_unchanged` — the whole `run_backtest` + `book_recon`
     response. The engine rounds these to the won itself (`round(..., 0)` in
     backtest.py), so agreement here is agreement at WON granularity. That is
     the contract the frontend consumes, and it is not sufficient on its own:
     a defect smaller than ₩0.5 per point would hide.
  2. `test_raw_valuation_floats_are_unchanged` — `_value_on` and `_settled_to`
     at full float64, straight off the memoized path, before any rounding.
     THIS is the byte-identity layer. JSON round-trips float64 exactly
     (`json.dumps` emits `repr`), so `==` here is bit equality.

THE FIXTURE TAKES NOTHING FROM DISK (`tests/characterization.py`). Seeding from
`data/irsdata.xlsx` — as the property tests reasonably do — would make these
numbers a function of a workbook the morning bake rewrites daily, and which is
uncommitted in the working tree as of this pass. Expected values that change
overnight are not a pin.

REGENERATING. Only ever after a change whose output effect is intended and
understood — never to make a red test green:

    python -m tests.regen_characterization

and the diff it produces is the change, stated in numbers.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from app.backtest import (
    Position,
    _build_legs,
    _cd_fixings,
    _settled_to,
    _span_of,
    _value_on,
    book_recon,
    run_backtest,
)

from tests.characterization import characterization_dataset

FIXTURE = Path(__file__).resolve().parent / "data" / "backtest_characterization.json"

N = 1e10  # 100억


def positions() -> list[Position]:
    """Chosen to cover every shape the schedule cache would have to keep apart.

    - 1, 2 and 3 legs (outright / spread / fly), so a cache keyed too loosely
      would cross-contaminate legs of one book.
    - both directions.
    - NON-INTEGER tenors (9M, 1.5Y). `VanillaSwap.tenor_years` is annotated
      `int` while the ported body actually uses the float; obeying the
      annotation once repriced every sub-year node as a 1Y swap. Any future
      cache key that rounds the tenor reproduces that defect exactly, and 9M
      here is what would catch it.
    - one position that MATURES inside the window (9M) and one closed by an
      explicit exit (the spread), so the frozen-tail branches are priced.
    """
    ds = characterization_dataset()
    d = ds.dates
    return [
        Position("10Y", 1, N, d[0]),                       # runs to the end
        Position("9M", -1, N, d[0]),                       # matures in-window
        Position("3Y-10Y", 1, N / 2, d[20], d[200]),       # closed early
        Position("2Y-5Y-10Y", -1, N / 2, d[5]),            # three legs
        Position("1.5Y", 1, N, d[0]),                      # non-integer tenor
    ]


def _raw_floats() -> dict[str, float]:
    """Unrounded `_value_on` / `_settled_to` off the memoized path.

    Sampled rather than exhaustive: enough (position × date) pairs that a cache
    which mixed two schedules up shows here, few enough that the file stays
    readable. Keys name the position and the row so a failure says WHICH.
    """
    ds = characterization_dataset()
    out: dict[str, float] = {}
    for pos in positions():
        entry_i, exit_i, _matured = _span_of(ds, pos)
        legs = _build_legs(ds, pos.series_id, pos.notional, entry_i)
        for leg in legs:
            leg.sign *= pos.direction
        entry_date = ds.dates[entry_i]
        span = exit_i - entry_i
        for frac in (0.0, 0.25, 0.5, 0.75, 1.0):
            i = entry_i + int(span * frac)
            fx = _cd_fixings(ds, i)
            clean, accrued = _value_on(legs, ds, i, entry_date, fx)
            cash = _settled_to(legs, entry_date, ds.dates[i], fx)
            tag = f"{pos.series_id}@{ds.dates[i].isoformat()}"
            out[f"{tag}/clean"] = clean
            out[f"{tag}/accrued"] = accrued
            out[f"{tag}/cash"] = cash
            # the frozen (unchanged-term-structure) revaluation the roll-down
            # chain is built from — a second, differently-shaped call into the
            # same path, on a curve index that is NOT the valuation index
            if i > entry_i:
                cf, af = _value_on(
                    legs, ds, i, entry_date, _cd_fixings(ds, i - 1),
                    None, curve_idx=i - 1,
                )
                out[f"{tag}/frozen_clean"] = cf
                out[f"{tag}/frozen_accrued"] = af
    return out


def build_expected() -> dict:
    ds = characterization_dataset()
    pos = positions()
    return {
        "meta": {
            "note": "regenerate with `python -m tests.regen_characterization`",
            "asof": ds.asof.isoformat(),
            "rows": len(ds.dates),
        },
        "backtest": run_backtest(ds, pos),
        "recon": book_recon(ds, pos),
        "raw": _raw_floats(),
    }


@pytest.fixture(scope="module")
def expected() -> dict:
    if not FIXTURE.exists():
        pytest.fail(
            f"{FIXTURE.name} is missing. It is committed alongside this test; "
            "regenerate with `python -m tests.regen_characterization` only if "
            "you intend to change the pinned output."
        )
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def actual() -> dict:
    return build_expected()


def test_the_fixture_is_self_contained():
    """The pin must not move when the morning bake rewrites the workbook.

    Asserted rather than trusted: `characterization_dataset()` is built twice
    and must agree, and its span must be the literal one — if someone reseeds
    it from `irsdata.xlsx` this fails before the number tests do, which is a
    far more legible failure than 900 numbers changing at once.
    """
    a, b = characterization_dataset(), characterization_dataset()
    assert a.dates == b.dates
    assert a.series == b.series
    assert a.dates[0] == dt.date(2024, 1, 2)
    assert len(a.dates) == 260


def test_payload_is_unchanged(expected, actual):
    """Every number the endpoint publishes, at the won granularity the engine
    itself rounds to. Compared whole rather than field by field: a new key is a
    contract change and should fail here too."""
    assert actual["backtest"] == expected["backtest"]
    assert actual["recon"] == expected["recon"]


def test_raw_valuation_floats_are_unchanged(expected, actual):
    """The byte-identity layer: float64 off the valuation path, unrounded.

    Exact `==`, no tolerance. A tolerance here would defeat the purpose — the
    question this file answers is whether a change altered the arithmetic at
    all, not whether it altered it by much.
    """
    exp, act = expected["raw"], actual["raw"]
    assert set(act) == set(exp), "the sampled set itself changed"
    wrong = {k: (exp[k], act[k]) for k in exp if exp[k] != act[k]}
    assert not wrong, f"{len(wrong)} raw float(s) moved: {dict(list(wrong.items())[:5])}"
