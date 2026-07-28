import datetime as dt
from pathlib import Path

import pytest

from app.dataset import DISPLAY_TENORS, QUOTED_NODES, load_dataset, tenor_years
from app.derive import (
    ANNUAL_OBS,
    annual_stats,
    apply_level_extreme,
    apply_solo_direction,
    basis_dates,
    classify_one_liner,
    curve_banner,
    day_move_pct,
    derived_ids,
    downsample_triples,
    ohlc_buckets,
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
    assert 0 <= s["range1y"]["pct"] <= 100


def test_summary_row_carries_no_history(ds):
    """Stage 1 is one screen of numbers per row, nothing per-row that is a
    SERIES. A 150-point `spark` line used to ride along on all 50 rows and no
    component read it — 92.3% of the payload, discarded on arrival (Pass E,
    docs/diagnostics/perf-baseline.md). History belongs to /api/series.

    Written as a shape assertion rather than `"spark" not in s` so that
    reintroducing the same mistake under a different name also fails."""
    b = basis_dates(ds)
    s = summarize(ds, "10Y", "IRS 10Y", "outright", b)
    for key, value in s.items():
        if key == "sortKey":  # a couple of leg-year floats, not a series
            continue
        assert not (isinstance(value, list) and len(value) > 8), (
            f"stage-1 row field {key!r} carries {len(value)} points — "
            "per-row history belongs to /api/series, not the summary"
        )


def test_annual_stats_use_only_the_trailing_year():
    """Level statistics are 52-week (annual-stats session): a decade of history
    with a regime break must not leak into min/max/avg/pct. Values ramp
    0..599; only the last ANNUAL_OBS observations count."""
    values = [float(i) for i in range(600)]
    s = annual_stats(values)
    lo = 600 - ANNUAL_OBS
    assert s["min"] == float(lo)
    assert s["max"] == 599.0
    assert s["avg"] == round(sum(range(lo, 600)) / ANNUAL_OBS, 4)
    # today's level is the max of its trailing year → top percentile
    assert s["pct"] == round((ANNUAL_OBS - 1) / ANNUAL_OBS * 100, 1)
    # None-tolerant and None-filled when empty
    assert annual_stats([None, None]) == {
        "min": None, "max": None, "avg": None, "pct": None,
    }


def test_move_pct_stays_on_the_full_history():
    """THE distinction of the annual-stats session: CHANGE percentiles keep the
    FULL history (changes are stationary; the longer window estimates better).
    Construct a series whose early changes are large and recent ones tiny —
    a full-history percentile of a tiny move is LOW, a trailing-year one would
    be ~median. Guard the full-history behaviour."""
    early = [0.0]
    for i in range(300):  # 300 big early changes (±10bp)
        early.append(early[-1] + (0.10 if i % 2 == 0 else -0.10))
    late = [early[-1]]
    for i in range(ANNUAL_OBS):  # a trailing year of tiny changes (±0.1bp)
        late.append(late[-1] + (0.001 if i % 2 == 0 else -0.001))
    values = early + late[1:]
    pct = day_move_pct(values, 100.0, 0.1)  # today's move: tiny (0.1bp)
    assert pct is not None
    # against the FULL history most changes (the 300 big ones) exceed it
    assert pct < 60.0, "day_move_pct must not narrow to the annual window"


def test_downsample_keeps_last():
    # `downsample()` over (date, value) pairs went with the spark field; this
    # is the surviving decimator, the one that thins the preview line.
    points = [{"t": f"d{i}", "v": float(i), "d": 1.0} for i in range(1000)]
    out = downsample_triples(points, target=150)
    assert len(out) == 150
    assert out[-1] is points[-1]


# ── §16 computation boundary: the numbers the browser used to compute ──────────

def test_summarize_carries_sort_key_quoted_and_classification(ds):
    b = basis_dates(ds)
    o = summarize(ds, "10Y", "IRS 10Y", "outright", b)
    assert o["sortKey"] == [10.0]
    assert o["quoted"] is True
    assert o["oneLiner"]["kind"] in {
        "move_extreme", "extreme", "solo_up", "solo_down", "none"
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


def test_classify_one_liner_rung1_move():
    assert classify_one_liner(50, has_data=False) == {"kind": "none", "value": None}
    # rung 1: today's move in the top 3% of the series' own daily moves
    assert classify_one_liner(98, True) == {"kind": "move_extreme", "value": 2}
    assert classify_one_liner(97, True) == {"kind": "move_extreme", "value": 3}
    # an ordinary move → nothing (level/solo rungs are the caller's job)
    assert classify_one_liner(90, True) == {"kind": "none", "value": None}
    assert classify_one_liner(None, True) == {"kind": "none", "value": None}


def test_apply_level_extreme_caps_and_picks_the_most_extreme():
    def row(pct, kind="none"):
        return {"range1y": {"pct": pct}, "oneLiner": {"kind": kind, "value": None}}

    rows = [row(100), row(99), row(98), row(97), row(96), row(50)]
    apply_level_extreme(rows, cap=3)
    spoke = [r for r in rows if r["oneLiner"]["kind"] == "extreme"]
    assert len(spoke) == 3  # capped on a synchronised-regime peer group
    assert {r["oneLiner"]["value"] for r in spoke} == {100, 99, 98}
    assert rows[5]["oneLiner"]["kind"] == "none"  # a mid-range level stays quiet


def test_apply_level_extreme_leaves_higher_rungs_and_uses_both_bands():
    def row(pct, kind="none"):
        return {"range1y": {"pct": pct}, "oneLiner": {"kind": kind, "value": None}}

    rows = [row(100, kind="move_extreme"), row(99), row(2)]
    apply_level_extreme(rows, cap=3)
    assert rows[0]["oneLiner"]["kind"] == "move_extreme"  # rung 1 kept
    assert rows[1]["oneLiner"]["kind"] == "extreme"  # top band
    assert rows[2]["oneLiner"]["kind"] == "extreme"  # bottom band


def test_curve_banner_fires_only_on_a_whole_curve_extreme():
    def outs(pcts):
        return [{"range1y": {"pct": p}} for p in pcts]

    # most of the curve at highs → curve_high
    assert curve_banner(outs([99, 98, 97, 96, 95, 50]))["kind"] == "curve_high"
    # most at lows → curve_low
    assert curve_banner(outs([1, 2, 3, 4, 5, 60]))["kind"] == "curve_low"
    # only a couple extreme (distinctive, not a regime) → no banner
    assert curve_banner(outs([99, 98, 50, 40, 30, 20]))["kind"] is None
    assert curve_banner([])["kind"] is None


def test_apply_solo_direction_marks_the_lone_mover():
    def row(d1, kind="none"):
        return {"deltas": {"d1": d1}, "oneLiner": {"kind": kind, "value": None}}

    # majority up; the one that fell (and is still silent) is a solo down
    rows = [row(5.0), row(4.0), row(3.0), row(-2.0)]
    apply_solo_direction(rows)
    assert rows[3]["oneLiner"]["kind"] == "solo_down"
    assert all(r["oneLiner"]["kind"] == "none" for r in rows[:3])
    # a row that already fired a higher rung is left alone
    rows2 = [row(5.0), row(5.0), row(-3.0, kind="extreme")]
    apply_solo_direction(rows2)
    assert rows2[2]["oneLiner"]["kind"] == "extreme"


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


def test_d_is_a_true_one_observation_change_after_downsample():
    # §F: `d` must be the change vs the PREVIOUS OBSERVATION, never a multi-day
    # change wearing a daily label — even when the preview downsamples the line
    # (d is computed on the full series before thinning, and each surviving
    # point keeps its own d). Distinct increments so a multi-step change differs.
    pairs = [(f"2020-{1 + i // 28:02d}-{1 + i % 28:02d}", float(i * i))
             for i in range(600)]
    full = series_history(pairs, "%", "full")["points"]
    prev = series_history(pairs, "%", "preview")["points"]
    assert len(prev) == 150 and len(full) == 600
    by_date = {t: i for i, (t, _v) in enumerate(pairs)}
    for pt in prev:
        idx = by_date[pt["t"]]
        if idx == 0:
            assert pt["d"] is None
            continue
        true_one_obs = round((pairs[idx][1] - pairs[idx - 1][1]) * 100, 2)
        assert pt["d"] == true_one_obs, (pt["t"], pt["d"], true_one_obs)


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


def test_ohlc_monthly_open_high_low_close():
    pairs = [
        ("2020-01-02", 1.0), ("2020-01-15", 3.0), ("2020-01-31", 2.0),  # Jan
        ("2020-02-03", 2.5), ("2020-02-20", 0.5),                       # Feb
    ]
    bars = ohlc_buckets(pairs, "m")
    assert len(bars) == 2
    jan = bars[0]
    assert (jan["o"], jan["h"], jan["l"], jan["c"]) == (1.0, 3.0, 1.0, 2.0)
    assert jan["t"] == "2020-01-31"  # bar dated at the last close in the period
    feb = bars[1]
    assert (feb["o"], feb["h"], feb["l"], feb["c"]) == (2.5, 2.5, 0.5, 0.5)


def test_ohlc_weekly_buckets_by_iso_week():
    # Mon 2020-01-06 .. Fri 2020-01-10 is one ISO week; the next Monday starts a
    # new one.
    pairs = [
        ("2020-01-06", 1.0), ("2020-01-08", 4.0), ("2020-01-10", 2.0),
        ("2020-01-13", 5.0),
    ]
    bars = ohlc_buckets(pairs, "w")
    assert len(bars) == 2
    assert (bars[0]["o"], bars[0]["h"], bars[0]["l"], bars[0]["c"]) == (1.0, 4.0, 1.0, 2.0)
    assert bars[1]["o"] == 5.0


def test_series_history_empty_is_null_safe():
    h = series_history([], "%", "preview")
    assert h["stats"] is None
    assert h["points"] == [] and h["calendar"] == []
