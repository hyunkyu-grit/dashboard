"""Parity + behaviour tests for the ported single-swap valuation core.

The parity test re-extracts every ported body from the frozen repo and asserts
byte-identity, the same discipline `test_engine_port.py` applies to the curve
side. It skips when the frozen repo is absent so braveworld stays self-contained.

The behaviour tests below it are NOT parity — they pin the two things a port
cannot inherit: that the units crossing our boundary are the ones the frozen
module expects, and that a swap valued on its own entry curve is worth ~nothing.
"""

import ast
import datetime as dt
from pathlib import Path

import numpy as np
import pytest

from app import valuation_port
from app.curves import build_basis_curves
from app.dataset import load_dataset
from app.engine_port import bootstrap_zero_curve
from app.valuation_port import (
    CurveBundle,
    VanillaSwap,
    fixing_date_for_reset,
    select_fixing,
    settled_cash_between,
    value_booked_trade,
)

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"
FROZEN = Path(
    r"C:\Users\infomax\Projects\apps"
    r"\Rates Portfolio\krw-fi-pms-backend\irs_pricer\engine"
)

# name -> the frozen module it came from
PORTED = {
    "FixingResolution": "fixings.py",
    "prev_seoul_business_day": "fixings.py",
    "fixing_date_for_reset": "fixings.py",
    "select_fixing": "fixings.py",
    "dedupe_data_quality_events": "fixings.py",
    "VanillaSwap": "instruments.py",
    "CashFlowDetail": "mtm_valuation.py",
    "MTMResult": "mtm_valuation.py",
    "settled_cash_between": "mtm_valuation.py",
    "value_booked_trade": "mtm_valuation.py",
}


def _bodies(path: Path) -> dict[str, str]:
    """Top-level classes and functions as source text, decorators included.

    `utf-8-sig`: mtm_valuation.py carries a BOM in the frozen repo, which is a
    file-encoding artefact and not part of any body. Reading with universal
    newlines also normalises the frozen copies' CRLF/LF split — the two frozen
    checkouts differ ONLY in line endings (verified), so this compares content.
    """
    src = path.read_text(encoding="utf-8-sig")
    tree = ast.parse(src)
    lines = src.splitlines(keepends=True)
    out: dict[str, str] = {}
    for n in tree.body:
        if isinstance(n, (ast.ClassDef, ast.FunctionDef)):
            start = min([d.lineno for d in n.decorator_list] + [n.lineno])
            out[n.name] = "".join(lines[start - 1 : n.end_lineno])
    return out


@pytest.mark.skipif(not FROZEN.exists(), reason="frozen repo not present")
def test_ported_bodies_byte_identical_to_frozen_source():
    ours = _bodies(Path(valuation_port.__file__))
    for name, src_file in PORTED.items():
        theirs = _bodies(FROZEN / src_file)
        assert name in theirs, f"{name} not found in {src_file}"
        assert ours[name].rstrip("\n") == theirs[name].rstrip("\n"), (
            f"{name} diverged from the frozen {src_file}"
        )


@pytest.mark.skipif(not FROZEN.exists(), reason="frozen repo not present")
def test_nothing_was_quietly_added_to_the_port():
    """A body in our file that is NOT in the frozen source is either a local
    edit or a new function someone slipped in beside ported code. Either way it
    must be declared: `CurveBundle` is the one allowed extra (see the module
    docstring — its sibling `build_curve` needs a DB-backed service)."""
    ours = set(_bodies(Path(valuation_port.__file__)))
    frozen: set[str] = set()
    for f in ("fixings.py", "instruments.py", "mtm_valuation.py"):
        frozen |= set(_bodies(FROZEN / f))
    assert ours - frozen == {"CurveBundle"}


@pytest.fixture(scope="module")
def ds():
    return load_dataset(DATA)


@pytest.fixture(scope="module")
def curve(ds):
    zc = build_basis_curves(ds)["now"]
    return CurveBundle(valuation_date=ds.asof, yield_curve=zc, par_rates=[])


