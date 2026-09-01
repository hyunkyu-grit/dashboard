"""Cross-check: independent pricer vs the ported engine, on real instruments.

Comparison target substituted per D0.3a — the plan named "the existing
QuantLib path", which does not exist. The engine actually in the product path
is imported, never reimplemented:

    bonds : app.cashbond.price      (yield-discounted par bond, FREQ=4)
    IRS   : app.engine_port.IRS_Trade.compute_npv  (curve-discounted)

Inputs are real: the 민평 credit matrix (`app.creditmatrix`) and the IRS close
dataset (`app.dataset`). No synthetic instruments.

Emits `docs/q1/xcheck_residuals.csv`.

No pass/fail is declared here. The deliverable is the residual DISTRIBUTION
and, where a residual is large, the diagnosis of which convention produced it.
"""

from __future__ import annotations

import csv
import datetime as dt
import statistics as st
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))

import numpy as np  # noqa: E402

from app import cashbond as cb  # noqa: E402
from app import creditmatrix as cm  # noqa: E402
from app import engine_port as ep  # noqa: E402
from app.curves import TENOR_T, par_rates_at_index  # noqa: E402
from app.dataset import load_dataset_merged  # noqa: E402
from research.xcheck import independent as ind  # noqa: E402

BOND_TYPE = "KTB"


# ── bonds ───────────────────────────────────────────────────────────────────


def bond_rows(m, asof_i: int) -> list[dict]:
    """One row per KTB tenor on the credit matrix's own grid.

    The product models an on-the-run par bond: coupon = that day's 민평 yield
    at that tenor, so `elapsed = 0` and `y = coupon` at entry. That is the
    instrument definition being checked, and it is read from the data rather
    than assumed.
    """
    rows = []
    for label in cm.TENOR_LABELS:
        years = cm.TENOR_YEARS[label]
        if not m.has(BOND_TYPE, label):
            continue
        y = cm.yield_at(m, BOND_TYPE, asof_i, years)
        n = cb.periods_for(label)
        coupon = y  # struck at par on the as-of date

        for elapsed_label, elapsed in (("t0", 0.0), ("t+90d", 90 / 365.0)):
            # engine (imported, not reimplemented)
            e_dirty, e_accr, _cp, _rd = cb.price(y, coupon, n, elapsed)
            e_clean = e_dirty - e_accr
            e_dv01 = cb.dv01_at(y, coupon, n, elapsed)

            # independent, same convention as the product (FREQ=4)
            i_dirty = ind.bond_dirty(y, coupon, n, elapsed, ind.FREQ_PRODUCT)
            i_accr = ind.bond_accrued(coupon, elapsed, ind.FREQ_PRODUCT)
            i_clean = ind.bond_clean(y, coupon, n, elapsed, ind.FREQ_PRODUCT)
            i_dv01 = ind.bond_dv01(y, coupon, n, elapsed, ind.FREQ_PRODUCT)

            # independent, KTB term-sheet convention (semi-annual).
            # Only when the quarterly period count is EVEN: n//2 semi-annual
            # periods then span the same maturity. For odd n (3M -> 1, 9M -> 3)
            # halving would move the maturity, and comparing two different
            # bonds would not be a convention gap — it would be a mistake.
            if n % 2 == 0:
                s_dirty = ind.bond_dirty(y, coupon, n // 2, elapsed,
                                         ind.FREQ_KTB_TERM_SHEET)
                s_dv01 = ind.bond_dv01(y, coupon, n // 2, elapsed,
                                       ind.FREQ_KTB_TERM_SHEET)
                gap_dirty = s_dirty - e_dirty
                gap_dv01 = s_dv01 - e_dv01
            else:
                s_dirty = s_dv01 = gap_dirty = gap_dv01 = None

            rows.append({
                "asset": f"{BOND_TYPE} {label}",
                "instrument": "bond",
                "point": elapsed_label,
                "years": years,
                "yield_pct": round(y * 100, 4),
                "engine_clean": e_clean,
                "indep_clean": i_clean,
                "resid_clean": i_clean - e_clean,
                "engine_dirty": e_dirty,
                "indep_dirty": i_dirty,
                "resid_dirty": i_dirty - e_dirty,
                "engine_accrued": e_accr,
                "indep_accrued": i_accr,
                "resid_accrued": i_accr - e_accr,
                "engine_dv01": e_dv01,
                "indep_dv01": i_dv01,
                "resid_dv01": i_dv01 - e_dv01,
                "semiannual_dirty": s_dirty,
                "convention_gap_dirty": gap_dirty,
                "convention_gap_dirty_bp_price": None if gap_dirty is None else gap_dirty * 1e4,
                "semiannual_dv01": s_dv01,
                "convention_gap_dv01": gap_dv01,
                "convention_gap_dv01_pct": None if (gap_dv01 is None or not e_dv01) else gap_dv01 / e_dv01 * 100.0,
            })
    return rows


# ── IRS ─────────────────────────────────────────────────────────────────────


