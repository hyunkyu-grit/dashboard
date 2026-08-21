# -*- coding: utf-8 -*-
"""Satellite VAR with shifting endpoints — BOK-LOOK Appendix A.

Notation (paper eq. numbers in brackets):

  z_t   3x1 core vector [pi, gap, r]      z*_t  3x1 endpoint vector
  d_t = z_t - z*_t                         deviations from endpoints

[A.1]  VECM with shifting endpoints, written equivalently as a VAR(p) in
       deviations (the error-correction representation and the deviations
       VAR are algebraically identical when the endpoints are the
       attractors — see AMBIGUITY (1) in the module report):

           d_t = A_1 d_{t-1} + ... + A_p d_{t-p} + eps_t     (no intercept:
                                                              endpoints absorb
                                                              the mean)

[A.2]  Augmented VAR with block exogeneity for a variable of interest w_t
       (deviations dw_t = w_t - w*_t):

           d_t  = A(L) d_{t-1} + eps_t                (core unaffected by w)
           dw_t = c(L)'d_{t-1} + g(L) dw_{t-1} + eta_t

[A.3-A.6]  companion (level representation): state x_t = [d_t', ..., d_{t-p+1}']',
           S = [[A_1 ... A_p], [I 0 ... 0], ...], selector J = [I 0 ... 0]
           so d_{t+k} expectation = J S^k x_t.

[A.7-A.8]  k-step forecast; endpoints follow random walks, so
           E_t z*_{t+k} = z*_t and E_t z_{t+k} = z*_t + J S^k x_t.

[A.9]  long-run limit: S^k -> 0 when rho(S) < 1, so E_t z_{t+inf} = z*_t.

[A.12] PAC expectation term: the infinite discounted sum of expected future
       changes of a target variable i, for discount beta in (0,1):

           F_{i,t} = sum_{k=1}^{inf} beta^k E_t[ z_{i,t+k} - z_{i,t+k-1} ]

       Since E_t z*_{t+k} = z*_t (random-walk endpoints), expected changes
       equal expected deviation changes, and the closed form is

           F_{i,t} = e_i' J beta (S - I) (I - beta S)^{-1} x_t

       using sum beta^k S^k = beta S (I-beta S)^{-1} and
       sum beta^k S^{k-1} = beta (I-beta S)^{-1}.  Requires rho(S) < 1
       (asserted before inversion; also sufficient for beta*rho < 1).
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd


class NonStationaryError(ValueError):
    """Raised when the companion matrix has spectral radius >= 1."""


# ------------------------------------------------- exact PAC weights (A.11-16)
def recover_alphas(a0: float, a_lags: list) -> list:
    """[A.15-A.16] Recover the adjustment-cost polynomial coefficients
    alpha_1..alpha_m of A(L) = 1 + alpha_1 L + ... + alpha_m L^m from the
    estimated decision-rule coefficients (a0, a_1..a_{m-1}):

        a0  = A(1)                       (A.15)
        a_k = sum_{j=k+1}^{m} alpha_j    (A.16, k = 1..m-1)

    Inversion: alpha_m = a_{m-1}; alpha_k = a_{k-1} - a_k for k = m-1..2;
    alpha_1 = a0 - 1 - sum_{j>=2} alpha_j.  m = len(a_lags) + 1.
    """
    a = [float(v) for v in a_lags]
    m = len(a) + 1
    alphas = [0.0] * m
    if m > 1:
        alphas[m - 1] = a[m - 2]
        for k in range(m - 1, 1, -1):           # k = m-1 .. 2
            alphas[k - 1] = a[k - 2] - a[k - 1]
    alphas[0] = float(a0) - 1.0 - sum(alphas[1:])
    return alphas


def pac_G(alphas: list, beta: float) -> np.ndarray:
    """[A.13] Forward-root companion of the PAC problem:

        G = [ [ 0            I_{m-1} ],
              [ -alpha_m beta^m, ..., -alpha_1 beta ] ]

    Its eigenvalues are beta * (inverse roots of A), so rho(G) < 1 whenever
    A(L) is stable and beta <= 1.
    """
    m = len(alphas)
    G = np.zeros((m, m))
    if m > 1:
        G[: m - 1, 1:] = np.eye(m - 1)
    G[m - 1, :] = [-alphas[m - j - 1] * beta ** (m - j) for j in range(m)]
    return G


def _companion(A_list: list[np.ndarray]) -> np.ndarray:
    """[A.3-A.6] Stack VAR(p) coefficient matrices into companion form."""
    p = len(A_list)
    n = A_list[0].shape[0]
    S = np.zeros((n * p, n * p))
    S[:n, :] = np.hstack(A_list)
    if p > 1:
        S[n:, : n * (p - 1)] = np.eye(n * (p - 1))
    return S


class SatelliteVAR:
    """Core satellite VAR (eq. A.1) with shifting endpoints.

    Parameters
    ----------
    core : DataFrame, columns [pi, gap, r], quarterly PeriodIndex
    lags : VAR order p (default 2, per the paper's benchmark practice)
    pi_endpoint : inflation endpoint, % annual (v1: constant, default 2.0)
    gap_endpoint : output-gap endpoint (v1: constant, default 0.0)
    r_endpoint : Series of the rate endpoint over the sample (HP trend of the
        call rate; last value held flat off-sample), or a constant float.

    v1 endpoint policy is an owner decision hardcoded as defaults; all three
    are constructor arguments so Phase 4 can swap in estimated endpoints.
    """

    COLS = ("pi", "gap", "r")

    def __init__(self, core: pd.DataFrame, lags: int = 2,
                 pi_endpoint: float = 2.0, gap_endpoint: float = 0.0,
                 r_endpoint: pd.Series | float = None):
        self.lags = int(lags)
        self.core = core[list(self.COLS)].dropna().copy()
        idx = self.core.index
        if r_endpoint is None:
            raise ValueError("r_endpoint required (HP trend series or float)")
        r_star = (pd.Series(float(r_endpoint), index=idx)
                  if np.isscalar(r_endpoint) else r_endpoint.reindex(idx))
        self.endpoints = pd.DataFrame(
            {"pi": pi_endpoint, "gap": gap_endpoint, "r": r_star}, index=idx)
        self.dev = self.core - self.endpoints           # d_t = z_t - z*_t
        self._fit_ols()

    # -------------------------------------------------------------- fitting
    def _fit_ols(self) -> None:
        """OLS on the deviations VAR (A.1), equation by equation, no constant.

        Plain OLS is the Phase-1 estimator; the Bayesian Minnesota prior
        arrives in Phase 4.
        """
        p, n = self.lags, len(self.COLS)
        D = self.dev.values
        T = len(D)
        Y = D[p:]                                        # (T-p) x n
        X = np.hstack([D[p - j - 1: T - j - 1] for j in range(p)])
        B, *_ = np.linalg.lstsq(X, Y, rcond=None)        # (n*p) x n
        self.A = [B[j * n:(j + 1) * n, :].T for j in range(p)]   # A_j: n x n
        self.resid = Y - X @ B
        self.S = _companion(self.A)
        self._x_T = np.concatenate([D[-1 - j] for j in range(p)])  # state x_T

    @classmethod
    def from_coefficients(cls, A_list: list[np.ndarray],
                          endpoint_vec: np.ndarray = None) -> "SatelliteVAR":
        """Assemble directly from coefficient matrices (published-coefficients
        path per the design principle; also used to test non-stationary
        refusal). No data attached: forecasts need a state via `state=`."""
        self = cls.__new__(cls)
        self.lags = len(A_list)
        self.A = [np.asarray(a, dtype=float) for a in A_list]
        self.S = _companion(self.A)
        n = self.A[0].shape[0]
        self.endpoint_vec = (np.zeros(n) if endpoint_vec is None
                             else np.asarray(endpoint_vec, dtype=float))
        self.core = None
        self._x_T = None
        return self

    # ----------------------------------------------------------- properties
    @property
    def n(self) -> int:
        return self.A[0].shape[0]

    @property
    def spectral_radius(self) -> float:
        return float(np.max(np.abs(np.linalg.eigvals(self.S))))

    def _require_stationary(self) -> None:
        rho = self.spectral_radius
        if rho >= 1.0:
            raise NonStationaryError(
                f"companion spectral radius {rho:.4f} >= 1; "
                "refusing forecast limit / infinite sum")

    def _J(self) -> np.ndarray:
        J = np.zeros((self.n, self.n * self.lags))
        J[:, : self.n] = np.eye(self.n)
        return J

    def _endpoint_now(self) -> np.ndarray:
        # endpoints are random walks: today's value is the forecast forever
        if self.core is not None:
            return self.endpoints.iloc[-1].values.astype(float)
        return self.endpoint_vec

    def _state(self, state: np.ndarray = None) -> np.ndarray:
        x = self._x_T if state is None else np.asarray(state, dtype=float)
        if x is None:
            raise ValueError("no data attached; pass state= explicitly")
        return x

    # ------------------------------------------------------------ forecasts
    def forecast(self, k: int, state: np.ndarray = None) -> np.ndarray:
        """[A.7-A.8] E_t z_{t+k} = z*_t + J S^k x_t (levels)."""
        x = self._state(state)
        return self._endpoint_now() + self._J() @ np.linalg.matrix_power(self.S, k) @ x

    def forecast_path(self, horizon: int, state: np.ndarray = None) -> pd.DataFrame:
        x = self._state(state)
        J, zstar = self._J(), self._endpoint_now()
        out, xi = [], x.copy()
        for _ in range(horizon):
            xi = self.S @ xi
            out.append(zstar + J @ xi)
        return pd.DataFrame(out, columns=list(self.COLS),
                            index=range(1, horizon + 1))

    def long_run(self) -> np.ndarray:
        """[A.9] lim_{k->inf} E_t z_{t+k} = z*_t (requires rho(S) < 1)."""
        self._require_stationary()
        return self._endpoint_now()

    # ---------------------------------------------------------- PAC term
    def pac_weights(self, target: int, beta: float, start_index: int = 1,
                    expectation_date: str = "t") -> np.ndarray:
        """[A.12] Row vector w with F = w @ x: closed-form infinite discounted
        sum of expected target-variable changes.

        Conventions (Phase 2 addition; defaults preserve the Phase-1 form):
          expectation_date "t"   -- expectations dated t, state x_t.
                                    j=0 (the period-t change) is data, not an
                                    expectation, so start_index must be >= 1.
          expectation_date "t-1" -- PAPER eq. (3): expectations dated t-1,
                                    state x_{t-1}; the sum may start at j=0
                                    (the current-period change).

        General closed form, j0 = start_index:
            F = e_i' J beta^{j0} S^{expo} (S - I)(I - beta S)^{-1} x
            expo = j0 - 1 + (1 if expectation_date == "t-1" else 0)
        Phase-1 default (j0=1, "t"): beta (S - I)(I - beta S)^{-1}  (expo=0).
        Paper convention (j0=0, "t-1"):     (S - I)(I - beta S)^{-1}.
        """
        if expectation_date not in ("t", "t-1"):
            raise ValueError(f"expectation_date must be 't' or 't-1', "
                             f"got {expectation_date!r}")
        expo = start_index - 1 + (1 if expectation_date == "t-1" else 0)
        if expo < 0:
            raise ValueError("start_index=0 with expectation_date='t': the "
                             "j=0 change is realized data, not an expectation")
        self._require_stationary()          # before any inversion
        m = self.S.shape[0]
        inv = np.linalg.inv(np.eye(m) - beta * self.S)
        e = np.zeros(self.n)
        e[target] = 1.0
        core = np.linalg.matrix_power(self.S, expo) @ (self.S - np.eye(m)) @ inv
        return e @ self._J() @ (beta ** start_index * core)

    def pac_term(self, target: int, beta: float, state: np.ndarray = None,
                 start_index: int = 1, expectation_date: str = "t") -> float:
        """[A.12] F evaluated at a state. NOTE: under expectation_date='t-1'
        the state passed must be x_{t-1} (the information set of the
        expectation date), not x_t."""
        w = self.pac_weights(target, beta, start_index, expectation_date)
        return float(w @ self._state(state))

    def pac_weights_exact(self, target: int, alphas: list, beta: float,
                          return_info: bool = False):
        """[A.11-A.16, exact] Row vector w with F = w @ x_{t-1} for the PAC
        expectation term  E_{t-1} sum_{k=0}^{inf} d_k dy*_{t+k}  with the
        paper's exact d-weights (owner transcription of pp. 50-52):

            d_k = A(1) A(beta) e_m'(I_m - G)^{-1} G^k e_m,   G per (A.13)

        (the iotas of (A.12) are UNIT selectors: iota_m = m-th column of I_m,
        iota_1 = the target's row selector — verified against the PAC Euler
        equation A(beta F)A(L) y_t = A(1)A(beta) y*_t to machine precision,
        m = 1..4; tests/test_expectations.py::test_a12_exact_euler).

        With the engine's companion S playing H and the target proxied by a
        core variable (the pre-existing Phase-2 wiring), the mixed sum
        sum_k d_k S^k collapses through the Kronecker identity to

            K = [e_m'(I-G)^{-1} kron I_N] [I_{mN} - (G kron S)]^{-1}
                [e_m kron I_N]
            w = A(1) A(beta) * e_target' J K (S - I)

        E_{t-1} dating and the k=0 start are built in (A.11): the k-th change
        row is J S^k (S - I) x_{t-1}.  For m=1 this reduces to the geometric
        d_k = A(1)(beta*lam)^k, i.e. the retired PROVISIONAL_A13 special case
        RESCALED by A(1)/A(beta) — the provisional (1-beta*lam) sum-to-one
        normalization is NOT the paper's and fails the Euler equation.

        Requires rho(S) < 1, rho(G) < 1 and rho(G kron S) < 1 (asserted
        before inversion).
        """
        self._require_stationary()
        alphas = [float(a) for a in alphas]
        m = len(alphas)
        G = pac_G(alphas, beta)
        rho_G = float(np.max(np.abs(np.linalg.eigvals(G))))
        if rho_G >= 1.0:
            raise NonStationaryError(
                f"PAC G spectral radius {rho_G:.4f} >= 1 (A(L) unstable at "
                f"beta={beta}); refusing inversion")
        GS = np.kron(G, self.S)
        rho_GS = float(np.max(np.abs(np.linalg.eigvals(GS))))
        if rho_GS >= 1.0:
            raise NonStationaryError(
                f"spectral radius of (G kron S) = {rho_GS:.4f} >= 1; "
                "refusing inversion")
        A1 = 1.0 + sum(alphas)
        Ab = 1.0 + sum(a * beta ** (j + 1) for j, a in enumerate(alphas))
        N = self.S.shape[0]
        em = np.zeros((m, 1))
        em[m - 1, 0] = 1.0
        left = np.kron(em.T @ np.linalg.inv(np.eye(m) - G), np.eye(N))
        mid = np.linalg.inv(np.eye(m * N) - GS)
        K = left @ mid @ np.kron(em, np.eye(N))
        e = np.zeros(self.n)
        e[target] = 1.0
        w = A1 * Ab * (e @ self._J() @ K @ (self.S - np.eye(N)))
        if return_info:
            d_sum = A1 * Ab * (
                em.T @ np.linalg.matrix_power(np.linalg.inv(np.eye(m) - G), 2)
                @ em).item()
            return w, {"m": m, "alphas": alphas, "A1": A1, "Abeta": Ab,
                       "rho_G": rho_G, "rho_G_kron_S": rho_GS,
                       "d_weight_sum": d_sum}
        return w

    # ------------------------------------------------------------- summary
    def summary(self, tests_passed: int = None) -> dict:
        s = {
            "module": "expectations_engine",
            "as_of": date.today().isoformat(),
            "spectral_radius": round(self.spectral_radius, 4),
            "var_lags": self.lags,
            "sample": (f"{self.core.index[0]}-{self.core.index[-1]}"
                       if self.core is not None else None),
            "endpoints": {
                "inflation_pct": (round(float(self.endpoints["pi"].iloc[-1]), 4)
                                  if self.core is not None else None),
                "output_gap_pct": (round(float(self.endpoints["gap"].iloc[-1]), 4)
                                   if self.core is not None else None),
                "rate_pct": (round(float(self.endpoints["r"].iloc[-1]), 4)
                             if self.core is not None else None),
            },
            "tests_passed": tests_passed,
        }
        return s


class ECSatelliteVAR(SatelliteVAR):
    """[A.1, explicit EC form — FORM_A1_EC] The photographed (A.1) is

        dX_t = A0 [X^ep_{t-1} - X_{t-1}] + B1 dX_{t-1} + u_t

    with a FREELY estimated n x n loading matrix A0 — estimated on level
    differences dX, not on deviation differences as the Phase-1
    deviations-form VAR effectively assumed.  OLS equation by equation, no
    constant, one dX lag (the natural counterpart of the lags=2 deviations
    benchmark; ellipsis lags beyond dX_{t-1} not transcribed).

    Companion rebuild per (A.3)-(A.5): under E_t dX^ep = 0 (random-walk
    endpoints) the implied deviations dynamics are

        d_t = (I - A0 + B1) d_{t-1} - B1 d_{t-2}

    i.e. a standard VAR(2) companion with Phi1 = I - A0 + B1, Phi2 = -B1,
    so every downstream consumer (J, pac weights, k-step forecasts) works
    unchanged on the standard state [d_t', d_{t-1}']'.  The free-A0 EC form
    and the deviations VAR(2) span the same 18-parameter family; the
    estimates differ only through the in-sample variation of the endpoint
    series (dX vs d-difference regressands) — with constant endpoints the
    two estimators coincide exactly (tests/test_expectations.py).
    """

    def _fit_ols(self) -> None:
        if self.lags != 2:
            raise ValueError("FORM_A1_EC is implemented for lags=2 "
                             "(one dX lag), got lags=%d" % self.lags)
        n = len(self.COLS)
        X = self.core.values                       # levels
        D = self.dev.values                        # X - X^ep
        dX = np.diff(X, axis=0)                    # row t-1 holds dX_t
        Y = dX[1:]                                 # dX_t,   t = 2..T-1
        ecm = -D[1:-1]                             # (X^ep - X)_{t-1}
        dXlag = dX[:-1]                            # dX_{t-1}
        R = np.hstack([ecm, dXlag])
        B, *_ = np.linalg.lstsq(R, Y, rcond=None)
        self.A0 = B[:n].T                          # FREE loading (A.1)
        self.B1 = B[n:].T
        self.resid = Y - R @ B
        self.A = [np.eye(n) - self.A0 + self.B1, -self.B1]
        self.S = _companion(self.A)
        self._x_T = np.concatenate([D[-1], D[-2]])


class AugmentedVAR:
    """[A.2] Core VAR augmented with one variable of interest w under block
    exogeneity: the core equations exclude w (estimated exactly as in the
    core engine), while the w equation loads on both core lags and own lags.

    The augmented companion is block lower-triangular:

        S_aug = [[ S_core      0    ],
                 [ C_blocks  G_blocks]]

    so core forecasts are unchanged and w inherits core dynamics.
    Phase 1 exercises the structure with a dummy variable; real variables
    (e.g. long rates, exchange rate) arrive in Phase 2.
    """

    def __init__(self, core_engine: SatelliteVAR, w: pd.Series,
                 w_endpoint: pd.Series | float = 0.0):
        self.core_engine = core_engine
        p, n = core_engine.lags, core_engine.n
        idx = core_engine.dev.index
        w = w.reindex(idx)
        w_star = (pd.Series(float(w_endpoint), index=idx)
                  if np.isscalar(w_endpoint) else w_endpoint.reindex(idx))
        self.dw = (w - w_star).dropna()
        if not self.dw.index.equals(idx):
            raise ValueError("w must cover the core sample")

        # ------- estimate the core block WITHIN the augmented framework:
        # block exogeneity == the w regressors are excluded, so this is the
        # same OLS as the core engine ran; kept as an independent estimation
        # so the block-exogeneity property is verified, not assumed.
        D = core_engine.dev.values
        T = len(D)
        Y = D[p:]
        Xc = np.hstack([D[p - j - 1: T - j - 1] for j in range(p)])
        Bc, *_ = np.linalg.lstsq(Xc, Y, rcond=None)
        self.core_A = [Bc[j * n:(j + 1) * n, :].T for j in range(p)]

        # ------- w equation: own lags + core lags
        dw = self.dw.values
        Xw = np.hstack([Xc, np.column_stack(
            [dw[p - j - 1: T - j - 1] for j in range(p)])])
        bw, *_ = np.linalg.lstsq(Xw, dw[p:], rcond=None)
        self.c = bw[: n * p]                      # loadings on core lags
        self.g = bw[n * p:]                       # own-lag coefficients

        # ------- block lower-triangular companion [A.2]
        m = n * p + p
        S = np.zeros((m, m))
        S[: n * p, : n * p] = _companion(self.core_A)
        S[n * p, : n * p] = self.c
        S[n * p, n * p:] = self.g
        if p > 1:
            S[n * p + 1:, n * p: m - 1] = np.eye(p - 1)
        self.S = S
        self._x_T = np.concatenate(
            [np.concatenate([D[-1 - j] for j in range(p)]),
             np.array([dw[-1 - j] for j in range(p)])])

    @property
    def spectral_radius(self) -> float:
        return float(np.max(np.abs(np.linalg.eigvals(self.S))))

    def pac_weights_w(self, beta: float) -> np.ndarray:
        """A.12 closed form for the augmented variable w itself."""
        rho = self.spectral_radius
        if rho >= 1.0:
            raise NonStationaryError(f"augmented spectral radius {rho:.4f} >= 1")
        m = self.S.shape[0]
        n_p = self.core_engine.n * self.core_engine.lags
        e = np.zeros(m)
        e[n_p] = 1.0                              # w's slot in the state
        inv = np.linalg.inv(np.eye(m) - beta * self.S)
        return e @ (beta * (self.S - np.eye(m)) @ inv)

    def pac_term_w(self, beta: float) -> float:
        return float(self.pac_weights_w(beta) @ self._x_T)
