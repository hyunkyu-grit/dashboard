# -*- coding: utf-8 -*-
"""Phase-2/2.1 tests: YAML integrity, equation algebra, PAC convention lock,
steady state (report, don't just assert), US block standalone shape."""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bigfoot.equations import (  # noqa: E402
    RESOLUTION,
    UnresolvedCoefficientError,
    load_appendix_d,
    resolve,
)
from bigfoot.equations import foreign, korea, sync, us  # noqa: E402
from bigfoot.equations.base import EXOG_V1, PROVISIONAL, RESOLVED, UNRESOLVED  # noqa: E402
from bigfoot.expectations import SatelliteVAR  # noqa: E402


# ------------------------------------------------------------ yaml integrity
def test_yaml_integrity():
    """Every YAML value appears in exactly one resolved position; export
    weights sum to 1.0; T16 regrouping preserved the value set exactly."""
    cfg = load_appendix_d()
    resolved = resolve(write=True)      # raises KeyError on coverage gaps

    n_yaml = 0
    from bigfoot.equations.loader import _iter_yaml_slots
    for path, kind, idx, val in _iter_yaml_slots(cfg):
        n_yaml += 1
        entry = resolved[path][str(idx)]
        assert entry["value"] == val, (path, idx)
        assert entry["status"] in (RESOLVED, PROVISIONAL, UNRESOLVED, EXOG_V1)
        if entry["status"] == UNRESOLVED:
            assert len(entry["candidates"]) >= 2, (path, idx)
    n_resolved = sum(len(v) for v in resolved.values())
    assert n_yaml == n_resolved, (n_yaml, n_resolved)

    xw = cfg["export"]["demand_weights"]["slots"]
    assert abs(sum(xw) - 1.0) < 1e-12, sum(xw)

    # T16 regrouping: value multiset identical to the pre-patch grouping
    lr = cfg["loan_rates"]
    new_vals = sorted(lr["household"]["slots"] + lr["firm"]["slots"]
                      + [lr["shared"]["named"]["eta_cb"]])
    old_vals = sorted([0.36, 0.6066, 0.0038, 0.2114, 0.0003]
                      + [0.64, 0.7025, 0.0013, 0.1607])
    assert new_vals == old_vals
    assert "corporate" not in lr


# ------------------------------------------------------------ algebra checks
def _synthetic_engine():
    A1 = np.array([[0.5, 0.1, 0.0], [0.0, 0.6, 0.1], [0.1, 0.0, 0.4]])
    return SatelliteVAR.from_coefficients([A1], endpoint_vec=np.zeros(3))


def test_equation_algebra():
    # --- policy rule (paper coefficients + CALIBRATED_LW r*, hand value)
    pr = korea.PolicyRule()
    by_hand = 0.85 * 3.0 + 0.15 * (2.0 + 4.0 + 1.5 * (4.0 - 2.0) + 0.5 * 1.0)
    assert abs(pr.rhs(i_lag=3.0, pi=4.0, gap=1.0) - by_hand) < 1e-12

    # --- Phillips pair (eq 23+24 AS PRINTED, paper pp.25-26, hand values)
    pp = korea.PhillipsPair()
    val = pp.core_inflation(pi_lag=4.0, pi_inf=3.0, pi_lead=3.5, gap=0.5)
    hand = (1 - 0.25 - 0.15) * 3.0 + 0.25 * 4.0 + 0.15 * 3.5 + 0.10 * 0.5
    assert abs(val - hand) < 1e-12
    # eq (24) carries (pi_Core,t-1 - pibar_t-1) as a DIFFERENCE, so pibar_t-1
    # loads at delta1 - delta2, not delta1.
    att = pp.attractor(pi_inf_lag=3.0, pi_lag=4.0)
    hand24 = (1 - 0.7232) * 2.0 + 0.7232 * 3.0 + 0.3164 * (4.0 - 3.0)
    assert abs(att - hand24) < 1e-12
    # the deviation form is the same equation with the constant dropped
    assert abs(pp.attractor_dev(pi_inf_lag=3.0, pi_lag=4.0)
               - ((0.7232 - 0.3164) * 3.0 + 0.3164 * 4.0)) < 1e-12
    # the retired readings must not come back silently
    for form in ("raw", "nested"):
        try:
            korea.PhillipsPair()  # no switch left
        except TypeError:  # pragma: no cover - would mean the API regressed
            raise
    assert not hasattr(pp, "eq24_form")

    # --- UIP with c_UIP wired (paper coefficients, hand value)
    u = korea.UIP()
    val = u.rhs(s_exp=7.02, s_lag=7.00, i_kr=3.0, i_us=4.0, z_risk=0.1)
    rp = 0.0812 + 4.0 * 0.1
    hand = 0.8814 * 7.02 + (1 - 0.8814) * 7.00 - (3.0 - 4.0 - rp) / 400
    assert abs(val - hand) < 1e-12

    # --- debt ratio now includes the gap term (eq 44, hand value)
    d = korea.DebtGDP()
    val = d.rhs(gap=0.5, dp_house=2.0, r_hh=4.0)
    hand = 0.0208 + 0.0118 * 0.5 + 0.1204 * 2.0 + (-0.8556) * 4.0
    assert abs(val - hand) < 1e-12

    # --- corp bond mean-reversion form (hand value)
    cb = korea.CorpBondSpread()
    val = cb.rhs(spread_lag=0.01, gap=-1.0)
    hand = 0.0003 + 0.5626 * (0.01 - 0.0003) + (-0.0487) * (-1.0)
    assert abs(val - hand) < 1e-12
    assert cb.steady_state() == 0.0003

    # --- consumption PAC, PAPER build (T2 all-RESOLVED + exact A.11-A.16)
    eng = _synthetic_engine()
    x = np.array([1.0, -0.5, 0.25])
    pac = korea.ConsumptionPAC(engine=eng, beta=0.99)
    assert pac.alpha.value == 0.0234 and pac.gammas[0].value == -0.1079
    # A.15/A.16 recovery (m=2): alpha_2 = a_1, alpha_1 = a0 - 1 - alpha_2
    assert np.allclose(pac.alphas, [-0.8687, -0.1079], rtol=0, atol=1e-12)
    w = eng.pac_weights_exact(1, pac.alphas, 0.99)
    F_hand = float(w @ x)
    F = pac.expectation_term(state_tm1=x)
    assert abs(F - F_hand) < 1e-12
    dy = pac.growth(ecm_lag=0.2, dy_lags=[0.05], F=F,
                    extras={"gap": 0.3, "r_hh": 4.0, "d_debt": 1.0,
                            "purch": 0.5})
    hand = (0.0234 * 0.2 + (-0.1079) * 0.05 + 1.0 * F
            + 0.2005 * 0.3 + (-0.6000) * 4.0 + 0.0193 * 1.0 + 0.0200 * 0.5)
    assert abs(dy - hand) < 1e-12

    # --- synthetic PAC path still available for framework tests
    pac_s = korea.consumption_pac(engine=eng, beta=0.95, synthetic={
        "a0": 0.01, "alpha": -0.12, "gamma1": 0.3, "phi": 0.4})
    F = pac_s.expectation_term(state_tm1=x)
    dy = pac_s.growth(ecm_lag=0.2, dy_lags=[0.05], F=F)
    hand = 0.01 + (-0.12) * 0.2 + 0.3 * 0.05 + 0.4 * F
    assert abs(dy - hand) < 1e-12


