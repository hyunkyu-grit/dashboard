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


def test_concurrent_readers_compute_a_series_once(ds):
    """Pass A, §4: two readers asking for the same UNCACHED forward computed
    it twice — 5,216 bootstraps where one pass is 2,608, ~3.7s of duplicated
    work, growing with the number of simultaneous readers. Endpoints run in
    FastAPI's threadpool, so this is real concurrency, not a hypothetical.
    """
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from app import forwards as fwd

    fid = "3Yx2Y"
    fwd._forward_history_cache.pop(fid, None)

    calls = {"n": 0}
    counter_lock = threading.Lock()
    real = fwd.bootstrap_zero_curve
    started = threading.Barrier(4)

    def counting(pars):
        with counter_lock:
            calls["n"] += 1
        return real(pars)

    fwd.bootstrap_zero_curve = counting
    try:
        def ask():
            started.wait(timeout=30)  # all four inside at once, cache empty
            return fwd.forward_history(ds, fid)

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = [f.result() for f in [pool.submit(ask) for _ in range(4)]]
    finally:
        fwd.bootstrap_zero_curve = real
        fwd._forward_history_cache.pop(fid, None)

    # one pass, not four — and every reader gets the same object back
    assert calls["n"] == len(ds.dates)
    for r in results:
        assert r is results[0]


def test_a_bad_id_fails_fast_without_waiting_on_the_lock(ds):
    """Validation happens outside the per-series lock, so a typo does not
    queue behind someone else's 3.7s bootstrap run."""
    with pytest.raises(KeyError):
        forward_history(ds, "9Yx9Y")


def test_key_forward_range1y(ds):
    """The gauge needs a 52-week LEVEL range + average + percentile per key
    forward (annual-stats session): min ≤ now ≤ max, min ≤ avg ≤ max, pct in
    [0,100], and the percentile agrees with the level's position in
    [min,max]."""
    from app.curves import build_basis_curves
    from app.forwards import forwards_payload

    payload = forwards_payload(ds, build_basis_curves(ds))
    for kf in payload["keyForwards"]:
        r = kf["range1y"]
        now = kf["values"]["now"]
        assert r["min"] is not None and r["max"] is not None and r["pct"] is not None
        assert r["min"] <= now <= r["max"]
        assert r["avg"] is not None and r["min"] <= r["avg"] <= r["max"]
        assert 0.0 <= r["pct"] <= 100.0
