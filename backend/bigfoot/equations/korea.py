# -*- coding: utf-8 -*-
"""Korea-block equations (BOK WP 2025-3 eq. 7-44), paper coefficients only.

Phase 2.1: full symbol mapping applied (owner PDF reading). Values unchanged.
Every coefficient is fetched through loader.coefficient(); PROVISIONAL
placements carry their basis; forms constructed here (not table facts) are
register items P4.
"""
from __future__ import annotations

import numpy as np

from bigfoot.equations.base import (
    Coefficient,
    Equation,
    BehavioralEquation,
    PACEquation,
    RESOLVED,
)
from bigfoot.equations.loader import coefficient, load_appendix_d
from bigfoot.expectations import recover_alphas

_CFG = load_appendix_d()


def C(path, idx) -> Coefficient:
    return coefficient(_CFG, path, idx)


# --------------------------------------------------------------------- 23-24
class PhillipsPair(Equation):
    """Core CPI Phillips pair (eq. 23 + 24), AS PRINTED IN THE PAPER.

    ## The symbols were readable all along (2026-08-21)

    Phase 2 read the coefficient TABLE and guessed the term placement,
    because pdf text extraction dropped the math symbols
    (`appendix_d.yaml`: "symbols lost in extraction").  That guess became
    PROVISIONAL_PHILLIPS, and phase 3 then searched over PERMUTATIONS of
    the printed values to fit the IRF scorecard.

    **The placement never needed guessing.**  Rendering the page as an
    image (`pypdfium2`, scale 3) shows both equations in full.  Paper
    pp. 25-26 (pdf pages 31-32), Table 8 on p. 61 (pdf 67):

        (23)  pi_Core,t = (1 - phi1 - phi2) * pibar_t
                          + phi1 * pi_Core,t-1
                          + phi2 * E_t pi_Core,t+1
                          + phi3 * yhat_t + u

        (24)  pibar_t   = (1 - delta1) * pi* / 4
                          + delta1 * pibar_t-1
                          + delta2 * (pi_Core,t-1 - pibar_t-1) + u

        Table 8   phi1 .2500  phi2 .1500  phi3 .1000
                  pi*  .0200  delta1 .7232  delta2 .3164

    The slot ORDER in `appendix_d.yaml` matches the printed symbol order
    exactly, so the transcribed VALUES were right; only the placement was
    wrong.

    ## What changed against the previous wiring

        term                  paper   previous (phillips_perm + exp bolt-on)
        attractor pibar        0.60   0.15
        lagged core            0.25   0.10
        expectation            0.15    0.50   (and at h=4, not t+1)
        output gap             0.10   0.25

    The attractor is what lets the model speak about (de)anchoring — the
    paper says so in the sentence right under eq (23).  At 0.15 that
    channel was four times too weak, while the gap slope was 2.5x too
    steep.

    ## Units

    The table's pi* = 0.0200 is an ANNUAL fraction and the paper's `pi*/4`
    puts it in QUARTERLY rate terms, which is the unit pibar and pi_Core
    carry there.  This model runs inflation in ANNUALISED PERCENT
    (`system.py`: `p_core += pi_core / 4`), so the same constant is
    `pi_star` (= 2.0) with no division.  In deviation space — which is
    where every basis is solved — the constant drops out entirely.

    ## Fixed point

    Setting pi = pibar in both equations gives pibar* = pi* and pi* = pibar*:
    the pair is anchored, with no explosive root.  (The literal reading of
    the old "raw" form had delta1 + delta2 = 1.0396 > 1 and no fixed point;
    that reading is now known to be a mis-transcription of eq (24), which
    carries `pi_Core,t-1 - pibar_t-1` as a DIFFERENCE.)
    """
    eq_no = "23-24"
    flags = ()

    def __init__(self):
        super().__init__("phillips_pair")
        self.phi1 = C("core_cpi.slots", 0).require()      # lagged core
        self.phi2 = C("core_cpi.slots", 1).require()      # E_t pi_{t+1}
        self.phi3 = C("core_cpi.slots", 2).require()      # output gap
        self.pi_star = C("core_cpi.slots", 3).require() * 100.0
        self.delta1 = C("core_cpi.slots", 4).require()
        self.delta2 = C("core_cpi.slots", 5).require()

    @property
    def w_attractor(self) -> float:
        """(1 - phi1 - phi2) — the weight eq (23) puts on pibar."""
        return 1.0 - self.phi1 - self.phi2

    def core_inflation(self, pi_lag, pi_inf, pi_lead, gap):   # eq 23
        return (self.w_attractor * pi_inf
                + self.phi1 * pi_lag
                + self.phi2 * pi_lead
                + self.phi3 * gap)

    def attractor(self, pi_inf_lag, pi_lag):                  # eq 24
        """Annualised-percent form; see the Units note."""
        return ((1.0 - self.delta1) * self.pi_star
                + self.delta1 * pi_inf_lag
                + self.delta2 * (pi_lag - pi_inf_lag))

    def attractor_dev(self, pi_inf_lag, pi_lag):              # eq 24, deviations
        """Same equation with the constant dropped — the solver's space.

        Written out rather than reusing `attractor` so the algebra is
        visible: the pibar_t-1 coefficient is delta1 - delta2 = 0.4068,
        not delta1.
        """
        return ((self.delta1 - self.delta2) * pi_inf_lag
                + self.delta2 * pi_lag)

    def residual(self, pi, pi_lag, pi_inf, pi_lead, gap):
        return pi - self.core_inflation(pi_lag, pi_inf, pi_lead, gap)


