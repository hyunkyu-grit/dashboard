"""Single-swap valuation, ported from the frozen krw-fi-pms engine.

PROVENANCE (owner-approved 2026-07-31, docs/PORT_PROPOSAL.md):
  source: krw-fi-pms-backend, irs_pricer/engine/{fixings,instruments,
          mtm_valuation}.py -- three modules merged into one file here.
  Class and function bodies are BYTE-IDENTICAL to the source. Only the import
  lines differ, and only because the frozen package layout does not exist
  here: `.quant_engine` and `.curve` become `.engine_port`, and `CurveBundle`
  is declared below rather than imported from a module whose other half
  (`build_curve`) needs a `MarketSnapshot` and a DB-backed market-data service
  braveworld has no equivalent of.

  `tests/test_valuation_port.py` re-extracts every body from the frozen source
  and asserts equality, exactly as the curve-side port is guarded. Do NOT edit
  the ported bodies; fix upstream understanding first, then re-port
  deliberately with a provenance note.

NOT ported, deliberately: everything above the engine layer. The frozen
`npv_trace_service` does roughly what this repo's backtest does, but it reaches
for a SQLAlchemy `Session`, trade/trace repositories, booked position ids and a
market-data service. braveworld reads one xlsx and has no database, so the
service is written natively in `app/backtest.py` and only the engine crosses.

UNIT CONVENTION -- DECIMAL AT THIS BOUNDARY. Every rate crossing into this
module is an annualized decimal (0.0251 == 2.51%). Percent exists only inside
`IRS_Trade`'s `*_pct` arguments, and `VanillaSwap.to_irs_trade()` performs that
single decimal->percent conversion. The frozen repo shipped a bug here once -- a
second /100 applied to an already-decimal CD fixing, which crushed the floating
stub ~100x and silently corrupted every P&L surface downstream --  so
`tests/test_valuation_port.py` pins the contract from both sides.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Iterable, Mapping

import numpy as np

from .engine_port import (
    IRS_Trade,
    _is_kr_business_day,
    df_linear_rate,
    forward_rate_simple,
    next_kr_business_day,
)


@dataclass
class CurveBundle:
    """The frozen `engine/curve.py` dataclass, verbatim. Its sibling
    `build_curve()` is NOT ported: that one consumes a `MarketSnapshot`
    assembled by a DB-backed service. braveworld builds the same zero-curve
    array from the xlsx (`app/curves.py`), so only the container crosses."""

    valuation_date: date
    yield_curve: np.ndarray
    par_rates: list[tuple[float, float]]


# -- from engine/fixings.py: the module constant the ported bodies read -------
CD_FIXING_LAG_SEOUL_BDAYS = 1

# -- from engine/fixings.py ------------------------------------------

@dataclass(frozen=True)
class FixingResolution:
    """How one floating period's rate was resolved from the fixing store."""

    reset_date: date
    fixing_date: date          # F(R), always a Seoul business day
    resolved_date: date | None  # store key actually used; None = nothing <= F(R)
    rate: float | None          # decimal; None = period must fall back to the forward
    is_exact: bool              # resolved_date == fixing_date

    @property
    def is_data_quality_event(self) -> bool:
        """True when a period that should be fixed had no fixing dated F(R):
        either an ffill substitution or a total miss. F(R) is a business day
        by construction, so a real print should have existed."""
        return not self.is_exact and _is_kr_business_day(self.fixing_date)

    def to_payload(self) -> dict:
        return {
            "reset_date": self.reset_date.isoformat(),
            "fixing_date": self.fixing_date.isoformat(),
            "resolved_date": self.resolved_date.isoformat() if self.resolved_date else None,
            "rate": self.rate,
        }

def prev_seoul_business_day(d: date, n: int = 1) -> date:
    """`n` Seoul business days strictly before `d` (business-day arithmetic)."""
    out = d
    for _ in range(n):
        out -= timedelta(days=1)
        while not _is_kr_business_day(out):
            out -= timedelta(days=1)
    return out

def fixing_date_for_reset(reset_date: date, lag: int = CD_FIXING_LAG_SEOUL_BDAYS) -> date:
    """F(R): the date whose CD91 print fixes the period resetting on R."""
    if lag <= 0:
        return reset_date
    return prev_seoul_business_day(reset_date, lag)

def select_fixing(
    fixings: Mapping[date, float],
    reset_date: date,
    valuation_date: date,
    lag: int = CD_FIXING_LAG_SEOUL_BDAYS,
) -> FixingResolution | None:
    """Resolve the fixing for a period with reset date `reset_date`.

    Returns None when F(R) is after `valuation_date` -- the period is not yet
    fixed and must be priced off the curve forward. Otherwise returns a
    FixingResolution whose `rate` is the fixing (exact hit at F(R), or ffill
    to the last available print <= F(R)); `rate` is None only when the store
    has nothing on or before F(R) at all.
    """
    f_date = fixing_date_for_reset(reset_date, lag)
    if f_date > valuation_date:
        return None
    exact = fixings.get(f_date)
    if exact is not None:
        return FixingResolution(reset_date, f_date, f_date, exact, True)
    past = [k for k in fixings if k <= f_date]
    if past:
        k = max(past)
        return FixingResolution(reset_date, f_date, k, fixings[k], False)
    return FixingResolution(reset_date, f_date, None, None, False)

