"""Parity + behavior tests for the ported curve engine.

The parity test extracts each ported function's source from the frozen
repo and asserts byte-identity (deviations are confined to the holidays
init block, which is excluded from the check by design). It skips when
the frozen repo is absent so the braveworld repo stays self-contained.
"""

import ast
import datetime as dt
from pathlib import Path

import numpy as np
import pytest

from app import engine_port
from app.curves import build_basis_curves, par_rates_at
from app.dataset import load_dataset
from app.derive import basis_dates
from app.forwards import (
    FWD_TENORS,
    KEY_FORWARDS,
    START_POINTS,
    forward_par_rate,
    forwards_payload,
    is_live_point,
)

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"
FROZEN = Path(
    r"C:\Users\infomax\Desktop\Assistant\Projects_AS"
    r"\Rates Portfolio\krw-fi-pms-backend\irs_pricer\engine\quant_engine.py"
)

PORTED_FUNCS = [
    "_inject_short_anchors",
    "_is_kr_business_day",
    "_next_business_day",
    "_prev_business_day",
    "next_kr_business_day",
    "_modfol_bd",
    "_subtract_months",
    "bootstrap_zero_curve",
    "df",
    "df_linear_rate",
    "zero_rate",
    "forward_rate_simple",
]


def _func_sources(path: Path) -> dict[str, str]:
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    lines = src.splitlines(keepends=True)
    return {
        node.name: "".join(lines[node.lineno - 1 : node.end_lineno])
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
    }


@pytest.mark.skipif(not FROZEN.exists(), reason="frozen repo not present")
def test_ported_bodies_byte_identical_to_frozen_source():
    ours = _func_sources(
        Path(__file__).resolve().parents[1] / "app" / "engine_port.py"
    )
    theirs = _func_sources(FROZEN)
    for name in PORTED_FUNCS:
        assert ours[name] == theirs[name], f"{name} diverged from 570a2ff"


@pytest.fixture(scope="module")
def ds():
    return load_dataset(DATA)


@pytest.fixture(scope="module")
def curves(ds):
    return build_basis_curves(ds)


def test_bootstrap_shape_and_df_identity(ds, curves):
    zc = curves["now"]
    assert zc.shape[1] == 2
    assert zc.shape[0] == len(par_rates_at(ds, ds.asof))
    assert engine_port.df(0.0, zc) == 1.0
    # DFs decrease with maturity on an upward-sloping positive curve
    dfs = [engine_port.df(t, zc) for t in (0.5, 1, 2, 5, 10)]
    assert all(a > b for a, b in zip(dfs, dfs[1:]))


def test_spot_par_reprices_input_quotes(ds, curves):
    """Forward-par with s=0 at node maturities must recover the input par
    quotes — the bootstrap identity round-trip (tolerance: interpolation
    method differences between bootstrap-internal and df(), sub-0.5bp)."""
    zc = curves["now"]
    for tenor, t in [("1Y", 1.0), ("2Y", 2.0), ("3Y", 3.0), ("5Y", 5.0), ("10Y", 10.0)]:
        quoted = ds.latest(tenor)
        recon = forward_par_rate(zc, t, None) * 100
        assert abs(recon - quoted) < 0.005, f"{tenor}: {recon} vs {quoted}"


def test_live_marker_rule_matches_spec_example():
    # §7: "for 1YF: ON, 6M, 1Y, 2Y starts" (4Y start is not a live node,
    # 3Y/5Y starts have non-live ends)
    live_starts = [
        label for label, t in START_POINTS if is_live_point(t, 1.0)
    ]
    assert live_starts == ["ON", "6M", "1Y", "2Y"]


def test_payload_shape(ds, curves):
    p = forwards_payload(ds, curves)
    assert len(p["startPoints"]) == 21
    assert p["tenors"] == [label for label, _ in FWD_TENORS]
    assert len(p["keyForwards"]) == len(KEY_FORWARDS)
    for tenor in p["tenors"]:
        col = p["grid"][tenor]
        assert len(col) == 21
        for row in col:
            assert set(row["values"]) == {"now", "d1", "wtd", "mtd", "qtd", "ytd"}
            assert row["values"]["now"] is not None
    # integer-year start rows carry Y labels (matrix separator rule §8)
    labels = [s["label"] for s in p["startPoints"]]
    for y in ("2Y", "3Y", "4Y", "5Y"):
        assert y in labels


def test_forward_ladder_consistency(curves):
    """1Yx1Y must sit between spot 1Y and spot 2Y implied levels in a way
    consistent with DF ratios: annuity-weighted recon of the 2Y swap."""
    zc = curves["now"]
    r_2y = forward_par_rate(zc, 2.0, None)
    r_1y = forward_par_rate(zc, 1.0, None)
    f_1y1y = forward_par_rate(zc, 1.0, 1.0)
    # upward-sloping curve => forward above both spot legs' average
    assert f_1y1y > r_1y
    assert min(r_1y, f_1y1y) < r_2y < max(r_1y, f_1y1y)


def test_modfol_start_dates(ds, curves):
    p = forwards_payload(ds, curves)
    for sp in p["startPoints"]:
        d = dt.date.fromisoformat(sp["date"])
        assert engine_port._is_kr_business_day(d), sp