# ------------------------------------------------------------------------ 35
class PolicyRule(Equation):
    """Inertial Taylor rule (eq. 35) — Table 14, fully RESOLVED (named).

        i_t = φ_i i_{t-1} + (1-φ_i)[ r* + π_t + φ_π (π_t - π*) + φ_y y_t ]

    CORRECTION applied: Table 14's fourth value is π* (inflation target),
    not r*. r* comes from the separate CALIBRATED_LW entry (Laubach-Williams
    mean, footnote 24). Both are 2% — labels only. Rates in annual %.
    """
    eq_no = "35"

    def __init__(self):
        super().__init__("policy_rule")
        g = lambda k: C("policy_rule.named", k).require()
        self.phi_i, self.phi_pi, self.phi_y = g("phi_i"), g("phi_pi"), g("phi_y")
        self.pi_star = g("pi_star") * 100.0
        self.r_star = C("calibration.r_star.named", "r_star").require() * 100.0

    def rhs(self, i_lag, pi, gap):
        tgt = (self.r_star + pi + self.phi_pi * (pi - self.pi_star)
               + self.phi_y * gap)
        return self.phi_i * i_lag + (1.0 - self.phi_i) * tgt

    def residual(self, i, i_lag, pi, gap):
        return i - self.rhs(i_lag, pi, gap)


# --------------------------------------------------------------------- 33-34
class UIP(Equation):
    """Exchange rate / UIP (eq. 33-34), log won-per-dollar — T13 RESOLVED.

        s_t = α_EXR,0·E s_{t+1} + (1-α_EXR,0)·s_{t-1}
              - (i_kr - i_us - rp_t)/400
        rp_t = c_UIP + α_EXR,2 · z_t          (eq 34; z = risk factor)

    ln s̄ = α_EXR,1 = 7.0142. The rp functional form is constructed (P4).
    """
    eq_no = "33-34"

    def __init__(self):
        super().__init__("uip")
        self.w = C("fx.slots", 0).require()
        self.ln_s_bar = C("fx.slots", 1).require()
        self.risk_scale = C("fx.slots", 2).require()
        self.c_uip = C("fx.slots", 3).require()

    def risk_premium(self, z_risk):
        return self.c_uip + self.risk_scale * z_risk

    def rhs(self, s_exp, s_lag, i_kr, i_us, z_risk=0.0):
        rp = self.risk_premium(z_risk)
        return (self.w * s_exp + (1.0 - self.w) * s_lag
                - (i_kr - i_us - rp) / 400.0)

    def residual(self, s, s_exp, s_lag, i_kr, i_us, z_risk=0.0):
        return s - self.rhs(s_exp, s_lag, i_kr, i_us, z_risk)


