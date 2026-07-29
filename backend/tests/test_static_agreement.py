"""Do the static files and the live endpoints still say the same thing?

Static conversion, Pass B. The FastAPI app stays as the reference
implementation for local development, so there are now two ways to get a
payload. This is what stops them drifting.

**This test cannot gate.** It needs a backend on :8100, and the working
agreement runs the suite with the dev server stopped — so it SKIPS when the
backend is unreachable, and the skip reason says how to run it rather than
leaving a later session to rediscover why it never fires:

    cd backend && python -m uvicorn app.main:app --port 8100
    python -m pytest tests/test_static_agreement.py -q

A skipped test proves nothing, which is why the drift it guards against is
also structurally prevented: `app/payloads.py` is the single source of every
body, and both the HTTP handlers and the pipeline call it. This test checks the
remaining gap — that the transport layer, the path mapping and the serializer
did not change the content on the way out.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend" / "scripts"))

from app.static_paths import (  # noqa: E402
    FORWARDS_PATH,
    SUMMARY_PATH,
    VOLATILITY_PATH,
    dv01_path,
    series_path,
)

BASE = "http://127.0.0.1:8100"
PUBLIC = REPO / "frontend" / "public"

# A sample, not the whole set: one of each id shape, because the shapes are
# what differ (outright / spread / fly / forward / volatility), and one of each
# resolution. 984 round trips would take minutes and prove the same thing.
SAMPLE_SERIES = ["10Y", "1.5Y", "1Y-10Y", "2Y-5Y-10Y", "2Yx1Y", "6Mx3M", "vol:10Y"]


def _backend_up() -> bool:
    try:
        import urllib.request

        with urllib.request.urlopen(f"{BASE}/api/health", timeout= 2) as r:
            return r.status == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _backend_up(),
    reason=(
        "no backend on :8100 — this test compares the committed static files "
        "against the live API and cannot gate. Start it with "
        "`python -m uvicorn app.main:app --port 8100` and re-run."
    ),
)


def get(url: str):
    import urllib.request

    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def static(rel: str):
    p = PUBLIC / rel
    assert p.exists(), f"{rel} not built — run backend/scripts/build_static.py"
    return json.loads(p.read_text(encoding="utf-8"))


def test_summary_agrees():
    assert static(SUMMARY_PATH) == get(f"{BASE}/api/wall/summary")


def test_forwards_agrees():
    assert static(FORWARDS_PATH) == get(f"{BASE}/api/forwards")


def test_volatility_agrees():
    assert static(VOLATILITY_PATH) == get(f"{BASE}/api/volatility")


@pytest.mark.parametrize("sid", SAMPLE_SERIES)
def test_series_agrees_at_every_resolution(sid):
    import urllib.parse

    q = urllib.parse.quote(sid, safe="")
    for res in ("full", "preview"):
        assert static(series_path(sid, res)) == get(
            f"{BASE}/api/series/{q}?res={res}"
        ), f"{sid} @ {res}"
    for iv in ("w", "m"):
        assert static(series_path(sid, iv)) == get(
            f"{BASE}/api/series/{q}?res=full&interval={iv}"
        ), f"{sid} @ {iv}"


@pytest.mark.parametrize("sid", SAMPLE_SERIES)
def test_dv01_agrees(sid):
    import urllib.parse

    q = urllib.parse.quote(sid, safe="")
    assert static(dv01_path(sid)) == get(f"{BASE}/api/dv01/{q}")


def test_the_static_tree_is_current_for_this_data_file():
    """A stale build would make every comparison above pass against itself and
    still ship yesterday's numbers. The manifest's hash is the check."""
    from app.cache import data_hash

    m = static("api/manifest.json")
    assert m["dataHash"] == data_hash(REPO / "data" / "irsdata.xlsx"), (
        "the committed static tree was built from a different data file — "
        "re-run backend/scripts/build_static.py"
    )
    assert m["asof"] == get(f"{BASE}/api/health")["asof"]