def dedupe_data_quality_events(
    resolutions: Iterable[FixingResolution],
) -> list[FixingResolution]:
    """The data-quality warnings in `resolutions`, deduplicated preserving
    order. Valuation loops resolve the same period once per date, so the raw
    stream repeats; consumers log/surface each distinct event once."""
    seen: set[tuple] = set()
    out: list[FixingResolution] = []
    for r in resolutions:
        if not r.is_data_quality_event:
            continue
        key = (r.reset_date, r.fixing_date, r.resolved_date)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out

# -- from engine/instruments.py --------------------------------------

@dataclass
class VanillaSwap:
    tenor_years: int
    notional: float
    fixed_rate: float
    pay_fixed: bool = True  # True = pay fixed / receive float
    float_spread: float = 0.0
    trade_date: date | None = None
    maturity_date: date | None = None  # if set, overrides tenor_years

    def to_irs_trade(self, valuation_date: date) -> IRS_Trade:
        """
        Converts this instrument definition into an executable IRS_Trade schedule
        for pricing. Replaces the old `to_ql_swap` method.
        """
        # Determine effective date (start date)
        if self.trade_date is not None:
            # SPOT_DAYS=1 logic: T+1 business day
            start_dt = next_kr_business_day(self.trade_date)
        else:
            # If no trade date is provided, assume standard spot from valuation
            start_dt = next_kr_business_day(valuation_date)

        # Determine maturity date
        if self.maturity_date is not None:
            mat_dt = self.maturity_date
        else:
            # Unadjusted raw termination date, IRS_Trade handles the modified following
            # internally via _modfol_bd
            mat_dt = start_dt + timedelta(days=round(self.tenor_years * 365))

        direction = -1 if self.pay_fixed else 1
        
        # quant_engine's IRS_Trade expects fixed_rate_pct.
        # Assuming fixed_rate is provided as a decimal (e.g. 0.03 for 3%).
        fixed_rate_pct = self.fixed_rate * 100.0

        return IRS_Trade(
            start_date=start_dt,
            maturity_date=mat_dt,
            fixed_rate_pct=fixed_rate_pct,
            direction=direction,
            notional=self.notional,
            sector="IRS",
            fixed_freq=0.25,
            float_freq=0.25
        )

# -- from engine/mtm_valuation.py ------------------------------------

@dataclass
class CashFlowDetail:
    accrual_start: date
    accrual_end: date
    payment_date: date
    leg: str  # "fixed" | "floating"
    rate: float | None  # known fixing or forward estimate
    is_known: bool
    cashflow: float | None
    pv: float

@dataclass
class MTMResult:
    clean_npv: float
    dirty_npv: float
    accrued_interest: float
    pv_fixed_leg: float
    pv_floating_leg: float
    telescoping_used: bool
    telescoping_diverged: bool
    cashflows: list[CashFlowDetail]
    # One entry per floating period whose F(R) had passed on the valuation
    # date (i.e. per fixing actually consumed). Entries with is_exact=False
    # are the data-quality events services must log/surface.
    fixing_resolutions: list[FixingResolution] = field(default_factory=list)

def settled_cash_between(
    swap: VanillaSwap,
    fixings: Mapping[date, float] | None,
    window_start: date,
    window_end: date,
) -> float:
    """Net cash `swap` actually settles with payment dates in (window_start,
    window_end] — the amount a dirty-basis P&L series must fold back so the
    line stays continuous across coupon/reset dates (the flow leaves the
    valuation schedule at the cutoff `pd > val_date`, but the desk receives it).

    Deterministic WITHOUT a curve: any flow paying by window_end has its reset
    strictly before the payment date, so F(reset) has passed and the float rate
    comes from the fixing store via engine/fixings.select_fixing (reset-date
    semantics, no look-ahead vs window_end). A store with no print at or below
    F(R) values that float side at 0.0 — the same "data missing" degradation
    the valuation surfaces as a fixing warning, never an exception here.

    Sign convention matches dirty_npv: direction * (fixed - float), i.e.
    receive-fixed positive when the fixed leg pays more. s13 (dirty+cash basis
    for historical series); the leg formulas mirror value_booked_trade exactly.
    """
    if window_end <= window_start:
        return 0.0
    irs_trade = swap.to_irs_trade(window_end)
    fixed_rate = irs_trade.fixed_rate_pct / 100.0

    net = 0.0
    for i, pay_date in enumerate(irs_trade.pay_dates):
        if not (window_start < pay_date <= window_end):
            continue
        a_start = irs_trade.pay_dates[i - 1] if i > 0 else irs_trade.start_date
        accrual = irs_trade.accruals[i]
        cf_fixed = irs_trade.notional * fixed_rate * accrual

        resolution = select_fixing(fixings, a_start, window_end) if fixings else None
        float_rate = resolution.rate if resolution is not None and resolution.rate is not None else 0.0
        cf_float = irs_trade.notional * float_rate * accrual

        net += irs_trade.direction * (cf_fixed - cf_float)
    return net