# --------------------------------------------------------------------- 36-37
class TermStructure(Equation):
    """KR 10y (eq. 36-37): expectations hypothesis + term premium.

        kr10y_t = (1/40) Σ_{k=0}^{39} E_t r_{t+k}  +  tp_kr_t

    Pure structure (no Appendix-D coefficients); expected short-rate path
    comes from the Phase-1 satellite VAR (rate = index 2 of the core vector).
    """
    eq_no = "36-37"

    def __init__(self, engine=None):
        super().__init__("term_structure")
        self.engine = engine

    def yield_10y(self, term_premium: float, state=None) -> float:
        path = [self.engine.forecast(k, state=state)[2] for k in range(40)]
        return float(np.mean(path)) + term_premium


# --------------------------------------------------------------------- 38-39
class CorpBondSpread(Equation):
    """Corporate bond spread (eq. 38-39) — Table 15, mean-reversion form
    (η̄_CB = MEAN spread per the symbol reading; prior intercept form
    corrected):

        spread_t = η̄_CB + ρ_CB (spread_{t-1} - η̄_CB) + α_CB·gap_t
    """
    eq_no = "38-39"

    def __init__(self):
        super().__init__("corp_bond")
        self.rho = C("corp_bond.slots", 0).require()
        self.eta_bar = C("corp_bond.slots", 1).require()
        self.b_gap = C("corp_bond.slots", 2).require()

    def rhs(self, spread_lag, gap):
        return (self.eta_bar + self.rho * (spread_lag - self.eta_bar)
                + self.b_gap * gap)

    def steady_state(self):
        return self.eta_bar

    def residual(self, spread, spread_lag, gap):
        return spread - self.rhs(spread_lag, gap)


# --------------------------------------------------------------------- 40-43
class LoanRate(Equation):
    """Bank loan rates (eq. 40-43) — Table 16, CORRECTED grouping:
    ν_HH = 0.36 group = HOUSEHOLD (households closer to long rates),
    ν_Firm = 0.64 group = FIRM.

        funding_t = ν·call_t + (1-ν)·long_rate_t
        rate_t = ρ rate_{t-1} + α·funding_t + η̄

    η̄_CB (shared, 0.0003) is the corp-bond spread reference in eqs 42-43,
    parked in .eta_cb_ref for Phase-3 wiring. Funding-mix FORM remains a
    constructed interpretation (P4); long-run pass-through α/(1-ρ) ≈ 0.54
    both groups — recorded diagnostic, not tuned.
    """
    eq_no = "40-43"

    def __init__(self, which: str):
        if which not in ("household", "firm"):
            raise ValueError("which must be 'household' or 'firm'")
        super().__init__(f"loan_rate_{which}")
        p = f"loan_rates.{which}.slots"
        self.nu = C(p, 0).require()
        self.rho = C(p, 1).require()
        self.eta_bar = C(p, 2).require()
        self.alpha = C(p, 3).require()
        self.eta_cb_ref = C("loan_rates.shared.named", "eta_cb").require()

    def rhs(self, rate_lag, call, long_rate):
        """RETIRED 2026-08-21 — the "constructed interpretation" (P4).

        It put the AR and the loading on the whole funding mix, giving a
        long-run pass-through of alpha/(1-rho) = 0.54. The printed pair is
        different: pass-through is ONE, and the persistence lives on the
        SPREAD.  Kept only so a stale caller fails loudly.
        """
        raise NotImplementedError(
            "eq (40)-(43) are printed on paper p.32; use spread_dev() and "
            "rate_dev(). The old funding-mix form damped policy pass-through "
            "to 0.54 against the paper's 1.0.")

    def spread_dev(self, eta_lag, cb_dev):
        """eq (42)/(43) in deviations — the eta_bar constants drop out.

            eta_t = (1-rho) etabar + rho eta_{t-1} + alpha (eta_CB - etabar_CB)
        """
        return self.rho * eta_lag + self.alpha * cb_dev

    def rate_dev(self, call, long_rate, eta):
        """eq (40)/(41) in deviations — funding passes through ONE for one.

            i_HH = nu i + (1-nu) i_TB10Y + eta_HH
        """
        return self.nu * call + (1.0 - self.nu) * long_rate + eta

    def residual(self, rate, rate_lag, call, long_rate):
        return rate - self.rhs(rate_lag, call, long_rate)


