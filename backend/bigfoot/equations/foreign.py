# -*- coding: utf-8 -*-
"""Foreign blocks (eq. 4-6): China / Japan / EU / EA + RW placeholder.

Structure per block (Table 1 slots [calib_a, calib_b, rho, spill, oil]):

    eq. 5  output gap:  gap_t = rho·gap_{t-1} + spill·fgap_t + oil·oilgap_{t-1}
    eq. 4  import gap:  mgap_t = lam·gap_t          (lam is among the
                        UNRESOLVED calibration pair -> paper build raises)
    eq. 6  oil-price gap: exogenous AR process, coefficient likewise in the
                        unresolved calibration pair.

RW (rest of world) is UNPUBLISHED: coefficients = mean of the four published
blocks, flag PLACEHOLDER_RW (the 'not paper' ledger).
"""
from __future__ import annotations

import numpy as np

from bigfoot.equations.base import Coefficient, Equation, RESOLVED
from bigfoot.equations.loader import coefficient, load_appendix_d

_CFG = load_appendix_d()
BLOCKS = ("china", "japan", "eu", "ea")


class ForeignBlock(Equation):
    eq_no = "4-6"

    def __init__(self, name: str, rho: Coefficient, spill: Coefficient,
                 oil: Coefficient, lam: Coefficient, flags: tuple = ()):
        super().__init__(name)
        self.rho_c, self.spill_c, self.oil_c, self.lam_c = rho, spill, oil, lam
        self.flags = flags

    # eq. 5
    def output_gap(self, gap_lag, foreign_gap, oil_gap_lag):
        return (self.rho_c.require() * gap_lag
                + self.spill_c.require() * foreign_gap
                + self.oil_c.require() * oil_gap_lag)

    # eq. 4 — requires lam (unresolved for published blocks)
    def import_gap(self, gap):
        return self.lam_c.require() * gap

    def residual(self, gap, gap_lag, foreign_gap, oil_gap_lag):
        return gap - self.output_gap(gap_lag, foreign_gap, oil_gap_lag)


def build(name: str) -> ForeignBlock:
    """Published block from Table 1 (rho/spill/oil PROVISIONAL; lam UNRESOLVED)."""
    p = f"foreign.{name}.slots"
    g = lambda i: coefficient(_CFG, p, i)
    return ForeignBlock(name, rho=g(2), spill=g(3), oil=g(4), lam=g(1))


def build_rw() -> ForeignBlock:
    """RW block: mean of the four published blocks — PLACEHOLDER_RW."""
    vals = {i: float(np.mean([_CFG["foreign"][b]["slots"][i] for b in BLOCKS]))
            for i in (1, 2, 3, 4)}
    mk = lambda i, sym: Coefficient(
        vals[i], sym, RESOLVED,
        "PLACEHOLDER_RW: mean of china/japan/eu/ea slot values",
        "unpublished in paper; ledger entry")
    blk = ForeignBlock("rw", rho=mk(2, "rho_gap"), spill=mk(3, "spillover"),
                       oil=mk(4, "kappa_oil"), lam=mk(1, "calib_b"),
                       flags=("PLACEHOLDER_RW",))
    return blk
