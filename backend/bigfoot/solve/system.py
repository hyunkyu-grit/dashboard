# -*- coding: utf-8 -*-
"""Phase-3 system solver — deviation form, block-recursive.

Everything is solved in DEVIATIONS from the steady state (baseline = all
zeros; a shocked path IS the IRF), so equation constants and trend terms
cancel exactly and the Phase-2 trend-calibration gaps do not bind.

Block order (small-open-economy recursivity):
  1. oil gap        : exogenous AR(1)
  2. US block       : stacked perfect-foresight linear solve + US 10y =
                      mean of remaining short path
  3. foreign blocks : backward-looking, spillover from the US gap
  4. Korea block    : period-by-period damped fixed point, diagnostics kept

Units: gaps/levels in % (log x100), rates in annual pp, s in log%*100.

WIRING decisions (documented, all flagged; levers of the Phase-3 failure
protocol, never silent):
  WIRING_SHARES_DATA      GDP gap = data-measured expenditure shares x
                          component deviations (i_con, g EXOG_V1 = 0)
  WIRING_DEMAND_OUTPUTGAP export demand index = ζ^X-weighted foreign OUTPUT
                          gaps (eq 4's c/τ pair as read gives implausibly
                          small trade elasticities — bypassed, register)
  WIRING_SPILLOVER        foreign-block spillover term = US gap
  WIRING_OIL_RHO_0.90     oil-gap AR(1) rho (placeholder, unpublished)
  WIRING_SEXP_RW          UIP expectation s^e_t = s_{t-1} (random walk)
  WIRING_SYNC_US10Y       KR term premium response = beta_sync x US 10y dev
                          (pure tp_us reading is un-pinnable here)
  WIRING_RULE_CPI         policy rule reacts to headline CPI YoY deviation
  WIRING_QRATE_FLOWS      annual rate devs enter FLOW equations
                          (consumption growth, debt accumulation) as
                          quarterly r/4; enter LEVEL/target equations
                          (housing) unscaled
  WIRING_PURCH_OFF        purchasing-power input held at 0 in v1
  WIRING_PX_EXOG          export prices exogenous in v1 (not scored)
"""
from __future__ import annotations

import numpy as np

from bigfoot.data.ecos import gdp_shares
from bigfoot.equations import foreign as ffor
from bigfoot.equations import korea, us
from bigfoot.equations.loader import coefficient, load_appendix_d
from bigfoot.expectations import build_korea_engine

WIRING_FLAGS = [
    "WIRING_SHARES_DATA", "WIRING_DEMAND_OUTPUTGAP", "WIRING_SPILLOVER",
    "WIRING_OIL_RHO_0.90", "WIRING_SEXP_RW", "WIRING_SYNC_US10Y",
    "WIRING_RULE_CPI", "WIRING_QRATE_FLOWS", "WIRING_PURCH_OFF",
    "WIRING_PX_EXOG",
]

OIL_RHO = 0.90          # WIRING_OIL_RHO

KOREA_VARS = ["c", "dc", "i_fi", "di", "i_fi_star", "g", "dg",
              "i_con", "di_con", "ih_star", "x", "m", "y_gap",
              "pi_core", "pi_inf",
              "p_core", "p_cpi", "cpi_yoy", "pm", "hpi", "dhpi", "hpi_yoy",
              "debt", "ddebt", "s", "i_kr", "cb", "kr10y",
              "eta_hh", "eta_firm", "r_hh", "r_firm"]