# ------------------------------------------------------------------------ 44
class DebtGDP(Equation):
    """Household debt-to-GDP (eq. 44) — Table 17, all four slots RESOLVED:

        Δ(debt/gdp)_t = c_debt + α_debt,1·gap_t + α_debt,2·Δp_house(YoY)_t
                        + α_debt,3·r_hh_t
    """
    eq_no = "44"

    def __init__(self):
        super().__init__("debt_gdp")
        self.const = C("debt_gdp.slots", 0).require()
        self.b_gap = C("debt_gdp.slots", 1).require()
        self.b_housing = C("debt_gdp.slots", 2).require()
        self.b_hh_rate = C("debt_gdp.slots", 3).require()

    def rhs(self, gap, dp_house, r_hh):
        return (self.const + self.b_gap * gap + self.b_housing * dp_house
                + self.b_hh_rate * r_hh)

    def residual(self, d_ratio_change, gap, dp_house, r_hh):
        return d_ratio_change - self.rhs(gap, dp_house, r_hh)


# ------------------------------------------------- targets (cointegration)
def consumption_target() -> BehavioralEquation:
    """Eq. 7: c* = β_c0 + β_c1·debt + β_c2·GFC + β_c3·Covid (all RESOLVED)."""
    return BehavioralEquation("consumption_target", "7", {
        "const": C("consumption.target.slots", 0),
        "debt": C("consumption.target.slots", 1),
        "gfc_dummy": C("consumption.target.slots", 2),
        "covid_dummy": C("consumption.target.slots", 3)})


def investment_fi_target() -> BehavioralEquation:
    """Eq. 9: i_fi* = β_I0 + β_I1·potential + β_I2·Covid (all RESOLVED)."""
    return BehavioralEquation("investment_fi_target", "9", {
        "const": C("investment_fi.target.slots", 0),
        "potential": C("investment_fi.target.slots", 1),
        "covid_dummy": C("investment_fi.target.slots", 2)})


def export_target() -> BehavioralEquation:
    return BehavioralEquation("export_target", "17", {
        "const": C("export.target.slots", 0),
        "world_demand": C("export.target.slots", 1)})


def import_target() -> BehavioralEquation:
    return BehavioralEquation("import_target", "20", {
        "const": C("import_.target.slots", 0),
        "abs_demand": C("import_.target.slots", 1)})


def housing_target() -> BehavioralEquation:
    """Eq. 27: hpi* = β_hpi0 + β_hpi1·CPI + β_hpi2·hh_rate (CPI, not income)."""
    return BehavioralEquation("housing_target", "27", {
        "const": C("housing.target.slots", 0),
        "cpi": C("housing.target.slots", 1),
        "hh_rate": C("housing.target.slots", 2)})


def export_price_target() -> BehavioralEquation:
    return BehavioralEquation("export_price_target", "29", {
        "const": C("export_price.target.slots", 0),
        "world_price": C("export_price.target.slots", 1)})


def import_price_target() -> BehavioralEquation:
    return BehavioralEquation("import_price_target", "31", {
        "const": C("import_price.target.slots", 0),
        "world_price": C("import_price.target.slots", 1),
        "oil": C("import_price.target.slots", 2)})


# ------------------------------------------------- growth (ECM) equations
class ECMGrowth(Equation):
    """Generic error-correction growth equation:

        Δy_t = c + α_0 (y*_{t-1} - y_{t-1}) + Σ b_k·x_{k,t}

    Whether the paper's form carries an expectation term in these equations
    remains a register item; symbols are now table-read.
    """

    def __init__(self, name, eq_no, a0, alpha, extras: dict):
        super().__init__(name)
        self.eq_no = eq_no
        self.a0, self.alpha, self.extras = a0, alpha, extras

    def rhs(self, ecm_lag, **kw):
        dy = self.a0.require() + self.alpha.require() * ecm_lag
        for k, c in self.extras.items():
            dy += c.require() * float(kw[k])
        return dy

    def residual(self, dy, ecm_lag, **kw):
        return dy - self.rhs(ecm_lag, **kw)


