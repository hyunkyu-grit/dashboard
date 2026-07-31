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

from app.backtest import BacktestError, Position, run_backtest, trace
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


def one(ds, series_id, direction, notional, entry, exit_=None):
    """A single-position book — most of these tests are about one trade, and
    the book is just a sum over them. Returns the position's own record merged
    with the book's series, so the assertions read as they did when the API
    took one position."""
    book = run_backtest(
        ds, [Position(series_id, direction, notional, entry, exit_)]
    )
    return {**book["positions"][0], "points": book["points"],
            "maxProfit": book["maxProfit"], "maxLoss": book["maxLoss"]}


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
    r = one(ds, "10Y", +1, N, dt.date(2026, 1, 2), None)
    assert r["points"][0]["pnl"] == 0.0
    # struck at that day's own par, so the NPV it starts from is ~0 too
    path = trace(ds, Position("10Y", +1, N, dt.date(2026, 1, 2)))
    assert abs(path[0]["npv"]) / N < 1e-3
    assert path[0]["pnl"] == 0.0


def test_a_payer_makes_money_when_rates_rose(ds):
    """2026-01-02 → 2026-07-30, the 10Y went 3.2850% → 4.1500%."""
    r = one(ds, "10Y", +1, N, dt.date(2026, 1, 2), None)
    assert r["exitValue"] > r["entryValue"]
    assert r["pnl"] > 0
    # and the other side of the same trade is the mirror image
    rec = one(ds, "10Y", -1, N, dt.date(2026, 1, 2), None)
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
        r = one(ds, "10Y", +1, N, entry)
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
    recent = one(ds, "10Y", +1, N, dt.date(2026, 1, 2), None)
    old = one(ds, "10Y", +1, N, dt.date(2020, 1, 2), None)
    assert recent["cash"] < 0
    assert old["cash"] > 0


def test_no_look_ahead_in_the_curve_or_the_fixings(ds):
    """A backtest that peeks is worse than no backtest. Truncating the dataset
    at the exit date must not change a single point of the run — if any date's
    valuation reached forward, it would."""
    exit_d = dt.date(2026, 3, 31)
    full = one(ds, "10Y", +1, N, dt.date(2026, 1, 2), exit_d)

    cut = len([d for d in ds.dates if d <= exit_d])
    truncated = load_dataset(DATA)
    truncated.dates = truncated.dates[:cut]
    truncated.series = {k: v[:cut] for k, v in truncated.series.items()}
    partial = one(truncated, "10Y", +1, N, dt.date(2026, 1, 2), exit_d)

    assert [p["pnl"] for p in full["points"]] == [p["pnl"] for p in partial["points"]]


def test_a_spread_is_weighted_dv01_neutral_at_entry(ds):
    """3s10s: the long leg carries the stated notional and the short leg is
    scaled so the two DV01s match. That weighting is what makes the quoted
    spread the P&L driver instead of a lopsided outright bet."""
    r = one(ds, "3Y-10Y", +1, N, dt.date(2026, 1, 2), None)
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
    r = one(ds, "3Y-10Y", +1, N, dt.date(2023, 1, 2), None)
    assert r["exitValue"] > r["entryValue"]
    assert r["pnl"] > 0


def test_a_dv01_neutral_spread_barely_moves_on_a_parallel_shift(ds):
    """The other half of the weighting's promise, and the sharper test of it.
    Over 2026 the 3Y and 10Y both moved exactly +86.5bp; a DV01-neutral 3s10s
    is by construction insensitive to that, so its P&L must be small against
    what the same notional would have made outright."""
    spread = one(ds, "3Y-10Y", +1, N, dt.date(2026, 1, 2), None)
    outright = one(ds, "10Y", +1, N, dt.date(2026, 1, 2), None)
    assert spread["entryValue"] == spread["exitValue"]  # the parallel window
    assert abs(spread["pnl"]) < abs(outright["pnl"]) * 0.25


def test_a_butterfly_weights_the_belly_against_both_wings(ds):
    r = one(ds, "2Y-5Y-10Y", +1, N, dt.date(2026, 1, 2), None)
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
    r = one(ds, "10Y", +1, N, dt.date(2024, 1, 2), None)
    pts = trace(ds, Position("10Y", +1, N, dt.date(2024, 1, 2)))
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
    r = one(ds, "10Y", +1, N, dt.date(2024, 1, 2), None)
    pts = trace(ds, Position("10Y", +1, N, dt.date(2024, 1, 2)))
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
        one(ds, "nonsense", +1, N, dt.date(2026, 1, 2), None)
    with pytest.raises(BacktestError):
        one(ds, "10Y", 0, N, dt.date(2026, 1, 2), None)
    with pytest.raises(BacktestError):
        one(ds, "10Y", +1, -1.0, dt.date(2026, 1, 2), None)
    with pytest.raises(BacktestError):  # exit before entry
        one(ds, "10Y", +1, N, dt.date(2026, 6, 1), dt.date(2026, 1, 2))
    with pytest.raises(BacktestError):  # entry past the data
        one(ds, "10Y", +1, N, dt.date(2030, 1, 2), None)


