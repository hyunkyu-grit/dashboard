"""Do the static files and the live endpoints still say the same thing?

Static conversion, Pass B. The FastAPI app stays as the reference
implementation for local development, so there are now two ways to get a
payload. This is what stops them drifting.

**This test cannot gate.** It needs a live backend, and the working agreement
runs the suite with the dev server stopped — so it SKIPS when there is none.

Which backend it talks to is NOT hardcoded any more (2026-08-20, 배포 준비).
`_live_backend.claim()` decides, and it refuses a port it cannot prove is ours:
after deployment :8200 is a Funnel-exposed live service, and "the port is open"
would otherwise read as "my backend is up". v1 ran a suite against the live
site exactly that way.

    powershell -File backend/serve.ps1 -Local        # 쪽지를 남긴다
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

import _live_backend

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend" / "scripts"))

from app.static_paths import (  # noqa: E402
    FORWARDS_PATH,
    SUMMARY_PATH,
    VOLATILITY_PATH,
    dv01_path,
    series_path,
)

# 포트는 여기 없다 — `_live_backend` 가 `SAURON_TEST_BASE` 로 정한다.
_VERDICT = _live_backend.claim()
BASE = _VERDICT.base
# V2-LOCAL: v2 의 Next 앱이 리포 루트라 구운 트리는 `public/` 이다.
# (v1 은 `frontend/public`. 포트도 v1 것 :8100 → v2 :8200 으로 바꿨다 —
#  안 바꾸면 v2 의 정적 트리를 **v1 백엔드**와 대조하게 된다.)
PUBLIC = REPO / "public"

# A sample, not the whole set: one of each id shape, because the shapes are
# what differ (outright / spread / fly / forward / volatility), and one of each
# resolution. 984 round trips would take minutes and prove the same thing.
# 3Mx3M added in V-PASS V5: the ONE span-sensitive forward (its start sits
# below the early-2016 curves' first node). The static build prices forwards
# on a fast path that bypasses forward_history, and this sample previously
# contained no series that could tell the two paths apart — the fast path
# kept emitting the ten 0.0% rows after the lazy path was fixed, and every
# agreement run stayed green.
SAMPLE_SERIES = ["10Y", "1.5Y", "1Y-10Y", "2Y-5Y-10Y", "2Yx1Y", "3Mx3M", "6Mx3M", "vol:10Y"]


def _tree_baked() -> bool:
    """Is there a static tree to compare at all? (V2-LOCAL)

    This file needs BOTH sides. Until 2026-08-14 it only checked one of them
    and pointed at v1's port, so on this copy it always skipped and the gap was
    invisible. Fixing the port woke it up — into 20 failures that all said the
    same thing: v2 has never baked a tree. That is not drift, it is absence,
    and reporting absence as disagreement is how a suite stops being read."""
    return (PUBLIC / "api" / "manifest.json").exists()


# 포트가 열려 있다는 사실만으로 진행하지 않는다. 이 줄은 skip 이 아니라
# **수집 단계의 거부**다 — 남의 백엔드(배포 뒤에는 곧 라이브 서비스)에 대고
# 아래 라운드트립을 돌리는 것은 조용한 사고이고, 조용한 사고를 skip 으로 적어
# 두면 아무도 안 읽는다. pytest 는 이 모듈을 ERROR 로 보고하고 종료코드가 선다.
if _VERDICT.fail:
    raise RuntimeError(_VERDICT.reason)

pytestmark = [
    pytest.mark.skipif(
        not _VERDICT.run,
        reason=_VERDICT.reason,
    ),
    pytest.mark.skipif(
        not _tree_baked(),
        reason=(
            "no baked static tree at public/api — there is nothing to compare the "
            "live API against. Run `python backend/scripts/build_static.py` first."
        ),
    ),
]


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
    still ship yesterday's numbers. The manifest's hash is the check.

    v7: the hash carries the dataset's effective asof (the 전일종가 cutoff
    makes content a function of bytes AND day), so the expectation is built
    the way build_static builds it — load, then hash with the loaded asof.
    A tree built on an earlier day from the same bytes fails here, which is
    exactly the staleness this test exists to catch."""
    import datetime as dt

    from app.cache import sql_data_hash
    from app.dataset import load_dataset_sql

    # 출처가 MySQL 이다 [OWNER, 2026-08-07]. 해시할 바이트가 없으므로 키가
    # **테이블 워터마크**(MAX(irs_date), COUNT(*))다 — `sql_data_hash`.
    # 그래서 이 검사는 이제 DB 를 한 번 읽는다. 이 파일은 어차피 :8200 이
    # 떠 있어야 도는 파일이라(모듈 독스트링) 오프라인 조건이 새로 붙지 않는다.
    m = static("api/manifest.json")
    assert m["dataHash"] == sql_data_hash(load_dataset_sql().asof), (
        "the committed static tree was built from different data or on a "
        "different day — re-run backend/scripts/build_static.py"
    )
    assert m["asof"] == get(f"{BASE}/api/health")["asof"]
    # the tree never claims today: its asof is a COMPLETED close
    assert m["asof"] < dt.date.today().isoformat()