def export_growth() -> ECMGrowth:
    """Eq. 19: c_X, α_X0 EC, α_X1 demand growth, α_X2 fx — all RESOLVED."""
    return ECMGrowth("export_growth", "19",
                     C("export.growth.slots", 0), C("export.growth.slots", 1),
                     {"demand_growth": C("export.growth.slots", 2),
                      "fx": C("export.growth.slots", 3)})


def import_growth() -> ECMGrowth:
    """Eq. 22: c_M, α_M0 EC, α_M1 demand growth, α_M2 fx — all RESOLVED."""
    return ECMGrowth("import_growth", "22",
                     C("import_.growth.slots", 0), C("import_.growth.slots", 1),
                     {"demand_growth": C("import_.growth.slots", 2),
                      "fx": C("import_.growth.slots", 3)})


def investment_growth() -> ECMGrowth:
    """Eq. 10: α_I0 EC, α_I1 AR, γ_I1 gap, γ_I2 deflator, γ_I3 semiconductor
    (SIGN_NOTE: negative as printed). NO constant in the T3 growth row —
    a0 is a structural zero; the AR term rides in extras (dy_lag)."""
    zero = Coefficient(0.0, "none", RESOLVED,
                       "structural: no constant in T3 growth row "
                       "(owner mapping)", "structure")
    return ECMGrowth("investment_growth", "10",
                     zero,
                     C("investment_fi.growth.slots", 0),   # α_I0 = EC loading
                     {"dy_lag": C("investment_fi.growth.slots", 1),  # α_I1 AR
                      "gap": C("investment_fi.growth.slots", 2),
                      "deflator": C("investment_fi.growth.slots", 3),
                      "semiconductor": C("investment_fi.growth.slots", 4)})


def cpi_growth() -> ECMGrowth:
    """Eq. 26: c_cpi, α_cpi0 EC, α_cpi1 Δcore, α_cpi2 Δimport price."""
    return ECMGrowth("cpi_growth", "26",
                     C("cpi.growth.slots", 0), C("cpi.growth.slots", 1),
                     {"d_core": C("cpi.growth.slots", 2),
                      "d_import_price": C("cpi.growth.slots", 3)})


def housing_growth() -> ECMGrowth:
    """Eq. 28: c_hpi, α_hpi0 EC, α_hpi1 AR, α_hpi2 rate."""
    return ECMGrowth("housing_growth", "28",
                     C("housing.growth.slots", 0), C("housing.growth.slots", 1),
                     {"dp_lag": C("housing.growth.slots", 2),
                      "d_rate": C("housing.growth.slots", 3)})


# ------------------------------------------------- consumption PAC (eq. 8)
class ConsumptionPAC(PACEquation):
    """Eq. 8, paper-assembled (T2 growth row, all six slots RESOLVED):

        Δc_t = α_C0·ecm_{t-1} + α_C1·Δc_{t-1} + γ_C1·gap_t + γ_C2·r_hh_t
               + γ_C3·Δdebt_t + γ_C4·purch_t + F_t

    F_t: exact A.11-A.16 weights (RESOLVED_A13, owner transcription of
    pp. 50-52, 2026-08-05).  m = 2 here (one own-lag term):
        alpha_2 = a_1 = -0.1079,  alpha_1 = a0 - 1 - alpha_2 = -0.8687
    (recover_alphas, A.15/A.16), G per A.13, and
        F_t = A(1)A(β) Σ_k [e_m'(I-G)^{-1}G^k e_m] E_{t-1}[Δc*_{t+k}]
    via engine.pac_weights_exact (Kronecker closed form, E_{t-1}/k=0
    convention built in).  The retired PROVISIONAL_A13 m=1 special case
    equals this at m=1 only after rescaling by A(1)/A(β) — its (1-βλ)
    sum-to-one normalization was not the paper's.
    CALIBRATED_BETA: β = 0.99 (β is not printed in the paper).
    """
    flags = ("RESOLVED_A13", "CALIBRATED_BETA")

    def __init__(self, engine=None, beta: float = 0.99):
        p = "consumption.growth.slots"
        a = [C(p, i) for i in range(6)]
        super().__init__("consumption_pac", "8",
                         a0=Coefficient(0.0, "none", RESOLVED,
                                        "structural: no constant in T2 growth "
                                        "row (owner mapping)", "structure"),
                         alpha=a[0], gammas=[a[1]],
                         phi=Coefficient(1.0, "unit", RESOLVED,
                                         "F enters unweighted; weights are "
                                         "inside F (A.13-A.16)", "structure"),
                         deltas={"gap": a[2], "r_hh": a[3],
                                 "d_debt": a[4], "purch": a[5]},
                         engine=engine, target_index=1, beta=beta)
        self.alphas = recover_alphas(a[0].require(), [a[1].require()])

    def expectation_term(self, state_tm1) -> float:
        w = self.engine.pac_weights_exact(self.target_index, self.alphas,
                                          self.beta)
        return float(w @ state_tm1)


