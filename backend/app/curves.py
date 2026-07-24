"""Basis curves: bootstrap one zero curve per time basis (Now, D-1, ...).

braveworld's own thin adapter over the ported engine functions — the frozen
repo's MarketSnapshot-bound builder was deliberately not ported.
"""

from __future__ import annotations

import datetime as dt

import numpy as np

from .dataset import Dataset
from .derive import BASIS_KEYS, basis_dates, value_at
from .engine_port import bootstrap_zero_curve

# Tenor id -> year fraction. 1D and 3M(CD91) use the engine's anchor/label
# conventions (1/365, 91/365).
TENOR_T: dict[str, float] = {
    "1D": 1.0 / 365.0,
    "3M": 91.0 / 365.0,
    "6M": 0.5,
    "9M": 0.75,
    "1Y": 1.0,
    "1.5Y": 1.5,
    "2Y": 2.0,
    "3Y": 3.0,
    "4Y": 4.0,
    "5Y": 5.0,
    "6Y": 6.0,
    "7Y": 7.0,
    "8Y": 8.0,
    "9Y": 9.0,
    "10Y": 10.0,
}


def par_rates_at(dataset: Dataset, date: dt.date | None) -> list[tuple[float, float]]:
    """[(T_years, rate_decimal), ...] for every tenor with a value on `date`
    (falling back to the most recent prior close, matching the summary)."""
    out: list[tuple[float, float]] = []
    for tenor, values in dataset.series.items():
        t = TENOR_T.get(tenor)
        if t is None:
            continue
        v = value_at(dataset, values, date)
        if v is not None:
            out.append((t, v / 100.0))
    return sorted(out)


def build_basis_curves(dataset: Dataset) -> dict[str, np.ndarray]:
    """Zero curve per basis key ('now' + BASIS_KEYS). Cheap (6 bootstraps);
    callers cache per dataset load."""
    bases = basis_dates(dataset)
    curves: dict[str, np.ndarray] = {
        "now": bootstrap_zero_curve(par_rates_at(dataset, dataset.asof))
    }
    for key in BASIS_KEYS:
        curves[key] = bootstrap_zero_curve(par_rates_at(dataset, bases[key]))
    return curves
