"""What actually goes over the wire (stability session, Pass E; pass L).

The measurement that produced this file: every endpoint was answering with no
`Content-Encoding` at all, so the browser downloaded 235 KB of stage-1 summary
that gzips to 36 KB, and 103 KB of series history that gzips to 17 KB. See
docs/diagnostics/perf-baseline.md.

These tests exercise the real app through the ASGI stack rather than calling
the handlers, because compression is middleware — a handler-level test cannot
see it, which is how it stayed missing.

Pass L changed the stage-1 SHAPE: `oneLiner` left every row and forward grid
cells gained `range1y`. The shape tests below are written to fail on the old
shape as well as on the classic regression (a per-row series reappearing under
a new name), because a size bound alone cannot tell the two apart.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    # imported inside the fixture: app.main loads the dataset and bootstraps
    # every curve at import time, and only this module needs it.
    from app.main import app

    return TestClient(app)


def body(client, path):
    return json.loads(
        client.get(path, headers={"Accept-Encoding": "identity"}).content
    )


def test_summary_is_compressed_on_the_wire(client):
    r = client.get("/api/wall/summary", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"


def test_series_history_is_compressed_on_the_wire(client):
    # the stage-2 fetch, the one a reader waits on when opening a popup
    r = client.get("/api/series/10Y?res=full", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"


def test_a_client_that_cannot_gunzip_still_gets_the_data(client):
    """Compression must be negotiated, never assumed. A caller that sends no
    Accept-Encoding (curl, a script, the next diagnostic) gets plain JSON."""
    r = client.get("/api/wall/summary", headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    assert "gzip" not in r.headers.get("content-encoding", "")
    assert r.json()["outrights"]


def test_stage_one_payload_stays_small(client):
    """A ceiling, not a target. The payload was 235 KB because a per-row
    150-point line nobody read rode along on all 50 rows; it is ~20 KB without
    it. This fails loudly if a series is ever attached to a summary row again —
    the failure the size guard exists for is silent growth, not one bad field.
    Raise the bound deliberately if the row count genuinely grows."""
    r = client.get("/api/wall/summary", headers={"Accept-Encoding": "identity"})
    raw = len(r.content)
    b = r.json()
    rows = len(b["outrights"]) + len(b["derived"])
    assert rows >= 40, "sanity: the summary should still carry the whole table"
    assert raw < 60_000, (
        f"stage-1 summary is {raw:,} bytes over {rows} rows "
        f"({raw // rows:,}/row) — check for per-row history"
    )


def test_forwards_payload_stays_small(client):
    """The other half of stage 1, and the half pass L grew: 168 grid cells each
    gained a 52-week min/max/avg. The growth was measured and stated, so it gets
    a bound of its own rather than riding free."""
    r = client.get("/api/forwards", headers={"Accept-Encoding": "identity"})
    raw = len(r.content)
    cells = sum(len(v) for v in r.json()["grid"].values())
    assert cells >= 100, "sanity: the whole matrix should still be here"
    assert raw < 90_000, (
        f"forwards is {raw:,} bytes over {cells} cells ({raw // cells:,}/cell)"
    )


def test_every_row_field_is_a_scalar_or_a_small_record(client):
    """The shape rule behind the size bound, stated where it is checkable over
    the whole table rather than one sampled row. Deliberately keyed on VALUE
    SHAPE, not on a field name: a 150-point line reappearing as `history`,
    `line`, `points` or anything else is the same defect and trips the same
    assertion."""
    for path, key in [
        ("/api/wall/summary", None),
        ("/api/volatility", "rows"),
    ]:
        b = body(client, path)
        rows = b["outrights"] + b["derived"] if key is None else b[key]
        for row in rows:
            for field, value in row.items():
                if field == "sortKey":
                    continue
                assert not (isinstance(value, list) and len(value) > 8), (
                    f"{path} {row['id']}.{field} carries {len(value)} points; "
                    "per-row history belongs to /api/series"
                )

    grid = body(client, "/api/forwards")["grid"]
    for tenor, cells in grid.items():
        for cell in cells:
            for field, value in cell.items():
                if field == "sortKey":
                    continue
                assert not (isinstance(value, list) and len(value) > 8), (
                    f"forwards {tenor}/{cell['start']}.{field} carries "
                    f"{len(value)} points; per-row history belongs to /api/series"
                )


def test_no_row_still_carries_the_한줄_classification(client):
    """Pass L deleted the 한 줄 column, its three backend rungs, and the field.
    A payload still carrying `oneLiner` is the old shape — the exact failure
    that left a 150-point sparkline at 92% of the payload after its consumer
    went away, one level up."""
    summary = body(client, "/api/wall/summary")
    forwards = body(client, "/api/forwards")
    vol = body(client, "/api/volatility")

    everything = (
        summary["outrights"]
        + summary["derived"]
        + vol["rows"]
        + forwards["keyForwards"]
        + [c for cells in forwards["grid"].values() for c in cells]
    )
    assert len(everything) > 200, "sanity: this should cover the whole product"
    for row in everything:
        assert "oneLiner" not in row, (
            "a row still ships the 한 줄 classification; its consumer, its "
            "three rungs and its column are all gone"
        )


def test_every_listed_row_can_render_the_52_week_column(client):
    """The new column's feed, checked where the column actually reads it. Every
    row the table lists — outright, spread, fly, volatility AND forward — must
    carry min/max/avg, because a cell with no data renders three em dashes and
    says nothing. Forwards are the ones that did not have it before pass L."""
    summary = body(client, "/api/wall/summary")
    vol = body(client, "/api/volatility")
    forwards = body(client, "/api/forwards")

    for row in summary["outrights"] + summary["derived"] + vol["rows"]:
        r = row["range1y"]
        assert set(r) == {"min", "max", "avg", "pct"}, row["id"]
        assert r["min"] <= r["avg"] <= r["max"], row["id"]

    for tenor, cells in forwards["grid"].items():
        for cell in cells:
            r = cell["range1y"]
            # min/max/avg and NOTHING else: nothing reads a forward's level
            # percentile, and §20 says a payload carries what is read
            assert set(r) == {"min", "max", "avg"}, f"{tenor}/{cell['start']}"
            assert r["min"] <= r["avg"] <= r["max"], f"{tenor}/{cell['start']}"

    # the key-forward gauge DOES read the percentile, so that block keeps it
    for kf in forwards["keyForwards"]:
        assert set(kf["range1y"]) == {"min", "max", "avg", "pct"}, kf["label"]