def consumption_pac(engine=None, beta: float = 0.95,
                    synthetic: dict = None):
    """Synthetic-coefficient PAC for algebra tests (Phase-2 signature kept);
    paper build now lives in ConsumptionPAC."""
    if synthetic is None:
        return ConsumptionPAC(engine=engine)
    s = synthetic
    mk = lambda v, sym: Coefficient(v, sym, RESOLVED, "synthetic-test", "test")
    return PACEquation("consumption_pac_synthetic", "8",
                       a0=mk(s["a0"], "a0"), alpha=mk(s["alpha"], "alpha"),
                       gammas=[mk(s["gamma1"], "gamma1")],
                       phi=mk(s["phi"], "phi"),
                       engine=engine, target_index=1, beta=beta)


# ------------------------------------------------- identities & exogenous
class GDPIdentity(Equation):
    """GDP = C + I_fi + I_con + G + X - M; gap vs exogenous potential.

    Potential is an input series (HP of real GDP for now  # LOOKAHEAD:
    two-sided filter, Phase 4 replaces with production-function/one-sided).
    """
    eq_no = "identity"

    def __init__(self):
        super().__init__("gdp_identity")

    def gdp(self, c, i_fi, i_con, g, x, m):
        return c + i_fi + i_con + g + x - m

    def gap(self, gdp, potential):
        return 100.0 * (np.log(gdp) - np.log(potential))


class ConstructionInvestment(Equation):
    """Construction investment (eq. 12-14), Table 4 — ENDOGENOUS since
    2026-08-21 (was EXOG_V1, held at trend).

        (12)  ln IH*_t = b_IH0 + b_IH1 ln Ybar_t + b_IH2 ln GB_t - UC_IH,t
        (13)  UC_IH,t  = (i_Firm,t + i_CB,t)/2 + pi^yoy_cpi,t/4 + delta_IH
        (14)  d ln IH_t = a_IH0 (ln IH*_{t-1} - ln IH_{t-1})
                          + a_IH1 d ln IH_{t-1} + E_t[sum d_k ln d IH*_{t+k}]
                          + g_IH1 d yhat_t + g_IH2 d ln P_IH,t
                          + g_IH3 d ln HPI_t + g_IH4 d_4 ln BCI_t + u

    GB (eq 12) and BCI (eq 14) are the same object — the Building
    Construction Initiated index, "the area where construction began"
    (paper p.20, Figure 5 legend).  The Phase-2 reading of Table 4's third
    target slot as a DUMMY was wrong; it is ln GB.

    ## What is and is not carried in deviation space

        endogenous, carried    i_Firm, i_CB, cpi_yoy (through UC_IH),
                               yhat, HPI
        exogenous, hence 0     ln GB, ln P_IH — no basis shocks either, so
                               their deviations vanish in simulation and
                               only bite in the historical residual

    ## PAC_EXPECTATION_OMITTED

    eq (14) carries a PAC expectation of future target changes.  It is not
    implemented.  For FI investment (eq 11) the same omission is EXACT —
    that target is zero in deviations, so its expected changes are zero
    too.  Here the target is NOT zero (it moves with the user cost), so
    dropping the term is an APPROXIMATION, and it is named as one.  The
    PAC polynomial's own weights are not published for this block; Table 4
    prints an error-correction loading and an AR term, not a d_k sequence.
    """
    eq_no = "12-14"
    flags = ("PAC_EXPECTATION_OMITTED",)

    def __init__(self):
        super().__init__("construction")
        self.b0 = C("construction.target.slots", 0).require()
        self.b_potential = C("construction.target.slots", 1).require()
        self.b_gb = C("construction.target.slots", 2).require()
        self.alpha_ec = C("construction.growth.slots", 0).require()
        self.alpha_ar = C("construction.growth.slots", 1).require()
        self.g_gap = C("construction.growth.slots", 2).require()
        self.g_deflator = C("construction.growth.slots", 3).require()
        self.g_housing = C("construction.growth.slots", 4).require()
        self.g_bci = C("construction.growth.slots", 5).require()

    @staticmethod
    def user_cost_dev(i_firm, i_cb, cpi_yoy) -> float:
        """eq (13) in deviations — delta_IH is a constant and drops out.

        NOTE the sign: eq (13) ADDS pi/4 while eq (10) for FI SUBTRACTS it.
        Both are reproduced as printed.
        """
        return (i_firm + i_cb) / 2.0 + cpi_yoy / 4.0

    def target_dev(self, gb_dev, uc_dev) -> float:
        """eq (12) in deviations — b_IH1 ln Ybar drops out (potential IS the
        trend)."""
        return self.b_gb * gb_dev - uc_dev


