# -*- coding: utf-8 -*-
"""Phase-1 tests for the satellite VAR expectations engine (Appendix A)."""
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bigfoot.expectations import (  # noqa: E402
    AugmentedVAR,
    ECSatelliteVAR,
    NonStationaryError,
    SatelliteVAR,
    build_korea_engine,
    pac_G,
    recover_alphas,
)


@lru_cache(maxsize=1)
def engine() -> SatelliteVAR:
    return build_korea_engine(lags=2)


def test_endpoint_convergence():
    """[A.9] long-run forecast converges to the endpoint vector (1e-8)."""
    eng = engine()
    endpoint = eng.long_run()
    fc = eng.forecast(2000)
    assert np.all(np.abs(fc - endpoint) < 1e-8), (fc, endpoint)
    # and the k-step path is actually heading there monotonically at the tail
    far, farther = eng.forecast(400), eng.forecast(800)
    assert np.all(np.abs(farther - endpoint) <= np.abs(far - endpoint) + 1e-12)


@pytest.mark.parametrize("beta", [0.90, 0.95, 0.98])
def test_infinite_sum(beta):
    """[A.12] closed form == brute-force 400-quarter summation (1e-6)."""
    eng = engine()
    for target in range(3):
        closed = eng.pac_term(target, beta)
        # brute force: propagate the state, accumulate beta^k * (d_k - d_{k-1})
        J = np.zeros((eng.n, eng.n * eng.lags))
        J[:, : eng.n] = np.eye(eng.n)
        x_prev = eng._x_T.copy()
        d_prev = (J @ x_prev)[target]
        brute, x = 0.0, x_prev.copy()
        for k in range(1, 401):
            x = eng.S @ x
            d_k = (J @ x)[target]
            brute += beta ** k * (d_k - d_prev)
            d_prev = d_k
        assert abs(closed - brute) < 1e-6, (target, beta, closed, brute)


def test_spectral_radius():
    """Engine must refuse (raise) on a non-stationary companion matrix."""
    bad = SatelliteVAR.from_coefficients([1.02 * np.eye(3)])
    assert bad.spectral_radius >= 1.0
    with pytest.raises(NonStationaryError):
        bad.pac_weights(0, 0.95)
    with pytest.raises(NonStationaryError):
        bad.long_run()
    # borderline unit root refuses too
    unit = SatelliteVAR.from_coefficients([np.eye(3)])
    with pytest.raises(NonStationaryError):
        unit.pac_weights(0, 0.95)


def test_block_exogeneity():
    """[A.2] core-block coefficients identical with and without the augmented
    variable (block exogeneity holds in estimation, not just by assumption)."""
    eng = engine()
    rng = np.random.default_rng(42)
    # dummy variable of interest: AR(1)-ish noise on the core sample
    idx = eng.core.index
    w_vals = np.zeros(len(idx))
    shocks = rng.standard_normal(len(idx))
    for t in range(1, len(idx)):
        w_vals[t] = 0.6 * w_vals[t - 1] + shocks[t]
    w = pd.Series(w_vals, index=idx)

    aug = AugmentedVAR(eng, w, w_endpoint=0.0)
    for j in range(eng.lags):
        assert np.allclose(aug.core_A[j], eng.A[j], rtol=0, atol=1e-12), j
    # the augmented PAC machinery runs and is stationary with the dummy
    assert aug.spectral_radius < 1.0
    assert np.isfinite(aug.pac_term_w(0.95))


# ---------------------------------------------- exact PAC weights (A.11-A.16)
def _stable_alphas(mus):
    """A(L) = prod_i (1 - mu_i L) -> [alpha_1..alpha_m], |mu_i| < 1."""
    poly = np.array([1.0])
    for mu in mus:
        poly = np.convolve(poly, [1.0, -mu])
    return list(poly[1:])


@pytest.mark.parametrize("mus", [[0.7], [0.85, -0.3], [0.85, -0.3, 0.2],
                                 [0.9, 0.5, -0.4, 0.25]])
def test_a15_a16_roundtrip(mus):
    """[A.15/A.16] alphas -> (a0, a_k) -> recover_alphas is the identity."""
    alphas = _stable_alphas(mus)
    m = len(alphas)
    a0 = 1.0 + sum(alphas)                          # A.15
    a_lags = [sum(alphas[k:]) for k in range(1, m)]  # A.16
    back = recover_alphas(a0, a_lags)
    assert np.allclose(back, alphas, rtol=0, atol=1e-12), (alphas, back)


def test_a12_exact_euler():
    """Ground truth for the A.12 unit-selector reading: a path simulated with
    the exact d-weights must satisfy the PAC Euler equation

        A(beta F) A(L) y_t = A(1) A(beta) y*_t

    to machine precision (deterministic world, so E_{t-1} = realization).
    Run at m=2 (consumption's order) on a 3-variable engine so the Kronecker
    dimensions are exercised, and at m=1 for the reduction."""
    A1m = np.array([[0.5, 0.1, 0.0], [0.0, 0.6, 0.1], [0.1, 0.0, 0.4]])
    eng = SatelliteVAR.from_coefficients([A1m], endpoint_vec=np.zeros(3))
    beta, tgt = 0.99, 1
    for alphas in ([-(1.0 - 0.0234)],               # m=1, lam = 1 - a0
                   recover_alphas(0.0234, [-0.1079])):   # m=2 consumption
        m = len(alphas)
        a0 = 1.0 + sum(alphas)
        a_lags = [sum(alphas[k:]) for k in range(1, m)]
        w = eng.pac_weights_exact(tgt, alphas, beta)

        T = 60
        x = np.array([1.0, -0.5, 0.25])             # x_{-1}
        ystar = {-1: x[tgt]}
        xs = {-1: x.copy()}
        for t in range(T + m + 2):
            xs[t] = eng.S @ xs[t - 1]
            ystar[t] = xs[t][tgt]
        y = {t: 0.0 for t in range(-m - 1, 0)}      # steady-state pre-history
        for t in range(T):
            F = float(w @ xs[t - 1])
            dy = a0 * (ystar[t - 1] - y[t - 1]) + F
            for k in range(1, m):
                dy += a_lags[k - 1] * (y[t - k] - y[t - k - 1])
            y[t] = y[t - 1] + dy

        al = np.array([1.0] + list(alphas))
        A1v, Abv = al.sum(), sum(al[i] * beta ** i for i in range(m + 1))
        for t in range(m, T - m - 1):
            euler = sum(al[i] * beta ** i * al[j] * y[t + i - j]
                        for i in range(m + 1) for j in range(m + 1))
            assert abs(euler - A1v * Abv * ystar[t]) < 1e-12, (m, t)


