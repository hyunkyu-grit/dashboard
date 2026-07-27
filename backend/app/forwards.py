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

from .curves import par_rates_at_index
from .dataset import Dataset
from .derive import BASIS_KEYS, basis_dates, classify_one_liner
from .engine_port import _modfol_bd, bootstrap_zero_curve, df

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


# ── Stage-2 forward history (§2, Session 13) ────────────────────────────────
# A forward rate on any past date is derivable from that date's curve; ten
# years of curve history is already loaded. Compute lazily, one series at a
# time (2,608 points ≈ one cheap bootstrap per date), and cache per series.

START_YEARS = {label: t for label, t in START_POINTS}
TENOR_YEARS = {label.replace("F", ""): t for label, t in FWD_TENORS}  # SPOT→None

_forward_history_cache: dict[str, list[dict]] = {}


def parse_forward_id(fid: str) -> tuple[float, float | None]:
    """'2Yx1Y' → (start_years, tenor_years); '2YxSPOT' → (start_years, None)."""
    start, _, tenor = fid.partition("x")
    if start not in START_YEARS or tenor not in TENOR_YEARS:
        raise KeyError(fid)
    return START_YEARS[start], TENOR_YEARS[tenor]


def forward_history(dataset: Dataset, fid: str) -> list[dict]:
    """10y daily history of a forward, rebuilt from each date's curve. Cached."""
    if fid in _forward_history_cache:
        return _forward_history_cache[fid]
    start_y, tenor_y = parse_forward_id(fid)
    out: list[dict] = []
    for i, date in enumerate(dataset.dates):
        pars = par_rates_at_index(dataset, i)
        if len(pars) < 2:
            continue
        zc = bootstrap_zero_curve(pars)
        r = forward_par_rate(zc, start_y, tenor_y)
        out.append({"t": date.isoformat(), "v": round(r * 100, 4)})
    _forward_history_cache[fid] = out
    return out


# ── Forward-cell own-history move percentile (§J colour scale) ──────────────
# The matrix tint must drop grid-max (cross-sectional lights ~everything) for
# the own-history scale used product-wide. Each cell needs the percentile of
# today's |Δ| within THAT forward's daily-change history. Re-bootstrapping per
# cell is 168× the curve work (~270s); instead bootstrap each historical date's
# curve ONCE and reprice every forward off the shared cache (~13s at startup).

_hist_zc: list[np.ndarray | None] | None = None


def _historical_curves(dataset: Dataset) -> list[np.ndarray | None]:
    global _hist_zc
    if _hist_zc is None:
        out: list[np.ndarray | None] = []
        for i in range(len(dataset.dates)):
            pars = par_rates_at_index(dataset, i)
            out.append(bootstrap_zero_curve(pars) if len(pars) >= 2 else None)
        _hist_zc = out
    return _hist_zc


def _cell_move_pct(dataset: Dataset, start: float, tenor: float | None) -> float | None:
    """Percentile of today's |Δ| within this forward's own daily-change history
    (§J). None if too little history."""
    zcs = _historical_curves(dataset)
    vals = [forward_par_rate(z, start, tenor) for z in zcs if z is not None]
    diffs = [abs(vals[i] - vals[i - 1]) for i in range(1, len(vals))]
    if len(diffs) < 30:
        return None
    x = diffs[-1]
    return round(100.0 * sum(1 for d in diffs if d <= x) / len(diffs), 1)


def _level_range(dataset: Dataset, start: float, tenor: float | None) -> dict:
    """10y LEVEL range + percentile for a forward: its own history min/max and
    where today's level sits within it (§8 gauge, Pass E). In percent to match
    `values` (×100). This is a LEVEL distribution — distinct from the |Δ| move
    percentile above that drives the matrix tint. None-filled if too little
    history. Reuses the shared historical-curve cache (cheap for 6 forwards)."""
    zcs = _historical_curves(dataset)
    vals = [forward_par_rate(z, start, tenor) * 100.0 for z in zcs if z is not None]
    if len(vals) < 30:
        return {"min": None, "max": None, "pct": None}
    now = vals[-1]
    return {
        "min": round(min(vals), 4),
        "max": round(max(vals), 4),
        "pct": round(100.0 * sum(1 for v in vals if v <= now) / len(vals), 1),
    }


def forwards_payload(dataset: Dataset, curves: dict[str, np.ndarray]) -> dict:
    bases = basis_dates(dataset)
    all_keys = ["now", *BASIS_KEYS]
    key_labels = {label for label, _s, _t in KEY_FORWARDS}

    def cell(start: float, tenor: float | None, name: str | None = None) -> dict:
        values = {
            k: round(forward_par_rate(curves[k], start, tenor) * 100, 4)
            for k in all_keys
        }
        deltas = {
            k: round((values["now"] - values[k]) * 100, 2) for k in BASIS_KEYS
        }
        # Sort key, keyForward flag, and 한 줄 classification are computed HERE,
        # not in the browser (§16). Forwards have no 10y percentile → the
        # classification is shape-only (a retracement or nothing).
        out = {
            "values": values,
            "deltas": deltas,
            "sortKey": [start, tenor if tenor is not None else 0.0],
            # forwards have no 10y percentile, so the 한 줄 ladder is silent, but
            # the own-history move percentile (§J) drives the matrix tint.
            "oneLiner": classify_one_liner(None, values["now"] is not None),
            "movePct": _cell_move_pct(dataset, start, tenor),
        }
        if name is not None:
            out["keyForward"] = name in key_labels
        return out

    grid = {
        tenor_label: [
            {
                "start": s_label,
                "live": is_live_point(s_t, tenor_t),
                **cell(s_t, tenor_t, f"{s_label}x{tenor_label.replace('F', '')}"),
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
            {"label": label, **cell(s, t), "range10y": _level_range(dataset, s, t)}
            for label, s, t in KEY_FORWARDS
        ],
    }
