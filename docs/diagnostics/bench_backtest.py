"""The NAMED reference run for backtest-path timings.

    python docs/diagnostics/bench_backtest.py --dataset xlsx --mode wall
    python docs/diagnostics/bench_backtest.py --dataset xlsx --mode profile
    python docs/diagnostics/bench_backtest.py --dataset synthetic --mode wall --memo off

WHY THIS FILE EXISTS — the ambiguity it retires.

MEMO-1 published two families of number without labelling which was which, and
they cannot be reconciled by arithmetic because they are not the same clock:

    14.92s baseline / 8.26s post-memo      <- WALL, no profiler attached
    37.7s total / 19.4s in _build_schedule <- PROFILED, cProfile attached

cProfile costs roughly 2.5x on this workload (every one of ~94M calls is
instrumented), so a "profiled second" and a "wall second" are different units.
MEMO-1's open item then quoted "~4-5s of a ~18s post-memo run": the 18s was
PROFILED-minus-19.4, silently compared against WALL savings. Same engine, two
clocks, one sentence — that is the whole of the discrepancy.

From here every timing carries three labels: RUN name, dataset, and clock.

THE TWO DATASETS, and why both.

  xlsx      `data/irsdata.xlsx`. Comparable to MEMO-1's published figures, and
            the shape real users hit. NOT reproducible: the morning bake
            rewrites this file, so the run stamps its size and mtime and every
            quoted number is only meaningful beside that stamp.
  synthetic `tests/characterization.py`. Reads nothing from disk, so the same
            numbers are reachable a year from now. Smaller (260 business days
            vs 2,621), so its absolute times are NOT comparable to the xlsx
            figures -- only its before/after ratios are.

Never quote a number from this script without its RUN label. That is the entire
point of the file.
"""

from __future__ import annotations

import argparse
import cProfile
import datetime as dt
import io
import os
import pstats
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.backtest import Position, book_recon, run_backtest  # noqa: E402

XLSX = ROOT / "data" / "irsdata.xlsx"


def _configs(dates: list[dt.date]) -> dict[str, list[Position]]:
    """The three published configurations, plus the 3-position book MEMO-1's
    monkeypatch experiment used. Entry dates are clamped into the dataset so the
    synthetic (260-day) variant runs the same shapes as the xlsx one."""
    first, last = dates[0], dates[-1]

    def at(target: dt.date, fallback_frac: float) -> dt.date:
        if first <= target <= last:
            return target
        return dates[int((len(dates) - 1) * fallback_frac)]

    d_1y = at(dt.date(2025, 8, 1), 0.55)
    d_5y = at(dt.date(2021, 8, 2), 0.0)
    return {
        "1pos-1y-10Y": [Position("10Y", 1, 1e10, d_1y)],
        "1pos-5y-10Y": [Position("10Y", 1, 1e10, d_5y)],
        "3pos-5y-mixed": [
            Position("10Y", 1, 1e10, d_5y),
            Position("3Y-10Y", 1, 5e9, d_5y),
            Position("2Y-5Y-10Y", -1, 5e9, d_5y),
        ],
    }


def _load(kind: str):
    if kind == "xlsx":
        from app.dataset import load_dataset
        st = XLSX.stat()
        stamp = (f"irsdata.xlsx {st.st_size:,}B "
                 f"mtime={dt.datetime.fromtimestamp(st.st_mtime):%Y-%m-%d %H:%M:%S}")
        return load_dataset(XLSX), stamp
    sys.path.insert(0, str(ROOT / "backend"))
    from tests.characterization import characterization_dataset
    return characterization_dataset(), "tests/characterization.py (literal quotes)"


def _memo_state() -> str:
    try:
        from app import schedule_cache
    except ImportError:
        return "not installed"
    s = schedule_cache.stats()
    return f"installed={s['installed']} entries={s['entries']} hit_rate={s['hit_rate']}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=("xlsx", "synthetic"), default="xlsx")
    ap.add_argument("--mode", choices=("wall", "profile"), default="wall")
    ap.add_argument("--memo", choices=("on", "off"), default="on")
    ap.add_argument("--top", type=int, default=22)
    args = ap.parse_args()

    if args.memo == "off":
        os.environ["BW_SCHEDULE_CACHE"] = "0"
    try:
        from app import schedule_cache
        schedule_cache.uninstall() if args.memo == "off" else schedule_cache.install()
    except ImportError:
        pass

    ds, stamp = _load(args.dataset)
    cfgs = _configs(ds.dates)

    run = f"RUN-BT-{args.dataset.upper()}"
    print(f"{run}  clock={args.mode}  memo={args.memo}")
    print(f"  dataset : {stamp}")
    print(f"  rows    : {len(ds.dates)}  ({ds.dates[0]} .. {ds.dates[-1]})")
    print(f"  memo    : {_memo_state()}")
    print()

    # call counter on the thing this pass is about
    from app.engine_port import IRS_Trade
    counts = {"n": 0}
    _orig = IRS_Trade._build_schedule

    def counted(self):
        counts["n"] += 1
        return _orig(self)

    IRS_Trade._build_schedule = counted

    print(f"  {'configuration':<16} {'backtest':>9} {'recon':>9} {'total':>9} "
          f"{'builds(bt)':>11} {'builds(rc)':>11}")
    print("  " + "-" * 72)
    totals = {}
    for name, pos in cfgs.items():
        counts["n"] = 0
        t = time.perf_counter(); run_backtest(ds, pos); t_bt = time.perf_counter() - t
        n_bt = counts["n"]
        counts["n"] = 0
        t = time.perf_counter(); book_recon(ds, pos); t_rc = time.perf_counter() - t
        n_rc = counts["n"]
        totals[name] = t_bt + t_rc
        print(f"  {name:<16} {t_bt:>8.2f}s {t_rc:>8.2f}s {t_bt + t_rc:>8.2f}s "
              f"{n_bt:>11,} {n_rc:>11,}")

    IRS_Trade._build_schedule = _orig

    if args.mode == "profile":
        print()
        print(f"  cProfile on 3pos-5y-mixed (backtest + recon) — PROFILED clock,")
        print(f"  not comparable to the wall figures above")
        pos = cfgs["3pos-5y-mixed"]
        pr = cProfile.Profile(); pr.enable()
        run_backtest(ds, pos); book_recon(ds, pos)
        pr.disable()
        s = io.StringIO()
        pstats.Stats(pr, stream=s).sort_stats("cumulative").print_stats(args.top)
        print(s.getvalue())
        s = io.StringIO()
        pstats.Stats(pr, stream=s).sort_stats("tottime").print_stats(args.top)
        print(s.getvalue())

    print(f"  memo after run: {_memo_state()}")


if __name__ == "__main__":
    main()
