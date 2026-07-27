"""Per-leg DV01 and DV01-neutral curve-trade weights (Session 16 Pass B).

Nobody trades a curve spread or a butterfly at equal notionals; they are
weighted **DV01-neutral**, and once they are, the quoted value (`r_long −
r_short`, `2·r_belly − r_short − r_long`) is exactly the P&L driver. This module
serves the weights a trader actually has to execute.

Per §16 this is calculation, so it happens here, not in the browser. QuantLib is
available in this environment, but the whole product prices off the byte-
identical ported engine's bootstrapped curve; introducing a second engine risks
two curves disagreeing. So DV01 is the par-swap **PV01 = annuity** read straight
off that same bootstrapped zero curve — the standard curve-trade DV01 proxy and
the exact quantity the neutral weighting depends on.

Weighting (Pass B):
    spread:  N_short·d_short = N_long·d_long          → long leg normalised to 100
    fly:     N_wing·d_wing   = ½·N_belly·d_belly       → belly normalised to 100
so the net DV01 under those weights is zero by construction; the residual from
the *rounded* integer notionals is shipped and asserted small as a cheap check
that the weighting and the curve agree.
"""

from __future__ import annotations

import numpy as np

from .curves import TENOR_T
from .engine_port import df


def pv01(zc: np.ndarray, tenor_years: float) -> float:
    """Par-swap annuity to `tenor_years` off the bootstrapped zero curve — the
    per-unit-notional DV01 proxy. Sub-quarterly (ON) collapses to a simple
    money-market accrual."""
    if tenor_years < 0.25:
        return float(tenor_years * df(tenor_years, zc))
    n = round(tenor_years * 4)
    return float(0.25 * sum(df(0.25 * (i + 1), zc) for i in range(n)))


def _leg(tenor: str, zc: np.ndarray, notional: float | None) -> dict:
    return {
        "tenor": tenor,
        "dv01": round(pv01(zc, TENOR_T[tenor]), 6),
        "notional": notional,
    }


def dv01_payload(series_id: str, kind: str, zc: np.ndarray) -> dict:
    """Leg DV01s + the DV01-neutral notional ratio (normalised to 100) for an
    outright / spread / fly. Other kinds get an empty block."""
    tenors = series_id.split("-")
    d = {t: pv01(zc, TENOR_T[t]) for t in tenors}

    if kind == "outright":
        return {
            "id": series_id, "kind": "outright",
            "legs": [_leg(tenors[0], zc, None)], "residual": None,
        }

    if kind == "spread":
        short, long = tenors  # derived ids are tenor-ascending
        n_short = round(100.0 * d[long] / d[short])
        legs = [_leg(short, zc, n_short), _leg(long, zc, 100)]
        residual = round(100.0 * d[long] - n_short * d[short], 6)
        return {"id": series_id, "kind": "spread", "legs": legs, "residual": residual}

    if kind == "fly":
        s, b, l = tenors  # short wing, belly, long wing (ascending)
        n_s = round(50.0 * d[b] / d[s])
        n_l = round(50.0 * d[b] / d[l])
        legs = [_leg(s, zc, n_s), _leg(b, zc, 100), _leg(l, zc, n_l)]
        residual = round(100.0 * d[b] - n_s * d[s] - n_l * d[l], 6)
        return {"id": series_id, "kind": "fly", "legs": legs, "residual": residual}

    return {"id": series_id, "kind": None, "legs": [], "residual": None}


def build_dv01_table(zc: np.ndarray, derived_ids_fn) -> dict[str, dict]:
    """Precompute the DV01 block for every outright and derived id at the current
    curve (cheap; a handful of annuities each)."""
    out: dict[str, dict] = {}
    for tenor in TENOR_T:
        out[tenor] = dv01_payload(tenor, "outright", zc)
    for sid, kind, _legs in derived_ids_fn():
        out[sid] = dv01_payload(sid, kind, zc)
    return out
