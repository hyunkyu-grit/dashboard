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

from .curves import build_basis_curves
from .dataset import DISPLAY_TENORS, SPEC_NODE_ORDER, load_dataset
from .derive import (
    basis_dates,
    derived_ids,
    series_history,
    series_values,
    summarize,
)
from .events import detect_event_clusters
from .forwards import forward_history, forwards_payload

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
_curves = build_basis_curves(_dataset)
_forwards = forwards_payload(_dataset, _curves)
_events = detect_event_clusters(_dataset)


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
        # Change-log EVENTS (D-1 fixed, collapsed) — DESIGN §12 rule (c).
        "events": _events,
    }


@app.get("/api/series/{series_id}")
def series_detail(series_id: str, res: str = "full") -> dict:
    # `res=preview` → ~150 downsampled line points; `res=full` → every day (the
    # enlarged view). Stats + per-point daily change + the calendar are always
    # precomputed here — the browser never differences a series (§16).
    if "x" in series_id:
        # Forward ids carry an 'x' (e.g. 2Yx1Y); their history is derived from
        # each date's curve, lazily and cached (§2 stage-2). Levels are %.
        try:
            hist = forward_history(_dataset, series_id)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown forward {series_id}")
        pairs = [(p["t"], p["v"]) for p in hist]
        unit = "%"
    else:
        try:
            values = series_values(_dataset, series_id)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown series {series_id}")
        # outright levels are %, derived spreads/flies are already bp.
        unit = "%" if series_id in _dataset.series else "bp"
        pairs = [
            (d.isoformat(), round(v, 4))
            for d, v in zip(_dataset.dates, values)
            if v is not None
        ]
    return {
        "id": series_id,
        "asof": _dataset.asof.isoformat(),
        **series_history(pairs, unit, res),
    }


@app.get("/api/forwards")
def forwards() -> dict:
    return _forwards
