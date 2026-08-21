# -*- coding: utf-8 -*-
"""Phase-5b Step 1/2 — swap-spread diagnostics + OU/AR(1) satellite.

SPREAD_V1_OU: per tenor, s_{t+1} = mu + phi (s_t - mu) + e on DAILY data;
mu estimated on a stress-trimmed sample (COVID 2020, Legoland 2022
windows removed; full-sample mu reported alongside), phi compounded
daily->quarterly as phi^63. No structural drivers in v1 (supply/hedging
flows out of scope). Forecast at horizon h business days: deterministic
mean reversion from the latest observed spread; uncertainty band =
EMPIRICAL quantiles (10/90) of historical h-step spread changes applied
around the deterministic path — not Gaussian, stress episodes included
(they define the honesty bounds).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from bigfoot.irs_curve.data import STRESS_WINDOWS, spreads, stress_mask

BD_PER_Q = 63


def moments(sp: pd.DataFrame) -> dict:
    out = {}
    for tenor in sp.columns:
        s = sp[tenor].dropna()
        ar1 = float(s.autocorr(1))
        out[tenor] = {"n": int(len(s)),
                      "mean_bp": round(float(s.mean()) * 100, 1),
                      "sd_bp": round(float(s.std()) * 100, 1),
                      "ar1_daily": round(ar1, 4),
                      "latest_bp": round(float(s.iloc[-1]) * 100, 1)}
    return out


def stress_excursions(sp: pd.DataFrame) -> dict:
    """Per episode, per tenor: extreme spread level and move from the
    pre-episode level (the satellite's honesty bounds)."""
    out = {}
    for name, (a, b) in STRESS_WINDOWS.items():
        ep = {}
        for tenor in sp.columns:
            s = sp[tenor].dropna()
            win = s.loc[a:b]
            pre = s.loc[:a]
            if len(win) < 5 or len(pre) < 5:
                ep[tenor] = {"insufficient": True}
                continue
            base = float(pre.iloc[-1])
            ext = float(win.loc[(win - base).abs().idxmax()])
            ep[tenor] = {"pre_bp": round(base * 100, 1),
                         "extreme_bp": round(ext * 100, 1),
                         "excursion_bp": round((ext - base) * 100, 1)}
        out[name] = ep
    return out


def fit_ou(sp: pd.DataFrame) -> dict:
    """Per tenor: (mu trimmed + full, phi daily + quarterly)."""
    out = {}
    trim = ~stress_mask(sp.index)
    for tenor in sp.columns:
        s = sp[tenor].dropna()
        mu_full = float(s.mean())
        mu_trim = float(s[trim.reindex(s.index, fill_value=True)].mean())
        x, y = s.values[:-1], s.values[1:]
        phi = float(np.polyfit(x - mu_trim, y - mu_trim, 1)[0])
        phi = min(phi, 0.9999)
        out[tenor] = {
            "mu_bp": round(mu_trim * 100, 1),
            "mu_full_bp": round(mu_full * 100, 1),
            "mu_trim_effect_bp": round((mu_trim - mu_full) * 100, 1),
            "phi_daily": round(phi, 4),
            "phi_quarterly": round(phi ** BD_PER_Q, 4),
            "half_life_bd": round(float(np.log(0.5) / np.log(phi)), 1),
            "latest": float(s.iloc[-1]),
            "latest_date": str(s.index[-1].date()),
        }
    return out


def forecast_path(ou: dict, tenor: str, h_bd: int) -> float:
    """Deterministic OU path at horizon h business days (pp)."""
    p = ou[tenor]
    mu, phi, s0 = p["mu_bp"] / 100.0, p["phi_daily"], p["latest"]
    return mu + (s0 - mu) * phi ** h_bd


def band(sp: pd.DataFrame, tenor: str, h_bd: int,
         q=(0.10, 0.90)) -> tuple:
    """Empirical quantiles of h-step spread changes (pp), full sample
    including stress (NOT Gaussian)."""
    s = sp[tenor].dropna()
    ch = (s.shift(-h_bd) - s).dropna()
    return (round(float(ch.quantile(q[0])), 4),
            round(float(ch.quantile(q[1])), 4))