def test_a_swap_struck_at_par_is_worth_about_nothing(ds, curve):
    """THE sanity check on the whole port. Enter a 10Y payer at today's own 10Y
    par rate and value it on today's curve: the fixed leg is by definition the
    rate that makes the two legs offset, so the NPV must be ~0 against the
    notional. If units, schedule or discounting are wrong anywhere in the chain
    this number is large, and it is the only test here that would notice."""
    par = ds.latest("10Y")
    assert par is not None
    notional = 1e10  # 100억
    swap = VanillaSwap(
        tenor_years=10,
        notional=notional,
        fixed_rate=par / 100.0,  # dataset is percent; this boundary is decimal
        pay_fixed=True,
        trade_date=ds.asof,
    )
    res = value_booked_trade(swap, curve, fixings=None)
    # a few bp of annuity at most — the schedule's start is T+1 and the par
    # rate is interpolated onto the curve, so it is near-zero, not exactly zero
    assert abs(res.dirty_npv) / notional < 2e-3, res.dirty_npv


def test_the_decimal_boundary_is_not_crossed_twice(ds, curve):
    """The frozen repo's 2026-07 P&L cliff was a second /100 applied to an
    already-decimal rate. Pinned from both sides: passing percent where decimal
    is expected moves the NPV by ~100x, and so does passing a decimal that has
    been divided again."""
    notional = 1e10
    par_dec = ds.latest("10Y") / 100.0

    def npv(rate):
        return value_booked_trade(
            VanillaSwap(10, notional, rate, True, trade_date=ds.asof), curve, None
        ).dirty_npv

    at_par = abs(npv(par_dec))
    as_percent = abs(npv(par_dec * 100.0))   # the "missing /100" mistake
    as_double = abs(npv(par_dec / 100.0))    # the "second /100" mistake
    assert as_percent > at_par * 50
    assert as_double > at_par * 50


def test_a_payer_gains_when_rates_rise(ds):
    """Direction, in the only terms that matter. Value the same payer swap on
    the entry curve and on a curve bumped +100bp; paying fixed must gain."""
    par = ds.latest("10Y") / 100.0
    quotes = [(0.25, ds.latest("3M") / 100.0)] + [
        (t, ds.latest(n) / 100.0)
        for t, n in ((1.0, "1Y"), (2.0, "2Y"), (3.0, "3Y"), (5.0, "5Y"), (10.0, "10Y"))
    ]
    base = CurveBundle(ds.asof, bootstrap_zero_curve(quotes), [])
    up = CurveBundle(ds.asof, bootstrap_zero_curve([(t, r + 0.01) for t, r in quotes]), [])
    swap = VanillaSwap(10, 1e10, par, pay_fixed=True, trade_date=ds.asof)
    assert value_booked_trade(swap, up, None).dirty_npv > value_booked_trade(
        swap, base, None
    ).dirty_npv


def test_fixing_selection_never_looks_ahead():
    """A period whose F(R) has not passed on the valuation date must return
    None so the caller prices it off the forward — never reach forward into a
    fixing the market had not printed yet."""
    fixings = {dt.date(2026, 7, 1): 0.0292, dt.date(2026, 7, 15): 0.0295}
    reset = dt.date(2026, 7, 16)
    assert fixing_date_for_reset(reset) == dt.date(2026, 7, 15)
    # valuation before F(R): not yet fixed
    assert select_fixing(fixings, reset, dt.date(2026, 7, 14)) is None
    # on/after F(R): the 07-15 print, exactly
    r = select_fixing(fixings, reset, dt.date(2026, 7, 15))
    assert r is not None and r.rate == 0.0295 and r.is_exact


def test_settled_cash_is_zero_over_an_empty_window(ds):
    swap = VanillaSwap(10, 1e10, 0.04, True, trade_date=ds.asof)
    d = ds.asof
    assert settled_cash_between(swap, None, d, d) == 0.0
