"""Carry & roll (carry session, Pass C/E). The expensive failure here is a
sign error — invisible on screen, wrong in the wallet — so the signs are
pinned against the real curve and against hand math on a synthetic one."""

from pathlib import Path

import numpy as np
import pytest

from app.carry import HORIZONS, carry_payload
from app.curves import build_basis_curves
from app.dataset import load_dataset
from app.forwards import forward_par_rate

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"


@pytest.fixture(scope="module")
def zc():
    return build_basis_curves(load_dataset(DATA))["now"]


def horizons(zc, sid):
    return carry_payload(sid, zc)["horizons"]


def test_payload_shape(zc):
    p = carry_payload("10Y", zc)
    assert p["side"] == "pay" and p["unit"] == "bp"
    assert set(p["horizons"]) == set(HORIZONS)
    for f in p["horizons"].values():
        assert f is not None
        assert round(f["carry"] + f["roll"], 2) == pytest.approx(f["total"], abs=0.011)


def test_upward_curve_gives_the_payer_negative_carry(zc):
    """Pass E hand check. Today's curve is upward-sloping in the belly/long
    end (verify, then assert): paying fixed funds above floating and rolls
    down toward it, so BOTH terms are negative for the payer on outrights."""
    s = {t: forward_par_rate(zc, 0.0, y) for t, y in [("2Y", 2.0), ("5Y", 5.0), ("10Y", 10.0)]}
    assert s["2Y"] < s["5Y"] < s["10Y"], "precondition: upward-sloping curve"
    for sid in ["5Y", "10Y"]:
        f = horizons(zc, sid)["3M"]
        assert f["carry"] < 0, f"payer carry must be negative on {sid}"
        assert f["roll"] < 0, f"payer roll must be negative on {sid}"
        assert f["total"] < 0


def test_carry_matches_the_accrual_identity_by_hand(zc):
    """carry_pay(T,h) = S(T) − F(h,T−h) must equal the accrual identity
    −(S(T) − short)·h/A(T−h) to first order — computed here from raw engine
    parts, not via carry.py."""
    h, T = 0.25, 10.0
    s10 = forward_par_rate(zc, 0.0, T) * 1e4
    f = forward_par_rate(zc, h, T - h) * 1e4
    carry = horizons(zc, "10Y")["3M"]["carry"]
    assert carry == pytest.approx(s10 - f, abs=0.011)
    short = forward_par_rate(zc, 0.0, h) * 1e4  # 3M money rate
    approx = -(s10 - short) * h / (T - h)  # flat-annuity first-order identity
    assert carry == pytest.approx(approx, rel=0.35), (
        "carry far from the accrual identity — formula suspect"
    )


def test_spread_and_fly_combine_their_legs_by_quote_weights(zc):
    for hlabel in HORIZONS:
        l10 = horizons(zc, "10Y")[hlabel]
        l1 = horizons(zc, "1Y")[hlabel]
        if l10 is None or l1 is None:
            continue
        sp = horizons(zc, "1Y-10Y")[hlabel]
        assert sp["carry"] == pytest.approx(l10["carry"] - l1["carry"], abs=0.011)
        assert sp["roll"] == pytest.approx(l10["roll"] - l1["roll"], abs=0.011)
    f2 = horizons(zc, "2Y")["3M"]
    f5 = horizons(zc, "5Y")["3M"]
    f10 = horizons(zc, "10Y")["3M"]
    fly = horizons(zc, "2Y-5Y-10Y")["3M"]
    assert fly["total"] == pytest.approx(
        2 * f5["total"] - f2["total"] - f10["total"], abs=0.021
    )


def test_receive_is_the_exact_negation_wire_contract(zc):
    """The wire carries PAY; Receive is the browser's negation — assert the
    payload declares the side so that contract cannot drift silently."""
    assert carry_payload("10Y", zc)["side"] == "pay"


def test_horizons_are_coherent_not_erratic(zc):
    """Longer horizons accumulate more carry on a persistent slope — the
    figures must grow in magnitude monotonically for the 10Y payer today,
    not jump around (Pass E)."""
    hs = horizons(zc, "10Y")
    totals = [hs[k]["total"] for k in ["1M", "3M", "6M", "1Y"]]
    assert all(t < 0 for t in totals)
    assert totals[0] > totals[1] > totals[2] > totals[3], totals  # more negative


def test_degenerate_ids_have_no_statement(zc):
    assert all(v is None for v in horizons(zc, "vol:3M").values())
    assert all(v is None for v in horizons(zc, "1D").values())  # the call rate
    # a 3M outright cannot be rolled 6M or 1Y
    hs = horizons(zc, "3M")
    assert hs["6M"] is None and hs["1Y"] is None
    assert hs["1M"] is not None


def test_forward_instrument_is_pure_roll(zc):
    hs = horizons(zc, "1Yx1Y")
    for f in hs.values():
        assert f is not None
        assert f["carry"] == 0.0
        assert f["total"] == f["roll"]
    # rolling a forward down an upward curve is negative for the payer too
    assert hs["3M"]["roll"] < 0


def test_one_month_horizon_is_not_quantized_to_zero(zc):
    """The engine's par grid is quarterly; without par interpolation the 1M
    roll of a 10Y would quantize to exactly 0 — the artifact this pins."""
    f = horizons(zc, "10Y")["1M"]
    assert f["roll"] != 0.0
