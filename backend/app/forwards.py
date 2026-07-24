"""Forward matrix derivations — design spec §7/§8.

Cell (start s, tenor τ) = forward par-swap rate of a swap starting at s
with length τ, quarterly fixed annuity on the single CD/IRS curve
([OWNER 2026-07-24]):

    R(s, τ) = (DF(s) − DF(s+τ)) / (0.25 · Σ_{i=1..4τ} DF(s + 0.25·i))

SPOT column = spot-starting par rate to maturity s (same formula with
s=0), except the ON point which is the simple money-market rate.

Live-quoted rule (§7): a point is "live" iff BOTH its start and its end
sit on live-quoted curve nodes (±0.02y tolerance, the engine's TOL_DUP —
absorbs the ON anchor's 1/365 offset).
"""

from __future__ import annotations

import calendar as _cal
import datetime as dt

import numpy as np

from .dataset import Dataset
from .derive import BASIS_KEYS, basis_dates
from .engine_port import _modfol_bd, df

# 21 forward start points: ON, then 3M steps out to 5Y (§7).
ON_T = 1.0 / 365.0
START_POINTS: list[tuple[str, float]] = [("ON", ON_T)] + [
    (
        f"{q // 4}Y" if q % 4 == 0
        else (f"{q * 3}M" if q < 4 else f"{q // 4}Y{(q % 4) * 3}M"),
        q * 0.25,
    )
    for q in range(1, 21)
]

# 8 forward tenors, one wall tile each (§7). SPOT = spot-starting par curve.
FWD_TENORS: list[tuple[str, float | None]] = [
    ("SPOT", None), ("3MF", 0.25), ("6MF", 0.5), ("9MF", 0.75),
    ("1YF", 1.0), ("2YF", 2.0), ("3YF", 3.0), ("5YF", 5.0),
]

# Named key forwards from the legacy sheet (§8): (label, start, tenor).
KEY_FORWARDS: list[tuple[str, float, float]] = [
    ("6Mx3M", 0.5, 0.25),
    ("1Yx1Y", 1.0, 1.0),
    ("2Yx1Y", 2.0, 1.0),
    ("2Yx2Y", 2.0, 2.0),
    ("3Yx3Y", 3.0, 3.0),
    ("5Yx5Y", 5.0, 5.0),
]

# Live-quoted curve nodes in years (1D..10Y wall node set).
LIVE_NODES = [ON_T, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0]
LIVE_TOL = 0.02  # engine TOL_DUP: ±~7d absorbs ON/91d label offsets


def _is_live_t(t: float) -> bool:
    return any(abs(t - n) < LIVE_TOL for n in LIVE_NODES)


def is_live_point(start: float, tenor: float | None) -> bool:
    end = start if tenor is None else start + tenor
    return _is_live_t(start) and _is_live_t(end)


def forward_par_rate(zc: np.ndarray, start: float, tenor: float | None) -> float:
    """Forward par-swap rate in decimal; see module docstring."""
    if tenor is None:  # SPOT column: spot-starting to maturity `start`
        s, e = 0.0, start
    else:
        s, e = start, start + tenor
    length = e - s
    if length < 0.25 - 1e-9:  # sub-quarterly (ON): simple money-market rate
        return (df(s, zc) / df(e, zc) - 1.0) / length
    n = round(length * 4)
    annuity = 0.25 * sum(df(s + 0.25 * (i + 1), zc) for i in range(n))
    return (df(s, zc) - df(e, zc)) / annuity


def _add_months(d: dt.date, months: int) -> dt.date:
    m = d.month + months
    y = d.year + (m - 1) // 12
    m = (m - 1) % 12 + 1
    return dt.date(y, m, min(d.day, _cal.monthrange(y, m)[1]))


def start_date_for(asof: dt.date, label: str, t: float) -> dt.date:
    """Real-world start date for a start point, ModFol-adjusted (§7 line 2).
    ON starts at the as-of date itself; quarterly points use calendar
    months (not 365ths) so dates land on month boundaries."""
    if label == "ON":
        return asof
    return _modfol_bd(_add_months(asof, round(t * 12)))


def forwards_payload(dataset: Dataset, curves: dict[str, np.ndarray]) -> dict:
    bases = basis_dates(dataset)
    all_keys = ["now", *BASIS_KEYS]

    def cell(start: float, tenor: float | None) -> dict:
        values = {
            k: round(forward_par_rate(curves[k], start, tenor) * 100, 4)
            for k in all_keys
        }
        deltas = {
            k: round((values["now"] - values[k]) * 100, 2) for k in BASIS_KEYS
        }
        return {"values": values, "deltas": deltas}

    grid = {
        tenor_label: [
            {
                "start": s_label,
                "live": is_live_point(s_t, tenor_t),
                **cell(s_t, tenor_t),
            }
            for s_label, s_t in START_POINTS
        ]
        for tenor_label, tenor_t in FWD_TENORS
    }

    return {
        "asof": dataset.asof.isoformat(),
        "basisDates": {k: (d.isoformat() if d else None) for k, d in bases.items()},
        "startPoints": [
            {
                "label": s_label,
                "t": s_t,
                "date": start_date_for(dataset.asof, s_label, s_t).isoformat(),
            }
            for s_label, s_t in START_POINTS
        ],
        "tenors": [label for label, _t in FWD_TENORS],
        "grid": grid,
        "keyForwards": [
            {"label": label, **cell(s, t)} for label, s, t in KEY_FORWARDS
        ],
    }
