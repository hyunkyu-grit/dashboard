"""Change-log event detection + correlation collapse (DESIGN §12 rule c)."""

from pathlib import Path

import pytest

from app.dataset import load_dataset
from app.events import _collapse, detect_event_clusters

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"


# ---- collapse tests (the two required) --------------------------------------

def test_collapse_merges_series_sharing_a_leg():
    """Spreads/flies sharing any tenor leg collapse into one cluster; a
    disjoint series stays separate."""
    firing = [
        {"id": "3Y-5Y", "legs": ["3Y", "5Y"]},
        {"id": "5Y-10Y", "legs": ["5Y", "10Y"]},   # shares 5Y with the first
        {"id": "3Y-5Y-10Y", "legs": ["3Y", "5Y", "10Y"]},  # shares both
        {"id": "1Y-2Y", "legs": ["1Y", "2Y"]},     # disjoint → own cluster
    ]
    comps = _collapse(firing)
    by_size = sorted((sorted(e["id"] for e in c) for c in comps), key=len)
    assert by_size == [
        ["1Y-2Y"],
        ["3Y-5Y", "3Y-5Y-10Y", "5Y-10Y"],
    ]


def test_collapse_transitively_links_and_partitions_exactly():
    """Union is transitive (A–B, B–C ⇒ one cluster), and every input lands in
    exactly one component with none lost or duplicated."""
    firing = [
        {"id": "1Y", "legs": ["1Y"]},
        {"id": "1Y-2Y", "legs": ["1Y", "2Y"]},   # links 1Y
        {"id": "2Y-3Y", "legs": ["2Y", "3Y"]},   # links via 2Y → 1Y cluster
        {"id": "5Y", "legs": ["5Y"]},            # isolated
        {"id": "10Y", "legs": ["10Y"]},          # isolated
    ]
    comps = _collapse(firing)
    sizes = sorted(len(c) for c in comps)
    assert sizes == [1, 1, 3]
    flat = [e["id"] for c in comps for e in c]
    assert sorted(flat) == ["10Y", "1Y", "1Y-2Y", "2Y-3Y", "5Y"]
    assert len(flat) == len(set(flat))  # partition: no duplicates


# ---- integration against real data ------------------------------------------

@pytest.fixture(scope="module")
def clusters():
    return detect_event_clusters(load_dataset(DATA))


def test_cluster_shape(clusters):
    for c in clusters:
        assert set(c) == {"leading", "related", "count"}
        assert c["count"] == len(c["related"])
        lead = c["leading"]
        assert lead["reasons"]  # non-empty; only firing series appear
        assert set(lead["reasons"]) <= {"transition", "move"}
        assert lead["anchor"]  # every entry is individually navigable


def test_no_pure_level_state_in_log(clusters):
    """A percentile-extreme LEVEL alone must not create a log entry — that is
    tile STATE, not an event. Every entry fires transition and/or move."""
    for c in clusters:
        for e in [c["leading"], *c["related"]]:
            assert "transition" in e["reasons"] or "move" in e["reasons"]