# ── the book (multi-position) ────────────────────────────────────────────────


def test_the_book_total_is_the_sum_of_its_positions(ds):
    """The only arithmetic claim the book makes. Every position is sampled on
    the SAME dates for exactly this reason — sampling each on its own grid and
    adding would sum figures from different days, which would look right and be
    wrong."""
    positions = [
        Position("10Y", +1, N, dt.date(2025, 7, 30)),
        Position("3Y-10Y", +1, 5e9, dt.date(2026, 1, 2)),
        Position("2Y", -1, 2e10, dt.date(2026, 3, 2)),
    ]
    book = run_backtest(ds, positions)
    assert len(book["positions"]) == 3
    total = sum(p["pnl"] for p in book["positions"])
    # The book rounds the SUM; each position rounds its OWN figure. Those
    # cannot both be exact, so they may differ by up to half a won per
    # position — which on hundreds of millions is not a number anyone will
    # ever see, but is not zero either and the test must not pretend it is.
    assert abs(book["pnl"] - total) <= len(positions)


def test_a_position_contributes_nothing_before_its_entry(ds):
    """Adding a position that starts later must not change the book on any date
    before it starts. Otherwise the book pays out money the desk had not put on
    yet."""
    early = Position("10Y", +1, N, dt.date(2025, 7, 30))
    late = Position("2Y", +1, N, dt.date(2026, 5, 4))
    alone = run_backtest(ds, [early])
    both = run_backtest(ds, [early, late])
    a = {p["t"]: p["pnl"] for p in alone["points"]}
    for p in both["points"]:
        if p["t"] < both["positions"][1]["entry"] and p["t"] in a:
            assert p["pnl"] == a[p["t"]], p["t"]


def test_a_closed_position_freezes_and_keeps_counting(ds):
    """THE book rule. After its exit a position stops responding to the market
    but its realised P&L stays in the total — money that was made does not
    un-make itself, and a position that kept marking after it was closed is the
    classic way a backtest flatters itself."""
    closed = Position("10Y", +1, N, dt.date(2025, 7, 30), dt.date(2026, 3, 2))
    other = Position("2Y", +1, N, dt.date(2025, 7, 30))
    book = run_backtest(ds, [closed, other])
    rec = book["positions"][0]
    assert rec["closed"] is True
    assert rec["exit"] == "2026-03-02"

    # the same trade run alone ends at the same figure
    solo = run_backtest(ds, [closed])
    assert solo["positions"][0]["pnl"] == rec["pnl"]
    # and after the exit the book moves only by the OTHER position
    only_other = run_backtest(ds, [other])
    o = {p["t"]: p["pnl"] for p in only_other["points"]}
    tail = [p for p in book["points"] if p["t"] > rec["exit"] and p["t"] in o]
    assert len(tail) >= 5
    for p in tail:
        # two positions rounded independently — see the note above
        assert abs((p["pnl"] - o[p["t"]]) - rec["pnl"]) <= 2


def test_the_book_window_spans_every_position(ds):
    book = run_backtest(
        ds,
        [
            Position("10Y", +1, N, dt.date(2024, 6, 3), dt.date(2025, 6, 2)),
            Position("2Y", +1, N, dt.date(2026, 1, 2)),
        ],
    )
    assert book["from"] == "2024-06-03"
    assert book["to"] == ds.dates[-1].isoformat()


def test_opposite_positions_in_one_book_cancel(ds):
    """Same instrument, same size, same dates, opposite sides: the book is flat
    at every point. Nothing else in this file checks that the sum is signed
    correctly across positions."""
    book = run_backtest(
        ds,
        [
            Position("10Y", +1, N, dt.date(2026, 1, 2)),
            Position("10Y", -1, N, dt.date(2026, 1, 2)),
        ],
    )
    assert max(abs(p["pnl"]) for p in book["points"]) < N * 1e-6


def test_an_empty_or_oversized_book_is_refused(ds):
    with pytest.raises(BacktestError):
        run_backtest(ds, [])
    with pytest.raises(BacktestError):
        run_backtest(
            ds, [Position("10Y", +1, N, dt.date(2026, 1, 2))] * 13
        )
