"""
The simulate stream's ERROR path — pinned after the 2026-08-19 P0.

What actually happened (backend.log, four identical tracebacks): the page's
default run asked for base_date 2026-08-18, the workbook's last row was
2026-08-13 (a snapshot copied at the repo's birth and never refreshed), and
the clean NonBusinessDayError this path exists to raise DIED IN ITS OWN
CONSTRUCTOR — three call sites in loaders/irsdata.py passed a single message
string to a class whose signature is (date, reason). The TypeError aborted
the already-200 stream and the frontend's only symptom was a JSON parse
failure. Two layers, two pins:

1. Every NonBusinessDayError call site in irsdata.py can actually construct
   the exception (the constructor-of-the-exception failure mode).
2. When the engine raises after headers are on the wire, the stream carries
   a `{"detail": …}` payload instead of just dying, so the client reads the
   real sentence ("…은(는) 영업일이 아닙니다…") rather than guessing at a
   truncated body.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from irs_pricer.core.errors import NonBusinessDayError
from irs_pricer.loaders import irsdata


def test_missing_date_raises_nonbusinessday_not_typeerror(tmp_path, monkeypatch):
    """_row on an absent date must raise the intended exception, not explode
    while constructing it (the 2026-08-19 regression)."""

    class FakeDs:
        dates = [dt.date(2026, 8, 13)]
        series: dict = {}

    with pytest.raises(NonBusinessDayError) as exc:
        irsdata._row(FakeDs(), dt.date(2026, 8, 18))
    # The class composes the sentence; the date must be in it.
    assert "2026-08-18" in str(exc.value)
    assert exc.value.reason


def test_all_irsdata_call_sites_match_signature():
    """Source pin: every raise in irsdata.py passes (date, reason) — a bare
    f-string message compiles fine and only explodes on the error path, which
    is exactly where nobody is looking."""
    import inspect
    import re

    src = inspect.getsource(irsdata)
    for call in re.findall(r"NonBusinessDayError\(([^)]*)\)", src):
        assert "valuation_date" in call.split(",")[0], call


def test_stream_carries_error_payload(monkeypatch):
    """An engine exception after headers are sent must arrive as a readable
    {"detail": …} body on the 200 stream, not as an aborted connection."""
    from irs_pricer.api.routers import simulate as simulate_router

    def boom(**kwargs):
        raise NonBusinessDayError(dt.date(2026, 8, 18), "테스트 사유")

    monkeypatch.setattr(
        simulate_router.simulation_service, "run_simulation", boom
    )
    client = TestClient(app)
    r = client.post(
        "/api/simulate",
        json={"positions": [], "simDays": 1, "baseDate": "2026-08-18"},
    )
    assert r.status_code == 200  # headers were already committed by design
    body = json.loads(r.text)  # leading keepalive whitespace is legal JSON space
    assert "detail" in body
    assert "2026-08-18" in body["detail"]
