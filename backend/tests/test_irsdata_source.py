"""The market source is this repo's own `data/irsdata.xlsx` [OWNER, 2026-08-07].

These pin the facts that made the switch safe, and the ones that make it
DIFFERENT. The second half matters more: swapping the input series moved every
priced number by 1.25-3.75bp, and a change that size is only defensible while
it is deliberate. If someone drops `True Data.xlsx` back into data/ these tests
say so, rather than the numbers quietly moving back.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from irs_pricer.config import DATA_DIR
from irs_pricer.loaders import factory
from irs_pricer.loaders.base_rate import XLSX_NAME as BOK_NAME
from irs_pricer.services import funding_basis

BASE = date(2026, 7, 16)


def test_the_data_folder_holds_only_this_repos_own_workbooks():
    """The five that came with the simulation are gone, not merely unread."""
    xlsx = sorted(p.name for p in DATA_DIR.glob("*.xlsx"))
    assert xlsx == ["bokbaserate.xlsx", "irsdata.xlsx"]


def test_the_factory_routes_to_irsdata():
    assert factory._detect_source_type(DATA_DIR) == "irsdata"


def test_irsdata_wins_even_if_true_data_reappears(tmp_path: Path):
    """Precedence, not merely presence.

    A stale `True Data.xlsx` landing back in data/ must not silently take the
    curve back — it is a different series (원화 IRS 종합코드 vs
    IRS KRW (QR VS QR 91D CD91)) and every number would move by the 1.25-3.75bp
    the two differ by, with nothing on screen saying so.
    """
    (tmp_path / "irsdata.xlsx").write_bytes(b"")
    (tmp_path / "True Data.xlsx").write_bytes(b"")
    assert factory._detect_source_type(tmp_path) == "irsdata"


class TestSnapshot:
    @pytest.fixture(scope="class")
    def snap(self):
        return factory.load_market_snapshot(DATA_DIR, BASE)

    def test_the_curve_stops_at_10y(self, snap):
        """The workbook has no long end. The tenor picker mirrors this
        (frontend sim/lib/manual-position.ts::TENORS) — offering 20Y here would
        let a reader build a swap that cannot be bootstrapped."""
        assert max(q.tenor_years for q in snap.swap_quotes) == 10

    def test_the_sub_year_pillars_survive_the_move(self, snap):
        """6M/9M/1.5Y keep tenor_months set. Dropping it stacks them all on
        tenor_years=1, which is how a 6M quote comes to price a 1Y swap — the
        exact defect the backtest hit once."""
        pins = {(q.tenor_years, q.tenor_months) for q in snap.swap_quotes}
        assert (1, 6) in pins and (1, 9) in pins and (2, 18) in pins
        assert (1, None) in pins and (2, None) in pins

    def test_cd_is_the_3m_node(self, snap):
        # dataset.py:121 — "CD 91d average — the spec's 3M node (IRS 3M = CD91)"
        assert snap.cd_rate == pytest.approx(0.029, abs=1e-9)

    def test_the_call_rate_arrives_at_last(self, snap):
        """`on_rate` was ALWAYS None from True Data (see MarketSnapshot's own
        comment). This workbook carries the 1D column, so the curve gains an
        O/N pillar it never had — one of the two ways the new source is better,
        and a reason the numbers differ beyond the series change alone."""
        assert snap.on_rate is not None
        # 0.02561 → 0.02556 (2026-08-19): the workbook is a LIVE file — the
        # frozen 08-13 snapshot v2 was born with got replaced by v1's daily
        # bake, whose intraday revision moved this pillar 0.5bp. Same rule as
        # test_the_series_really_is_the_composite_one: refresh → update the
        # number; a re-routed loader would move 3Y too, and it did not.
        assert snap.on_rate == pytest.approx(0.02556, abs=1e-9)

    def test_the_series_really_is_the_composite_one(self, snap):
        """3Y = 3.9225%, not True Data's 3.8875%.

        This is the whole 3.5bp, written down. It is not a tolerance to widen:
        if this value moves, either the workbook was refreshed (fine, update the
        number) or something re-routed the loader (not fine).
        """
        three_y = next(
            q.rate for q in snap.swap_quotes if q.tenor_years == 3 and q.tenor_months is None
        )
        assert three_y == pytest.approx(0.039225, abs=1e-9)


def test_fixings_are_cd_and_start_in_2016():
    """Shorter history than True Data's 2010 start is a real consequence: a swap
    that began before 2016 has no fixing for its current period. swap_inputs
    leaves currentFloatRate unresolved and logs it — it does not invent one.

    2016-01-18, not the workbook's first row (2016-01-04): the 3M column is
    blank for its first ten rows, which `load_dataset` warns about on every
    load. Those blanks are DROPPED rather than carried as zeros — a zero here
    would read as a valid 0% reset and price a whole quarter's floating leg at
    nothing.
    """
    fx = factory.load_fixing_history(DATA_DIR)
    # 01-18 → 01-19 (2026-08-19): the refreshed workbook (v1's daily bake)
    # blanks one more leading 3M row, so the first non-blank fixing moved a
    # day. The property under test — leading blanks DROPPED, never zeros —
    # is the assertion below it and is unchanged.
    assert min(fx) == date(2016, 1, 19)
    assert fx[BASE] == pytest.approx(0.029, abs=1e-9)
    assert all(v > 0 for v in fx.values())


def test_available_dates_are_priceable_dates():
    """Every date offered must actually price. Returning the workbook's whole
    date list would put days in the picker that raise NonBusinessDayError on
    the way to a curve."""
    dates = factory.list_available_dates(DATA_DIR)
    assert BASE in dates
    for d in (dates[0], dates[len(dates) // 2], dates[-1]):
        snap = factory.load_market_snapshot(DATA_DIR, d)
        assert snap.cd_rate > 0
        assert snap.swap_quotes


def test_the_bok_series_is_still_the_historical_staircase():
    """`bokbaserate.xlsx` and the deleted `BOK Base Rate.xlsx` are the same bytes
    (md5 2cab5907…), so nothing about funding should have changed. It did, for
    one commit: this loader still looked for the deleted NAME, `all_rates()`
    returned {} — which is a legitimate state, not an error — and funding
    silently flattened from the historical staircase to the policy constant.

    2021-11-24 is the pin because it is far from the constant: 0.75% then,
    2.75% now. A flat-constant regression fails here by 200bp, not by a
    rounding.
    """
    assert BOK_NAME == "bokbaserate.xlsx"
    assert funding_basis.base_rate_at(date(2021, 11, 24)) == pytest.approx(0.0075, abs=1e-12)
    assert funding_basis.base_rate_at(date(2021, 11, 25)) == pytest.approx(0.0100, abs=1e-12)
