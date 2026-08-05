"""braveworld backend — KRW IRS monitor API.

Stage-1 wall summary + stage-2 full series. All derived series (spreads,
flies) are computed here, never in the browser (design spec §4).

Forwards / curve bootstrapping are intentionally ABSENT: the module list to
port from the frozen engine is [TBD — owner]. /api/forwards is a stub that
documents the gate.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from . import payloads
from .backtest import BacktestError, Position, run_backtest
from .cache import cached, data_hash
from .curves import build_basis_curves
from .dataset import load_dataset
from .derive import basis_dates, derived_ids
from .dv01 import build_dv01_table
from .events import detect_event_clusters
from .forwards import forwards_payload
from .policy import load_base_rate, policy_step
from .regret import regret_payload
from .staleness import dataset_freshness
from .volatility import volatility_payload

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"
POLICY_PATH = Path(__file__).resolve().parents[2] / "data" / "bokbaserate.xlsx"

app = FastAPI(title="braveworld", version="0.1.0")

# Every response left here uncompressed (measured, Pass E: no Content-Encoding
# on any endpoint). These payloads are long lists of short numeric records and
# compress ~6x; the stage-2 series fetch, the one the reader actually waits on
# when opening a popup, goes 103 KB -> 17 KB. minimum_size skips the small
# ones, where the header costs more than it saves (/api/health is 156 bytes).
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    # braveworld runs on :3100/:8100 — :3000/:8000 belong to the frozen
    # krw-fi-pms deployment and must stay untouched.
    allow_origins=["http://localhost:3100", "http://127.0.0.1:3100"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

_dataset = load_dataset(DATA_PATH)
_bases = basis_dates(_dataset)
# The policy step, resolved ONCE against this dataset's as-of date — the carry
# bound depends on both files, so it cannot be decided by policy.py alone (see
# its docstring). Two dozen corners; it rides in the summary rather than
# earning an endpoint, because every %-unit chart needs it and the summary is
# already the first thing fetched.
_policy = policy_step(load_base_rate(POLICY_PATH), _dataset.asof)
_curves = build_basis_curves(_dataset)
_events = detect_event_clusters(_dataset)
_volatility = volatility_payload(_dataset, _bases)
_dv01_table = build_dv01_table(_curves["now"], derived_ids)
# The own-history distributions are the slow part (§D) — bootstrap each
# historical curve once and reprice all forwards (~13s) — over a file that
# changes once a day. Persist them keyed by the data-file hash; recompute only
# when the data changes (loudly logged).
_data_hash = data_hash(DATA_PATH, _dataset.asof)
_forwards = cached("forwards", _data_hash, lambda: forwards_payload(_dataset, _curves))
# 라고 할 때 살걸: a 20-day event replay plus ~2 valuations per line — a
# couple of seconds over a file that changes once a day, so it caches the
# same way forwards does.
_regret = cached("regret", _data_hash, lambda: regret_payload(_dataset))
# Two things that used to sit here are gone, both from this region of the
# popup: the curve heatmap (its 어제-column question was answered faster by
# the table, and daily resolution over ten years was noise) and carry & roll
# after it (see DESIGN — removed for a repeated figure and components that
# did not sum). `forwards` is the only cached payload now.


@app.get("/api/health")
def health() -> dict:
    # freshness recomputed per request (its age advances with the wall clock
    # while the file does not) — see staleness.py.
    return {
        "status": "ok",
        "asof": _dataset.asof.isoformat(),
        "rows": len(_dataset.dates),
        "missingNodes": _dataset.missing_nodes,
        "freshness": dataset_freshness(_dataset.asof),
    }


@app.get("/api/wall/summary")
def wall_summary() -> dict:
    return payloads.wall_summary(_dataset, _bases, _events, _policy, _regret)


@app.get("/api/series/{series_id}")
def series_detail(series_id: str, res: str = "full", interval: str | None = None) -> dict:
    # Content comes from payloads.py so the static build cannot drift from this
    # (Pass B). All that is left here is turning an unknown id into a 404.
    try:
        return payloads.series_detail(_dataset, series_id, res, interval)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown series {series_id}")


@app.get("/api/forwards")
def forwards() -> dict:
    return _forwards


@app.get("/api/dv01/{series_id}")
def dv01(series_id: str) -> dict:
    # Per-leg DV01 + DV01-neutral notional ratio at the current curve (§B).
    # Forwards/vol/unknown ids get an empty block (kind null).
    return _dv01_table.get(series_id, payloads.empty_dv01(series_id))


@app.get("/api/backtest")
def backtest(positions: str = "") -> dict:
    """Revalue a BOOK of positions daily and sum them (§backtest).

    `positions` is a `;`-separated list, one position per entry, each
    `id,direction,notional,entry[,exit]` — e.g.

        10Y,1,1e10,2025-07-30;3Y-10Y,1,5e9,2026-01-02,2026-05-01

    A query string rather than a POST body because every other route here is a
    GET and a backtest is a question, not a submission: this way a book is a
    URL somebody can paste to a colleague, which is the same property `?tile=`
    gives the rest of the product.

    LIVE ONLY, by design. Every other endpoint has a static twin under
    `frontend/public/api/**` that the deployed site serves; this one cannot,
    because the answer depends on inputs the reader chooses. Vercel runs the
    frontend and this backend runs behind it [OWNER, 2026-07-31], which is also
    what keeps §16 intact — the browser still computes nothing.
    """
    if not positions.strip():
        raise HTTPException(status_code=422, detail="at least one position is required")

    parsed: list[Position] = []
    for raw in positions.split(";"):
        raw = raw.strip()
        if not raw:
            continue
        parts = [p.strip() for p in raw.split(",")]
        if len(parts) not in (4, 5):
            raise HTTPException(
                status_code=422,
                detail=f"bad position {raw!r}: expected id,direction,notional,entry[,exit]",
            )
        try:
            parsed.append(
                Position(
                    series_id=parts[0],
                    direction=int(parts[1]),
                    notional=float(parts[2]),
                    entry=dt.date.fromisoformat(parts[3]),
                    exit=dt.date.fromisoformat(parts[4]) if len(parts) == 5 and parts[4] else None,
                )
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"bad position {raw!r}: {exc}")

    try:
        return run_backtest(_dataset, parsed)
    except BacktestError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get("/api/volatility")
def volatility() -> dict:
    # Relative-ATR list rows + across-tenor curve, all precomputed (§16).
    return payloads.volatility(_dataset, _bases, _volatility)
