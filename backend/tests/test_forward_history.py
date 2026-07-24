"""Stage-2 forward history (Session 13): forwards derive history from each
date's curve, so a forward is NOT a data-less instrument."""

from pathlib import Path

import pytest

from app.dataset import load_dataset
from app.forwards import forward_history, parse_forward_id

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"


@pytest.fixture(scope="module")
def ds():
    return load_dataset(DATA)


def test_parse_forward_id():
    assert parse_forward_id("2Yx1Y") == (2.0, 1.0)
    assert parse_forward_id("5Yx5Y") == (5.0, 5.0)
    assert parse_forward_id("2YxSPOT")[1] is None
    with pytest.raises(KeyError):
        parse_forward_id("9Yx9Y")  # not a matrix cell


def test_forward_history_full_domain(ds):
    pts = forward_history(ds, "2Yx1Y")
    assert len(pts) > 2000  # a real 10y series, not empty
    assert pts[0]["t"] <= "2016-12-31"
    assert pts[-1]["t"] == ds.asof.isoformat()
    for p in pts:
        assert 0.0 < p["v"] < 15.0  # sane KRW forward rate in %


def test_forward_history_matches_now(ds):
    # last history point equals the live forward matrix value (both from today's
    # curve, same forward_par_rate) within rounding.
    from app.curves import build_basis_curves
    from app.forwards import forwards_payload

    payload = forwards_payload(ds, build_basis_curves(ds))
    kf = next(k for k in payload["keyForwards"] if k["label"] == "2Yx1Y")
    hist_last = forward_history(ds, "2Yx1Y")[-1]["v"]
    assert abs(hist_last - kf["values"]["now"]) < 0.01
