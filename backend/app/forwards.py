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
import threading

import numpy as np

from .curves import par_rates_at_index
from .dataset import Dataset
from .derive import ANNUAL_OBS, BASIS_KEYS, basis_dates
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

# Named key forwards (§8): (label, start, tenor). Re-picked by the owner on
# 2026-07-31 — the front end of the ladder (3M/6M/9M starts on a 3M tenor) is
# where the policy path is actually read, so 2Yx2Y and 3Yx3Y gave way to
# 3Mx3M and 9Mx3M. They are still in the 전체 list and the matrix; only the
# 주요 block changed.
KEY_FORWARDS: list[tuple[str, float, float]] = [
    ("3Mx3M", 0.25, 0.25),
    ("6Mx3M", 0.5, 0.25),
    ("9Mx3M", 0.75, 0.25),
    ("1Yx1Y", 1.0, 1.0),
    ("2Yx1Y", 2.0, 1.0),
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

# Two readers asking for the same UNCACHED series computed it twice: 5,216
# bootstraps where one pass is 2,608, ~3.7s wall (Pass A, §4). Identical
# results, so this was waste rather than error — but waste proportional to the
# number of simultaneous readers, and endpoints run in FastAPI's threadpool so
# it is genuinely concurrent. The lock is PER SERIES: two different forwards
# still build in parallel, only the duplicate is serialised.
_fh_locks: dict[str, threading.Lock] = {}
_fh_locks_guard = threading.Lock()


def _lock_for(fid: str) -> threading.Lock:
    with _fh_locks_guard:
        return _fh_locks.setdefault(fid, threading.Lock())


def parse_forward_id(fid: str) -> tuple[float, float | None]:
    """'2Yx1Y' → (start_years, tenor_years); '2YxSPOT' → (start_years, None)."""
    start, _, tenor = fid.partition("x")
    if start not in START_YEARS or tenor not in TENOR_YEARS:
        raise KeyError(fid)
    return START_YEARS[start], TENOR_YEARS[tenor]


def forward_history(dataset: Dataset, fid: str) -> list[dict]:
    """10y daily history of a forward, rebuilt from each date's curve. Cached."""
    hit = _forward_history_cache.get(fid)
    if hit is not None:
        return hit
    # validate OUTSIDE the lock: a bad id should fail immediately rather than
    # queue behind someone else's 3.7s bootstrap run
    start_y, tenor_y = parse_forward_id(fid)
    with _lock_for(fid):
        # the wait may have been for exactly this series being filled in
        hit = _forward_history_cache.get(fid)
        if hit is not None:
            return hit
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
_hist_zc_lock = threading.Lock()


def _historical_curves(dataset: Dataset) -> list[np.ndarray | None]:
    """The whole 10y of bootstrapped curves, built once (~13s)."""
    global _hist_zc
    if _hist_zc is not None:
        return _hist_zc
    # Same duplicated-work shape as forward_history, and 13s of it: without
    # the lock, every reader who arrives before the first one finishes builds
    # their own copy.
    with _hist_zc_lock:
        if _hist_zc is None:
            out: list[np.ndarray | None] = []
            for i in range(len(dataset.dates)):
                pars = par_rates_at_index(dataset, i)
                out.append(bootstrap_zero_curve(pars) if len(pars) >= 2 else None)
            _hist_zc = out
    return _hist_zc


def _cell_history(dataset: Dataset, start: float,
                  tenor: float | None) -> list[float]:
    """This forward's whole daily history in DECIMAL, off the shared curve
    cache. Both statistics below read this ONE list: the move percentile used
    to be built here per cell and the level range separately per key forward,
    which repriced the same series twice. Every cell now needs both (pass L
    puts the 52-week range in the table's last column), so the two pass over
    one list — strictly less work than before, and identical arithmetic."""
    zcs = _historical_curves(dataset)
    return [forward_par_rate(z, start, tenor) for z in zcs if z is not None]


def _move_pct(vals: list[float]) -> float | None:
    """Percentile of today's |Δ| within this forward's own daily-change history
    (§J). None if too little history. Scale-free — `vals` stay in decimal so the
    comparisons are bit-for-bit what they were before the shared-history
    refactor."""
    diffs = [abs(vals[i] - vals[i - 1]) for i in range(1, len(vals))]
    if len(diffs) < 30:
        return None
    x = diffs[-1]
    return round(100.0 * sum(1 for d in diffs if d <= x) / len(diffs), 1)


def _level_range(vals: list[float]) -> dict:
    """52-week LEVEL range + average + percentile for a forward (§8 gauge,
    Pass E; annual window per the annual-stats session — the 10y window
    straddled the regime break and pinned every gauge at the top). In percent
    to match `values` (×100). This is a LEVEL distribution — distinct from
    the |Δ| move percentile above that drives the matrix tint, which stays on
    the FULL history on purpose. None-filled if too little history."""
    window = [v * 100.0 for v in vals][-ANNUAL_OBS:]
    if len(window) < 30:
        return {"min": None, "max": None, "avg": None, "pct": None}
    now = window[-1]
    return {
        "min": round(min(window), 4),
        "max": round(max(window), 4),
        "avg": round(sum(window) / len(window), 4),
        "pct": round(100.0 * sum(1 for v in window if v <= now) / len(window), 1),
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
        # Sort key and keyForward flag are computed HERE, not in the browser
        # (§16), as are both history statistics — one repricing pass, two uses.
        hist = _cell_history(dataset, start, tenor)
        level = _level_range(hist)
        out = {
            "values": values,
            "deltas": deltas,
            "sortKey": [start, tenor if tenor is not None else 0.0],
            # 52-week LEVEL high/low/mean — the table's last column (pass L).
            # `pct` is dropped for a GRID cell on purpose: nothing reads a
            # forward's level percentile (the 고점권/저점권 chips are wired to
            # the summary rows only), and shipping a field no consumer reads is
            # what §20 exists to prevent. The key-forward gauge does read it, so
            # the keyForwards block below keeps the full record.
            "range1y": {k: level[k] for k in ("min", "max", "avg")},
            # own-history move percentile (§J) — drives the matrix tint.
            "movePct": _move_pct(hist),
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
        # the gauge needs the percentile too, so a key forward overrides the
        # grid cell's min/max/avg-only record with the full one
        "keyForwards": [
            {
                "label": label,
                **cell(s, t),
                "range1y": _level_range(_cell_history(dataset, s, t)),
            }
            for label, s, t in KEY_FORWARDS
        ],
    }
