import datetime as dt
from pathlib import Path

import pytest

from app.dataset import DISPLAY_TENORS, QUOTED_NODES, load_dataset, tenor_years
from app.derive import (
    basis_dates,
    classify_one_liner,
    derived_ids,
    downsample,
    series_history,
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


# ── §16 computation boundary: the numbers the browser used to compute ──────────

def test_summarize_carries_sort_key_quoted_and_classification(ds):
    b = basis_dates(ds)
    o = summarize(ds, "10Y", "IRS 10Y", "outright", b)
    assert o["sortKey"] == [10.0]
    assert o["quoted"] is True
    assert o["oneLiner"]["kind"] in {
        "extreme", "retrace_week", "retrace_month", "none"
    }
    sp = summarize(ds, "1Y-10Y", "1Y/10Y", "spread", b)
    assert sp["sortKey"] == [1.0, 10.0]
    assert sp["quoted"] is None  # quoted/interpolated only applies to outrights


def test_sort_key_orders_3m_second_not_last():
    # the 3M-at-the-end bug (§6): CD91/3M must sort just after the overnight.
    order = sorted(["1D", "10Y", "3M", "5Y", "1Y"], key=tenor_years)
    assert order == ["1D", "3M", "1Y", "5Y", "10Y"]
    assert tenor_years("does-not-exist") == float("inf")
    assert "10Y" in QUOTED_NODES and "4Y" not in QUOTED_NODES


def test_classify_one_liner_matches_the_old_client_rule():
    flat = {"d1": None, "wtd": None, "mtd": None, "qtd": None, "ytd": None}
    assert classify_one_liner(50, flat, has_data=False) == {"kind": "none", "value": None}
    assert classify_one_liner(95, flat, True) == {"kind": "extreme", "value": 95}
    assert classify_one_liner(5, flat, True) == {"kind": "extreme", "value": 5}
    # a sign flip d1 vs wtd (both ≥0.5bp) is a weekly retracement
    assert classify_one_liner(
        50, {"d1": 1.0, "wtd": -1.0, "mtd": None, "qtd": None, "ytd": None}, True
    )["kind"] == "retrace_week"
    # d1/wtd same sign, wtd vs mtd flip → monthly
    assert classify_one_liner(
        50, {"d1": 1.0, "wtd": 1.0, "mtd": -1.0, "qtd": None, "ytd": None}, True
    )["kind"] == "retrace_month"
    # sub-0.5bp wiggles never count as a flip
    assert classify_one_liner(
        50, {"d1": 0.2, "wtd": -1.0, "mtd": None, "qtd": None, "ytd": None}, True
    )["kind"] == "none"


def test_series_history_precomputes_deltas_stats_calendar():
    pairs = [
        ("2020-01-01", 1.0), ("2020-01-02", 1.5),
        ("2020-01-03", 1.5), ("2020-01-06", 2.0),
    ]
    h = series_history(pairs, "%", "full")
    assert [p["d"] for p in h["points"]] == [None, 50.0, 0.0, 50.0]  # bp
    assert h["stats"] == {"min": 1.0, "max": 2.0, "avg": 1.5}
    # calendar drops the first (no prior day) and stays at daily resolution
    assert [c["d"] for c in h["calendar"]] == [50.0, 0.0, 50.0]


def test_series_history_bp_unit_does_not_rescale():
    pairs = [("2020-01-01", 10.0), ("2020-01-02", 10.5)]
    h = series_history(pairs, "bp", "full")
    assert h["points"][1]["d"] == 0.5  # bp levels: change is a plain difference


def test_series_history_preview_downsamples_but_keeps_daily_calendar():
    pairs = [(f"2020-{1 + i // 28:02d}-{1 + i % 28:02d}", float(i)) for i in range(600)]
    full = series_history(pairs, "%", "full")
    prev = series_history(pairs, "%", "preview")
    assert len(full["points"]) == 600
    assert len(prev["points"]) == 150
    assert prev["points"][-1]["t"] == pairs[-1][0]  # last point always kept
    # calendar is daily regardless of line resolution: recent 130 changes
    assert len(prev["calendar"]) == 130 == len(full["calendar"])


def test_series_history_empty_is_null_safe():
    h = series_history([], "%", "preview")
    assert h["stats"] is None
    assert h["points"] == [] and h["calendar"] == []
