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


def test_spread_weights_are_dv01_neutral(zc):
    p = dv01_payload("1Y-10Y", "spread", zc)
    assert p["kind"] == "spread"
    short, long = p["legs"]
    assert long["notional"] == 100
    # short leg carries MORE notional (smaller DV01), long the reference 100
    assert short["notional"] > 100
    # residual rounds to zero relative to the gross leg DV01
    gross = 100 * long["dv01"]
    assert abs(p["residual"]) / gross < 0.01


def test_fly_weights_are_dv01_neutral(zc):
    p = dv01_payload("1Y-2Y-10Y", "fly", zc)
    assert p["kind"] == "fly"
    s, b, l = p["legs"]
    assert b["notional"] == 100  # belly is the reference
    assert s["notional"] > l["notional"]  # short wing needs the most notional
    gross = 100 * b["dv01"]
    assert abs(p["residual"]) / gross < 0.01


def test_every_spread_and_fly_is_neutral_within_rounding(zc):
    table = build_dv01_table(zc, derived_ids)
    for sid, kind, _legs in derived_ids():
        p = table[sid]
        ref = max(leg["dv01"] for leg in p["legs"])
        assert abs(p["residual"]) / (100 * ref) < 0.01, sid


def test_outright_has_dv01_but_no_ratio(zc):
    p = dv01_payload("10Y", "outright", zc)
    assert p["kind"] == "outright"
    assert p["legs"][0]["notional"] is None
    assert p["legs"][0]["dv01"] > 0
    assert p["residual"] is None
