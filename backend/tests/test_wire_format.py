"""What actually goes over the wire (stability session, Pass E).

The measurement that produced this file: every endpoint was answering with no
`Content-Encoding` at all, so the browser downloaded 235 KB of stage-1 summary
that gzips to 36 KB, and 103 KB of series history that gzips to 17 KB. See
docs/diagnostics/perf-baseline.md.

These tests exercise the real app through the ASGI stack rather than calling
the handlers, because compression is middleware — a handler-level test cannot
see it, which is how it stayed missing.
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
    body = r.json()
    rows = len(body["outrights"]) + len(body["derived"])
    assert rows >= 40, "sanity: the summary should still carry the whole table"
    assert raw < 60_000, (
        f"stage-1 summary is {raw:,} bytes over {rows} rows "
        f"({raw // rows:,}/row) — check for per-row history"
    )


def test_every_row_field_is_a_scalar_or_a_small_record(client):
    """The shape rule behind the size bound, stated where it is checkable over
    the whole table rather than one sampled row."""
    body = json.loads(
        client.get(
            "/api/wall/summary", headers={"Accept-Encoding": "identity"}
        ).content
    )
    for row in body["outrights"] + body["derived"]:
        for key, value in row.items():
            if key == "sortKey":
                continue
            assert not (isinstance(value, list) and len(value) > 8), (
                f"{row['id']}.{key} carries {len(value)} points; per-row "
                "history belongs to /api/series"
            )
