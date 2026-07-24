import datetime as dt
from pathlib import Path

import pytest

from app.dataset import DISPLAY_TENORS, load_dataset
from app.derive import (
    basis_dates,
    derived_ids,
    downsample,
    series_values,
    summarize,
)

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"


@pytest.fixture(scope="module")
def ds():
    return load_dataset(DATA)


def test_loads_ascending_daily(ds):
    assert ds.dates == sorted(ds.dates)
    assert len(ds.dates) > 2000
    assert ds.asof >= dt.date(2026, 7, 24)


def test_tenor_columns(ds):
    for t in ["1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"]:
        assert t in ds.series, t
    # full spec node set present since the 2026-07-24 re-export added CD 3M
    assert ds.missing_nodes == []


def test_derived_count():
    ids = derived_ids()
    assert len(ids) == 35
    assert sum(1 for _, k, _l in ids if k == "spread") == 15
    assert sum(1 for _, k, _l in ids if k == "fly") == 20


def test_spread_and_fly_arithmetic(ds):
    i = -1
    r = {t: ds.series[t][i] for t in DISPLAY_TENORS}
    s = series_values(ds, "1Y-10Y")[i]
    assert s == pytest.approx((r["10Y"] - r["1Y"]) * 100)
    f = series_values(ds, "2Y-5Y-10Y")[i]
    assert f == pytest.approx((2 * r["5Y"] - r["2Y"] - r["10Y"]) * 100)


def test_basis_dates_strictly_before_periods(ds):
    b = basis_dates(ds)
    asof = ds.asof
    assert b["d1"] < asof
    assert b["wtd"] < asof - dt.timedelta(days=asof.weekday())
    assert b["mtd"] < asof.replace(day=1)
    assert b["ytd"].year == asof.year - 1


def test_summary_shape(ds):
    b = basis_dates(ds)
    s = summarize(ds, "10Y", "IRS 10Y", "outright", b)
    assert s["unit"] == "%"
    assert s["now"] is not None
    assert set(s["deltas"]) == {"d1", "wtd", "mtd", "qtd", "ytd"}
    assert all(v is not None for v in s["deltas"].values())
    assert len(s["spark"]) <= 150
    assert s["spark"][-1]["v"] == s["now"]
    assert 0 <= s["range10y"]["pct"] <= 100


def test_downsample_keeps_last():
    dates = [dt.date(2020, 1, 1) + dt.timedelta(days=i) for i in range(1000)]
    vals = [float(i) for i in range(1000)]
    out = downsample(dates, vals, target=150)
    assert len(out) == 150
    assert out[-1] == (dates[-1], vals[-1])
