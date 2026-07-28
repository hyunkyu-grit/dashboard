"""Carry & roll (carry session, Pass C) — mechanics, not prediction.

What holding an instrument EARNS over a horizon follows deterministically
from today's curve: no forecast, nothing to validate, no scores or ratings.
Figures are computed for the PAY side; Receive is the exact negation and the
browser applies it, exactly as the Pay/Receive diagram does (§16: the
backend computes, the browser formats).

Formulas (bp of the quoted value; horizon h in years, tenor T):

  Outright (pay fixed, tenor T):
    carry = S(T) − F(h, T−h)      the accrual piece: fixed-vs-floating net
                                  funding, via the identity
                                  F(h,T−h) − S(T) ≈ (S(T) − short)·h/A(T−h)
    roll  = S(T−h) − S(T)         the curve-shape piece: where the residual
                                  (T−h)-tenor swap is quoted on TODAY's curve
    total = carry + roll = S(T−h) − F(h, T−h)
    On an upward-sloping curve both terms are NEGATIVE for the payer — the
    sign check in Pass E. T−h ≤ 0 → no figure (null).

  Spread (quote = R_long − R_short) and fly (quote = 2·R_belly − R_s − R_l):
    the leg figures combine with the QUOTE weights (+1/−1; +2/−1/−1). The
    DV01-neutral weights from dv01.py set the legs' NOTIONALS; in bp of the
    quoted value they are already embedded — a DV01-neutral position's P&L
    per bp of the quote is constant, so the bp figure is exactly the
    quote-weighted combination. Do not re-apply the dv01 ratios here.

  Forward (a×b): at horizon the position is the (a−h)×b forward swap (same
    real-world dates), so the whole figure is roll on today's curve:
    roll = F(a−h, b) − F(a, b), carry = 0 (nothing has started accruing).
    a−h is floored at 0; the seasoning of a partially-started swap when
    h > a is ignored — recorded approximation, only touches long horizons
    on near starts.

  Volatility: a ratio has no carry statement → null.

The engine's forward_par_rate rounds a tenor to quarter multiples, which
would quantize the 1M horizon's off-grid tenors (e.g. 9.9167y) to the grid —
roll would read exactly 0, an artifact. Interpolating par between quarter
tenors is no better: the upper neighbour's end date extrapolates past the
curve's 10y edge (F(1M, 10Y) ends at 10.083y). So this module prices par
EXACTLY on a quarterly schedule anchored at the END date with a front stub:
no quantization, and every end date used stays ≤ the curve's last node by
construction (h + (T−h) = T).
"""

from __future__ import annotations

import re

import numpy as np

from .engine_port import df
from .forwards import forward_par_rate

# horizon labels → years; all four ship at once, the browser picks (§16)
HORIZONS: dict[str, float] = {"1M": 1.0 / 12.0, "3M": 0.25, "6M": 0.5, "1Y": 1.0}

_QUARTER = 0.25
_EPS = 1e-9

# "10Y" → 10, "1.5Y" → 1.5, "9M" → 0.75, "1Y3M" → 1.25 (forward starts).
# Anything else (1D, ON, junk) → inf, which downstream turns into null —
# the 1D call rate has no swap carry statement.
_LBL = re.compile(r"^(?:(\d+(?:\.\d+)?)Y)?(?:(\d+)M)?$")


def _label_years(label: str) -> float:
    m = _LBL.match(label)
    if not m or (m.group(1) is None and m.group(2) is None):
        return float("inf")
    return float(m.group(1) or 0) + int(m.group(2) or 0) / 12.0