def irs_rows(ds, asof: dt.date, asof_i: int) -> list[dict]:
    """One row per IRS tenor on the curve's own grid, priced two ways off the
    SAME bootstrapped zero curve."""
    pars = par_rates_at_index(ds, asof_i)
    if not pars:
        return []
    zc = ep.bootstrap_zero_curve(pars)
    short = next((r for t, r in sorted(pars) if t > 0), 0.0)

    rows = []
    for label, yrs in TENOR_T.items():
        if yrs < 1.0:
            continue  # a swap shorter than a year has no meaningful schedule here
        maturity = asof + dt.timedelta(days=round(yrs * 365))
        trade = ep.IRS_Trade(
            start_date=asof,
            maturity_date=maturity,
            fixed_rate_pct=3.0,
            direction=1,
            notional=1e10,
            sector="IRS",
        )
        pay_taus = [(d - asof).days / 365.0 for d in trade.pay_dates if d > asof]
        accr = [a for d, a in zip(trade.pay_dates, trade.accruals) if d > asof]
        if not pay_taus:
            continue

        e_npv = trade.compute_npv(asof, zc, short * 100.0)
        i_npv = ind.irs_npv_telescoped(
            notional=trade.notional,
            direction=trade.direction,
            fixed_rate=trade.fixed_rate_pct / 100.0,
            pay_taus=pay_taus,
            accruals=accr,
            current_float_rate=short,
            df_fn=ep.df_linear_rate,
            zc=zc,
        )
        i_par = ind.par_rate(pay_taus, accr, short, ep.df_linear_rate, zc)
        e_par_input = next((r for t, r in sorted(pars) if abs(t - yrs) < 1e-6), None)

        rows.append({
            "asset": f"IRS {label}",
            "instrument": "irs",
            "point": "npv",
            "years": yrs,
            "yield_pct": round(short * 100, 4),
            "engine_npv": e_npv,
            "indep_npv": i_npv,
            "resid_npv": i_npv - e_npv,
            "resid_npv_bp_of_notional": (i_npv - e_npv) / trade.notional * 1e4,
            "indep_par_pct": round(i_par * 100, 5),
            "market_par_pct": None if e_par_input is None else round(e_par_input * 100, 5),
            "par_resid_bp": None if e_par_input is None else round((i_par - e_par_input) * 1e4, 3),
            "n_pay_dates": len(pay_taus),
        })
    return rows


# ── report ──────────────────────────────────────────────────────────────────


def describe(vals: list[float], label: str) -> dict:
    a = [abs(v) for v in vals if v is not None]
    if not a:
        return {"metric": label, "n": 0}
    a_sorted = sorted(a)
    return {
        "metric": label,
        "n": len(a),
        "max": max(a),
        "median": st.median(a),
        "p95": a_sorted[min(len(a) - 1, int(0.95 * len(a)))],
    }


def main() -> None:
    ds = load_dataset_merged()
    m = cm.load()

    asof = min(ds.dates[-1], m.dates[-1])
    ds_i = ds.dates.index(asof) if asof in ds.dates else len(ds.dates) - 1
    m_i = cm.index_on_or_before(m.dates, asof)
    print(f"as-of {asof}  (dataset row {ds_i}, matrix row {m_i})")

    rows = bond_rows(m, m_i) + irs_rows(ds, ds.dates[ds_i], ds_i)

    outdir = REPO / "docs" / "q1"
    outdir.mkdir(parents=True, exist_ok=True)
    cols: list[str] = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    path = outdir / "xcheck_residuals.csv"
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {path} ({len(rows)} rows)")

    bonds = [r for r in rows if r["instrument"] == "bond"]
    irs = [r for r in rows if r["instrument"] == "irs"]

    print("\n── residual distribution (|independent − engine|) ──")
    for d in (
        describe([r["resid_clean"] for r in bonds], "bond clean (face 1)"),
        describe([r["resid_dirty"] for r in bonds], "bond dirty (face 1)"),
        describe([r["resid_accrued"] for r in bonds], "bond accrued (face 1)"),
        describe([r["resid_dv01"] for r in bonds], "bond DV01 (face 1)"),
        describe([r["resid_npv"] for r in irs], "IRS NPV (KRW, 10bn notional)"),
        describe([r["resid_npv_bp_of_notional"] for r in irs], "IRS NPV (bp of notional)"),
    ):
        if d["n"]:
            print(f"  {d['metric']:32s} n={d['n']:3d}  max={d['max']:.6e}  "
                  f"med={d['median']:.6e}  p95={d['p95']:.6e}")

    print("\n── worst five by |resid| ──")
    worst = sorted(
        rows,
        key=lambda r: abs(r.get("resid_dirty") or r.get("resid_npv_bp_of_notional") or 0.0),
        reverse=True,
    )[:5]
    for r in worst:
        v = r.get("resid_dirty")
        v = v if v is not None else r.get("resid_npv_bp_of_notional")
        print(f"  {r['asset']:12s} {r['point']:6s}  resid={v:.6e}")

    print("\n── convention gap: KTB term sheet (semi-annual) vs product (quarterly) ──")
    comparable = [r for r in bonds if r["convention_gap_dirty"] is not None]
    skipped = sorted({r["asset"] for r in bonds if r["convention_gap_dirty"] is None})
    print(f"  comparable tenors: {len(comparable)}  |  skipped (odd period count): {skipped}")
    for d in (
        describe([r["convention_gap_dirty_bp_price"] for r in comparable], "dirty gap (bp of price)"),
        describe([r["convention_gap_dv01_pct"] for r in comparable], "DV01 gap (% of DV01)"),
    ):
        if d["n"]:
            print(f"  {d['metric']:32s} n={d['n']:3d}  max={d['max']:.4f}  med={d['median']:.4f}  p95={d['p95']:.4f}")
    if comparable:
        w = max(comparable, key=lambda r: abs(r["convention_gap_dirty_bp_price"]))
        print(f"  worst: {w['asset']} {w['point']}  "
              f"{w['convention_gap_dirty_bp_price']:.4f} bp of price  "
              f"= {w['convention_gap_dirty'] * 1e11:,.0f} KRW on 100bn notional")


if __name__ == "__main__":
    main()
