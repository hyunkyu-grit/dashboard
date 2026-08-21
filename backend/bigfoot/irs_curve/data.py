# -*- coding: utf-8 -*-
"""Phase-5b Step 0/1 data layer — Infomax IRS export + KTB pairing.

Raw file: data/krwswapdata/raw/krwswapdata.xlsx (company data, gitignored;
single sheet, daily MID close, 2016-01-01..present). Layout: meta header
row, series-label row (offset by one column around the date column),
field row (일자 / MID종가...), then descending daily rows.
data/krwswapdata/clean.parquet contains the quotes verbatim -> ALSO
gitignored; only derived statistics/parameters are committed (in output/).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from bigfoot.data.ecos import daily

ROOT = Path(__file__).resolve().parents[2]
RAW_XLSX = ROOT / "data" / "krwswapdata" / "raw" / "krwswapdata.xlsx"
CLEAN = ROOT / "data" / "krwswapdata" / "clean.parquet"

#: data-column order in the export (after the date column)
IRS_COLS = ["irs_6m", "irs_9m", "irs_1y", "irs_18m", "irs_2y", "irs_3y",
            "irs_4y", "irs_5y", "irs_6y", "irs_7y", "irs_8y", "irs_9y",
            "irs_10y", "call", "cd91"]

#: spread tenors: IRS leg -> (ECOS KTB series, label)
KTB_LEGS = {
    "1y": ("irs_1y", "bigfoot_ktb1y_d", "KTB 1y"),
    "2y": ("irs_2y", "bigfoot_ktb2y_d", "KTB 2y (from 2021-03 only)"),
    "3y": ("irs_3y", "bigfoot_ktb3y_d", "KTB 3y"),
    "5y": ("irs_5y", "bigfoot_ktb5y_d", "KTB 5y"),
    "10y": ("irs_10y", "bigfoot_ktb10y_d", "KTB 10y"),
}

#: stress episodes visible in the span (define the satellite's honesty
#: bounds; also the mu-trim windows)
STRESS_WINDOWS = {
    "covid_2020": ("2020-02-15", "2020-06-30"),
    "legoland_2022": ("2022-09-15", "2023-01-31"),
}


def load_clean(rebuild: bool = False) -> pd.DataFrame:
    """Parse the export once -> clean daily frame (date index ascending)."""
    if CLEAN.exists() and not rebuild:
        return pd.read_parquet(CLEAN)
    df = pd.read_excel(RAW_XLSX, header=None, skiprows=3)
    df = df.iloc[:, : 1 + len(IRS_COLS)]
    df.columns = ["date"] + IRS_COLS
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).set_index("date").sort_index()
    for c in IRS_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(how="all")
    CLEAN.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(CLEAN)
    return df


def schema_report(df: pd.DataFrame) -> dict:
    out = {"rows": int(len(df)),
           "span": f"{df.index[0].date()}..{df.index[-1].date()}",
           "span_years": round((df.index[-1] - df.index[0]).days / 365.25, 1),
           "frequency": "daily (business days)",
           "quote_convention": "MID close (시세산출 종가, MID종가)",
           "columns": {}}
    for c in df.columns:
        s = df[c].dropna()
        out["columns"][c] = {
            "n": int(len(s)),
            "first": str(s.index[0].date()) if len(s) else None,
            "last_value": round(float(s.iloc[-1]), 4) if len(s) else None,
        }
    return out


def spreads(df: pd.DataFrame = None) -> pd.DataFrame:
    """Swap spreads s_tau = IRS_tau - KTB_tau (pp), daily, per tenor."""
    if df is None:
        df = load_clean()
    out = {}
    for tenor, (irs_col, ktb_name, _label) in KTB_LEGS.items():
        ktb = daily(ktb_name)
        pair = pd.concat([df[irs_col], ktb], axis=1, join="inner").dropna()
        out[tenor] = pair.iloc[:, 0] - pair.iloc[:, 1]
    return pd.DataFrame(out)


def stress_mask(idx: pd.DatetimeIndex) -> pd.Series:
    m = pd.Series(False, index=idx)
    for a, b in STRESS_WINDOWS.values():
        m.loc[a:b] = True
    return m
