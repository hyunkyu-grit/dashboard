"""Long-format ladder: ordering, aggregation, and the round-trip identity.

The full-book equivalence proof lives in `research/ladder/equivalence.py`
because it needs the live 민평 matrix. These tests pin the properties that
must hold regardless of data, so a future edit to `longform.py` cannot quietly
change them.

Synthetic values here are permitted: this file is under `tests/` and the
numbers are ladder *arithmetic* fixtures, not market data. Nothing here is
shown to anyone.
"""

from __future__ import annotations

import pytest

from research.ladder.longform import (
    aggregate,
    extra_buckets,
    from_wide,
    sort_tenors,
    tenor_days,
    to_wide,
)


# ── ordering: the property the string-keyed dict does not have ──────────────


def test_tenor_days_orders_18m_between_1y_and_2y():
    assert tenor_days("1Y") < tenor_days("18M") < tenor_days("2Y")


def test_tenor_days_beats_string_sort_on_the_real_grids():
    """The union of this repo's three tenor grids, sorted both ways."""
    labels = ["1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "2.5Y", "3Y",
              "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y", "20Y", "30Y"]
    assert sort_tenors(labels) == labels
    # string sort puts 10Y before 1D and 3M after 2Y
    assert sorted(labels) != labels
    assert sorted(labels).index("10Y") < sorted(labels).index("1D")


def test_unparseable_label_raises_rather_than_sorting_arbitrarily():
    """A silently mis-ordered bucket is the defect this replaces, so an
    unknown label must be loud."""
    with pytest.raises(ValueError):
        tenor_days("front")


@pytest.mark.parametrize("label,days", [
    ("1D", 1.0), ("3M", 90.0), ("18M", 540.0), ("1.5Y", 547.5),
    ("1Y", 365.0), ("10Y", 3650.0), ("30Y", 10950.0),
])
def test_tenor_days_values(label, days):
    assert tenor_days(label) == days


# ── round trip ──────────────────────────────────────────────────────────────


def test_round_trip_is_exact_including_zero_buckets():
    wide = {"3M": 1.5, "1Y": -2.25, "2Y": 0.0, "10Y": 1e9}
    df = from_wide(wide, instrument="x", curve="c")
    assert to_wide(df, list(wide)) == wide


def test_zero_and_absent_are_different_facts():
    """In the wide form a zero and a missing bucket are indistinguishable.
    The long form keeps the distinction, which is what makes the equivalence
    proof able to reproduce the wide grid exactly."""
    df = from_wide({"3M": 0.0, "1Y": 5.0}, instrument="x", curve="c")
    assert set(df["tenor_label"]) == {"3M", "1Y"}
    assert extra_buckets(df, ["1Y"]) == ["3M"]


# ── aggregation across differing grids ──────────────────────────────────────


def test_two_instruments_on_different_grids_add_without_alignment_code():
    a = from_wide({"1Y": 10.0, "2Y": 20.0}, instrument="a", curve="c")
    b = from_wide({"2Y": 5.0, "2.5Y": 7.0, "30Y": 1.0}, instrument="b", curve="c")
    out = to_wide(aggregate([a, b]))
    assert out == {"1Y": 10.0, "2Y": 25.0, "2.5Y": 7.0, "30Y": 1.0}
    assert list(out) == ["1Y", "2Y", "2.5Y", "30Y"]  # ordered by days


def test_wide_grid_would_have_dropped_the_extra_buckets():
    """States the cost of the wide representation in the same test that shows
    the long one handling it."""
    a_labels = ["1Y", "2Y"]
    b = from_wide({"2Y": 5.0, "2.5Y": 7.0, "30Y": 1.0}, instrument="b", curve="c")
    assert extra_buckets(b, a_labels) == ["2.5Y", "30Y"]


def test_aggregate_of_nothing_is_an_empty_frame_not_a_crash():
    assert len(aggregate([])) == 0


def test_long_and_short_net_to_zero_exactly():
    a = from_wide({"5Y": 1234.5}, instrument="long", curve="c")
    b = from_wide({"5Y": -1234.5}, instrument="short", curve="c")
    assert to_wide(aggregate([a, b])) == {"5Y": 0.0}


def test_instrument_dimension_survives_aggregation():
    """Netting to a curve view is a separate step; the per-instrument rows
    must still be there, or the ladder cannot be attributed."""
    a = from_wide({"5Y": 1.0}, instrument="a", curve="c")
    b = from_wide({"5Y": 2.0}, instrument="b", curve="c")
    agg = aggregate([a, b])
    assert len(agg) == 2
    assert set(agg["instrument"]) == {"a", "b"}