def _par_bp(zc: np.ndarray, start: float, tenor: float) -> float:
    """Forward par rate in bp (×10⁴ of decimal). On-grid tenors go through
    the engine's forward_par_rate (byte-identical to everything else built on
    it); off-grid tenors are priced exactly on an end-anchored quarterly
    schedule with a front stub (see module docstring)."""
    q = tenor / _QUARTER
    if abs(q - round(q)) < 1e-6:
        return forward_par_rate(zc, start, tenor) * 1e4
    s, e = start, start + tenor
    if tenor < _QUARTER - _EPS:  # sub-quarterly: simple money-market rate
        return (df(s, zc) / df(e, zc) - 1.0) / tenor * 1e4
    times: list[float] = []
    t = e
    while t > s + _EPS:
        times.append(t)
        t -= _QUARTER
    times.reverse()  # first entry is the (possibly stub) front payment
    annuity = 0.0
    prev = s
    for ti in times:
        annuity += (ti - prev) * df(ti, zc)
        prev = ti
    return (df(s, zc) - df(e, zc)) / annuity * 1e4


def _outright_leg(zc: np.ndarray, T: float, h: float) -> dict | None:
    """PAY-side carry/roll for a single outright leg, in bp."""
    if T - h <= _EPS:
        return None  # the swap matures inside the horizon
    s_T = _par_bp(zc, 0.0, T)
    s_res = _par_bp(zc, 0.0, T - h)
    f_res = _par_bp(zc, h, T - h)
    carry = s_T - f_res
    roll = s_res - s_T
    return {"carry": carry, "roll": roll}


def _forward_leg(zc: np.ndarray, a: float, b: float, h: float) -> dict:
    """PAY-side figure for an a×b forward swap: all roll (see docstring)."""
    entry = _par_bp(zc, a, b)
    rolled = _par_bp(zc, max(0.0, a - h), b)
    return {"carry": 0.0, "roll": rolled - entry}


def _combine(legs: list[tuple[float, dict | None]]) -> dict | None:
    """Quote-weighted combination; any missing leg voids the figure."""
    if any(f is None for _w, f in legs):
        return None
    carry = sum(w * f["carry"] for w, f in legs)  # type: ignore[index]
    roll = sum(w * f["roll"] for w, f in legs)  # type: ignore[index]
    return {
        "carry": round(carry, 2),
        "roll": round(roll, 2),
        "total": round(carry + roll, 2),
    }


def carry_payload(series_id: str, zc: np.ndarray) -> dict:
    """All four horizons for one instrument id, PAY side, bp of the quote.
    Volatility / unknown ids get null horizons — no carry statement."""
    horizons: dict[str, dict | None] = {}

    def fill(fn) -> None:
        for label, h in HORIZONS.items():
            horizons[label] = fn(h)

    if series_id.startswith("vol:"):
        fill(lambda h: None)
    elif "x" in series_id:
        a_lbl, b_lbl = series_id.split("x")
        a, b = _label_years(a_lbl), _label_years(b_lbl)
        if not (np.isfinite(a) and np.isfinite(b)) or b <= _EPS:
            fill(lambda h: None)
        else:
            fill(lambda h: _combine([(1.0, _forward_leg(zc, a, b, h))]))
    else:
        legs = [_label_years(t) for t in series_id.split("-")]
        if not all(np.isfinite(t) and t > _EPS for t in legs):
            fill(lambda h: None)
        elif len(legs) == 1:
            fill(lambda h: _combine([(1.0, _outright_leg(zc, legs[0], h))]))
        elif len(legs) == 2:
            s, l_ = legs  # quote = long − short
            fill(lambda h: _combine([
                (1.0, _outright_leg(zc, l_, h)),
                (-1.0, _outright_leg(zc, s, h)),
            ]))
        elif len(legs) == 3:
            s, b, l_ = legs  # quote = 2·belly − short − long
            fill(lambda h: _combine([
                (2.0, _outright_leg(zc, b, h)),
                (-1.0, _outright_leg(zc, s, h)),
                (-1.0, _outright_leg(zc, l_, h)),
            ]))
        else:
            fill(lambda h: None)

    return {"id": series_id, "unit": "bp", "side": "pay", "horizons": horizons}