def value_booked_trade(
    swap: VanillaSwap,
    curve: CurveBundle,
    fixings: Mapping[date, float] | None = None,
) -> MTMResult:
    """Revalue `swap` on `curve` against the historical CD91 `fixings` store
    ({date: decimal rate}, passed verbatim from load_fixings()).

    Each floating period's rate is resolved by engine/fixings.py: the CD91
    print of F(R) = reset date - 1 Seoul business day, immutable once F(R)
    has passed, and never a fixing dated after the valuation date (no
    look-ahead on historical valuations). Periods whose F(R) is still in the
    future -- and any period the store cannot cover at all -- are priced off
    the curve's own forward.
    """
    irs_trade = swap.to_irs_trade(curve.valuation_date)
    val_date = curve.valuation_date
    zc = curve.yield_curve

    rem = [i for i, pd in enumerate(irs_trade.pay_dates) if pd > val_date]
    if not rem:
        return MTMResult(0.0, 0.0, 0.0, 0.0, 0.0, False, False, [])

    first_i = rem[0]

    # IRS_Trade carries the fixed rate in percent (quant_engine's *_pct
    # discipline); this is the one sanctioned percent->decimal conversion here.
    fixed_rate = irs_trade.fixed_rate_pct / 100.0

    cashflows: list[CashFlowDetail] = []
    fixing_resolutions: list[FixingResolution] = []

    fixed_pv = 0.0
    float_pv = 0.0

    accrued_interest_fixed = 0.0
    accrued_interest_float = 0.0
    
    for i in rem:
        a_start = irs_trade.pay_dates[i-1] if i > 0 else irs_trade.start_date
        a_end = irs_trade.pay_dates[i]
        t_pay = (a_end - val_date).days / 365.0
        df_pay = df_linear_rate(t_pay, zc)
        
        # Fixed Leg
        cf_fixed = irs_trade.notional * fixed_rate * irs_trade.accruals[i]
        cf_fixed_pv = cf_fixed * df_pay
        fixed_pv += cf_fixed_pv
        
        cashflows.append(CashFlowDetail(a_start, a_end, a_end, "fixed", fixed_rate, True, cf_fixed, cf_fixed_pv))
        
        if i == first_i and val_date > a_start:
            # Calculate accrued portion linearly
            days_accrued = (val_date - a_start).days
            total_days = (a_end - a_start).days
            if total_days > 0:
                accrued_interest_fixed += cf_fixed * (days_accrued / total_days)
    
    t_s = 0.0
    for idx, i in enumerate(rem):
        a_start = irs_trade.pay_dates[i-1] if i > 0 else irs_trade.start_date
        a_end = irs_trade.pay_dates[i]
        t_e = (a_end - val_date).days / 365.0
        df_pay = df_linear_rate(t_e, zc)

        # a_start IS the period's reset date; select_fixing applies the
        # F(R) = R - 1 Seoul-business-day convention and the no-look-ahead
        # guard. Not restricted to idx == 0: on the day before a reset the
        # next period's F(R) has already passed, and its print -- not the
        # forward -- is the period's immutable rate from that day on.
        resolution = select_fixing(fixings, a_start, val_date) if fixings else None
        if resolution is not None:
            fixing_resolutions.append(resolution)
        if resolution is not None and resolution.rate is not None:
            rate = resolution.rate
            is_known = True
        else:
            rate = forward_rate_simple(t_s, t_e, zc, df_fn=df_linear_rate)
            is_known = False

        cf_float = irs_trade.notional * rate * irs_trade.accruals[i]
        cf_float_pv = cf_float * df_pay
        float_pv += cf_float_pv
        
        cashflows.append(CashFlowDetail(a_start, a_end, a_end, "floating", rate, is_known, cf_float, cf_float_pv))
        
        if i == first_i and val_date > a_start:
            days_accrued = (val_date - a_start).days
            total_days = (a_end - a_start).days
            if total_days > 0:
                accrued_interest_float += cf_float * (days_accrued / total_days)
                
        t_s = t_e

    npv = irs_trade.direction * (fixed_pv - float_pv)
    net_accrued = irs_trade.direction * (accrued_interest_fixed - accrued_interest_float)
    clean_npv = npv - net_accrued
    
    return MTMResult(
        clean_npv=clean_npv,
        dirty_npv=npv,
        accrued_interest=net_accrued,
        pv_fixed_leg=-fixed_pv if swap.pay_fixed else fixed_pv,
        pv_floating_leg=float_pv if swap.pay_fixed else -float_pv,
        telescoping_used=False,
        telescoping_diverged=False,
        cashflows=cashflows,
        fixing_resolutions=fixing_resolutions,
    )
