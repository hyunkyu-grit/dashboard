# -*- coding: utf-8 -*-
"""Phase-4 Step 1 — historical residual infrastructure (Appendix B prep).

Residual = observed LHS minus AS-WIRED model RHS, per stochastic equation,
over the estimation sample (2000Q1-latest, shorter where data starts later).

Construction discipline (all flagged in the output):
  RESID_DEV_FORM        equations are evaluated in the same DEVIATION space
                        the Phase-3 solver uses: log-level cycles are HP(1600,
                        AR(4)-padded) deviations x100, rates are deviations
                        from their HP trends, inflations are deviations from
                        the 2% target. Constants/trends are absorbed by the
                        detrending, mirroring the deviation-form solver where
                        they cancel.
  RESID_PF_EXPECTATIONS US-block leads (pi4_{t+3}, pi4_{t+4}, y_{t+1}) use
                        REALIZED values — perfect-foresight proxy, so these
                        residuals include expectation errors.
  RESID_PROXY_DEMAND    the export demand index is eq (18) with RW (0.31)
                        renormalized away and EU standing on its output gap;
                        EA is a 2-of-6 emerging-Asia basket. See the block
                        comment at the index for what each piece is.
                        with the paper's zeta weights renormalized (EU and EA
                        both proxied by the EA19 gap; China and RW omitted —
                        no clean quarterly real GDP).
  LOOKAHEAD             HP filters are two-sided (Phase-1 convention).

Sigma: diagonal by default (per-equation std); full covariance available
behind full_cov=True (common-sample intersection). Persisted to
output/residual_moments.json.

Conditioning map: config/conditioning_map.yaml — which residuals may move
for each conditionable variable group. Requests touching residuals outside
the requested group RAISE (paper footnote-31 manual-selection discipline,
made mechanical).
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from bigfoot.data import ecos
from bigfoot.data.fred import fetch_fred
from bigfoot.equations import korea, us
from bigfoot.expectations import build_korea_engine

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"
MAP_PATH = ROOT / "config" / "conditioning_map.yaml"

FLAGS = ["RESID_DEV_FORM", "RESID_PF_EXPECTATIONS", "RESID_PROXY_DEMAND",
         "LOOKAHEAD"]

# as-wired Phase-3 final options that shape the equations (phase3.py)
# RETIRED 2026-08-21 — the permutation existed because eq (23)'s term
# placement was believed unrecoverable. It is printed on paper p.25.
PI_STAR = 2.0


class ConditioningMapError(ValueError):
    """A conditioning request touched residuals outside the map group."""


# ------------------------------------------------------------------ helpers
def _hp_cycle_log(series: pd.Series) -> pd.Series:
    """100*log deviation from the padded HP(1600) trend."""
    logs = 100.0 * np.log(series.dropna())
    return logs - ecos.hp_trend_padded(logs)


def _hp_dev(series: pd.Series) -> pd.Series:
    """Level deviation from the padded HP(1600) trend (rates, ratios)."""
    s = series.dropna()
    return s - ecos.hp_trend_padded(s)


def _fred_q(series_id: str, how: str = "mean") -> pd.Series:
    s = fetch_fred(series_id)
    q = s.groupby(pd.PeriodIndex(s.index, freq="Q"))
    return q.mean() if how == "mean" else q.last()


# ------------------------------------------------------------- data assembly
def build_variables(start: str = "1996Q1") -> pd.DataFrame:
    """All model-space variables (deviation space) on one quarterly index."""
    q = ecos.quarterly
    v = {}

    # Korea real side (log cycles x100)
    v["x"] = _hp_cycle_log(q("bigfoot_gdp_x_q"))
    v["m"] = _hp_cycle_log(q("bigfoot_gdp_m_q"))
    v["c"] = _hp_cycle_log(q("bigfoot_gdp_c_priv_q"))
    v["i_fi"] = _hp_cycle_log(q("bigfoot_gdp_i_fac_q"))
    v["g"] = _hp_cycle_log(q("bigfoot_gdp_c_gov_q"))
    v["i_con"] = _hp_cycle_log(q("bigfoot_gdp_i_con_q"))
    v["y_gap"] = ecos.output_gap_hp(q("bigfoot_gdp_real_sa_q"))

    # prices
    core_idx = q("bigfoot_core_cpi_q")
    head_idx = q("bigfoot_cpi_headline_q")
    v["p_core"] = _hp_cycle_log(core_idx)
    v["p_cpi"] = _hp_cycle_log(head_idx)
    v["pi_core_yoy"] = (core_idx / core_idx.shift(4) - 1.0) * 100.0 - PI_STAR
    v["cpi_yoy"] = (head_idx / head_idx.shift(4) - 1.0) * 100.0 - PI_STAR
    v["pm"] = _hp_cycle_log(q("bigfoot_import_price_q"))
    # eq (11) 의 나머지 두 항 [2026-08-21]. 편차공간 모의에서는 충격이 없어
    # 0 이라 `system.py` 가 안 쓰지만, **과거 잔차는 다르다** — 빼지 않으면
    # 설비투자 디플레이터와 D램 가격의 변동이 통째로 잔차로 들어간다.
    v["p_i"] = _hp_cycle_log(q("bigfoot_defl_fi_q"))
    v["p_ih"] = _hp_cycle_log(q("bigfoot_defl_con_q"))
    # GB/BCI — 건축착공 연면적. **ECOS 는 2013Q1 부터만 싣는다.** 그 앞은
    # NaN 으로 두고, 잔차 쪽에서 있는 구간만 쓴다(없는 값을 0 으로 채우면
    # «착공이 늘 추세였던 나라» 가 된다).
    v["gb"] = _hp_cycle_log(q("bigfoot_bci_m"))
    # eq (15) 의 EDEPR — 고령인구비율. 연간이라 분기로 편다(인구 계열이라
    # 매끄럽고, 어차피 HP 순환만 쓴다). **비율이므로 로그를 안 씌운다.**
    _ed = ecos.fetch_ecos("bigfoot_edepr_a")
    _ed = pd.Series(pd.to_numeric(_ed["DATA_VALUE"], errors="coerce").values,
                    index=pd.PeriodIndex(_ed["TIME"].astype(str) + "Q4",
                                         freq="Q")).dropna().sort_index()
    _edq = _ed.reindex(pd.period_range(_ed.index.min(), _ed.index.max(),
                                       freq="Q")).interpolate("linear")
    v["edepr"] = _edq - ecos.hp_trend_padded(_edq)
    v["oil"] = _hp_cycle_log(_fred_q("WTISPLC"))

    # eq 24 attractor recursion on core yoy LEVELS, then deviation.
    # `attractor` carries the printed constant (1-delta1)*pi*, so running it
    # on levels and subtracting PI_STAR afterwards is the right order —
    # the recursion's own fixed point is pi*.
    pp = korea.PhillipsPair()
    pi_lvl = (v["pi_core_yoy"] + PI_STAR).dropna()
    inf = pd.Series(index=pi_lvl.index, dtype=float)
    prev = float(pi_lvl.iloc[0])
    for t, p in zip(pi_lvl.index, pi_lvl.values):
        prev = pp.attractor(pi_inf_lag=prev, pi_lag=float(p))
        inf[t] = prev
    v["pi_inf"] = inf - PI_STAR

    # FX, housing, debt, rates
    v["s"] = _hp_cycle_log(_fred_q("DEXKOUS"))
    v["hpi"] = _hp_cycle_log(q("bigfoot_housing_kb_m"))
    credit = q("bigfoot_hh_credit_q")
    gdp_nom = q("bigfoot_gdp_nom_sa_q")
    v["debt"] = _hp_dev(100.0 * credit / (4.0 * gdp_nom))
    v["i_kr"] = _hp_dev(q("bigfoot_base_rate_d"))
    v["r_hh"] = _hp_dev(q("bigfoot_loan_rate_hh_q"))
    v["r_firm"] = _hp_dev(q("bigfoot_loan_rate_firm_q"))
    v["kr10y"] = _hp_dev(q("bigfoot_ktb10y_d"))
    spread = (q("bigfoot_corp3y_d") - q("bigfoot_ktb3y_d")).dropna()
    v["cb"] = spread - spread.mean()

    # US block (deviations; QPM2008 space)
    v["us_y"] = ecos.output_gap_hp(_fred_q("GDPC1"))
    pce = _fred_q("PCEPILFE")
    us_pi_lvl = ((pce / pce.shift(1)) ** 4 - 1.0) * 100.0
    v["us_pi"] = us_pi_lvl - PI_STAR
    v["us_pi4"] = us_pi_lvl.rolling(4).mean() - PI_STAR
    v["us_i"] = _hp_dev(_fred_q("FEDFUNDS"))

    # ---- export demand index, eq (18) (paper p.23)
    #
    #   X^demand = z_US M^US + z_EU M^EU + z_CH M^CH
    #            + z_EA M^EA + z_JP M^JP + z_RW M^RW
    #
    # RESID_PROXY_DEMAND: the paper aggregates partners' IMPORT demand, and
    # eq (4) maps each block's output gap into its import gap. eq (4)'s
    # coefficients (rho_M, beta_M) are NOT in Table 1 — all five printed
    # symbols there carry the subscript Y and belong to eq (5) — so neither
    # this index nor `system.py::_demand_x` can build import gaps. Both sides
    # therefore stand on OUTPUT gaps, which at least keeps history and
    # simulation measuring the same object.
    #
    # Merchandise import indices ARE available on FRED for US/JP/CN, but only
    # as VALUE (XTIMVA01..Q657S, quarter-on-quarter % of a value index). The
    # paper models the foreign blocks "in terms of the real trade variables
    # only", and the value gap carries prices: measured 2026-08-21, the
    # value-based index had sd 8.2pp against ~1-2pp for an output gap. Using
    # it would have pushed prices into the export residual, so it is not used.
    #
    # FIXED 2026-08-21 — EA IS NOT EUROPE. Figure 1's legend reads "EA: 6
    # Emerging Asia Countries", and this index had been standing BOTH the EU
    # and the EA weight on Euro-Area-19. EU now has its own EU27 series and
    # EA is an emerging-Asia basket.
    #
    #   CH         ECOS 902Y015 (국제 주요국 경제성장률), quarterly real
    #              growth, cumulated to a level index. FRED has no Chinese
    #              quarterly real series that runs past 2024 — this table is
    #              the only route. **It starts 2011Q1**: the OECD source
    #              carries no earlier Chinese quarterly GDP, so the index
    #              reweights per period over the blocks that HAVE data (see
    #              below). Before 2011 the composition is what it was.
    #   EA         India + Indonesia real GDP gaps, equal-weighted — 2 of the
    #              6 emerging-Asia countries. Neither FRED nor ECOS 902Y015
    #              carries TH/MY/PH/SG/VN/TW quarterly.
    #
    # STILL MISSING, and named rather than hidden:
    #   RW (0.31)  no observable for a residual aggregate; renormalized away.
    #   EA 4 of 6  TH/MY/PH/SG/VN/TW — needs IMF IFS, CEIC or the national
    #              statistics offices.
    def _gap_from_growth(sid: str) -> pd.Series:
        """전기대비 **증가율** 계열의 HP 갭.

        OECD/IMF 의 `..QPSMEI` 는 수준이 아니라 분기 증가율이라 로그가 죽는다
        (실측 2026-08-21). 실질 증가율이므로 누적하면 실질 지수가 되고, HP 는
        로그 위에서 돌므로 기준값은 상관없다.
        """
        g = _fred_q(sid).dropna()
        return ecos.output_gap_hp((1.0 + g / 100.0).cumprod())

    zx = korea.demand_weight_vectors()["export"]
    jp_gap = ecos.output_gap_hp(_fred_q("JPNRGDPEXP"))
    eu_gap = ecos.output_gap_hp(_fred_q("CLVMNACSCAB1GQEU272020"))
    ea_gap = pd.concat([_gap_from_growth("INDGDPRQPSMEI"),
                        _gap_from_growth("IDNGDPRQPSMEI")],
                       axis=1).mean(axis=1)
    cn_growth = ecos.quarterly("bigfoot_gr_chn_q")
    cn_gap = ecos.output_gap_hp((1.0 + cn_growth / 100.0).cumprod())
    parts = {"us": v["us_y"], "jp": jp_gap, "eu": eu_gap, "ea": ea_gap,
             "cn": cn_gap}
    # PER-PERIOD RENORMALIZATION. China only exists from 2011Q1, so a fixed
    # denominator would silently treat it as "gap 0" for 2000-2010 — a
    # country that never moves. Instead each quarter divides by the weight
    # actually present that quarter, which is what "renormalize away the
    # blocks we cannot see" has always meant here; it just was not
    # time-varying before.
    frame = pd.DataFrame({k: g for k, g in parts.items()})
    w = pd.DataFrame({k: frame[k].notna() * zx[k] for k in parts})
    v["d_x"] = (frame.fillna(0.0) * w).sum(axis=1) / w.sum(axis=1)

    df = pd.DataFrame(v)
    return df.loc[pd.Period(start, "Q"):]


# ------------------------------------------------------------ per-equation
def extract_residuals(start: str = "2000Q1",
                      variables: pd.DataFrame = None) -> pd.DataFrame:
    """Observed LHS minus as-wired RHS for every stochastic equation."""
    d = build_variables() if variables is None else variables
    L = lambda s, k=1: s.shift(k)
    D = lambda s: s.diff()
    D4 = lambda s: s.diff(4)      # eq (19)·(44) 의 Δ₄
    r = {}

    cfg_g = lambda p, i: korea.C(p, i).require()

    # --- trade (eqs 19, 22 as wired: WIRING_DEMAND_OUTPUTGAP)
    xg, mg = korea.export_growth(), korea.import_growth()
    bX = cfg_g("export.target.slots", 1)
    bM = cfg_g("import_.target.slots", 1)
    r["export"] = (D(d["x"])
                   - xg.alpha.require() * (bX * L(d["d_x"]) - L(d["x"]))
                   - xg.extras["demand_growth"].require() * D(d["d_x"])
                   # eq (19) 는 Δ₄ ln EXR 이다 — eq (22) 의 Δ 와 다르다.
                   - xg.extras["fx"].require() * D4(d["s"]))
    zm = korea.demand_weight_vectors()["import"]
    d_m = zm["c"] * d["c"] + zm["fi"] * d["i_fi"] + zm["x"] * d["x"]
    r["import_"] = (D(d["m"])
                    - mg.alpha.require() * (bM * L(d_m) - L(d["m"]))
                    - mg.extras["demand_growth"].require() * D(d_m)
                    - mg.extras["fx"].require() * D(d["s"]))

    # --- phillips (eq 23 AS PRINTED — paper p.25)
    #
    # The residual must be taken against the SAME equation the solver runs,
    # or conditioning and simulation disagree. Both now read:
    #
    #   pi = (1-phi1-phi2)*pibar + phi1*pi_{t-1} + phi2*E pi_{t+1} + phi3*gap
    #
    # with E pi_{t+1} = pibar + two-step deviation forecast from the state
    # at t-1 (Appendix A.7-A.8), matching `system.py`'s `w_pi_lead`.
    pp = korea.PhillipsPair()
    eng = build_korea_engine(lags=2)
    S, J = eng.S, eng._J()
    w_pi_lead = (J @ np.linalg.matrix_power(S, 2))[0]
    dev = eng.dev  # engine's own deviation states (pi, gap, r)
    states = pd.DataFrame(
        {t: np.concatenate([dev.loc[t - 1].values, dev.loc[t - 2].values])
         for t in dev.index[2:]}).T
    lead_dev = states @ w_pi_lead
    e_pi_lead = d["pi_inf"] + lead_dev
    r["phillips"] = (d["pi_core_yoy"]
                     - pp.w_attractor * d["pi_inf"]
                     - pp.phi1 * L(d["pi_core_yoy"])
                     - pp.phi2 * e_pi_lead
                     - pp.phi3 * d["y_gap"])

    # --- construction investment (eq 12-14 as printed, paper pp.19-21)
    #
    #   (12) ln IH* = b_IH0 + b_IH1 ln Ybar + b_IH2 ln GB - UC_IH
    #   (13) UC_IH  = (i_Firm + i_CB)/2 + pi^yoy_cpi/4 + delta_IH
    #   (14) d ln IH = a_IH0(ln IH*_{t-1} - ln IH_{t-1}) + a_IH1 d ln IH_{t-1}
    #                  + PAC + g1 d yhat + g2 d ln P_IH + g3 d ln HPI
    #                  + g4 d_4 ln BCI
    #
    # PAC_EXPECTATION_OMITTED — see `korea.ConstructionInvestment`.
    #
    # **GB starts 2013Q1 in ECOS.** Where it is missing, its two terms are
    # dropped and their contribution stays inside the residual; where it
    # exists they are subtracted. The seam is named rather than papered
    # over with a zero, which would assert "construction starts were always
    # on trend" for 2000-2012.
    con = korea.ConstructionInvestment()
    uc_ih = con.user_cost_dev(i_firm=d["r_firm"],
                              i_cb=d["kr10y"] + d["cb"],
                              cpi_yoy=d["cpi_yoy"])
    gb = d["gb"]
    ih_star = con.target_dev(gb_dev=gb.fillna(0.0), uc_dev=uc_ih)
    r["construction"] = (D(d["i_con"])
                         - con.alpha_ec * (L(ih_star) - L(d["i_con"]))
                         - con.alpha_ar * L(D(d["i_con"]))
                         - con.g_gap * D(d["y_gap"])
                         - con.g_deflator * D(d["p_ih"])
                         - con.g_housing * D(d["hpi"])
                         - con.g_bci * D4(gb).fillna(0.0))

    # --- government consumption (eq 15-16 as printed, paper p.21)
    #
    #   (15) ln G* = b_G0 + b_G1 ln Ybar + b_G2 EDEPR
    #   (16) d ln G = c_G + a_G0 (ln G*_{t-1} - ln G_{t-1}) + a_G1 yhat
    #
    # In deviations b_G1 ln Ybar is zero by construction (potential IS the
    # trend), so the target's deviation is b_G2 times the elderly-ratio
    # cycle. The block was EXOG_V1 until 2026-08-21 — held at trend, so a
    # shock could not move government consumption at all.
    gov = korea.GovernmentConsumption()
    g_star = gov.target_dev(d["edepr"])
    r["government"] = (D(d["g"])
                       - gov.alpha_ec * (L(g_star) - L(d["g"]))
                       - gov.alpha_gap * d["y_gap"])

    # --- headline CPI (eq 26 as wired)
    cpig = korea.cpi_growth()
    nu = korea.C("cpi.target.named", "w_core").require()
    r["cpi"] = (D(d["p_cpi"])
                - cpig.alpha.require() * (nu * L(d["p_core"]) - L(d["p_cpi"]))
                - cpig.extras["d_core"].require() * d["pi_core_yoy"] / 4.0
                - cpig.extras["d_import_price"].require() * D(d["pm"]))

    # --- import price (eqs 30-32 as wired, P3 slot order)
    a_ec = cfg_g("import_price.growth.slots", 1)
    a_s = cfg_g("import_price.growth.slots", 2)
    a_oil = cfg_g("import_price.growth.slots", 3)
    b_wp = cfg_g("import_price.target.slots", 1)
    b_oil = cfg_g("import_price.target.slots", 2)
    pm_star = b_wp * d["s"] + b_oil * d["oil"]
    r["import_price"] = (D(d["pm"]) - a_ec * (L(pm_star) - L(d["pm"]))
                         - a_s * D(d["s"]) - a_oil * D(d["oil"]))

    # --- policy rule (eq 35 as wired: WIRING_RULE_CPI, deviation form)
    pr = korea.PolicyRule()
    r["policy_rule"] = (d["i_kr"] - pr.phi_i * L(d["i_kr"])
                        - (1 - pr.phi_i) * ((1 + pr.phi_pi) * d["cpi_yoy"]
                                            + pr.phi_y * d["y_gap"]))

    # --- UIP (as wired: WIRING_SEXP_RW, quarterly carry /4)
    r["uip"] = d["s"] - (L(d["s"]) - (d["i_kr"] - d["us_i"]) / 4.0)

    # --- corp bond spread (eq 38-39, deviation form)
    cbz = korea.CorpBondSpread()
    r["corp_spread"] = d["cb"] - cbz.rho * L(d["cb"]) - cbz.b_gap * d["y_gap"]

    # --- loan rates (eqs 40-43 AS PRINTED, paper p.32)
    #
    #   (40/41)  i = nu*call + (1-nu)*TB10Y + eta
    #   (42/43)  eta = (1-rho) etabar + rho eta_{t-1} + alpha (eta_CB - etabar)
    #
    # The spread eta is not observed on its own, so back it out of the rate
    # identity and take the residual against ITS law of motion — that is
    # where the persistence and the corporate-premium loading live.
    for key, which in (("loan_hh", "household"), ("loan_firm", "firm")):
        eq = korea.LoanRate(which)
        rate = d["r_hh"] if which == "household" else d["r_firm"]
        eta = rate - eq.nu * d["i_kr"] - (1 - eq.nu) * d["kr10y"]
        r[key] = eta - eq.rho * L(eta) - eq.alpha * d["cb"]

    # --- housing (eq 28 as wired: rates unscaled in target and growth)
    hg = korea.housing_growth()
    b_h_cpi = cfg_g("housing.target.slots", 1)
    b_h_rate = cfg_g("housing.target.slots", 2)
    hpi_star = b_h_cpi * d["p_cpi"] + b_h_rate * d["r_hh"]
    r["housing"] = (D(d["hpi"]) - hg.alpha.require() * (L(hpi_star) - L(d["hpi"]))
                    - hg.extras["dp_lag"].require() * L(D(d["hpi"]))
                    - hg.extras["d_rate"].require() * d["r_hh"])

    # --- debt (eq 44 as wired: qrate_debt=False -> unscaled)
    dbt = korea.DebtGDP()
    hpi_yoy = d["hpi"] - d["hpi"].shift(4)
    r["debt"] = (D(d["debt"]) - dbt.b_gap * d["y_gap"]
                 - dbt.b_housing * hpi_yoy - dbt.b_hh_rate * d["r_hh"])

    # --- consumption PAC (eq 8 as wired: exact A.13 weights, qrate_cons=False)
    pac = korea.ConsumptionPAC(engine=eng)
    wF = eng.pac_weights_exact(1, pac.alphas, pac.beta)
    F = states @ wF
    b_c_debt = cfg_g("consumption.target.slots", 1)
    r["consumption"] = (D(d["c"])
                        - pac.alpha.require() * (b_c_debt * L(d["debt"]) - L(d["c"]))
                        - pac.gammas[0].require() * L(D(d["c"]))
                        - pac.deltas["gap"].require() * d["y_gap"]
                        - pac.deltas["r_hh"].require() * d["r_hh"]
                        - pac.deltas["d_debt"].require() * D(d["debt"])
                        - F)

    # --- investment (eq 11 as printed, paper p.18; zero target in deviations)
    #
    #   Δln I = α_I0(ln I*_{t-1} − ln I_{t-1}) + α_I1 Δln I_{t-1} + E[Σ d_k …]
    #           + γ_I1 Δŷ + γ_I2 Δln P_I + γ_I3 ln DRAM
    #
    # The last two were declared in `investment_growth()` and never subtracted
    # here, so the FI deflator and the DRAM price rode into the residual.
    # γ_I3 는 못 채운다. `DRAM_t` 는 가격이 아니라 **Gartner 의 반도체 초과수요
    # 지수**다(논문 19쪽: "the excess demand index of semi-conductor from
    # Gartner"). 유료 계열이라 ECOS·FRED 어디에도 없다. 한때 ECOS 수출물가
    # DRAM(402Y016/30911201AA)을 넣었다가 되돌렸다 — 이름만 같고 다른 것이다.
    inv = korea.investment_growth()
    r["investment"] = (D(d["i_fi"])
                       - inv.alpha.require() * (0.0 - L(d["i_fi"]))
                       - inv.extras["dy_lag"].require() * L(D(d["i_fi"]))
                       # eq (11) 은 gamma_I1 * d yhat 이다 — 갭의 변화지 수준이 아니다.
                       - inv.extras["gap"].require() * D(d["y_gap"])
                       - inv.extras["deflator"].require() * D(d["p_i"]))

    # --- US block (QPM2008, deviation form, perfect-foresight leads)
    y, pi4, i = d["us_y"], d["us_pi4"], d["us_i"]
    r["us_is"] = (y - us.B1 * L(y) - us.B2 * y.shift(-1)
                  + us.B3 * (L(i) - pi4.shift(-3)))
    r["us_pc"] = (d["us_pi"] - us.L1 * pi4.shift(-4)
                  - (1 - us.L1) * L(pi4) - us.L2 * L(y))
    r["us_rule"] = (i - us.G1 * L(i)
                    - (1 - us.G1) * ((1 + us.G2) * pi4.shift(-3) + us.G4 * y))

    out = pd.DataFrame(r).loc[pd.Period(start, "Q"):]
    return out


# ------------------------------------------------------------------ moments
def fit_moments(resids: pd.DataFrame = None, full_cov: bool = False,
                persist: bool = True) -> dict:
    """Per-equation moments + diagonal Sigma (full covariance behind flag)."""
    if resids is None:
        resids = extract_residuals()
    eqs = {}
    for name in resids.columns:
        u = resids[name].dropna()
        n = len(u)
        if n < 12:
            eqs[name] = {"status": "INSUFFICIENT_DATA", "n": n}
            continue
        x = np.arange(n)
        slope = float(np.polyfit(x, u.values, 1)[0]) * 40.0  # per decade
        u0, u1 = u.values[:-1], u.values[1:]
        ar1 = float(np.corrcoef(u0, u1)[0, 1])
        m = u.mean()
        sd = u.std(ddof=1)
        z = (u - m) / sd
        eqs[name] = {
            "status": "OK", "n": n,
            "sample": f"{u.index[0]}-{u.index[-1]}",
            "mean": round(float(m), 4), "std": round(float(sd), 4),
            "skew": round(float((z ** 3).mean()), 2),
            "excess_kurtosis": round(float((z ** 4).mean() - 3.0), 2),
            "ar1": round(ar1, 3),
            "trend_per_decade": round(slope, 4),
        }
    sigma = {k: v["std"] for k, v in eqs.items() if v["status"] == "OK"}
    out = {
        "module": "residual_moments",
        "as_of": date.today().isoformat(),
        "method_flags": FLAGS,
        "sigma_form": "full" if full_cov else "diagonal",
        "equations": eqs,
        "sigma_diagonal_std": sigma,
    }
    if full_cov:
        common = resids.dropna()
        out["sigma_full_corr"] = {
            "sample": f"{common.index[0]}-{common.index[-1]}",
            "n": len(common),
            "columns": list(common.columns),
            "corr": np.round(common.corr().values, 3).tolist(),
        }
    if persist:
        OUT.mkdir(exist_ok=True)
        (OUT / "residual_moments.json").write_text(
            json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


# ----------------------------------------------------------- conditioning map
def load_conditioning_map() -> dict:
    return yaml.safe_load(MAP_PATH.read_text(encoding="utf-8"))["groups"]


def check_residual_selection(group: str, residuals: list) -> list:
    """Enforce the footnote-31 discipline: the requested residual set must
    stay inside the named group's allowance. Raises ConditioningMapError."""
    groups = load_conditioning_map()
    if group not in groups:
        raise ConditioningMapError(
            f"unknown conditioning group {group!r}; known: {sorted(groups)}")
    allowed = set(groups[group]["residuals"])
    illegal = [x for x in residuals if x not in allowed]
    if illegal:
        raise ConditioningMapError(
            f"residuals {illegal} are outside group {group!r} (allowed: "
            f"{sorted(allowed)}) — silent cross-channel conditioning is "
            "forbidden; edit config/conditioning_map.yaml explicitly")
    return residuals


if __name__ == "__main__":
    res = extract_residuals()
    summary = fit_moments(res)
    for k, v in summary["equations"].items():
        print(k, v)
