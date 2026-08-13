"""RUN-SIM-HORIZON — the simulation's cost along the HORIZON axis.

    python docs/diagnostics/bench_sim_horizon.py                 # both axes
    python docs/diagnostics/bench_sim_horizon.py --bisect 180 240
    python docs/diagnostics/bench_sim_horizon.py --instrument 90,210

MEMO-1B measured the SWAP axis (~64 ms/swap, linear) and never measured the
horizon. The owner's actual complaint is horizon-shaped -- "slow past roughly
180 days" -- and that sentence is consistent with two different worlds that
have opposite fixes:

  smooth growth   crossing a patience threshold near 180  -> cost is
                  df_linear_rate, fix is batching, may need a port exemption
  a discontinuity at/near 180                             -> something changes
                  state at a threshold, fix is likely cheap and output-neutral

This tree's ancestor hit the second kind once: an LRU sized 2048 collapsed to a
~0% hit rate the moment key count crossed it, costing 93% of a 24-minute wall
(curve_cache.py, s18). So the shape is measured, never assumed.

`--instrument` reports, per horizon: every cache's key count and hit rate, the
holiday table size, the number of distinct payment dates in scope, and the
business-day schedule length -- the quantities that would move if a threshold
were being crossed rather than a curve being climbed.

Same labelling discipline as the other benches: RUN name, fixture, clock. The
fixture is the committed representative request; the fan is OFF by default
because that is what the deployed frontend sends
(frontend/src/sim/lib/scenario-curves.ts:272).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

FIXTURE = ROOT / "backend" / "tests" / "data" / "simulate_request_representative.json"
_req = json.loads(FIXTURE.read_text(encoding="utf-8"))


def _setup():
    from app import schedule_cache
    from irs_pricer.engine import curve_cache
    curve_cache.install()
    schedule_cache.install()
    return curve_cache, schedule_cache


def _book(n_swaps: int):
    from irs_pricer.services.simulation_service import FrontendPosition
    base = [p for p in _req["positions"] if p.get("bondType") == "swap"]
    bonds = [p for p in _req["positions"] if p.get("bondType") != "swap"]
    out, i = [], 0
    while len(out) < n_swaps:
        p = dict(base[i % len(base)])
        p["id"] = f"{p.get('id','sw')}-{i}"
        p["remainingDays"] = float(p.get("remainingDays") or 900) + (i % 37) * 45
        p["couponRate"] = float(p.get("couponRate") or 3.0) + (i % 11) * 0.05
        out.append(p)
        i += 1
    return [FrontendPosition(**q) for q in out + bonds]


def _kwargs(n_swaps: int, sim_days: int, fan: bool):
    from irs_pricer.services.simulation_service import FrontendShockCurves
    return dict(
        positions=_book(n_swaps),
        shock_curves=FrontendShockCurves(**_req["shockCurves"]) if _req.get("shockCurves") else None,
        daily_shock_curves=None,
        funding_rate=_req.get("fundingRate"),
        funding_events=_req.get("fundingEvents") or [],
        sim_days=sim_days,
        shock_type=_req.get("shockType", "step"),
        shock_mode=_req.get("shockMode", "parallel"),
        base_shock_bp=_req.get("baseShockBp", 50.0),
        base_date=_req.get("baseDate", "2026-01-01"),
        irs_curves=_req.get("irsCurves") or [],
        custom_path=_req.get("customPath") or [],
        want_distribution=fan,
    )


def run(n_swaps: int, sim_days: int, fan: bool = False, repeat: int = 2) -> float:
    from irs_pricer.services import simulation_service as ss
    kw = _kwargs(n_swaps, sim_days, fan)
    best = float("inf")
    for _ in range(repeat):
        t = time.perf_counter()
        ss.run_simulation(**kw)
        best = min(best, time.perf_counter() - t)
    return best


def instrument(n_swaps: int, sim_days: int, fan: bool = False) -> dict:
    """Everything that would move if a THRESHOLD were being crossed."""
    from irs_pricer.services import simulation_service as ss
    import app.engine_port as ep
    import irs_pricer.engine.quant_engine as qe
    cc, sc = _setup()
    cc.clear(); sc.clear()

    n_hol_before = len(qe._KR_HOLIDAYS) if hasattr(qe, "_KR_HOLIDAYS") else len(ep._KR_HOLIDAYS)

    # count distinct payment-date year-fractions the pricing actually touches
    seen_t: set[float] = set()
    _orig_df = qe.df_linear_rate
    calls = {"n": 0}

    def counting_df(t, zc):
        calls["n"] += 1
        seen_t.add(round(float(t), 9))
        return _orig_df(t, zc)

    qe.df_linear_rate = counting_df
    try:
        t0 = time.perf_counter()
        out = ss.run_simulation(**_kwargs(n_swaps, sim_days, fan))
        wall = time.perf_counter() - t0
    finally:
        qe.df_linear_rate = _orig_df

    hol_now = len(qe._KR_HOLIDAYS) if hasattr(qe, "_KR_HOLIDAYS") else len(ep._KR_HOLIDAYS)
    ci = cc.stats()
    si = sc.stats()
    return {
        "simDays": sim_days,
        "swaps": n_swaps,
        "wall": round(wall, 3),
        "chart_days": len(out["chartData"]),
        "recon_rows": len(out["irsDailyReconciliation"]),
        "df_calls": calls["n"],
        "distinct_t": len(seen_t),
        "curve_keys": ci["entries"],
        "curve_hit": ci["hit_rate"],
        "curve_max": cc._MAX_ENTRIES,
        "sched_keys": si["entries"],
        "sched_hit": si["hit_rate"],
        "holidays_before": n_hol_before,
        "holidays_after": hol_now,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--swaps", type=int, default=8)
    ap.add_argument("--fan", action="store_true")
    ap.add_argument("--bisect", nargs=2, type=int, metavar=("LO", "HI"))
    ap.add_argument("--instrument", type=str, help="comma-separated simDays")
    args = ap.parse_args()
    _setup()

    if args.instrument:
        print(f"RUN-SIM-HORIZON  instrumented  swaps={args.swaps}  fan={args.fan}")
        rows = [instrument(args.swaps, int(d), args.fan)
                for d in args.instrument.split(",")]
        keys = ["simDays", "wall", "chart_days", "recon_rows", "df_calls", "distinct_t",
                "curve_keys", "curve_hit", "curve_max", "sched_keys", "holidays_after"]
        w = max(len(k) for k in keys) + 1
        for k in keys:
            print(f"  {k:<{w}}" + "".join(f"{str(r[k]):>16}" for r in rows))
        return

    if args.bisect:
        lo, hi = args.bisect
        print(f"RUN-SIM-HORIZON  bisect [{lo}, {hi}]  swaps={args.swaps}  fan={args.fan}")
        t_lo, t_hi = run(args.swaps, lo), run(args.swaps, hi)
        print(f"  simDays {lo}: {t_lo:.3f}s     simDays {hi}: {t_hi:.3f}s")
        while hi - lo > 2:
            mid = (lo + hi) // 2
            t_mid = run(args.swaps, mid)
            # follow the half containing the bigger jump
            if (t_mid - t_lo) >= (t_hi - t_mid):
                hi, t_hi = mid, t_mid
            else:
                lo, t_lo = mid, t_mid
            print(f"  -> [{lo}, {hi}]   mid {mid}: {t_mid:.3f}s")
        print(f"  boundary between simDays {lo} and {hi}")
        return

    print(f"RUN-SIM-HORIZON  wall clock  swaps={args.swaps}  fan={args.fan}")
    print(f"  fixture: {FIXTURE.name}  (memo on, curve_cache on)")
    print()
    print(f"  {'simDays':>8} {'wall':>9} {'ms/day':>9} {'vs prev':>9}")
    print("  " + "-" * 40)
    prev_t = prev_d = None
    for d in (30, 60, 90, 120, 150, 180, 195, 210, 240, 300, 365):
        t = run(args.swaps, d)
        ratio = "" if prev_t is None else f"{(t / prev_t) / (d / prev_d):>8.2f}x"
        print(f"  {d:>8} {t:>8.3f}s {t / d * 1000:>8.2f} {ratio:>9}")
        prev_t, prev_d = t, d
    print()
    print("  'vs prev' = growth ratio normalised by the horizon ratio.")
    print("  1.00 = perfectly linear in simDays; >1 = superlinear over that step.")

    print()
    print(f"RUN-SIM-SWAPS  wall clock  simDays=180  fan={args.fan}")
    print(f"  {'swaps':>8} {'wall':>9} {'ms/swap':>9}")
    print("  " + "-" * 30)
    for n in (2, 4, 8, 16, 32):
        t = run(n, 180)
        print(f"  {n:>8} {t:>8.3f}s {t / n * 1000:>8.2f}")


if __name__ == "__main__":
    main()
