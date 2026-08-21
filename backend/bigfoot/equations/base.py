# -*- coding: utf-8 -*-
"""Equation framework: coefficient provenance + behavioral / PAC classes.

Design rule (absolute): no invented coefficients. Every Coefficient carries a
status and source; building an equation from paper values with UNRESOLVED
slots raises UnresolvedCoefficientError instead of guessing.
"""
from __future__ import annotations

from dataclasses import dataclass, field


class UnresolvedCoefficientError(ValueError):
    """A paper slot could not be uniquely placed; refusing to guess."""


# provenance statuses for resolved-slot bookkeeping
RESOLVED = "RESOLVED"          # unique from structure / named / note-identified
PROVISIONAL = "PROVISIONAL"    # placed by stated convention or owner-note 후보;
                               # flagged for re-check, used in equations
UNRESOLVED = "UNRESOLVED"      # not placed; candidates listed; never used
EXOG_V1 = "EXOG_V1"            # equation held exogenous in Phase 2; slots parked


@dataclass
class Coefficient:
    value: float
    symbol: str
    status: str
    source: str                 # e.g. "appendix_d: consumption.growth[1]"
    basis: str = ""             # why this placement (structure/magnitude/note)
    candidates: list = field(default_factory=list)   # for UNRESOLVED

    def require(self) -> float:
        if self.status == UNRESOLVED:
            raise UnresolvedCoefficientError(
                f"{self.symbol} ({self.source}) is UNRESOLVED; "
                f"candidates: {self.candidates}")
        return float(self.value)


class Equation:
    """Base: a named equation with paper eq. number and provenance flags."""

    eq_no: str = "?"
    flags: tuple = ()

    def __init__(self, name: str):
        self.name = name

    def residual(self, **inputs) -> float:
        """Structural residual at the supplied inputs (0 = equation holds)."""
        raise NotImplementedError


class BehavioralEquation(Equation):
    """Cointegration / target form:  y* = theta' x  (paper 'target' rows).

    coeffs: ordered mapping term-name -> Coefficient. The constant term is
    named 'const'; every other key must be supplied in inputs.
    """

    def __init__(self, name: str, eq_no: str, coeffs: dict):
        super().__init__(name)
        self.eq_no = eq_no
        self.coeffs = coeffs

    def target(self, **inputs) -> float:
        y = 0.0
        for term, c in self.coeffs.items():
            v = c.require()
            y += v if term == "const" else v * float(inputs[term])
        return y

    def residual(self, y_star: float, **inputs) -> float:
        return float(y_star) - self.target(**inputs)


class PACEquation(Equation):
    """Polynomial-adjustment-cost growth equation (paper 'growth' rows):

        dy_t = a0 + alpha*(y*_{t-1} - y_{t-1}) + sum_j gamma_j dy_{t-j}
               + phi * F_t + sum_k delta_k * z_{k,t}

    F_t is the expectation term of paper eq. (3): the infinite discounted sum
    of expected target changes, **expectations dated t-1, summation starting
    at the current-period change (j=0)** — wired below as
    engine.pac_weights(target, beta, start_index=0, expectation_date='t-1').
    This is the Phase-2 CONVENTION FIX over the Phase-1 default (j0=1, E_t);
    tests/test_equations.py::test_pac_convention locks it.

    Phase-2 note: the engine's core variables proxy the equation's own target
    process; wiring each equation's true y* projection through AugmentedVAR
    is Phase 3 work.
    """

    PAC_START_INDEX = 0
    PAC_EXPECTATION_DATE = "t-1"

    def __init__(self, name: str, eq_no: str, a0: Coefficient,
                 alpha: Coefficient, gammas: list, phi: Coefficient,
                 deltas: dict = None, engine=None, target_index: int = 0,
                 beta: float = 0.95):
        super().__init__(name)
        self.eq_no = eq_no
        self.a0, self.alpha, self.gammas = a0, alpha, gammas
        self.phi, self.deltas = phi, (deltas or {})
        self.engine, self.target_index, self.beta = engine, target_index, beta

    @property
    def pac_args(self) -> tuple:
        return (self.PAC_START_INDEX, self.PAC_EXPECTATION_DATE)

    def expectation_term(self, state_tm1) -> float:
        """F_t from the satellite VAR, state = x_{t-1} (paper eq. 3 dating)."""
        return self.engine.pac_term(
            self.target_index, self.beta, state=state_tm1,
            start_index=self.PAC_START_INDEX,
            expectation_date=self.PAC_EXPECTATION_DATE)

    def growth(self, ecm_lag: float, dy_lags: list, F: float,
               extras: dict = None) -> float:
        dy = (self.a0.require() + self.alpha.require() * ecm_lag
              + sum(g.require() * l for g, l in zip(self.gammas, dy_lags))
              + self.phi.require() * F)
        for k, c in self.deltas.items():
            dy += c.require() * float((extras or {})[k])
        return dy

    def residual(self, dy: float, **kw) -> float:
        return float(dy) - self.growth(**kw)
