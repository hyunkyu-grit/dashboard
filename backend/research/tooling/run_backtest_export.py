"""§7 T1 stage 1 — compute a backtest run in-process and export it.

D0.3f found there is NO persisted backtest run in this repo: `app/cache.py`
caches derived market payloads, and `output/backtest_2021_cycle.json` is a
bigfoot macro artifact, not an MR run. The `-114,000,000` reference anchor does
not appear anywhere in the tree either. The owner's instruction was to compute
one during the run, so this file does that.

It calls the product's own engine (`app.mrbacktest.simulate`) on the product's
own series (`app.mr.series_points`) with the product's own defaults, exports the
daily series plus the engine's OWN reported totals, and records a manifest so
the tearsheet can be checked against the engine rather than against itself.

Runs on the application interpreter. Nothing installed.
Writes `docs/q1/_backtest_run.csv` and `docs/q1/_backtest_manifest.json`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))

SERIES_ID = "BSS-3Y"
LOOKBACK = 120
ENTRY_Z = 2.0
EXIT_Z = 0.5
STOP_Z = 4.0
COST_BP = 0.5           # the owner's measured one-way cost
NOTIONAL = 1e8          # KRW per bp


def main() -> None:
    from app import mr as mr_mod
    from app import mrbacktest as mrbt

    body = mr_mod.series_points(SERIES_ID)
    pts = body["points"]
    unit = body["unit"]
    scale = 100.0 if unit == "%" else 1.0

    dates = [p["t"] for p in pts]
    vals = [float(p["v"]) * scale for p in pts]
    # dirs_for returns a descriptor dict; the engine wants the tuple.
    dirs_info = mr_mod.dirs_for("bss")
    dirs = tuple(dirs_info["allowed"])

    print(f"series {SERIES_ID}: {len(vals)} points, unit={unit}, "
          f"{dates[0]} .. {dates[-1]}, tradable dirs {dirs} "
          f"({dirs_info['why']})")

    r = mrbt.simulate(
        dates, vals,
        lookback=LOOKBACK, entry_z=ENTRY_Z, exit_z=EXIT_Z, stop_z=STOP_Z,
        cost_bp=COST_BP, notional=NOTIONAL, allow_dirs=dirs,
        close_open_at_end=True,
    )

    points = r["points"]
    trades = r["trades"]
    summary = r["summary"]

    # The engine's own totals — the values the tearsheet must reproduce.
    engine_total = points[-1]["cumulativePnl"] if points else 0.0
    engine_sum_daily = sum(p["dailyPnl"] for p in points)
    trade_pnl_sum = sum(t["pnl"] for t in trades if t.get("pnl") is not None)

    print(f"\nengine result")
    print(f"  bars                 : {len(points)}")
    print(f"  trades               : {len(trades)}")
    print(f"  cumulative PnL (last): {engine_total:,.2f} KRW")
    print(f"  sum of daily PnL     : {engine_sum_daily:,.2f} KRW")
    print(f"  sum of trade PnL     : {trade_pnl_sum:,.2f} KRW")
    print(f"  internal consistency : cumulative - sum(daily) = "
          f"{engine_total - engine_sum_daily:.10f}")

    out = REPO / "docs" / "q1"
    out.mkdir(parents=True, exist_ok=True)

    import csv

    with (out / "_backtest_run.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "value", "position", "hold", "dailyPnl", "cumulativePnl"])
        for p in points:
            w.writerow([p["date"], p.get("value"), p.get("position"), p.get("hold"),
                        p["dailyPnl"], p["cumulativePnl"]])

    manifest = {
        "series_id": SERIES_ID,
        "unit": unit,
        "params": {"lookback": LOOKBACK, "entryZ": ENTRY_Z, "exitZ": EXIT_Z,
                   "stopZ": STOP_Z, "costBp": COST_BP, "notional": NOTIONAL,
                   "allow_dirs": list(dirs), "close_open_at_end": True},
        "first_date": dates[0], "last_date": dates[-1],
        "n_bars": len(points), "n_trades": len(trades),
        "engine_cumulative_pnl": engine_total,
        "engine_sum_daily_pnl": engine_sum_daily,
        "engine_sum_trade_pnl": trade_pnl_sum,
        "engine_summary": {k: v for k, v in summary.items()
                           if isinstance(v, (int, float, str, type(None)))},
    }
    (out / "_backtest_manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {out / '_backtest_run.csv'} and _backtest_manifest.json")


if __name__ == "__main__":
    main()