class GovernmentConsumption(Equation):
    """Government consumption (eq. 15-16), Table 5 — ENDOGENOUS since
    2026-08-21 (was EXOG_V1, held at trend).

        (15)  ln G*_t = b_G0 + b_G1 ln Ybar_t + b_G2 EDEPR_t
        (16)  d ln G_t = c_G + a_G0 (ln G*_{t-1} - ln G_{t-1})
                         + a_G1 yhat_t + u

    EDEPR is the elderly-rate index; the paper puts it in to carry the
    incoming social-security demand.  a_G1 = -0.0440 is NEGATIVE, which is
    the paper's own finding: "simple error-correction estimation favors the
    countercyclical fiscal behavior".

    ## Deviation space

    Both drivers of the target are trends — potential output by
    construction, and the elderly ratio is demography.  So ln G*'s deviation
    is b_G2 times the elderly-ratio CYCLE, which is near zero, and the block
    reduces to error-correction toward trend plus the countercyclical gap
    term.  What the un-freezing actually buys is that a shock now propagates
    INTO government consumption and back out through the GDP gap and the
    import aggregator (eq 21), which is where holding it exogenous was
    costing amplitude.
    """
    eq_no = "15-16"

    def __init__(self):
        super().__init__("government")
        self.b0 = C("government.target.slots", 0).require()
        self.b_potential = C("government.target.slots", 1).require()
        self.b_edepr = C("government.target.slots", 2).require()
        self.c_g = C("government.growth.slots", 0).require()
        self.alpha_ec = C("government.growth.slots", 1).require()
        self.alpha_gap = C("government.growth.slots", 2).require()

    def target_dev(self, edepr_dev: float) -> float:
        """eq (15) in deviations — the potential-output term drops out."""
        return self.b_edepr * edepr_dev

    def growth_dev(self, g_star_lag, g_lag, gap) -> float:
        """eq (16) in deviations — the constant drops out."""
        return self.alpha_ec * (g_star_lag - g_lag) + self.alpha_gap * gap


class ExogPath(Equation):
    """EXOG_V1: construction (eq. 12-14) / government (eq. 15-16) held at
    an exogenous trend path in Phase 2. Symbols are now table-read; the
    coefficient lists stay parked in .parked, not wired."""
    flags = ("EXOG_V1",)

    def __init__(self, which: str, eq_no: str):
        super().__init__(which)
        self.eq_no = eq_no
        tbl = _CFG[which]
        self.parked = {"target": tbl["target"]["slots"],
                       "growth": tbl["growth"]["slots"]}

    def path(self, trend_series):
        return trend_series


def demand_weight_vectors() -> dict:
    """Eq. 18 / 21 aggregator weights — CORRECTED export order (T6):
    US·EU·CH·EA·JP·RW. Import order C·FI·IH·G·X confirmed."""
    xw = [C("export.demand_weights.slots", i).require() for i in range(6)]
    mw = [C("import_.demand_weights.slots", i).require() for i in range(5)]
    return {"export": dict(zip(["us", "eu", "cn", "ea", "jp", "rw"], xw)),
            "import": dict(zip(["c", "fi", "ih", "g", "x"], mw))}
