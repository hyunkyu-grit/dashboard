"""§7 T1 stage 2 — quantstats tearsheet, gated on reproducing the engine total.

Runs in the isolated `.venv-q1` (quantstats), reading the run exported by
`run_backtest_export.py`. Nothing installed into the application venv.

    python research/tooling/tearsheet.py        # from backend/, on .venv-q1

## The validity gate

The plan's gate was "the tearsheet's total PnL must equal the application's own
reported total for the same run, exactly", anchored to -114,000,000 KRW. That
anchor does not exist in this repo (D0.3f) and neither does a persisted run, so
the anchor here is the engine's OWN reported total for the run computed in
stage 1. That is a weaker gate than an independent reference — it proves the
tearsheet consumes the series faithfully, not that the engine is right — and
the report says so.

## The unit problem, which is the real content of this task

quantstats is built for RETURNS on a capital base. This strategy has no capital
base: PnL is `notional x delta-spread` in KRW/bp, and the engine's own Sharpe
(`summary["sharpe"]`) is a PnL-Sharpe — mean/sd of daily PnL, annualised. That
is the same convention gs-quant's `summary_stats` uses, and the same one this
desk already quotes.

Feeding a PnL series to quantstats as if it were returns would silently produce
a different Sharpe. So the equity curve is formed by adding cumulative PnL to a
declared notional base, the base is REPORTED, and the two Sharpe conventions
are printed side by side rather than one being passed off as the other.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "docs" / "q1"
RUN = OUT / "_backtest_run.csv"
MANIFEST = OUT / "_backtest_manifest.json"

# Declared, not inferred. Every percentage in the tearsheet is relative to this.
CAPITAL_BASE = 1e10  # 10bn KRW


def main() -> None:
    if not RUN.exists():
        raise SystemExit(f"{RUN} missing — run research/tooling/run_backtest_export.py "
                         f"on the application interpreter first.")
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    df = pd.read_csv(RUN, parse_dates=["date"]).set_index("date")

    cum = df["cumulativePnl"]
    daily = df["dailyPnl"]

    # ── the gate ────────────────────────────────────────────────────────────
    engine_total = float(man["engine_cumulative_pnl"])
    csv_total = float(cum.iloc[-1])
    csv_sum = float(daily.sum())

    print("── §7 T1 validity gate ──")
    print(f"  engine cumulative PnL       : {engine_total:>20,.2f} KRW")
    print(f"  exported series last value  : {csv_total:>20,.2f} KRW")
    print(f"  exported series sum(daily)  : {csv_sum:>20,.2f} KRW")
    print(f"  delta (engine - exported)   : {engine_total - csv_total:>20,.10f}")
    print(f"  delta (engine - sum daily)  : {engine_total - csv_sum:>20,.10f}")
    exact = (engine_total == csv_total)
    print(f"  EXACT MATCH                 : {exact}")
    if not exact:
        raise SystemExit("tearsheet input does not reproduce the engine total — stopping "
                         "per the plan: a tearsheet that disagrees with the app is a "
                         "finding, not a deliverable.")

    # ── two Sharpe conventions, stated ──────────────────────────────────────
    ann = 252
    pnl_sharpe = daily.mean() / daily.std() * np.sqrt(ann) if daily.std() > 0 else float("nan")
    engine_sharpe = man["engine_summary"].get("sharpe")

    equity = CAPITAL_BASE + cum
    rets = equity.pct_change().fillna(0.0)
    ret_sharpe = rets.mean() / rets.std() * np.sqrt(ann) if rets.std() > 0 else float("nan")

    print("\n── Sharpe, both conventions ──")
    print(f"  engine summary['sharpe']            : {engine_sharpe:.6f}")
    print(f"  recomputed PnL-Sharpe (no base)     : {pnl_sharpe:.6f}")
    print(f"  return-Sharpe on {CAPITAL_BASE:,.0f} base : {ret_sharpe:.6f}")
    print(f"  PnL-Sharpe vs engine, delta         : {abs(pnl_sharpe - float(engine_sharpe)):.2e}")
    print("  The two conventions are NOT interchangeable. The engine and this")
    print("  desk quote the PnL-Sharpe; quantstats will report the return one.")

    # ── tearsheet ───────────────────────────────────────────────────────────
    try:
        import quantstats as qs
    except Exception as exc:  # noqa: BLE001
        print(f"\nquantstats unavailable: {type(exc).__name__}: {exc}")
        return

    rets.index = pd.DatetimeIndex(rets.index)
    rets.name = f"{man['series_id']} MR"
    html = OUT / "tearsheet_bss3y.html"
    try:
        qs.reports.html(rets, output=str(html), title=(
            f"{man['series_id']} mean reversion — lookback {man['params']['lookback']}, "
            f"entry z {man['params']['entryZ']}, cost {man['params']['costBp']}bp one-way "
            f"| base {CAPITAL_BASE:,.0f} KRW"
        ))
        print(f"\nwrote {html}")
    except Exception as exc:  # noqa: BLE001
        print(f"\nquantstats html failed: {type(exc).__name__}: {exc}")
        print("falling back to metrics only")
        try:
            m = qs.reports.metrics(rets, display=False)
            m.to_csv(OUT / "tearsheet_metrics.csv", encoding="utf-8")
            print(f"wrote {OUT / 'tearsheet_metrics.csv'}")
        except Exception as exc2:  # noqa: BLE001
            print(f"metrics also failed: {type(exc2).__name__}: {exc2}")

    # ── reconcile the headline numbers the tearsheet will show ──────────────
    peak = equity.cummax()
    dd = equity - peak
    print("\n── headline reconciliation ──")
    print(f"  total PnL        engine {engine_total:>18,.2f}  "
          f"tearsheet-equity {float(equity.iloc[-1] - CAPITAL_BASE):>18,.2f}")
    print(f"  max drawdown     engine {man['engine_summary'].get('maxDrawdown', float('nan')):>18,.2f}  "
          f"recomputed {float(-dd.min()):>18,.2f}")
    print(f"  trades           engine {man['n_trades']:>18d}")
    print(f"  win rate         engine {man['engine_summary'].get('winRate', float('nan')):>18.4f}")
    print(f"  open PnL         engine {man['engine_summary'].get('openPnl', 0) or 0:>18,.2f}"
          "   <- included in total; not a separate bucket")


if __name__ == "__main__":
    main()
