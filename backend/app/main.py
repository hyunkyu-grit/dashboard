"""braveworld backend — KRW IRS monitor API.

Stage-1 wall summary + stage-2 full series. All derived series (spreads,
flies) are computed here, never in the browser (design spec §4).

Forwards / curve bootstrapping are intentionally ABSENT: the module list to
port from the frozen engine is [TBD — owner]. /api/forwards is a stub that
documents the gate.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .dataset import DISPLAY_TENORS, SPEC_NODE_ORDER, load_dataset
from .derive import basis_dates, derived_ids, series_values, summarize

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"

app = FastAPI(title="braveworld", version="0.1.0")

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


def _outright_label(tenor: str) -> str:
    return "Call (1D)" if tenor == "1D" else f"IRS {tenor}"


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "asof": _dataset.asof.isoformat(),
        "rows": len(_dataset.dates),
        "missingNodes": _dataset.missing_nodes,
    }


@app.get("/api/wall/summary")
def wall_summary() -> dict:
    outrights = [
        summarize(_dataset, t, _outright_label(t), "outright", _bases)
        for t in _dataset.tenor_order
    ]
    derived = [
        summarize(_dataset, sid, sid.replace("-", "/"), kind, _bases)
        for sid, kind, _legs in derived_ids()
    ]
    return {
        "asof": _dataset.asof.isoformat(),
        "basisDates": {
            k: (d.isoformat() if d else None) for k, d in _bases.items()
        },
        "specNodeOrder": SPEC_NODE_ORDER,
        "displayTenors": DISPLAY_TENORS,
        "missingNodes": _dataset.missing_nodes,
        "outrights": outrights,
        "derived": derived,
    }


@app.get("/api/series/{series_id}")
def series_detail(series_id: str) -> dict:
    try:
        values = series_values(_dataset, series_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown series {series_id}")
    return {
        "id": series_id,
        "asof": _dataset.asof.isoformat(),
        "points": [
            {"t": d.isoformat(), "v": v}
            for d, v in zip(_dataset.dates, values)
            if v is not None
        ],
    }


@app.get("/api/forwards")
def forwards_stub() -> dict:
    raise HTTPException(
        status_code=501,
        detail=(
            "Forward derivation requires the curve bootstrap port from the "
            "frozen engine; module list is [TBD — owner]. Not implemented."
        ),
    )
