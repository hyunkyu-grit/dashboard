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

from .cache import cached, data_hash
from .curves import build_basis_curves
from .dataset import DISPLAY_TENORS, SPEC_NODE_ORDER, load_dataset
from .derive import (
    apply_level_extreme,
    apply_solo_direction,
    basis_dates,
    curve_banner,
    curve_heatmap,
    derived_ids,
    ohlc_buckets,
    series_history,
    series_values,
    summarize,
)
from .dv01 import build_dv01_table
from .events import detect_event_clusters
from .forwards import forward_history, forwards_payload
from .volatility import relative_atr_for, volatility_payload

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
_events = detect_event_clusters(_dataset)
_volatility = volatility_payload(_dataset, _bases)
_dv01_table = build_dv01_table(_curves["now"], derived_ids)
# The own-history distributions are the slow part (§D) — bootstrap each
# historical curve once and reprice all forwards (~13s) — over a file that
# changes once a day. Persist them keyed by the data-file hash; recompute only
# when the data changes (loudly logged).
_data_hash = data_hash(DATA_PATH)
_forwards = cached("forwards", _data_hash, lambda: forwards_payload(_dataset, _curves))
_curve_heatmap = cached("curve_heatmap", _data_hash, lambda: curve_heatmap(_dataset))


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
    # 한 줄 rungs 2 & 3 (§C2/§I) are cross-sectional, so they run after the whole
    # table is built. When the whole curve sits at a 10y extreme (§I), that is a
    # curve fact stated once in the banner, so the per-row level rung is
    # SUPPRESSED on outrights; spreads/flies keep it (a spread at a 10y extreme
    # is genuinely distinctive, not restated by the banner). Rung 3 (solo
    # direction) over outrights only. Both fill only silent rows, so rung 1
    # (set in summarize) keeps priority.
    banner = curve_banner(outrights)
    apply_level_extreme(derived if banner["kind"] else outrights + derived)
    apply_solo_direction(outrights)
    return {
        "asof": _dataset.asof.isoformat(),
        "basisDates": {
            k: (d.isoformat() if d else None) for k, d in _bases.items()
        },
        "specNodeOrder": SPEC_NODE_ORDER,
        "displayTenors": DISPLAY_TENORS,
        "missingNodes": _dataset.missing_nodes,
        "curveBanner": banner,  # §I: whole-curve extreme stated once, not per row
        "outrights": outrights,
        "derived": derived,
        # Change-log EVENTS (D-1 fixed, collapsed) — DESIGN §12 rule (c).
        "events": _events,
    }


@app.get("/api/series/{series_id}")
def series_detail(series_id: str, res: str = "full", interval: str | None = None) -> dict:
    # `res=preview` → ~150 downsampled line points; `res=full` → every day (the
    # enlarged view). `interval=w|m` → weekly/monthly OHLC candles instead (§G).
    # Stats + per-point daily change + the calendar are always precomputed here —
    # the browser never differences or aggregates a series (§16).
    if series_id.startswith("vol:"):
        # Volatility history: the relative-ATR ratio series for a tenor. Ratio
        # levels are dimensionless; warm-up / floor nulls are simply absent.
        try:
            ratios = relative_atr_for(_dataset, series_id[len("vol:"):])
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown series {series_id}")
        pairs = [(t, r) for t, r in ratios if r is not None]
        unit = "ratio"
    elif "x" in series_id:
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
    if interval in ("w", "m"):
        return {
            "id": series_id,
            "asof": _dataset.asof.isoformat(),
            "unit": unit,
            "interval": interval,
            "bars": ohlc_buckets(pairs, interval),
        }
    return {
        "id": series_id,
        "asof": _dataset.asof.isoformat(),
        **series_history(pairs, unit, res),
    }


@app.get("/api/forwards")
def forwards() -> dict:
    return _forwards


@app.get("/api/curve-heatmap")
def curve_heatmap_endpoint() -> dict:
    # Tenor × date grid of curve changes, own-history normalised (§D). Static
    # across instruments — it is the curve, not the popup's instrument.
    return _curve_heatmap


@app.get("/api/dv01/{series_id}")
def dv01(series_id: str) -> dict:
    # Per-leg DV01 + DV01-neutral notional ratio at the current curve (§B).
    # Forwards/vol/unknown ids get an empty block (kind null).
    return _dv01_table.get(
        series_id,
        {"id": series_id, "kind": None, "legs": [], "residual": None},
    )


@app.get("/api/volatility")
def volatility() -> dict:
    # Relative-ATR list rows + across-tenor curve, all precomputed (§16).
    return {
        "asof": _dataset.asof.isoformat(),
        "basisDates": {
            k: (d.isoformat() if d else None) for k, d in _bases.items()
        },
        **_volatility,
    }
