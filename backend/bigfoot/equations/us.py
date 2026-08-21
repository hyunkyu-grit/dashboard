# -*- coding: utf-8 -*-
"""US block — small NK model, Carabenciov et al. (2008), IMF WP/08/278.

SOURCE_QPM2008: coefficients are the published POSTERIOR MODES from the
paper's "Results From Posterior Maximization (parameters), Base Case Model"
table (the benchmark model WITHOUT financial-real linkages), retrieved from
the IMF eLibrary full text on 2026-08-05. The task asked for posterior
means; the paper reports posterior modes — flagged, not silently swapped.
Role assignment is confirmed by the paper's own prior-vs-posterior
discussion (lag weight up from 0.75, lead up from 0.15, rate down from
0.20, forward PC weight up from 0.50, smoothing up from 0.50).

    IS:  y_t = b1·y_{t-1} + b2·y_{t+1} - b3·(rr_{t-1} - rr̄)
    PC:  pi_t = l1·pi4_{t+4} + (1-l1)·pi4_{t-1} + l2·y_{t-1}
    MP:  i_t = g1·i_{t-1} + (1-g1)·[rr̄ + pi4_{t+3} + g2·(pi4_{t+3}-pi*) +
               g4·y_t] + eps_t

Interface: identical to the other foreign blocks (output gap out, import gap
out, oil in) PLUS the financial channel: US 10y = expected short rates +
US term premium (identity, no estimated coefficients).
"""
from __future__ import annotations

import numpy as np

from bigfoot.equations.base import Equation

# SOURCE_QPM2008 posterior modes (base case model, WP/08/278)
B1, B2, B3 = 0.8523, 0.1674, 0.1270          # beta_us1, beta_us2, beta_us3
L1, L2 = 0.7272, 0.1937                      # lambda_us1, lambda_us2
G1, G2, G4 = 0.7087, 1.2679, 0.2192          # gamma_us1, gamma_us2, gamma_us4
RR_BAR = 1.8221                              # rr̄_us (SS real rate, %)
G_SS = 2.6016                                # ḡ_Yss (SS output growth, %)
PI_STAR = 2.0

# ---- Phase-4.7 US term-premium FIR kernel (FORM_TP_FIR) -------------------
#   tp_us_t = sum_{k=0}^{11} TP_KERNEL[k] * (i_us_{t-k} - baseline_{t-k})
# CALIBRATED_PYFRBUS_KERNEL under TP_TRUTH_PYFRBUS (pyfrbus = declared
# truth source for the US term structure). Fitted by ridge-NNLS
# (bigfoot/solve/tpus3.py, 2026-08-05) so model US10y (= EH 40q mean + tp)
# matches pyfrbus rg10 on TWO imposed policy paths simultaneously —
# one-off +25bp x 1q (max err 0.7bp) and sustained HFL +100bp x 4q (max
# err 1.8bp) — and validated on a fit-forbidden holdout (+50bp x 2q):
# mean |gap| 0.4bp, peak err 0.4bp (gates 15/20bp). Every fit/validation
# input is a pyfrbus policy triple IMPOSED on this block (the desk
# conditional-forecast drive); QPM-INTERNAL rule-shock IRFs drive the
# kernel out-of-family — their 10y shape inherits QPM's sharp policy
# reversal, not pyfrbus's (recorded caveat). The unconstrained kernel had
# 4 sign flips -> NNLS per the phase rule; kernel sum 0.8712; tp == 0 at
# baseline by construction (FIR of a zero path).
# Superseded: the 4.5 AR(1)-on-level (TP_RHO 0.65, TP_THETA 0.642) —
# rejected by the 4.6 two-moment test; history in tpus{,2}.py + git.
TP_KERNEL = np.array([0.31806, 0.0, 0.14631, 0.0, 0.0503, 0.05415,
                      0.04932, 0.05419, 0.05003, 0.05052, 0.04895, 0.04942])

FLAGS = ("SOURCE_QPM2008", "FORM_TP_FIR", "CALIBRATED_PYFRBUS_KERNEL",
         "TP_TRUTH_PYFRBUS")


