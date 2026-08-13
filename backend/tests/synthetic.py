# -*- coding: utf-8 -*-
"""Synthetic Dataset builders for the V-PASS consistency tests (2026-08-03).

Never touch data/irsdata.xlsx — these construct `Dataset` objects directly,
seeded from a REAL curve snapshot so the shapes are market-plausible, then
evolved under a stated law (frozen, or along the implied forwards).

Both builders emit par rates through the SAME conventions the engine reads
(TENOR_T year fractions; 1D/3M as simple money-market rates; swap tenors as
quarterly par on the 0.25y grid), so what the engine bootstraps back is the
intended curve up to the accepted bootstrap residual.
"""

from __future__ import annotations

import datetime as dt

import numpy as np

from app.curves import TENOR_T
from app.dataset import Dataset
from app.engine_port import df, next_kr_business_day

# Money-market nodes price as simple single payments (docs/CONVENTIONS.md);
# everything longer is quarterly par.
_MM_TENORS = {"1D", "3M"}


def business_days(start: dt.date, n: int) -> list[dt.date]:
    """`n` KR business days starting AT `start` (start must be one)."""
    out = [start]
    while len(out) < n:
        out.append(next_kr_business_day(out[-1]))
    return out


def par_from_curve(zc: np.ndarray, horizon: float = 0.0) -> dict[str, float]:
    """Par rates (in PERCENT) for every TENOR_T node, read off the forward
    curve `zc` implies at `horizon` years. horizon=0.0 is the spot curve.

    df_fwd(t) = df(h + t) / df(h) — the discount curve seen from h if today's
    curve realizes its own forwards. Money-market nodes: simple rate over the
    node's own year fraction. Swap tenors: quarterly par on the 0.25y grid,
    the same schedule idealization the bootstrap solves against.
    """
    dfh = df(horizon, zc)

    def dff(t: float) -> float:
        return df(horizon + t, zc) / dfh

    out: dict[str, float] = {}
    for tenor, t in TENOR_T.items():
        if tenor in _MM_TENORS:
            r = (1.0 / dff(t) - 1.0) / t
        else:
            n = round(t * 4)
            annuity = 0.25 * sum(dff(0.25 * (k + 1)) for k in range(n))
            r = (1.0 - dff(t)) / annuity
        out[tenor] = r * 100.0
    return out


def _dataset_from_rows(dates: list[dt.date], rows: list[dict[str, float]]) -> Dataset:
    tenors = list(TENOR_T.keys())
    return Dataset(
        dates=dates,
        series={t: [row[t] for row in rows] for t in tenors},
        tenor_order=tenors,
    )


def frozen_dataset(zc: np.ndarray, start: dt.date, n_days: int) -> Dataset:
    """The V2 fixture: the same spot curve printed on every date — no market
    move at all, CD fixings frozen with it. Anything the backtest reports on
    this dataset is time and time alone."""
    quotes = par_from_curve(zc, 0.0)
    dates = business_days(start, n_days)
    return _dataset_from_rows(dates, [quotes] * n_days)


def forward_realized_dataset(zc: np.ndarray, start: dt.date, n_days: int) -> Dataset:
    """The V3 fixture: each date's curve is the forward curve today's curve
    implies for that horizon (ACT/365 from `start`), so the market realizes
    exactly what was priced — including the CD path, since the 3M row IS the
    fixing store."""
    dates = business_days(start, n_days)
    rows = [par_from_curve(zc, (d - start).days / 365.0) for d in dates]
    return _dataset_from_rows(dates, rows)
