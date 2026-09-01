"""T1 — realised and GARCH(1,1) conditional volatility on KTB 3Y and 10Y.

Runs on the application interpreter with NO new packages: `arch 8.0.0` is
already present (D0.1). Nothing is installed for this script.

Yields are in basis points and are differenced, not returned — a bp yield has
no meaningful origin (T4). So the GARCH is fitted to daily CHANGES in bp, and
its conditional sigma is in bp/day. That is the unit a breakeven-volatility
calculation needs, so no rescaling is smuggled in later.

Writes `docs/q1/garch_conditional_vol.csv` and `docs/q1/garch_conditional_vol.png`.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

TENORS = ("3Y", "10Y")
BOND = "KTB"


def series_bp(m, label: str) -> pd.Series:
    yrs = __import__("app.creditmatrix", fromlist=["x"]).TENOR_YEARS[label]
    cm = __import__("app.creditmatrix", fromlist=["x"])
    vals, idx = [], []
    for i, d in enumerate(m.dates):
        try:
            v = cm.yield_at(m, BOND, i, yrs)
        except Exception:  # noqa: BLE001
            continue
        if v is None:
            continue
        vals.append(v * 1e4)
        idx.append(pd.Timestamp(d))
    return pd.Series(vals, index=pd.DatetimeIndex(idx), name=f"{BOND} {label}")


def main() -> None:
    from app import creditmatrix as cm
    from arch import arch_model

    m = cm.load()
    outdir = REPO / "docs" / "q1"
    outdir.mkdir(parents=True, exist_ok=True)

    frames, params = {}, []
    for label in TENORS:
        if not m.has(BOND, label):
            print(f"  {BOND} {label}: absent from the matrix — skipped")
            continue
        lvl = series_bp(m, label)
        chg = lvl.diff().dropna()

        # realised vol: 21-business-day rolling sd of daily changes, bp/day
        realised = chg.rolling(21).std()

        res = arch_model(chg, mean="Zero", vol="GARCH", p=1, q=1, dist="normal").fit(disp="off")
        cond = pd.Series(res.conditional_volatility, index=chg.index)

        w = float(res.params["omega"])
        a = float(res.params["alpha[1]"])
        b = float(res.params["beta[1]"])
        persist = a + b
        uncond = (w / (1 - persist)) ** 0.5 if persist < 1 else float("nan")
        halflife = np.log(0.5) / np.log(persist) if 0 < persist < 1 else float("nan")

        params.append({
            "series": lvl.name, "n_changes": len(chg),
            "omega": w, "alpha1": a, "beta1": b,
            "persistence_a_plus_b": persist,
            "uncond_sigma_bp_per_day": uncond,
            "halflife_days": halflife,
            "loglik": float(res.loglikelihood),
            "realised21_last_bp": float(realised.iloc[-1]),
            "cond_last_bp": float(cond.iloc[-1]),
            "cond_min_bp": float(cond.min()),
            "cond_max_bp": float(cond.max()),
        })
        frames[f"{label} realised21"] = realised
        frames[f"{label} GARCH"] = cond

        print(f"\n── {lvl.name} ──")
        print(f"  changes            : {len(chg)}  ({chg.index[0].date()} .. {chg.index[-1].date()})")
        print(f"  omega/alpha/beta   : {w:.6f} / {a:.4f} / {b:.4f}")
        print(f"  persistence a+b    : {persist:.5f}   half-life {halflife:.1f} days")
        print(f"  unconditional sigma: {uncond:.3f} bp/day  "
              f"(= {uncond * 252 ** 0.5:.1f} bp/yr)")
        print(f"  conditional sigma  : last {cond.iloc[-1]:.3f}  "
              f"min {cond.min():.3f}  max {cond.max():.3f} bp/day")
        print(f"  realised 21d (last): {realised.iloc[-1]:.3f} bp/day")

    df = pd.DataFrame(frames).dropna(how="all")
    df.to_csv(outdir / "garch_conditional_vol.csv", encoding="utf-8")
    pd.DataFrame(params).to_csv(outdir / "garch_params.csv", index=False, encoding="utf-8")
    print(f"\nwrote {outdir / 'garch_conditional_vol.csv'} ({len(df)} rows)")

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(len(TENORS), 1, figsize=(11, 6.5), sharex=True)
        axes = np.atleast_1d(axes)
        for ax, label in zip(axes, TENORS):
            if f"{label} GARCH" not in df:
                continue
            ax.plot(df.index, df[f"{label} realised21"], lw=0.9,
                    label="realised, 21d sd of changes")
            ax.plot(df.index, df[f"{label} GARCH"], lw=1.1,
                    label="GARCH(1,1) conditional")
            ax.set_ylabel(f"{BOND} {label}\nbp / day")
            ax.legend(loc="upper left", fontsize=8, frameon=False)
            ax.grid(alpha=0.15)
        axes[-1].set_xlabel("")
        fig.suptitle("KTB yield-change volatility — realised vs GARCH(1,1), bp/day", fontsize=11)
        fig.tight_layout()
        fig.savefig(outdir / "garch_conditional_vol.png", dpi=130)
        print(f"wrote {outdir / 'garch_conditional_vol.png'}")
    except Exception as exc:  # noqa: BLE001
        print(f"PNG skipped: {type(exc).__name__}: {exc}")

    print("\n── implication for a breakeven-vol calculation ──")
    for p in params:
        persist = p["persistence_a_plus_b"]
        spread = p["cond_max_bp"] / p["cond_min_bp"]
        if not (persist < 1):
            print(f"  {p['series']}: alpha+beta = {persist:.5f} — the fit sits ON the")
            print("    IGARCH boundary, so the unconditional variance DOES NOT EXIST.")
            print("    There is no long-run sigma to quote a breakeven against: variance")
            print("    shocks in this series never decay. A breakeven must be quoted")
            print(f"    against the conditional sigma of the day (range "
                  f"{p['cond_min_bp']:.2f}-{p['cond_max_bp']:.2f} bp/day, {spread:.1f}x).")
        else:
            hl = p["halflife_days"]
            print(f"  {p['series']}: unconditional {p['uncond_sigma_bp_per_day']:.2f} bp/day, "
                  f"but conditional sigma spans {p['cond_min_bp']:.2f}-{p['cond_max_bp']:.2f} "
                  f"({spread:.1f}x).")
            print(f"    Quoting the unconditional value overstates by "
                  f"{p['uncond_sigma_bp_per_day'] / p['cond_min_bp']:.1f}x in calm and "
                  f"understates by {p['cond_max_bp'] / p['uncond_sigma_bp_per_day']:.1f}x in stress.")
            print(f"    Half-life {hl:.0f} days means the 'long-run average' is a "
                  f"{hl / 252:.1f}-year concept — not an anchor for a trade held weeks.")


if __name__ == "__main__":
    main()