def tp_us_path(i_dev_path) -> np.ndarray:
    """Term-premium deviation path from a policy-rate deviation path
    (FIR convolution; zero-padded history before t=0)."""
    i = np.asarray(i_dev_path, dtype=float)
    K = len(TP_KERNEL)
    tp = np.zeros(len(i))
    for t in range(len(i)):
        lo = max(0, t - K + 1)
        tp[t] = float(TP_KERNEL[: t - lo + 1] @ i[lo: t + 1][::-1])
    return tp


class USBlock(Equation):
    eq_no = "QPM2008 (1)-(3)"
    flags = FLAGS

    def __init__(self):
        super().__init__("us_block")

    # ---- foreign-block interface -------------------------------------
    def output_gap_eq(self, y_lag, y_lead, rr_gap_lag):
        return B1 * y_lag + B2 * y_lead - B3 * rr_gap_lag

    def phillips(self, pi4_lead4, pi4_lag, y_lag):
        return L1 * pi4_lead4 + (1.0 - L1) * pi4_lag + L2 * y_lag

    def rule(self, i_lag, pi4_lead3, y, shock=0.0):
        tgt = RR_BAR + pi4_lead3 + G2 * (pi4_lead3 - PI_STAR) + G4 * y
        return G1 * i_lag + (1.0 - G1) * tgt + shock

    def import_gap(self, y):
        # same linkage form as the other foreign blocks; the loading is the
        # unresolved Table-1 calibration slot — Phase 3 wires it. Structure
        # placeholder returns the gap itself (unit loading) with no claim.
        return y

    def us_10y(self, expected_short_path, term_premium):
        """Financial channel: 10y = mean expected short rate over 40q + TP."""
        return float(np.mean(expected_short_path)) + term_premium

    # ---- standalone path simulation (Phase-2 shape test + Phase-4 tools) --
    NV = 3                           # y, pi, i per period
    ROW_NAMES = ("us_is", "us_pc", "us_rule")

    def stacked_matrix(self, T: int) -> np.ndarray:
        """The 3T x 3T perfect-foresight system matrix (deviation form,
        steady-state terminal conditions). Row nv*t+k is equation
        ROW_NAMES[k] at period t; equation residuals enter the RHS
        additively on their own row.

        Timing (GPM):  pi4_t = mean(pi_{t-3..t});  rr_t = i_t - pi4_{t+4}.
            IS:  y_t = B1 y_{t-1} + B2 y_{t+1} - B3 rr_{t-1}         + u_is
            PC:  pi_t = L1 pi4_{t+4} + (1-L1) pi4_{t-1} + L2 y_{t-1} + u_pc
            MP:  i_t = G1 i_{t-1} + (1-G1)[(1+G2) pi4_{t+3} + G4 y_t] + u_mp
        """
        nv = self.NV
        A = np.zeros((nv * T, nv * T))
        Y, PI, I = 0, 1, 2

        def add(row, var, t, coef):
            if 0 <= t < T:
                A[row, nv * t + var] += coef

        def add_pi4(row, t_end, coef):
            for s in range(t_end - 3, t_end + 1):
                add(row, PI, s, coef / 4.0)

        for t in range(T):
            r = nv * t + Y
            add(r, Y, t, 1.0)
            add(r, Y, t - 1, -B1)
            add(r, Y, t + 1, -B2)
            add(r, I, t - 1, B3)
            add_pi4(r, t + 3, -B3)           # rr_{t-1} = i_{t-1} - pi4_{t+3}
            r = nv * t + PI
            add(r, PI, t, 1.0)
            add_pi4(r, t + 4, -L1)
            add_pi4(r, t - 1, -(1.0 - L1))
            add(r, Y, t - 1, -L2)
            r = nv * t + I
            add(r, I, t, 1.0)
            add(r, I, t - 1, -G1)
            add_pi4(r, t + 3, -(1.0 - G1) * (1.0 + G2))
            add(r, Y, t, -(1.0 - G1) * G4)
        return A

    def _rhs(self, T: int, shock_bp: float = 0.0,
             residuals: dict = None) -> np.ndarray:
        b = np.zeros(self.NV * T)
        b[self.NV * 0 + 2] = shock_bp / 100.0
        for k, name in enumerate(self.ROW_NAMES):
            u = (residuals or {}).get(name)
            if u is not None:
                u = np.asarray(u, dtype=float)
                b[k::self.NV][: len(u)] += u[:T]
        return b

    def simulate_shock(self, shock_bp: float = 25.0, T: int = 80,
                       residuals: dict = None):
        """Solve the stacked system for a rule shock and/or additive
        equation-residual paths ({'us_is'|'us_pc'|'us_rule': array})."""
        A = self.stacked_matrix(T)
        x = np.linalg.solve(A, self._rhs(T, shock_bp, residuals))
        return {"y": x[0::self.NV], "pi": x[1::self.NV], "i": x[2::self.NV]}

    def simulate_imposed_rate(self, i_imposed, T: int = 80):
        """[Phase-4.8, SHOCK_IMPL_B_IMPOSED] dmpex-style exogenization: the
        policy rate is IMPOSED for the first len(i_imposed) quarters (its
        MP equation rows are dropped — their violation is the imposed
        deviation), y and pi stay endogenous throughout, and the rule
        resumes afterwards. The pyfrbus-family counterpart of a rule
        innovation: a 25bp shock produces an actual 25bp policy move."""
        nv = self.NV
        i_imposed = np.asarray(i_imposed, dtype=float)
        Tc = len(i_imposed)
        A = self.stacked_matrix(T)
        b = self._rhs(T)
        x = np.zeros(nv * T)
        known = np.zeros(nv * T, dtype=bool)
        for t in range(Tc):
            x[nv * t + 2] = i_imposed[t]
            known[nv * t + 2] = True
        keep = [r for r in range(nv * T)
                if not (r % nv == 2 and r // nv < Tc)]
        A_ff = A[np.ix_(keep, ~known)]
        rhs = b[keep] - A[np.ix_(keep, known)] @ x[known]
        x[~known] = np.linalg.solve(A_ff, rhs)
        return {"y": x[0::nv], "pi": x[1::nv], "i": x[2::nv]}

    def conditioned_solve(self, imposed: dict, T: int = 80):
        """[Appendix B, exact mode] Impose y/pi/i for the first Tc periods
        (arrays in `imposed`: keys us_y, us_pi, us_i, equal length Tc); let
        the model run FREE (zero residuals) for t >= Tc with steady-state
        terminal conditions; back out the implied residuals of the imposed
        window from the equation rows.

        Returns (paths dict over full T, residuals dict over Tc).
        With #residuals == #conditions per period this is the unique exact
        inversion: free-period equations hold (u=0), imposed-period
        residuals are the equation violations.
        """
        nv = self.NV
        Tc = len(next(iter(imposed.values())))
        for k in imposed.values():
            if len(k) != Tc:
                raise ValueError("imposed paths must share one length")
        A = self.stacked_matrix(T)
        b = self._rhs(T)
        x = np.zeros(nv * T)
        for k, key in enumerate(("us_y", "us_pi", "us_i")):
            x[k::nv][:Tc] = np.asarray(imposed[key], dtype=float)
        known = np.zeros(nv * T, dtype=bool)
        known[: nv * Tc] = True
        free_rows = np.arange(nv * Tc, nv * T)      # eqs that must hold
        A_ff = A[np.ix_(free_rows, ~known)]
        rhs = b[free_rows] - A[np.ix_(free_rows, known)] @ x[known]
        x[~known] = np.linalg.solve(A_ff, rhs)
        resid_rows = A[: nv * Tc] @ x - b[: nv * Tc]
        residuals = {name: resid_rows[k::nv]
                     for k, name in enumerate(self.ROW_NAMES)}
        return ({"y": x[0::nv], "pi": x[1::nv], "i": x[2::nv]}, residuals)
