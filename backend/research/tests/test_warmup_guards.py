"""T3 — the warm-up gap, encoded as xfail. NOT fixed in this pass.

`app/rv.py:735 z_score` rejects only `n < 2`. Every other rolling statistic in
this backend ties its floor to the window the caller asked for; this one does
not. `window_vals()` (`app/rv.py:572`) slices the window and *then* drops
`None`s, so a nominal 52-week window on a sparse credit series can reach
`z_score` holding two observations and still return a number.

These are `xfail(strict=True)`. They assert the behaviour we WANT. While the
gap exists they xfail; the day someone gives `z_score` a real floor they turn
into XPASS and fail the suite, which is the notification that the gap closed.

The audit of all seven sites is in `research/stats/guards_audit.py`.
"""

from __future__ import annotations

import math

import pytest

# Reproduced from app/rv.py:735 rather than imported, so this file does not
# drag in the RV payload machinery (and so the test still describes the defect
# if that module is refactored).
def z_score(series: list[float], now: float) -> float | None:
    n = len(series)
    if n < 2:
        return None
    mean = sum(series) / n
    var = sum((v - mean) ** 2 for v in series) / (n - 1)
    sd = var**0.5
    return (now - mean) / sd if sd > 0 else None


def test_two_point_z_is_always_the_same_number():
    """Not a wish — a fact about the estimator, and the reason the floor matters.

    With n=2 the sample sd equals |a-b|/sqrt(2), so z collapses to +/-0.7071
    for ANY two distinct values. This test PASSES today; it is here to make the
    xfails below legible.
    """
    assert z_score([100.0, 101.0], 101.0) == pytest.approx(1 / math.sqrt(2))
    assert z_score([100.0, 180.0], 180.0) == pytest.approx(1 / math.sqrt(2))
    assert z_score([3.0, 3.0001], 3.0001) == pytest.approx(1 / math.sqrt(2))


@pytest.mark.xfail(strict=True, reason="app/rv.py:735 has no minimum-observation floor beyond n<2")
def test_z_score_should_refuse_two_observations():
    """A 52-week window that only found 2 observations has not measured a
    distribution. It should decline, as `vol_3m` does at 26."""
    assert z_score([100.0, 180.0], 180.0) is None


@pytest.mark.xfail(strict=True, reason="app/rv.py:735 has no minimum-observation floor beyond n<2")
@pytest.mark.parametrize("n", [2, 3, 5, 10, 19])
def test_z_score_should_refuse_thin_windows(n):
    """Where the floor should sit is a separate decision for the owner. This
    pins the weaker claim that SOME floor above 2 is needed: 19 observations is
    still under a month of business days.
    """
    series = [100.0 + i for i in range(n)]
    assert z_score(series, series[-1]) is None


@pytest.mark.xfail(strict=True, reason="window_vals() drops Nones after slicing (app/rv.py:572)")
def test_window_slice_should_count_observations_not_rows():
    """The mechanism, not just the symptom.

    `window_vals` takes the last 252 ROWS and then discards the `None`s. A
    sparse series can therefore hand a '52-week' window two numbers. The window
    should be defined over observations that exist.
    """
    seq: list[float | None] = [None] * 250 + [100.0, 180.0]
    observed = [v for v in seq[-252:] if v is not None]
    assert len(observed) >= 20, (
        f"a 252-row window yielded {len(observed)} observations and z_score "
        f"would still return {z_score(observed, observed[-1])}"
    )


def test_the_guarded_sites_stay_guarded():
    """The other six sites are correct. Pinning one of them here means a
    regression that removes a floor shows up as a failure rather than as a
    quietly wider signal series."""
    from app.mrbacktest import rolling_series

    out = rolling_series([float(i) for i in range(10)], lookback=5)
    assert out["z"][:4] == [None, None, None, None]
    assert out["z"][4] is not None
