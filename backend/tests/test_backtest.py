"""The backtest: enter on a past date, revalue every day since.

The tests that matter here are the ones about the HISTORICAL path. A swap
struck at today's par and valued on today's curve is worth ~0 almost by
identity (test_valuation_port covers it), and it says nothing about whether
revaluing across time works. These do.

The load-bearing one is `test_matches_dv01_on_a_pure_parallel_shift`: with time
held still and the whole curve moved together, full revaluation and
Δbp × DV01 × notional must agree to a rounding error. It is the only check here
that isolates the valuation from carry, roll-down and curve shape all at once,
so it is the one that fails loudly if the engine is miswired.

Everything else asserts that the DIFFERENCE between the two behaves — that it
grows with the horizon, carries the right sign, and is made of the things it
should be made of.
"""

import datetime as dt
from pathlib import Path

import pytest

from app.backtest import BacktestError, run_backtest
from app.curves import par_rates_at_index
from app.dataset import load_dataset
from app.dv01 import pv01
from app.engine_port import bootstrap_zero_curve
from app.valuation_port import (
    CurveBundle,
    VanillaSwap,
    select_fixing,
    value_booked_trade,
)

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"
N = 1e10  # 100억


@pytest.fixture(scope="module")
def ds():
    return load_dataset(DATA)


def test_matches_dv01_on_a_pure_parallel_shift(ds):
    """THE check. Same valuation date, whole curve shifted together: no carry,
    no roll-down, no curve-shape effect. Revaluation must equal Δbp × DV01 to
    within convexity, which at 1bp is nothing.

    Measured: −0.05% at 1bp, −4.60% at 100bp. The sign is not incidental — a
    payer's gain DECELERATES as rates rise because its own DV01 falls, so the
    approximation must overstate, never understate. A positive difference here
    would mean the direction or the discounting is inverted.
    """
    i = len(ds.dates) - 1
    d = ds.dates[i]
    par = ds.latest("10Y") / 100.0
    quotes = par_rates_at_index(ds, i)
    swap = VanillaSwap(10, N, par, pay_fixed=True, trade_date=d)

    zc0 = bootstrap_zero_curve(quotes)
    npv0 = value_booked_trade(swap, CurveBundle(d, zc0, []), None).dirty_npv
    dv01 = pv01(zc0, 10.0) * N * 1e-4

    def reval(bp):
        zc = bootstrap_zero_curve([(t, r + bp * 1e-4) for t, r in quotes])
        return value_booked_trade(swap, CurveBundle(d, zc, []), None).dirty_npv - npv0

    assert abs(reval(1) - dv01) / dv01 < 0.002          # 1bp: exact to 0.2%
    assert abs(reval(10) - 10 * dv01) / (10 * dv01) < 0.01
    # convexity, with the sign a payer must have
    for bp in (25, 50, 100):
        assert reval(bp) < bp * dv01
    assert abs(reval(100) - 100 * dv01) / (100 * dv01) < 0.08


def test_the_position_is_worth_nothing_on_its_entry_date(ds):
    r = run_backtest(ds, "10Y", +1, N, dt.date(2026, 1, 2), None)
    assert r["points"][0]["pnl"] == 0.0
    # struck at that day's own par, so the NPV it starts from is ~0 too
    assert abs(r["points"][0]["npv"]) / N < 1e-3


def test_a_payer_makes_money_when_rates_rose(ds):
    """2026-01-02 → 2026-07-30, the 10Y went 3.2850% → 4.1500%."""
    r = run_backtest(ds, "10Y", +1, N, dt.date(2026, 1, 2), None)
    assert r["exitValue"] > r["entryValue"]
    assert r["pnl"] > 0
    # and the other side of the same trade is the mirror image
    rec = run_backtest(ds, "10Y", -1, N, dt.date(2026, 1, 2), None)
    assert rec["pnl"] < 0
    assert abs(rec["pnl"] + r["pnl"]) < abs(r["pnl"]) * 0.02


def test_the_gap_from_the_dv01_approximation_grows_with_the_horizon(ds):
    """Roll-down and DV01 decay, which is the whole reason for revaluing rather
    than multiplying. A 10Y entered 6.6 years ago is a 3.4Y today and its DV01
    is a fraction of the entry figure, so the entry-DV01 approximation
    overstates by more the longer the position is held.

    Measured: −4.9% over 7 days, −12.7% over 209, −43.1% over 2401.
    """
    def gap(entry):
        r = run_backtest(ds, "10Y", +1, N, entry, None)
        d_bp = (r["exitValue"] - r["entryValue"]) * 100
        approx = d_bp * r["legs"][0]["dv01"] * N * 1e-4
        return (r["pnl"] - approx) / abs(approx)

    short = gap(dt.date(2026, 7, 23))
    mid = gap(dt.date(2026, 1, 2))
    long = gap(dt.date(2020, 1, 2))
    assert short > mid > long          # increasingly negative
    assert long < -0.20


