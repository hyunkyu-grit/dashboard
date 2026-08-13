"""Numerical validation of the bootstrapped curve (final session Pass A1).

Permanent gates, not a one-off script. The honest headline (see
docs/diagnostics/curve-validation.md): the curve's DERIVED quantities are
algebraically exact (forward-annuity identity to 1e-17), but the single-pass
sequential bootstrap does NOT reprice its own par INPUTS to 1e-8 for swap
tenors — a ≤0.25bp residual, exact only at the 1D/3M money-market anchors,
growing with tenor, from the CD91 3M node at 0.2493y (vs the 0.25y payment grid)
and sub-annual cashflows interpolated between sparse nodes. That residual lives
in frozen ported code (`engine_port.bootstrap_zero_curve`) and is xfailed here,
documented, never tolerance-fudged.
"""

from pathlib import Path

import pytest

from app.curves import par_rates_at, par_rates_at_index
from app.dataset import DISPLAY_TENORS, load_dataset
from app.derive import series_values, summarize, basis_dates
from app.engine_port import bootstrap_zero_curve, df

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"
SHORT = 0.25 * 1.04  # bootstrap's short/simple threshold


@pytest.fixture(scope="module")
def ds():
    return load_dataset(DATA)


def annuity(s: float, e: float, zc) -> float:
    n = round((e - s) * 4)
    return 0.25 * sum(df(s + 0.25 * (i + 1), zc) for i in range(n))


def reprice_par(tenor: float, zc) -> float:
    """Reprice a par swap to `tenor` off the curve, using the public df() — the
    same discount function the displayed forwards/DV01 use, and the same
    backward-quarterly schedule (stub first) the bootstrap builds."""
    if tenor <= SHORT + 1e-9:
        return (1.0 / df(tenor, zc) - 1.0) / tenor
    periods = []
    t = tenor
    while t > 0.25 + 1e-9:
        periods.append(t)
        t = round(t - 0.25, 10)
    periods.append(t)
    periods.sort()
    interim = periods[:-1]
    accr = [interim[0]] + [0.25] * (len(interim) - 1) if interim else []
    ann = 0.25 * df(tenor, zc) + sum(a * df(ti, zc) for a, ti in zip(accr, interim))
    return (1.0 - df(tenor, zc)) / ann


# ── round-trip: the anchors are exact; the swaps carry the frozen residual ──

def test_round_trip_money_market_anchors_exact(ds):
    """1D and 3M are single-payment simple-interest instruments and MUST
    round-trip to machine precision — a failure here is a real anchor bug."""
    zc = bootstrap_zero_curve(par_rates_at(ds, ds.asof))
    for tenor, c in par_rates_at(ds, ds.asof):
        if tenor <= SHORT + 1e-9:
            assert abs(reprice_par(tenor, zc) - c) < 1e-8, (tenor, c)


@pytest.mark.xfail(
    strict=True,
    reason="ACCEPTED LIMITATION (owner decision), not a defect. Swap tenors do "
    "not reprice their own par inputs to 1e-8: a ≤0.25bp residual, exact at "
    "1D/3M, from a single-pass sparse-node bootstrap + the CD91 node at "
    "0.2493y. The owner accepted it and chose NOT to re-port the frozen "
    "engine. This xfail documents the accepted limitation; it stays strict so a "
    "future iterated re-port (which would make it xpass) is noticed. See "
    "docs/CONVENTIONS.md and docs/diagnostics/curve-validation.md.",
)
def test_round_trip_swap_tenors_to_1e8(ds):
    zc = bootstrap_zero_curve(par_rates_at(ds, ds.asof))
    for tenor, c in par_rates_at(ds, ds.asof):
        if tenor > SHORT + 1e-9:
            assert abs(reprice_par(tenor, zc) - c) < 1e-8, (tenor, c)


def test_round_trip_residual_is_bounded_and_no_gross_error(ds):
    """The residual is small and explained — assert it stays under 0.5bp so a
    genuine convention error (day count / compounding — those would be bp-scale)
    would still trip this even while the sub-0.25bp artefact is tolerated."""
    zc = bootstrap_zero_curve(par_rates_at(ds, ds.asof))
    worst = max(
        abs(reprice_par(t, zc) - c) for t, c in par_rates_at(ds, ds.asof)
    )
    assert worst < 0.5e-4, f"round-trip residual {worst * 1e4:.3f}bp exceeds 0.5bp"


