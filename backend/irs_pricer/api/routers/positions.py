"""Positions endpoint — NEW in this deployment, replacing the upload screen.

The source app got its book by having the analyst upload four workbooks through
a form; the server parsed `Portfolio Data.xlsx` and handed the positions back,
and the browser kept them in localStorage. Here the owner drops the workbooks
into `data/` directly, so the parse is just a read and the browser holds no
ledger at all — it asks for one.

This is the SERVER parse, deliberately: it is the path that carries real
duration/PVBP off the source ledger. (The frozen repo also had a browser-side
blotter parser, which sets `duration: 0, pvbp: 0` — that path is not ported.)

Nothing is cached here beyond the loaders' own (path, mtime) cache: a refresh
lands on the next request, which is the whole point of the folder workflow.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ...config import DataDirNotFoundError, require_data_dir
from ...loaders import portfolio as portfolio_loader
from ..models import ParsedPositionOut

router = APIRouter(prefix="/api/positions")


@router.get("", response_model=list[ParsedPositionOut])
def list_positions() -> list[ParsedPositionOut]:
    """The book as parsed from `data/Portfolio Data.xlsx` (bond sheet + IRS sheet).

    404 when the data folder or the workbook isn't there — an empty list would
    read as "the book is empty", which is a different and much worse claim.
    """
    try:
        data_dir = require_data_dir()
    except DataDirNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        rows = portfolio_loader.parse(data_dir)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return [ParsedPositionOut(**row) for row in rows]


@router.get("/summary")
def positions_summary() -> dict:
    """Row counts + the workbook's own date stamp, for the data-state surface."""
    try:
        data_dir = require_data_dir()
        return portfolio_loader.summary(data_dir)
    except DataDirNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