def test_carry_changes_sign_with_the_regime(ds):
    """Settled cash is real money and must follow the fixed-vs-CD relationship.
    Paying 3.285% fixed from 2026-01 against a ~2.9% CD is negative carry;
    paying 1.3% fixed from 2020 against a CD that rose to 3.5% is strongly
    positive. A carry leg that only ever had one sign would pass every other
    test in this file."""
    recent = run_backtest(ds, "10Y", +1, N, dt.date(2026, 1, 2), None)
    old = run_backtest(ds, "10Y", +1, N, dt.date(2020, 1, 2), None)
    assert recent["points"][-1]["cash"] < 0
    assert old["points"][-1]["cash"] > 0


def test_no_look_ahead_in_the_curve_or_the_fixings(ds):
    """A backtest that peeks is worse than no backtest. Truncating the dataset
    at the exit date must not change a single point of the run — if any date's
    valuation reached forward, it would."""
    exit_d = dt.date(2026, 3, 31)
    full = run_backtest(ds, "10Y", +1, N, dt.date(2026, 1, 2), exit_d)

    cut = len([d for d in ds.dates if d <= exit_d])
    truncated = load_dataset(DATA)
    truncated.dates = truncated.dates[:cut]
    truncated.series = {k: v[:cut] for k, v in truncated.series.items()}
    partial = run_backtest(truncated, "10Y", +1, N, dt.date(2026, 1, 2), exit_d)

    assert [p["pnl"] for p in full["points"]] == [p["pnl"] for p in partial["points"]]


def test_a_spread_is_weighted_dv01_neutral_at_entry(ds):
    """3s10s: the long leg carries the stated notional and the short leg is
    scaled so the two DV01s match. That weighting is what makes the quoted
    spread the P&L driver instead of a lopsided outright bet."""
    r = run_backtest(ds, "3Y-10Y", +1, N, dt.date(2026, 1, 2), None)
    assert len(r["legs"]) == 2
    long_leg, short_leg = r["legs"]
    assert long_leg["tenor"] == "10Y" and long_leg["side"] == "pay"
    assert short_leg["tenor"] == "3Y" and short_leg["side"] == "receive"
    a = long_leg["dv01"] * long_leg["notional"]
    b = short_leg["dv01"] * short_leg["notional"]
    assert abs(a - b) / a < 1e-6


def test_a_steepener_makes_money_when_the_curve_steepened(ds):
    """3s10s went −20.25bp (2023-01-02) → +26.50bp. Long the quoted value is
    the steepener, and it must profit.

    The window is chosen, not incidental: over 2026 the 3Y and the 10Y each
    moved +86.5bp, so the curve shifted perfectly parallel and the spread did
    not change at all. A steepener test over THAT window asserts nothing — it
    was the first version of this test and it failed for the right reason."""
    r = run_backtest(ds, "3Y-10Y", +1, N, dt.date(2023, 1, 2), None)
    assert r["exitValue"] > r["entryValue"]
    assert r["pnl"] > 0


def test_a_dv01_neutral_spread_barely_moves_on_a_parallel_shift(ds):
    """The other half of the weighting's promise, and the sharper test of it.
    Over 2026 the 3Y and 10Y both moved exactly +86.5bp; a DV01-neutral 3s10s
    is by construction insensitive to that, so its P&L must be small against
    what the same notional would have made outright."""
    spread = run_backtest(ds, "3Y-10Y", +1, N, dt.date(2026, 1, 2), None)
    outright = run_backtest(ds, "10Y", +1, N, dt.date(2026, 1, 2), None)
    assert spread["entryValue"] == spread["exitValue"]  # the parallel window
    assert abs(spread["pnl"]) < abs(outright["pnl"]) * 0.25


def test_a_butterfly_weights_the_belly_against_both_wings(ds):
    r = run_backtest(ds, "2Y-5Y-10Y", +1, N, dt.date(2026, 1, 2), None)
    assert len(r["legs"]) == 3
    belly, w1, w2 = r["legs"]
    assert belly["tenor"] == "5Y" and belly["side"] == "pay"
    assert {w1["tenor"], w2["tenor"]} == {"2Y", "10Y"}
    # each wing carries half the belly's DV01
    belly_dv = belly["dv01"] * belly["notional"]
    for w in (w1, w2):
        assert abs(w["dv01"] * w["notional"] - belly_dv / 2) / belly_dv < 1e-6