# ── the derived quantities ARE self-consistent ─────────────────────────────

def test_forward_annuity_identity_exact(ds):
    """par(0,e)·A(0,e) == par(0,s)·A(0,s) + fwdpar(s,e)·A(s,e), in DF space —
    exact by construction, so every forward/spread/fly/DV01 off the curve is
    consistent with the curve. Checked across a start × tenor grid."""
    zc = bootstrap_zero_curve(par_rates_at(ds, ds.asof))
    starts = [0.5, 1.0, 1.5, 2.0, 3.0, 5.0]
    tenors = [0.5, 1.0, 2.0, 3.0, 5.0]
    for s in starts:
        for tt in tenors:
            e = s + tt
            par0e = (df(0, zc) - df(e, zc)) / annuity(0, e, zc)
            par0s = (df(0, zc) - df(s, zc)) / annuity(0, s, zc)
            fwd = (df(s, zc) - df(e, zc)) / annuity(s, e, zc)
            lhs = par0e * annuity(0, e, zc)
            rhs = par0s * annuity(0, s, zc) + fwd * annuity(s, e, zc)
            assert abs(lhs - rhs) < 1e-10, (s, e, lhs - rhs)


def test_discount_factors_strictly_decreasing_and_bounded(ds):
    zc = bootstrap_zero_curve(par_rates_at(ds, ds.asof))
    prev = 1.0
    t = 0.02
    while t <= 10.0:
        d = df(t, zc)
        assert 0.0 < d <= 1.0, (t, d)
        assert d < prev + 1e-12, f"DF not decreasing at {t}: {d} !< {prev}"
        prev = d
        t += 0.02


def test_derived_series_agree_with_the_outright_summary(ds):
    """Recompute every spread/fly from the outright summary levels and assert
    it equals the derive.py series — trivially true if the wiring is right,
    which is the point."""
    b = basis_dates(ds)
    now = {
        t: summarize(ds, t, t, "outright", b)["now"] for t in DISPLAY_TENORS
    }
    for a, c in ((x, y) for x in DISPLAY_TENORS for y in DISPLAY_TENORS if x < y):
        sid = f"{a}-{c}"
        expect = round((now[c] - now[a]) * 100, 4)
        got = round(series_values(ds, sid)[-1], 4)
        assert got == pytest.approx(expect, abs=1e-4), sid
    for legs in (("1Y", "2Y", "10Y"), ("1Y", "3Y", "5Y"), ("2Y", "3Y", "5Y")):
        a, belly, c = legs
        sid = f"{a}-{belly}-{c}"
        expect = round((2 * now[belly] - now[a] - now[c]) * 100, 4)
        got = round(series_values(ds, sid)[-1], 4)
        assert got == pytest.approx(expect, abs=1e-4), sid


# ── replay across history, deliberately over calendar edges ─────────────────

def test_replay_no_calendar_blowup(ds):
    """Bootstrap + round-trip on scattered past dates incl year-ends / 설 /
    추석. Calendar edges are where this class of engine breaks. Asserts DFs
    stay well-behaved and the round-trip residual never explodes (a broken
    holiday roll would produce a gross error, not a 0.2bp one)."""
    n = len(ds.dates)
    # scatter + force calendar-edge months (Dec/Jan/Feb/Sep/Oct)
    idxs = set(range(0, n, max(1, n // 200)))
    for i, d in enumerate(ds.dates):
        if d.month in (12, 1, 2, 9, 10):
            idxs.add(i)
    checked = 0
    for i in sorted(idxs):
        pars = par_rates_at_index(ds, i)
        if len(pars) < 2:
            continue
        zc = bootstrap_zero_curve(pars)
        # DFs monotone at the node tenors
        prev = 1.0
        for t, _r in pars:
            d = df(t, zc)
            assert 0 < d <= 1.0 and d < prev + 1e-9, (ds.dates[i], t, d)
            prev = d
        worst = max(abs(reprice_par(t, zc) - c) for t, c in pars)
        assert worst < 1.0e-4, f"{ds.dates[i]}: round-trip {worst*1e4:.2f}bp > 1bp"
        checked += 1
    assert checked >= 200


def test_dataset_within_ported_holiday_range(ds):
    """The ported calendar is 2016–2035; no dataset date may fall outside it."""
    assert ds.dates[0].year >= 2016 and ds.dates[-1].year <= 2035
