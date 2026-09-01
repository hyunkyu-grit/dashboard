"""A from-scratch pricer, written from the term sheet — not from the engine.

## Why from scratch rather than a third-party library

The original plan was to cross-check against `rateslib`. Two things ruled that
out. Its licence forbids use directed toward business operations (2.7.1 is a
bespoke dual licence, not the CC BY-NC-ND the plan assumed), and — more to the
point — D0.3a found **there is no QuantLib path in this backend to check
against**. QuantLib 1.42.1 is installed and imported by nothing; the product
prices off a ported engine (`app/engine_port.py`).

That makes an independent library the *weaker* option anyway: two libraries can
share a conventional mistake, whereas a definition written out from the term
sheet cannot. So this module states the definitions and nothing else.

## Independence, concretely

Where possible the derivation differs in FORM from the engine's, so that
agreement means something:

- The engine accumulates the float leg stub by stub with an explicit forward
  rate per period. Here it is derived by **telescoping**: for a vanilla swap
  whose float accruals match its forward periods, the projected float PV past
  the current stub collapses to `DF(t_1) - DF(t_N)`. Agreement therefore tests
  the forward-rate construction and the DF interpolation, not just arithmetic.
- The engine's bond price discounts every flow at a single yield. Here the
  schedule is built explicitly and each flow discounted on its own, so a
  frequency or accrual error shows up as a residual instead of cancelling.

## Conventions honoured

- **Dirty basis throughout.** Clean/dirty mixing caused a prior accrual leak;
  clean is only ever produced as `dirty - accrued`, never carried separately.
- **CD91 fixing = reset date − 1 bank business day**, on the calendar
  canonicalised in `research/calendar/canonical.py` (i.e. including 근로자의 날,
  which the backend's own calendar misses).
- Coupon frequency and day count are taken as parameters, never assumed —
  `FREQ_PRODUCT` records what the product actually does so the comparison can
  separate a convention difference from an implementation error.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import numpy as np

# The product (`app/cashbond.py:61`) discounts KTB cash flows QUARTERLY.
# Korean Treasury Bonds pay SEMI-ANNUAL coupons. Both are recorded; the
# residual report quantifies what the difference is worth rather than
# asserting which is intended.
FREQ_PRODUCT = 4
FREQ_KTB_TERM_SHEET = 2
ACT_BASIS = 365.0


# ── bond ────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BondFlow:
    k: int          # coupon number, 1-based
    tau: float      # years from valuation to this flow
    coupon: float   # coupon cash on face 1
    principal: float


def bond_schedule(coupon: float, n_periods: int, elapsed: float,
                  freq: int = FREQ_PRODUCT) -> list[BondFlow]:
    """Remaining flows on face 1.

    Flow k sits at `k/freq` years from ISSUE; `elapsed` years have passed, so
    it sits `k/freq - elapsed` years from VALUATION. Flows at or before
    valuation have been paid and are dropped. The final flow carries principal.
    """
    c = coupon / freq
    out: list[BondFlow] = []
    for k in range(1, n_periods + 1):
        tau = k / freq - elapsed
        if tau <= 1e-9:
            continue
        out.append(BondFlow(k=k, tau=tau, coupon=c,
                            principal=1.0 if k == n_periods else 0.0))
    return out


def bond_dirty(y: float, coupon: float, n_periods: int, elapsed: float,
               freq: int = FREQ_PRODUCT) -> float:
    """Dirty price on face 1, each flow discounted on its own.

    Discounting is compounded at the coupon frequency: `(1 + y/freq)^(-freq*tau)`.
    """
    q = 1.0 + y / freq
    return sum((f.coupon + f.principal) * q ** (-freq * f.tau)
               for f in bond_schedule(coupon, n_periods, elapsed, freq))


def bond_accrued(coupon: float, elapsed: float, freq: int = FREQ_PRODUCT) -> float:
    """Accrued interest on face 1: the fraction of the current period elapsed,
    times the period coupon. Zero immediately after a coupon date, converging
    to a full period immediately before the next one."""
    period = 1.0 / freq
    if elapsed < 0:
        return 0.0
    frac = (elapsed % period) / period
    return (coupon / freq) * frac


def bond_clean(y: float, coupon: float, n_periods: int, elapsed: float,
               freq: int = FREQ_PRODUCT) -> float:
    """Clean is DERIVED, never carried. This is the accrual-leak guard."""
    return bond_dirty(y, coupon, n_periods, elapsed, freq) - bond_accrued(coupon, elapsed, freq)


def bond_dv01(y: float, coupon: float, n_periods: int, elapsed: float,
              freq: int = FREQ_PRODUCT, bump_bp: float = 1.0) -> float:
    """Central-difference DV01 on face 1, per 1bp. Positive for a long."""
    h = bump_bp * 1e-4 / 2.0
    up = bond_dirty(y + h, coupon, n_periods, elapsed, freq)
    dn = bond_dirty(y - h, coupon, n_periods, elapsed, freq)
    return -(up - dn)


# ── IRS ─────────────────────────────────────────────────────────────────────


def annuity(pay_taus: list[float], accruals: list[float],
            df_fn, zc: np.ndarray) -> float:
    """Σ accrual_i · DF(t_i) — the fixed-leg PV01 per unit notional per unit
    rate. Everything about a vanilla swap follows from this and the DFs."""
    return sum(a * df_fn(t, zc) for t, a in zip(pay_taus, accruals))


def irs_npv_telescoped(
    *,
    notional: float,
    direction: int,
    fixed_rate: float,
    pay_taus: list[float],
    accruals: list[float],
    current_float_rate: float,
    df_fn,
    zc: np.ndarray,
) -> float:
    """NPV = direction · (fixed PV − float PV), float leg by telescoping.

    Fixed PV  = N · K · Σ a_i · DF(t_i)

    Float PV  = N · [ f_0 · a_0 · DF(t_1)          (current stub — fixing known)
                    + (DF(t_1) − DF(t_N)) ]         (all later stubs, telescoped)

    The second term is the standard identity for a vanilla float leg with no
    spread: each projected flow is `N·(DF(t_{i-1})/DF(t_i) − 1)/a_i · a_i ·
    DF(t_i)`, which is `N·(DF(t_{i-1}) − DF(t_i))`, and the sum collapses.

    Deriving it this way rather than accumulating forwards is the whole point
    of this module: it reaches the same number by a different route, so a match
    is evidence about the curve and the interpolation, not about arithmetic.
    """
    if not pay_taus:
        return 0.0

    fixed_pv = notional * fixed_rate * annuity(pay_taus, accruals, df_fn, zc)

    t1 = pay_taus[0]
    tN = pay_taus[-1]
    stub = notional * current_float_rate * accruals[0] * df_fn(t1, zc)
    projected = notional * (df_fn(t1, zc) - df_fn(tN, zc)) if len(pay_taus) > 1 else 0.0
    float_pv = stub + projected

    return direction * (fixed_pv - float_pv)


def par_rate(pay_taus: list[float], accruals: list[float],
             current_float_rate: float, df_fn, zc: np.ndarray) -> float:
    """The fixed rate that sets NPV to zero — an independent read on the curve.

    Solved in closed form from the same two pieces, so it needs no root find.
    """
    a = annuity(pay_taus, accruals, df_fn, zc)
    if a <= 0:
        return float("nan")
    t1, tN = pay_taus[0], pay_taus[-1]
    float_pv = current_float_rate * accruals[0] * df_fn(t1, zc)
    if len(pay_taus) > 1:
        float_pv += df_fn(t1, zc) - df_fn(tN, zc)
    return float_pv / a


# ── CD91 fixing, on the canonical calendar ──────────────────────────────────


def cd91_fixing_date(reset_date: dt.date) -> dt.date:
    """Reset date − 1 **bank** business day. Delegates to the canonical
    calendar so this module cannot drift from `research/calendar/`."""
    from research.calendar.canonical import prev_bank_business_day

    return prev_bank_business_day(reset_date)