# ------------------------------------------------------- PAC convention lock
def test_pac_convention():
    """Regression lock: PAC equations use paper eq. (3) — E_{t-1}, j=0."""
    eng = _synthetic_engine()
    assert korea.PACEquation.PAC_START_INDEX == 0
    assert korea.PACEquation.PAC_EXPECTATION_DATE == "t-1"
    assert korea.ConsumptionPAC(engine=eng).pac_args == (0, "t-1")

    beta, tgt = 0.95, 1
    w = eng.pac_weights(tgt, beta, start_index=0, expectation_date="t-1")
    m = eng.S.shape[0]
    manual = (np.eye(3)[tgt] @ eng._J()
              @ ((eng.S - np.eye(m)) @ np.linalg.inv(np.eye(m) - beta * eng.S)))
    assert np.allclose(w, manual, atol=1e-12)

    x = np.array([0.8, -0.3, 0.5])
    J = eng._J()
    brute, d_prev, xi = 0.0, (J @ x)[tgt], x.copy()
    for j in range(0, 400):
        xi = eng.S @ xi
        d_j = (J @ xi)[tgt]
        brute += beta ** j * (d_j - d_prev)
        d_prev = d_j
    assert abs(float(w @ x) - brute) < 1e-10


# ------------------------------------------------------------- steady state
def test_steady_state(capsys):
    """At endpoints (pi=2%, gap=0, rates neutral) every evaluable equation
    implies zero deviation. Report all residuals; failures are information,
    coefficients are NOT tuned.

    **The eq (24) INFO-FAIL is gone [2026-08-21].** It was never the paper's
    arithmetic — δ1+δ2 = 1.0396 came from reading eq (24) as
    `δ1·πbar + δ2·π`, and the printed equation carries
    `δ2·(π_Core,t-1 − πbar_t-1)` as a DIFFERENCE. Read as printed, the pair
    has an exact fixed point at π* and every residual here is zero."""
    PI, GAP = 2.0, 0.0
    NEUTRAL = 2.0 + PI                          # r* + pi*, annual %
    results, failures, info_fails = [], [], []

    def check(name, resid, tol=1e-9, info_only=False):
        ok = abs(resid) < tol
        results.append((name, resid, "PASS" if ok else
                        ("INFO-FAIL" if info_only else "FAIL")))
        if not ok:
            (info_fails if info_only else failures).append((name, resid))

    pr = korea.PolicyRule()
    check("policy_rule(35)", pr.residual(i=NEUTRAL, i_lag=NEUTRAL, pi=PI,
                                         gap=GAP))
    pp = korea.PhillipsPair()
    check("phillips_core(23)[as printed, p.25]",
          pp.residual(pi=PI, pi_lag=PI, pi_inf=PI, pi_lead=PI, gap=GAP))
    check("phillips_attractor(24)[as printed, p.26]",
          PI - pp.attractor(pi_inf_lag=PI, pi_lag=PI))
    u = korea.UIP()
    sbar = u.ln_s_bar
    # SS requires the rate differential to equal the SS risk premium c_UIP
    check("uip(33-34)[i_kr-i_us=rp_ss]",
          u.residual(s=sbar, s_exp=sbar, s_lag=sbar,
                     i_kr=NEUTRAL + u.c_uip, i_us=NEUTRAL, z_risk=0.0))
    cb = korea.CorpBondSpread()
    check("corp_bond(38-39)[SS=η̄]", cb.residual(spread=cb.steady_state(),
                                                spread_lag=cb.steady_state(),
                                                gap=GAP))
    # eq (40)-(43) as printed [2026-08-21]: the funding mix passes through
    # ONE for one and the persistence sits on the spread. At the steady
    # state every deviation is zero, so both the spread recursion and the
    # rate identity return zero — a stronger check than the old "own implied
    # SS", which only held because the constructed form had an arbitrary
    # long-run level of its own.
    for which in ("household", "firm"):
        lr = korea.LoanRate(which)
        check(f"loan_spread_{which}(42-43)[dev]",
              lr.spread_dev(eta_lag=0.0, cb_dev=0.0))
        check(f"loan_rate_{which}(40-41)[dev]",
              lr.rate_dev(call=0.0, long_rate=0.0, eta=0.0))
    # consumption PAC in deviation reading: all inputs at SS deviations = 0
    eng = _synthetic_engine()
    pac = korea.ConsumptionPAC(engine=eng)
    check("consumption_pac(8)[dev-form]",
          0.0 - pac.growth(ecm_lag=0.0, dy_lags=[0.0], F=0.0,
                           extras={"gap": 0.0, "r_hh": 0.0, "d_debt": 0.0,
                                   "purch": 0.0}))
    inv = korea.investment_growth()
    check("investment_growth(10)[dev-form]",
          0.0 - inv.rhs(ecm_lag=0.0, dy_lag=0.0, gap=0.0, deflator=0.0,
                        semiconductor=0.0))
    for b in foreign.BLOCKS:
        blk = foreign.build(b)
        check(f"foreign_{b}(5)", blk.residual(gap=0, gap_lag=0,
                                              foreign_gap=0, oil_gap_lag=0))
    blk = foreign.build_rw()
    check("foreign_rw(5)[PLACEHOLDER_RW]",
          blk.residual(gap=0, gap_lag=0, foreign_gap=0, oil_gap_lag=0))
    ub = us.USBlock()
    check("us_is(QPM)", 0.0 - ub.output_gap_eq(0.0, 0.0, 0.0))
    check("us_pc(QPM)[dev]", (PI) - ub.phillips(PI, PI, GAP))
    i_ss = us.RR_BAR + PI
    check("us_rule(QPM)", i_ss - ub.rule(i_ss, PI, GAP))
    ts = sync.TermPremiumSync()
    check("tp_sync", ts.residual(tp_kr=0.25, tp_us=0.5))

    # growth ECMs whose constants imply trend growth need trend calibration
    # of their inputs, which is not in the tables -> reported SKIP
    skips = {
        "export_growth(19)": "c_X implies trend growth; input trends "
                             "(world demand, fx) not pinned by tables",
        "import_growth(22)": "same as export",
        "cpi_growth(26)": "c_cpi + Δcore/Δpm SS levels not pinned",
        "housing_growth(28)": "house-price trend not pinned",
        "debt_gdp(44)": "input basis (levels vs deviations, decimal vs %) "
                        "not pinned by table; implied drift depends on it",
        "construction/government": "EXOG_V1 (held at trend)",
    }

    print("\n=== steady-state report (Phase 2.1) ===")
    for name, resid, verdict in results:
        print(f"{verdict:9s} {name:48s} residual {resid:+.4e}")
    for name, why in skips.items():
        print(f"{'SKIP':9s} {name:48s} {why}")
    assert not failures, failures
    # **No INFO-FAIL is left.** The single one used to be eq (24) under the
    # mis-transcribed reading; read as printed the pair is anchored at pi*.
    assert not info_fails, info_fails


# ------------------------------------------------------- US standalone shape
def test_us_block_standalone():
    """+25bp shock alone -> hump-shaped output-gap decline (sign/shape only)."""
    ub = us.USBlock()
    sim = ub.simulate_shock(shock_bp=25.0, T=80)
    y = sim["y"]
    trough_k = int(np.argmin(y))
    trough = y[trough_k]
    assert trough < 0, "output gap must decline after a tightening shock"
    assert trough_k >= 2, f"hump requires delayed trough, got k={trough_k}"
    assert abs(y[-1]) < 0.25 * abs(trough), "gap must recover toward zero"
    assert y[-1] == pytest.approx(0.0, abs=0.05)
    print(f"\nUS block: trough {trough:+.4f}pp at k={trough_k}, "
          f"y[-1]={y[-1]:+.5f}")
