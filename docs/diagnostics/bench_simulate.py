"""The NAMED reference run for the SIMULATION path (RUN-SIM-REP).

    python docs/diagnostics/bench_simulate.py --mode wall
    python docs/diagnostics/bench_simulate.py --mode wall --memo off
    python docs/diagnostics/bench_simulate.py --mode profile --fan off

Same labelling discipline as bench_backtest.py: every number carries a RUN name,
a fixture, and a clock (wall vs profiled -- cProfile costs ~2.5x on this
workload and the two are not the same unit).

FIXTURE. `backend/tests/data/simulate_request_representative.json`, already
committed and already used by the golden tests: 5 positions of which 2 are
swaps, simDays=90, ramp/matrix. Chosen over a hand-written book precisely
because it is the one the suite already pins, so a number here is comparable to
something.

THE FAN. `includeDistribution` is absent from that fixture, and the backend
default is True -- so the plain run does the base scenario PLUS four more for
the percentile bands. The deployed frontend sends `includeDistribution: false`
(`frontend/src/sim/lib/scenario-curves.ts:272`), so `--fan off` is what a real
request costs and `--fan on` is what the fixture costs. Report both; quoting
one as "the simulation" is how the 75%/25% confusion started.
"""

from __future__ import annotations

import argparse
import cProfile
import io
import json
import os
import pstats
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

FIXTURE = ROOT / "backend" / "tests" / "data" / "simulate_request_representative.json"


def _memo_state() -> str:
    try:
        from app import schedule_cache
    except ImportError:
        return "not installed"
    s = schedule_cache.stats()
    return (f"installed={s['installed']} entries={s['entries']} "
            f"hits={s['hits']} hit_rate={s['hit_rate']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("wall", "profile"), default="wall")
    ap.add_argument("--memo", choices=("on", "off"), default="on")
    ap.add_argument("--fan", choices=("on", "off"), default="off")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--top", type=int, default=24)
    args = ap.parse_args()

    if args.memo == "off":
        os.environ["BW_SCHEDULE_CACHE"] = "0"
    from app import schedule_cache
    schedule_cache.clear()
    if args.memo == "off":
        schedule_cache.uninstall()
    else:
        schedule_cache.install()

    from irs_pricer.engine import curve_cache
    curve_cache.install()          # production installs this; match it

    from irs_pricer.services import simulation_service as ss
    from irs_pricer.services.simulation_service import (
        FrontendPosition, FrontendShockCurves,
    )

    req = json.loads(FIXTURE.read_text(encoding="utf-8"))
    positions = [FrontendPosition(**p) for p in req["positions"]]
    shock = FrontendShockCurves(**req["shockCurves"]) if req.get("shockCurves") else None
    daily = (FrontendShockCurves(**req["dailyShockCurves"])
             if req.get("dailyShockCurves") else None)

    kwargs = dict(
        positions=positions,
        shock_curves=shock,
        daily_shock_curves=daily,
        funding_rate=req.get("fundingRate"),
        funding_events=req.get("fundingEvents") or [],
        sim_days=req.get("simDays", 90),
        shock_type=req.get("shockType", "step"),
        shock_mode=req.get("shockMode", "parallel"),
        base_shock_bp=req.get("baseShockBp", 50.0),
        base_date=req.get("baseDate", "2026-01-01"),
        irs_curves=req.get("irsCurves") or [],
        custom_path=req.get("customPath") or [],
        want_distribution=(args.fan == "on"),
    )

    n_sw = sum(1 for p in positions if p.bondType == "swap")
    print(f"RUN-SIM-REP  clock={args.mode}  memo={args.memo}  fan={args.fan}")
    print(f"  fixture : {FIXTURE.name}")
    print(f"  book    : {len(positions)} positions ({n_sw} swaps), "
          f"simDays={kwargs['sim_days']}, {kwargs['shock_type']}/{kwargs['shock_mode']}")
    print(f"  memo    : {_memo_state()}")

    # does the sim path touch the memoized method at all?
    from app.valuation_port import VanillaSwap
    touches = {"n": 0}
    _cur = VanillaSwap.to_irs_trade

    def counting(self, valuation_date):
        touches["n"] += 1
        return _cur(self, valuation_date)

    VanillaSwap.to_irs_trade = counting
    try:
        times = []
        for _ in range(args.repeat):
            t = time.perf_counter()
            out = ss.run_simulation(**kwargs)
            times.append(time.perf_counter() - t)
    finally:
        VanillaSwap.to_irs_trade = _cur

    print(f"  wall    : {min(times):.2f}s (best of {args.repeat})"
          + (f"  [{', '.join(f'{t:.2f}' for t in times)}]" if args.repeat > 1 else ""))
    print(f"  app.valuation_port.to_irs_trade calls from this path: {touches['n']}")
    print(f"  chartData days: {len(out['chartData'])}  "
          f"recon rows: {len(out['irsDailyReconciliation'])}  "
          f"distribution: {'present' if out['distribution'] else 'null'}")
    print(f"  memo after: {_memo_state()}")

    if args.mode == "profile":
        print()
        print("  cProfile — PROFILED clock, not comparable to the wall figure above")
        pr = cProfile.Profile(); pr.enable()
        ss.run_simulation(**kwargs)
        pr.disable()
        s = io.StringIO()
        pstats.Stats(pr, stream=s).sort_stats("cumulative").print_stats(args.top)
        print(s.getvalue())
        s = io.StringIO()
        pstats.Stats(pr, stream=s).sort_stats("tottime").print_stats(args.top)
        print(s.getvalue())


if __name__ == "__main__":
    main()
