"""Relative-ATR engine (Session 14 Pass 2). Close-only realised-vol ratio."""

import datetime as dt
from pathlib import Path

import pytest

from app.dataset import DISPLAY_TENORS, load_dataset
from app.derive import basis_dates
from app.volatility import (
    LONG_MEAN_FLOOR_BP,
    LONG_OBS,
    WARMUP_OBS,
    relative_atr,
    relative_atr_aligned,
    relative_atr_for,
    volatility_payload,
)

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"


def _pairs(values, scale_free_dates=True):
    """Build (iso, value) pairs. Dates are irregular on purpose (a fat holiday
    gap) to prove windows count OBSERVATIONS, not calendar days."""
    out = []
    d = dt.date(2020, 1, 1)
    for i, v in enumerate(values):
        out.append((d.isoformat(), float(v)))
        # jump a two-week hole a third of the way in — must not shorten a window
        d += dt.timedelta(days=15 if i == len(values) // 3 else 1)
    return out


def test_warmup_returns_null_until_the_first_full_long_window():
    # 61 observations = the first index with a full 60-obs long window (§E)
    vals = [i * 0.1 for i in range(WARMUP_OBS)]
    out = relative_atr(_pairs(vals), scale=1.0)
    assert len(out) == WARMUP_OBS == 61
    # every observation before the last is null (not 0, not a partial window)
    assert all(r is None for _t, r in out[:WARMUP_OBS - 1])
    # the WARMUP_OBS-th observation is the first that can carry a value
    assert out[WARMUP_OBS - 1][1] is not None


def test_constant_true_range_gives_ratio_one():
    # every day moves the same amount → short mean == long mean → 1.0
    vals = [i * 2.0 for i in range(80)]  # TR = 2.0 every step
    out = relative_atr(_pairs(vals), scale=1.0)
    assert out[-1][1] == pytest.approx(1.0)


def test_hot_recent_window_pushes_ratio_above_one():
    # 60-obs window: 55 steps of 2.0 then the last 5 steps of 6.0
    incs = [2.0] * 59 + [6.0] * 5  # 64 increments → 65 observations
    vals = [0.0]
    for step in incs:
        vals.append(vals[-1] + step)
    out = relative_atr(_pairs(vals), scale=1.0)
    ratio = out[-1][1]
    # short mean = 6.0; long window = tr[5..64] = 55×2.0 + 5×6.0 over 60
    expected = 6.0 / ((55 * 2.0 + 5 * 6.0) / LONG_OBS)
    assert ratio == pytest.approx(expected, abs=1e-4)  # ratio is rounded to 4dp


def test_flat_series_hits_the_denominator_floor_and_returns_null():
    # a rate that never moves (3M CD91 for weeks): long-window mean is 0 → null,
    # never a divide-by-zero and never 0.00
    vals = [3.5] * 90
    out = relative_atr(_pairs(vals), scale=100.0)
    assert all(r is None for _t, r in out)


def test_tiny_moves_below_floor_are_null_not_exploding():
    # 60-obs mean |Δ| below the floor (bp) → undefined
    vals = [3.5 + (0.00001 * (i % 2)) for i in range(90)]  # ~0.001 bp wiggle
    out = relative_atr(_pairs(vals), scale=100.0)
    assert out[-1][1] is None
    # sanity: the wiggle really is below the floor
    assert 0.00001 * 100.0 < LONG_MEAN_FLOOR_BP


def test_holiday_gap_does_not_shorten_the_window():
    # WARMUP_OBS observations with a two-week calendar hole embedded; a value
    # must still appear at the last one because windows count observations.
    vals = [i * 0.1 for i in range(WARMUP_OBS)]
    out = relative_atr(_pairs(vals), scale=1.0)
    dates = [t for t, _r in out]
    assert len(set(dates)) == WARMUP_OBS  # irregular but distinct dates
    assert out[-1][1] is not None


def test_ratio_is_scale_invariant():
    vals = [0.0]
    for step in [2.0] * 40 + [5.0] * 30:
        vals.append(vals[-1] + step)
    a = relative_atr(_pairs(vals), scale=1.0)[-1][1]
    b = relative_atr(_pairs(vals), scale=100.0)[-1][1]
    assert a == pytest.approx(b)  # scale cancels in the ratio


def test_relative_atr_for_real_series_is_cached_and_aligned():
    ds = load_dataset(DATA)
    a = relative_atr_for(ds, "10Y")
    b = relative_atr_for(ds, "10Y")
    assert a is b  # cached (same object)
    assert len(a) > 2000
    # early dates are warm-up nulls; the tail has real ratios
    assert a[0][1] is None
    assert any(r is not None for _t, r in a)


def test_aligned_matches_dataset_dates():
    ds = load_dataset(DATA)
    aligned = relative_atr_aligned(ds, "10Y")
    assert len(aligned) == len(ds.dates)
    assert aligned[0] is None  # warm-up


def test_volatility_payload_shape_matches_the_other_tabs():
    ds = load_dataset(DATA)
    payload = volatility_payload(ds, basis_dates(ds))
    assert len(payload["rows"]) == len(DISPLAY_TENORS)
    assert len(payload["curve"]) == len(DISPLAY_TENORS)
    for row in payload["rows"]:
        # SeriesSummary-like so the FE table component never branches
        assert set(row) >= {
            "id", "label", "unit", "now", "deltas", "range1y",
            "sortKey", "quoted", "movePct",
        }
        assert row["unit"] == "ratio"
        assert row["quoted"] is None
        assert row["id"].startswith("vol:")
        assert set(row["deltas"]) == {"d1", "wtd", "mtd", "qtd", "ytd"}
        # the 한 줄 classification is gone from every row shape (pass L)
        assert "oneLiner" not in row
        assert len(row["sortKey"]) == 1
        pct = row["range1y"]["pct"]
        assert pct is None or 0 <= pct <= 100
    # the 10Y ratio is well past warm-up, so it is a real number, not null
    r10 = next(r for r in payload["rows"] if r["id"] == "vol:10Y")
    assert isinstance(r10["now"], float)
