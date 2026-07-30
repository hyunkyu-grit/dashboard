"""DV01 leg weights (Session 16 Pass B): the DV01-neutral notional ratio and its
residual, off the bootstrapped curve."""

from pathlib import Path

import pytest

from app.curves import build_basis_curves
from app.dataset import load_dataset
from app.derive import derived_ids
from app.dv01 import build_dv01_table, dv01_payload, pv01

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"


@pytest.fixture(scope="module")
def zc():
    ds = load_dataset(DATA)
    return build_basis_curves(ds)["now"]


def test_pv01_increases_with_tenor(zc):
    # a longer par swap has a larger annuity / DV01
    assert pv01(zc, 1.0) < pv01(zc, 5.0) < pv01(zc, 10.0)


"""The residual bound, derived once and used by the three tests below.

The weighting is DV01-neutral by construction (see `app/dv01.py`), so the
shipped residual is EXACTLY the non-reference legs' integer rounding, priced:

    residual = Σ (exact_i − round(exact_i)) · d_i ,   |exact − round| ≤ ½

hence |residual| ≤ ½ · Σ d_i over the ROUNDED legs. That bound is structural —
it holds at every curve, so no data refresh can trip it — and it is what "the
weighting and the curve agree" actually means here.

WHAT THIS REPLACED, AND WHY [2026-07-30 refresh]. Each test used to divide the
residual by one leg's gross DV01 and demand <1%, with a different leg per test:
the fly divided by the BELLY, the table-wide test by the LARGEST leg. Neither
number measures neutrality. The fly's `1Y-2Y-10Y` long wing needs ~11.7 units at
a 10Y DV01 four times the belly's, so half a unit of rounding on that leg alone
is 2.1% of the belly's gross — the 1% ceiling was inside the rounding noise it
was measuring. It passed at 0.880% on the 2026-07-24 curve and failed at 1.111%
on 2026-07-30 with nothing changed but the data, while the SAME trade passed the
table-wide test at 0.261% because that one divides by the 10Y leg. A genuine
weighting-or-curve disagreement is still caught: it would put the residual on
the order of the gross DV01 (hundreds), not half a notional unit.
"""

# float slack for the round-trip through the payload's 6dp rounding
RESIDUAL_EPS = 1e-5


def rounding_bound(payload: dict) -> float:
    """½ · Σ d over the legs whose notional was ROUNDED — every leg except the
    reference, which is normalised to exactly 100 (long leg for a spread, belly
    for a fly). Indices mirror `dv01_payload`, which is where the order is set."""
    legs = payload["legs"]
    rounded = [legs[0]] if payload["kind"] == "spread" else [legs[0], legs[2]]
    return 0.5 * sum(leg["dv01"] for leg in rounded)


def test_spread_weights_are_dv01_neutral(zc):
    p = dv01_payload("1Y-10Y", "spread", zc)
    assert p["kind"] == "spread"
    short, long = p["legs"]
    assert long["notional"] == 100
    # short leg carries MORE notional (smaller DV01), long the reference 100
    assert short["notional"] > 100
    assert abs(p["residual"]) <= rounding_bound(p) + RESIDUAL_EPS
    # what makes the bound HALF a unit: the notionals ship as integers. Stated
    # structurally rather than as "the bound is under x% of the trade" — a
    # percentage here would be data-dependent in exactly the way this rewrite
    # removed. Ship notionals at 1dp and this line is the one that says so.
    assert all(float(leg["notional"]).is_integer() for leg in p["legs"])


def test_fly_weights_are_dv01_neutral(zc):
    p = dv01_payload("1Y-2Y-10Y", "fly", zc)
    assert p["kind"] == "fly"
    s, b, l = p["legs"]
    assert b["notional"] == 100  # belly is the reference
    assert s["notional"] > l["notional"]  # short wing needs the most notional
    assert abs(p["residual"]) <= rounding_bound(p) + RESIDUAL_EPS
    assert all(float(leg["notional"]).is_integer() for leg in p["legs"])


def test_every_spread_and_fly_is_neutral_within_rounding(zc):
    table = build_dv01_table(zc, derived_ids)
    for sid, _kind, _legs in derived_ids():
        p = table[sid]
        assert abs(p["residual"]) <= rounding_bound(p) + RESIDUAL_EPS, sid


def test_outright_has_dv01_but_no_ratio(zc):
    p = dv01_payload("10Y", "outright", zc)
    assert p["kind"] == "outright"
    assert p["legs"][0]["notional"] is None
    assert p["legs"][0]["dv01"] > 0
    assert p["residual"] is None