class BigfootSystem:
    #: wiring levers — MY constructions (unit/sign conventions the tables do
    #: not pin), togglable by the Phase-3 failure protocol; RESOLVED
    #: coefficient values are never touched.
    DEFAULT_OPTIONS = {
        "qrate_cons": True,     # r_hh enters Δc as r/4 (else unscaled)
        "qrate_debt": True,     # r_hh, hpi_yoy enter Δdebt as /4
        "oil_sign": +1.0,       # sign of the oil gap entering foreign blocks
        "purch_channel": False, # γ_C4 · (−cpi_yoy) real-income channel
        "gap_lag_cons": False,  # consumption γ_C1 uses y_gap_{t-1} (timing)
        # RETIRED 2026-08-21 — "phillips_perm", "phillips_exp",
        # "phillips_exp_w", "phillips_exp_h".  Those levers existed because
        # the eq (23) term placement was believed unrecoverable
        # (PROVISIONAL_PHILLIPS).  It is recoverable: the equation is
        # PRINTED on paper p. 25, and rendering the page as an image shows
        # it.  eq (23) now carries the paper's placement and its own
        # expectation term at t+1, so there is nothing left to permute or
        # bolt on.  Passing any of the four raises — a stale call site must
        # fail loudly, not silently keep a fitted wiring.
        # CALIBRATED_BETA lever: PAC discount beta (not printed in the
        # paper; 0.99 conventional quarterly discount, 0.97-0.995 protocol)
        "pac_beta": 0.99,
        # FORM_A1_EC lever: core satellite VAR estimator — "dev" (Phase-1
        # deviations VAR) or "a1_ec" (photographed A.1 explicit EC form,
        # free A0, estimated on level differences)
        "core_form": "dev",
        # SHOCK_IMPL_B_IMPOSED lever (Phase 4.8, owner ruling): how a
        # us_rule_bp shock is implemented — "imposed" (rate exogenized at
        # +shock for 1q, rule resumes; pyfrbus-family, kernel-consistent;
        # a 25bp-shock anchor sees an actual 25bp move) or "internal"
        # (QPM rule innovation, attenuated policy peak ~0.19pp; legacy)
        "us_shock_impl": "imposed",
    }

    #: Levers that no longer exist. Named so a stale caller gets a sentence
    #: instead of a silent revert to the fitted wiring.
    RETIRED_OPTIONS = {
        "phillips_perm": "eq (23) placement is printed on paper p. 25",
        "phillips_exp": "eq (23) carries its own E_t pi_Core,t+1 term",
        "phillips_exp_w": "the attractor weight is 1 - phi1 - phi2, not a "
                          "homogeneity residual",
        "phillips_exp_h": "the printed horizon is t+1",
    }

    def __init__(self, beta_sync: float = 0.5, eq24_form: str = "paper",
                 T: int = 24, damp: float = 0.6, tol: float = 1e-8,
                 max_iter: int = 500, options: dict = None):
        if eq24_form != "paper":
            raise ValueError(
                f"eq24_form={eq24_form!r} is retired. eq (24) is printed on "
                "paper p. 26 and carries (pi_Core,t-1 - pibar_t-1) as a "
                "DIFFERENCE; the old 'raw' and 'nested' readings were both "
                "mis-transcriptions. Pass 'paper'.")
        self.T, self.damp, self.tol, self.max_iter = T, damp, tol, max_iter
        self.beta_sync = beta_sync
        for _k, _why in self.RETIRED_OPTIONS.items():
            if _k in (options or {}):
                raise ValueError(f"options[{_k!r}] is retired — {_why}.")
        self.opt = dict(self.DEFAULT_OPTIONS, **(options or {}))
        cfg = load_appendix_d()

        self.shares = gdp_shares()                       # WIRING_SHARES_DATA
        self.engine = build_korea_engine(lags=2,
                                         form=self.opt["core_form"])
        self.pp = korea.PhillipsPair()
        self.pr = korea.PolicyRule()
        self.cbz = korea.CorpBondSpread()
        self.lr_hh = korea.LoanRate("household")
        self.lr_firm = korea.LoanRate("firm")
        self.debt_eq = korea.DebtGDP()
        self.pac = korea.ConsumptionPAC(engine=self.engine,
                                        beta=self.opt["pac_beta"])
        self.inv = korea.investment_growth()
        self.fi = korea.FIInvestment()                # eq (9-11), 2026-08-21
        self.gov = korea.GovernmentConsumption()      # eq (15-16), 2026-08-21
        self.con = korea.ConstructionInvestment()     # eq (12-14), 2026-08-21
        self.xg, self.mg = korea.export_growth(), korea.import_growth()
        self.cpig = korea.cpi_growth()
        self.hg = korea.housing_growth()
        self.weights = korea.demand_weight_vectors()

        g = lambda p, i: coefficient(cfg, p, i).value
        self.bX = g("export.target.slots", 1)
        self.bM = g("import_.target.slots", 1)
        self.b_c_debt = g("consumption.target.slots", 1)
        self.b_h_cpi = g("housing.target.slots", 1)
        self.b_h_rate = g("housing.target.slots", 2)
        self.b_pm_wp = g("import_price.target.slots", 1)
        self.b_pm_oil = g("import_price.target.slots", 2)
        self.a_pm_ec = g("import_price.growth.slots", 1)
        self.a_pm_1 = g("import_price.growth.slots", 2)   # Δs (P3 order)
        self.a_pm_2 = g("import_price.growth.slots", 3)   # Δoil (P3 order)
        self.nu_cpi = g("cpi.target.named", "w_core")

        self.fblocks = {b: ffor.build(b) for b in ffor.BLOCKS}
        self.fblocks["rw"] = ffor.build_rw()
        self.usb = us.USBlock()

        # 40q-mean expectations weights: kr10y dev = w40 @ x_t  (rate row = 2)
        S, J = self.engine.S, self.engine._J()
        acc, P = np.zeros_like(S), np.eye(S.shape[0])
        for _ in range(40):
            acc += P
            P = P @ S
        self.w40 = (J @ (acc / 40.0))[2]

        # PAC F weights: exact A.11-A.16 d-weights (RESOLVED_A13), state
        # applied per period; rho(G kron S) asserted inside
        self.wF, self.pac_info = self.engine.pac_weights_exact(
            1, self.pac.alphas, self.pac.beta, return_info=True)

        # eq (23) carries E_t pi_Core,t+1.  The satellite VAR gives
        # E z_{t+k} = z*_t + J S^k x_t (Appendix A.7-A.8), so the expectation
        # is the ENDPOINT (pibar, which eq (24) just produced) PLUS the
        # k-step deviation forecast.
        #
        # The solver's information set at t is the predetermined state
        # x_{t-1}, so t+1 sits TWO steps out from there.  That is as close
        # to E_t as this recursion can stand.  The previous wiring used
        # h = 4 (a year-ahead point expectation, untranscribed) AND dropped
        # the endpoint, so its "expectation" was not anchored at all.
        self.w_pi_lead = (J @ np.linalg.matrix_power(S, 2))[0]

    # ------------------------------------------------------------ exogenous
    def _oil_path(self, shock: float) -> np.ndarray:
        oil = np.zeros(self.T)
        for t in range(self.T):
            prev = oil[t - 1] if t > 0 else 0.0
            oil[t] = OIL_RHO * prev + (shock if t == 0 else 0.0)
        return oil

    def _us10y(self, i_full: np.ndarray) -> np.ndarray:
        """US 10y deviation: EH 40q mean of the short path + the Phase-4.5
        term-premium process (us.tp_us_path, CALIBRATED_PYFRBUS)."""
        tp = us.tp_us_path(i_full)
        return np.array([float(np.mean(i_full[t:t + 40])) + tp[t]
                         for t in range(self.T)])

    def _us_paths(self, us_shock_bp: float, us_override: dict = None) -> dict:
        if us_override is not None:
            i = np.asarray(us_override["i"], dtype=float)
            if len(i) < self.T + 40:
                raise ValueError(
                    f"us_override paths must cover T+40={self.T + 40} "
                    f"quarters for the EH 10y (got {len(i)}); solve the "
                    "override with USBlock.conditioned_solve at T>=T_kr+40")
            return {"y": np.asarray(us_override["y"])[:self.T],
                    "pi": np.asarray(us_override["pi"])[:self.T],
                    "i": i[:self.T], "us10y": self._us10y(i)}
        if us_shock_bp == 0.0:
            z = np.zeros(self.T)
            return {"y": z, "pi": z, "i": z, "us10y": z}
        T_us = max(80, self.T + 40)
        if self.opt["us_shock_impl"] == "imposed":   # SHOCK_IMPL_B_IMPOSED
            sim = self.usb.simulate_imposed_rate([us_shock_bp / 100.0],
                                                 T=T_us)
        else:
            sim = self.usb.simulate_shock(shock_bp=us_shock_bp, T=T_us)
        return {"y": sim["y"][:self.T], "pi": sim["pi"][:self.T],
                "i": sim["i"][:self.T], "us10y": self._us10y(sim["i"])}

    def _foreign_paths(self, uspath: dict, oil: np.ndarray) -> dict:
        out = {}
        for name, blk in self.fblocks.items():
            y = np.zeros(self.T)
            for t in range(self.T):
                y[t] = blk.output_gap(
                    gap_lag=y[t - 1] if t > 0 else 0.0,
                    foreign_gap=uspath["y"][t],          # WIRING_SPILLOVER
                    oil_gap_lag=self.opt["oil_sign"]
                    * (oil[t - 1] if t > 0 else 0.0))
            out[name] = y
        return out

    def _demand_x(self, uspath, fpaths, t) -> float:
        if t < 0:
            return 0.0
        zx = self.weights["export"]
        return (zx["us"] * uspath["y"][t] + zx["cn"] * fpaths["china"][t]
                + zx["jp"] * fpaths["japan"][t] + zx["eu"] * fpaths["eu"][t]
                + zx["ea"] * fpaths["ea"][t] + zx["rw"] * fpaths["rw"][t])

    #: equations that accept an additive residual path (Phase 4, Appendix B);
    #: names match bigfoot/conditional/residuals.py extraction
    RESIDUAL_EQS = ("consumption", "investment", "government",
                    "construction", "export",
                    "import_", "phillips", "cpi", "import_price",
                    "policy_rule", "uip", "corp_spread", "loan_hh",
                    "loan_firm", "housing", "debt")
    #: variables pinnable in exact mode (pin-and-back-out of the OWN
    #: equation's residual); extend deliberately, never silently
    PIN_SUPPORTED = ("i_kr",)

    # -------------------------------------------------------------- solving
    def solve(self, shock: dict, residuals: dict = None, pin: dict = None,
              us_override: dict = None) -> dict:
        """shock: {'kr_rule_bp': x, 'us_rule_bp': x, 'oil_pct': x}.

        Phase-4 conditional inputs (all optional):
          residuals    {eq_name: array} additive equation-residual paths
                       (names in RESIDUAL_EQS; shorter arrays are zero-padded)
          pin          {var: array} imposed variable paths (PIN_SUPPORTED);
                       NaN entries leave that quarter UNPINNED (rule runs) —
                       Phase-6b partial pins; the pinned variable's
                       own-equation residual is backed out per pinned quarter
                       and returned in diagnostics['pin_residuals']
          us_override  {'y','pi','i'} imposed US paths (length >= T+40 for
                       the EH 10y) — bypasses the US-block simulation
        """
        T = self.T
        res = {k: np.zeros(T) for k in self.RESIDUAL_EQS}
        for k, u in (residuals or {}).items():
            if k not in res:
                raise KeyError(f"unknown residual equation {k!r}; "
                               f"known: {self.RESIDUAL_EQS}")
            u = np.asarray(u, dtype=float)
            res[k][: min(T, len(u))] = u[:T]
        pin = {k: np.asarray(v, dtype=float) for k, v in (pin or {}).items()}
        for k in pin:
            if k not in self.PIN_SUPPORTED:
                raise KeyError(f"variable {k!r} is not pin-supported "
                               f"(supported: {self.PIN_SUPPORTED})")
        pin_resid = {k: np.zeros(T) for k in pin}

        oil = self._oil_path(shock.get("oil_pct", 0.0))
        uspath = self._us_paths(shock.get("us_rule_bp", 0.0), us_override)
        fpaths = self._foreign_paths(uspath, oil)
        zm = self.weights["import"]
        sh = self.shares

        v = {k: np.zeros(T) for k in KOREA_VARS}
        iters, deltas = [], []

        def lag(key, t, k=1):
            return v[key][t - k] if t - k >= 0 else 0.0

        for t in range(T):
            # predetermined
            x_tm1 = np.array([lag("pi_core", t), lag("y_gap", t),
                              lag("i_kr", t), lag("pi_core", t, 2),
                              lag("y_gap", t, 2), lag("i_kr", t, 2)])
            F_c = float(self.wF @ x_tm1)
            # eq (24) in deviation space — the constant drops out.  The
            # pibar_{t-1} coefficient is delta1 - delta2 = 0.4068, NOT
            # delta1: the printed equation carries (pi_Core,t-1 - pibar_t-1)
            # as a difference, so delta2 loads negatively on pibar too.
            pi_inf = self.pp.attractor_dev(pi_inf_lag=lag("pi_inf", t),
                                           pi_lag=lag("pi_core", t))
            # E_t pi_Core,t+1 = endpoint + two-step deviation forecast.
            pi_lead = pi_inf + float(self.w_pi_lead @ x_tm1)
            d_x = self._demand_x(uspath, fpaths, t)
            d_x_lag = self._demand_x(uspath, fpaths, t - 1)
            oil_lag = oil[t - 1] if t > 0 else 0.0
            shock_a = shock.get("kr_rule_bp", 0.0) / 100.0 if t == 0 else 0.0

            u = {k: lag(k, t) for k in KOREA_VARS}
            n_it, delta = 0, np.inf
            while n_it < self.max_iter and delta > self.tol:
                n_it += 1
                new = dict(u)

                # trade
                #
                # eq (19) prints Δ₄ ln EXR and eq (22) prints Δ ln EXR — the
                # asymmetry is the paper's, not a typo on our side: exports
                # respond to the year-on-year currency move, imports to the
                # quarter's. Both had been wired to the quarterly difference
                # (found 2026-08-21 reading p.24).
                ds = u["s"] - lag("s", t)
                ds4 = u["s"] - lag("s", t, 4)
                dx = (self.xg.alpha.value * (self.bX * d_x_lag - lag("x", t))
                      + self.xg.extras["demand_growth"].value * (d_x - d_x_lag)
                      + self.xg.extras["fx"].value * ds4
                      + res["export"][t])
                new["x"] = lag("x", t) + dx
                # eq (21): M^demand = z_C C + z_I I + z_IH IH + z_G G + z_X X.
                # G joined 2026-08-21; IH still zero until its block lands.
                d_m = (zm["c"] * u["c"] + zm["fi"] * u["i_fi"]
                       + zm["ih"] * u["i_con"] + zm["g"] * u["g"]
                       + zm["x"] * new["x"])
                d_m_lag = (zm["c"] * lag("c", t) + zm["fi"] * lag("i_fi", t)
                           + zm["ih"] * lag("i_con", t)
                           + zm["g"] * lag("g", t) + zm["x"] * lag("x", t))
                dm = (self.mg.alpha.value * (self.bM * d_m_lag - lag("m", t))
                      + self.mg.extras["demand_growth"].value * (d_m - d_m_lag)
                      + self.mg.extras["fx"].value * ds
                      + res["import_"][t])
                new["m"] = lag("m", t) + dm

                # GDP gap
                new["y_gap"] = (sh["c"] * u["c"] + sh["i_fi"] * u["i_fi"]
                                + sh["i_con"] * u["i_con"] + sh["g"] * u["g"]
                                + sh["x"] * new["x"] - sh["m"] * new["m"])

                # prices
                new["pi_inf"] = pi_inf
                # eq (23) as printed — the attractor carries 1 - phi1 - phi2
                # (= 0.60), which is what lets the pair speak about
                # (de)anchoring at all.
                new["pi_core"] = self.pp.core_inflation(
                    pi_lag=lag("pi_core", t), pi_inf=pi_inf,
                    pi_lead=pi_lead, gap=new["y_gap"])
                new["pi_core"] += res["phillips"][t]
                new["p_core"] = lag("p_core", t) + new["pi_core"] / 4.0
                pm_star_lag = (self.b_pm_wp * lag("s", t)
                               + self.b_pm_oil * oil_lag)
                dpm = (self.a_pm_ec * (pm_star_lag - lag("pm", t))
                       + self.a_pm_1 * ds
                       + self.a_pm_2 * (oil[t] - oil_lag)
                       + res["import_price"][t])
                new["pm"] = lag("pm", t) + dpm
                dpcpi = (self.cpig.alpha.value
                         * (self.nu_cpi * lag("p_core", t) - lag("p_cpi", t))
                         + self.cpig.extras["d_core"].value * new["pi_core"] / 4.0
                         + self.cpig.extras["d_import_price"].value * dpm
                         + res["cpi"][t])
                new["p_cpi"] = lag("p_cpi", t) + dpcpi
                new["cpi_yoy"] = new["p_cpi"] - lag("p_cpi", t, 4)

                # policy & rates (WIRING_RULE_CPI); a pinned i_kr overrides
                # the rule — its residual is backed out after convergence
                rule_rhs = (self.pr.phi_i * lag("i_kr", t)
                            + (1 - self.pr.phi_i)
                            * ((1 + self.pr.phi_pi) * new["cpi_yoy"]
                               + self.pr.phi_y * new["y_gap"])
                            + shock_a + res["policy_rule"][t])
                pinned_now = ("i_kr" in pin
                              and not np.isnan(pin["i_kr"][t]))
                new["i_kr"] = pin["i_kr"][t] if pinned_now else rule_rhs
                new["cb"] = (self.cbz.rho * lag("cb", t)
                             + self.cbz.b_gap * new["y_gap"]
                             + res["corp_spread"][t])
                x_t = np.array([new["pi_core"], new["y_gap"], new["i_kr"],
                                lag("pi_core", t), lag("y_gap", t),
                                lag("i_kr", t)])
                new["kr10y"] = (float(self.w40 @ x_t)
                                + self.beta_sync * uspath["us10y"][t])
                # eq (40)-(43) as printed (paper p.32): the funding mix
                # passes through ONE for one and the persistence sits on the
                # SPREAD, which is what carries the corporate-bond premium.
                # The retired form put rho and alpha on the whole mix, so the
                # long-run pass-through was 0.54 instead of 1.
                for key, ekey, eq, rname in [
                        ("r_hh", "eta_hh", self.lr_hh, "loan_hh"),
                        ("r_firm", "eta_firm", self.lr_firm, "loan_firm")]:
                    new[ekey] = eq.spread_dev(eta_lag=lag(ekey, t),
                                              cb_dev=new["cb"])
                    new[key] = eq.rate_dev(call=new["i_kr"],
                                           long_rate=new["kr10y"],
                                           eta=new[ekey]) + res[rname][t]

                # housing (rates unscaled in target/level eq: WIRING_QRATE)
                hpi_star_lag = (self.b_h_cpi * lag("p_cpi", t)
                                + self.b_h_rate * lag("r_hh", t))
                new["dhpi"] = (self.hg.alpha.value
                               * (hpi_star_lag - lag("hpi", t))
                               + self.hg.extras["dp_lag"].value * lag("dhpi", t)
                               + self.hg.extras["d_rate"].value * new["r_hh"]
                               + res["housing"][t])
                new["hpi"] = lag("hpi", t) + new["dhpi"]
                new["hpi_yoy"] = new["hpi"] - lag("hpi", t, 4)

                # debt (WIRING_QRATE_FLOWS lever)
                dq = 4.0 if self.opt["qrate_debt"] else 1.0
                new["ddebt"] = (self.debt_eq.b_gap * new["y_gap"]
                                + self.debt_eq.b_housing * new["hpi_yoy"] / dq
                                + self.debt_eq.b_hh_rate * new["r_hh"] / dq
                                + res["debt"][t])
                new["debt"] = lag("debt", t) + new["ddebt"]

                # consumption PAC + investment
                cq = 4.0 if self.opt["qrate_cons"] else 1.0
                # eq (8) prints gamma_c1 * d yhat_t — the CHANGE in the output
                # gap, not its level (paper p.17). Same for eq (11)'s
                # gamma_I1 below. Both had been wired to the level, which
                # makes consumption and FI investment answer the gap for as
                # long as it is open instead of while it is moving; the IRF
                # troughs came out too deep and too persistent because of it
                # (found 2026-08-21).
                d_gap = new["y_gap"] - lag("y_gap", t)
                gap_in = (lag("y_gap", t) if self.opt["gap_lag_cons"]
                          else new["y_gap"])
                purch = (-new["cpi_yoy"] if self.opt["purch_channel"] else 0.0)
                cstar_lag = self.b_c_debt * lag("debt", t)
                new["dc"] = (self.pac.alpha.value * (cstar_lag - lag("c", t))
                             + self.pac.gammas[0].value * lag("dc", t)
                             + self.pac.deltas["gap"].value * d_gap
                             + self.pac.deltas["r_hh"].value * new["r_hh"] / cq
                             + self.pac.deltas["d_debt"].value * new["ddebt"]
                             + self.pac.deltas["purch"].value * purch
                             + F_c + res["consumption"][t])
                new["c"] = lag("c", t) + new["dc"]
                # FI investment, eq (9)-(11).  The target's deviation is
                # -UC_I: potential is the trend, the constant and the Covid
                # dummy drop, and delta_I is exogenous.  eq (11)'s error
                # correction reads the target at t-1 as printed, so the target
                # is a state variable here exactly as `ih_star` is for
                # construction.  Until 2026-08-21 this was the literal `0.0`
                # and the policy rate had NO route into equipment investment.
                uc_i = self.fi.user_cost_dev(
                    i_firm=new["r_firm"],
                    i_cb=new["kr10y"] + new["cb"],
                    cpi_yoy=new["cpi_yoy"])
                new["i_fi_star"] = self.fi.target_dev(uc_dev=uc_i)
                new["di"] = (self.inv.alpha.value
                             * (lag("i_fi_star", t) - lag("i_fi", t))
                             + self.inv.extras["dy_lag"].value * lag("di", t)
                             + self.inv.extras["gap"].value * d_gap
                             + res["investment"][t])
                new["i_fi"] = lag("i_fi", t) + new["di"]
                # government consumption, eq (15-16). The target's deviation
                # is b_G2 x (elderly-ratio cycle); that regressor is exogenous
                # and unshocked in every basis, so it is zero here and only
                # bites in the historical residual.
                new["dg"] = (self.gov.growth_dev(
                    g_star_lag=0.0, g_lag=lag("g", t), gap=new["y_gap"])
                    + res["government"][t])
                new["g"] = lag("g", t) + new["dg"]
                # construction investment, eq (12)-(14).
                # ln GB and ln P_IH are exogenous and unshocked -> 0 here;
                # the user cost is fully endogenous and is what makes this
                # block respond to policy at all.
                uc = self.con.user_cost_dev(
                    i_firm=new["r_firm"],
                    i_cb=new["kr10y"] + new["cb"],
                    cpi_yoy=new["cpi_yoy"])
                new["ih_star"] = self.con.target_dev(gb_dev=0.0, uc_dev=uc)
                new["di_con"] = (
                    self.con.alpha_ec * (lag("ih_star", t) - lag("i_con", t))
                    + self.con.alpha_ar * lag("di_con", t)
                    + self.con.g_gap * (new["y_gap"] - lag("y_gap", t))
                    + self.con.g_housing * new["dhpi"]
                    + res["construction"][t])
                new["i_con"] = lag("i_con", t) + new["di_con"]

                # UIP (WIRING_SEXP_RW), s in log%*100: quarterly carry = /4
                new["s"] = (lag("s", t) - (new["i_kr"] - uspath["i"][t]) / 4.0
                            + res["uip"][t])

                delta = max(abs(new[k] - u[k]) for k in KOREA_VARS)
                u = {k: self.damp * new[k] + (1 - self.damp) * u[k]
                     for k in KOREA_VARS}
            if delta > self.tol:
                raise RuntimeError(
                    f"period {t}: no convergence after {n_it} iters, max "
                    f"delta {delta:.2e} — silent non-convergence forbidden")
            iters.append(n_it)
            deltas.append(delta)
            for k in KOREA_VARS:
                v[k][t] = u[k]
            if "i_kr" in pin and not np.isnan(pin["i_kr"][t]):
                # back out the rule residual the pin implies (WITHOUT the
                # shock/residual inputs, so a round-trip recovers them)
                bare = (self.pr.phi_i * lag("i_kr", t)
                        + (1 - self.pr.phi_i)
                        * ((1 + self.pr.phi_pi) * u["cpi_yoy"]
                           + self.pr.phi_y * u["y_gap"]))
                pin_resid["i_kr"][t] = pin["i_kr"][t] - bare

        return {"korea": v, "us": uspath, "foreign": fpaths, "oil": oil,
                "diagnostics": {"iterations": iters,
                                "max_iter_used": int(max(iters)),
                                "final_deltas": deltas,
                                "pin_residuals": pin_resid}}