def test_settled_cash_steps_only_on_payment_dates(ds):
    """The correction is piecewise constant and moves by the net coupon. Cash
    that drifted on ordinary days would mean the window arithmetic in
    `settled_cash_between` is wrong."""
    r = run_backtest(ds, "10Y", +1, N, dt.date(2024, 1, 2), None)
    pts = r["points"]
    swap = VanillaSwap(
        10, N, r["legs"][0]["entryRate"] / 100, True,
        trade_date=dt.date.fromisoformat(r["entry"]),
    )
    pays = {d.isoformat() for d in
            swap.to_irs_trade(dt.date.fromisoformat(r["exit"])).pay_dates}

    moved = 0
    for a, b in zip(pts, pts[1:]):
        crossed = any(a["t"] < pd <= b["t"] for pd in pays)
        if b["cash"] != a["cash"]:
            assert crossed, f"cash moved with no payment date in ({a['t']}, {b['t']}]"
            moved += 1
    assert moved >= 4, "no payment date in the window — test proves nothing"


def test_the_cash_correction_is_the_real_net_coupon(ds):
    """Dirty NPV drops by the net coupon on every payment date, because the
    flow leaves the valuation schedule the moment it is paid. Marking P&L on
    NPV alone would draw a sawtooth that is pure accounting artefact — the desk
    RECEIVED that money — so the published series folds settled cash back in.

    This asserts the correction is the RIGHT SIZE: each cash step must equal
    notional × (fixed − CD fixing) × accrual for the period that just paid.

    Two weaker versions came first and both were wrong. Capping every step
    below the coupon failed on an ordinary 15bp two-day move, which is market
    data doing its job. Comparing crossing steps to ordinary ones failed
    because the NET coupon here is ~9M against typical 20–40M daily moves, so
    it does not stand out — and `pnl = npv − base + cash` is an identity, so no
    comparison of the two series can test anything the arithmetic does not
    already guarantee. Only the MAGNITUDE of the correction is a real claim.
    """
    r = run_backtest(ds, "10Y", +1, N, dt.date(2024, 1, 2), None)
    pts = r["points"]
    entry = dt.date.fromisoformat(r["entry"])
    fixed = r["legs"][0]["entryRate"] / 100

    swap = VanillaSwap(10, N, fixed, True, trade_date=entry)
    trade = swap.to_irs_trade(dt.date.fromisoformat(r["exit"]))
    cd = {d: v / 100 for d, v in zip(ds.dates, ds.series["3M"]) if v is not None}

    checked = 0
    for a, b in zip(pts, pts[1:]):
        step = b["cash"] - a["cash"]
        if step == 0:
            continue
        expected = 0.0
        for i, pay in enumerate(trade.pay_dates):
            if not (a["t"] < pay.isoformat() <= b["t"]):
                continue
            reset = trade.pay_dates[i - 1] if i > 0 else trade.start_date
            res = select_fixing(cd, reset, dt.date.fromisoformat(b["t"]))
            flt = res.rate if res and res.rate is not None else 0.0
            # direction −1 for pay-fixed: pay the fixed leg, receive float
            expected += -1 * N * (fixed - flt) * trade.accruals[i]
        assert expected != 0.0
        assert abs(step - expected) < abs(expected) * 0.01, (a["t"], b["t"], step, expected)
        checked += 1
    assert checked >= 4, "no payment date in the window — test proves nothing"


def test_bad_requests_are_refused(ds):
    with pytest.raises(BacktestError):
        run_backtest(ds, "nonsense", +1, N, dt.date(2026, 1, 2), None)
    with pytest.raises(BacktestError):
        run_backtest(ds, "10Y", 0, N, dt.date(2026, 1, 2), None)
    with pytest.raises(BacktestError):
        run_backtest(ds, "10Y", +1, -1.0, dt.date(2026, 1, 2), None)
    with pytest.raises(BacktestError):  # exit before entry
        run_backtest(ds, "10Y", +1, N, dt.date(2026, 6, 1), dt.date(2026, 1, 2))
    with pytest.raises(BacktestError):  # entry past the data
        run_backtest(ds, "10Y", +1, N, dt.date(2030, 1, 2), None)