def test_a13_m1_regression():
    """m=1 reduction vs the retired PROVISIONAL_A13 special case.

    The exact closed form reduces at m=1 to geometric weights in beta*lam —
    the SAME structure as the old special case — but normalized by
    A(1) = a0, not the old sum-to-one (1 - beta*lam):

        w_exact = [A(1)/A(beta)] * w_provisional,   A(beta) = 1 - beta*lam

    (exact equality, as the Phase-3.1 task sheet predicted, holds only at
    beta = 1, where A(1) = A(beta); the old normalization fails the Euler
    equation of test_a12_exact_euler at beta < 1)."""
    A1m = np.array([[0.5, 0.1, 0.0], [0.0, 0.6, 0.1], [0.1, 0.0, 0.4]])
    eng = SatelliteVAR.from_coefficients([A1m], endpoint_vec=np.zeros(3))
    a0, tgt = 0.0234, 1
    lam = 1.0 - a0
    for beta in (0.99, 0.97):
        w_exact = eng.pac_weights_exact(tgt, [a0 - 1.0], beta)
        w_old = (1.0 - beta * lam) * eng.pac_weights(
            tgt, beta * lam, start_index=0, expectation_date="t-1")
        ratio = a0 / (1.0 - beta * lam)             # A(1)/A(beta)
        assert np.allclose(w_exact, ratio * w_old, rtol=0, atol=1e-14)
    # at beta -> 1 the two coincide
    w_exact = eng.pac_weights_exact(tgt, [a0 - 1.0], 1.0)
    w_old = (1.0 - lam) * eng.pac_weights(tgt, lam, start_index=0,
                                          expectation_date="t-1")
    assert np.allclose(w_exact, w_old, rtol=0, atol=1e-14)


def test_a13_stationarity_refusal():
    """rho(G) >= 1 or rho(G kron S) >= 1 must refuse before inversion."""
    A1m = np.array([[0.5, 0.1, 0.0], [0.0, 0.6, 0.1], [0.1, 0.0, 0.4]])
    eng = SatelliteVAR.from_coefficients([A1m], endpoint_vec=np.zeros(3))
    # lam = 1.5 -> G = [1.5*beta], rho >= 1 at beta = 0.99
    with pytest.raises(NonStationaryError):
        eng.pac_weights_exact(0, [-1.5], 0.99)
    # G itself checked: rho(pac_G) matches beta * inverse-root scaling
    G = pac_G(recover_alphas(0.0234, [-0.1079]), 0.99)
    assert np.abs(np.linalg.eigvals(G)).max() < 1.0


# ----------------------------------------------------- A.1 EC form (Step 3)
def test_a1_ec_form():
    """[A.1, FORM_A1_EC] The explicit EC estimator (free A0, dX regressand):

    1. with CONSTANT endpoints, dX == d-difference, so the EC form and the
       deviations VAR(2) are the same 18-parameter OLS problem under an
       invertible regressor reparameterization — companions must coincide
       to machine precision;
    2. on the real Korea dataset (HP-trend rate endpoint varies in-sample)
       the estimates differ but must stay stationary, and the Phi map
       Phi1 = I - A0 + B1, Phi2 = -B1 must hold exactly.
    """
    rng = np.random.default_rng(3)
    idx = pd.period_range("2000Q1", periods=120, freq="Q")
    # simulate a stable VAR(2) around constant endpoints
    P1 = np.array([[0.5, 0.1, 0.0], [0.0, 0.55, 0.1], [0.1, 0.0, 0.45]])
    P2 = 0.15 * np.eye(3)
    D = np.zeros((120, 3))
    for t in range(2, 120):
        D[t] = P1 @ D[t - 1] + P2 @ D[t - 2] + 0.3 * rng.standard_normal(3)
    core = pd.DataFrame(D + np.array([2.0, 0.0, 2.5]),
                        columns=["pi", "gap", "r"], index=idx)
    dev = SatelliteVAR(core, lags=2, pi_endpoint=2.0, gap_endpoint=0.0,
                       r_endpoint=2.5)
    ec = ECSatelliteVAR(core, lags=2, pi_endpoint=2.0, gap_endpoint=0.0,
                        r_endpoint=2.5)
    assert np.allclose(ec.S, dev.S, rtol=0, atol=1e-10)

    ec_kr = build_korea_engine(lags=2, form="a1_ec")
    dev_kr = build_korea_engine(lags=2, form="dev")
    assert ec_kr.spectral_radius < 1.0
    n = np.eye(3)
    assert np.allclose(ec_kr.A[0], n - ec_kr.A0 + ec_kr.B1, atol=1e-14)
    assert np.allclose(ec_kr.A[1], -ec_kr.B1, atol=1e-14)
    # the two estimators genuinely differ on the real data (moving r*)
    assert not np.allclose(ec_kr.S, dev_kr.S, atol=1e-6)
