"""RUN-SIM-HTTP — what a REAL /api/simulate request costs, end to end.

    python docs/diagnostics/bench_sim_http.py --url http://127.0.0.1:8109 --swaps 32 --days 180

Every simulation number before this one came from calling `run_simulation()`
in-process. The owner does not do that; the owner POSTs to `/api/simulate`. That
path additionally pays:

  * Pydantic validation of the request (one `FrontendPosition` per book line),
  * the `run_in_executor` hop and the streaming heartbeat wrapper,
  * `SimulateResponse.model_validate(result).model_dump_json()` -- revalidating
    a response whose `chartData` is one open-field row per simulated day and
    whose `irsDailyReconciliation` is another, then serialising the lot,
  * transport of that payload.

None of it is engine time, all of it is wall time the owner waits through, and a
harness that skips it cannot be reconciled with a complaint about slowness. This
script measures both halves against the same inputs so the gap is attributable
rather than argued about.

NEVER point --url at :8100. That is the live service (Tailscale Funnel proxies
the public internet into it). Start your own backend on a free port.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

FIXTURE = ROOT / "backend" / "tests" / "data" / "simulate_request_representative.json"
_req = json.loads(FIXTURE.read_text(encoding="utf-8"))


def payload(n_swaps: int, days: int, fan: bool) -> dict:
    """The committed fixture's book scaled to `n_swaps`, as a wire payload."""
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
    r = dict(_req)
    r["positions"] = out + bonds
    r["simDays"] = days
    r["includeDistribution"] = fan
    return r


def post(url: str, body: dict) -> tuple[float, int]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url + "/api/simulate", data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    t = time.perf_counter()
    with urllib.request.urlopen(req, timeout=900) as r:
        raw = r.read()
    return time.perf_counter() - t, len(raw)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--swaps", type=int, default=32)
    ap.add_argument("--days", type=int, default=180)
    ap.add_argument("--fan", action="store_true")
    ap.add_argument("--repeat", type=int, default=3)
    args = ap.parse_args()

    assert ":8100" not in args.url, "refusing to benchmark against the live service"

    body = payload(args.swaps, args.days, args.fan)
    n_pos = len(body["positions"])

    print(f"RUN-SIM-HTTP  {args.swaps} swaps ({n_pos} positions), simDays={args.days}, "
          f"fan={'on' if args.fan else 'off'}")
    print(f"  target: {args.url}")

    cold, size = post(args.url, body)
    warm = [post(args.url, body)[0] for _ in range(args.repeat)]
    print(f"  HTTP end-to-end : cold {cold:.2f}s | warm best {min(warm):.2f}s "
          f"[{', '.join(f'{t:.2f}' for t in warm)}]")
    print(f"  response bytes  : {size:,}")

    # ---- the same work in-process, i.e. what every prior harness measured ----
    from irs_pricer.services import simulation_service as ss
    from irs_pricer.services.simulation_service import FrontendPosition, FrontendShockCurves
    from irs_pricer.engine import curve_cache
    from app import schedule_cache, calendar_cache
    curve_cache.install(); schedule_cache.install(); calendar_cache.install()

    kw = dict(
        positions=[FrontendPosition(**p) for p in body["positions"]],
        shock_curves=FrontendShockCurves(**body["shockCurves"]) if body.get("shockCurves") else None,
        daily_shock_curves=None,
        funding_rate=body.get("fundingRate"),
        funding_events=body.get("fundingEvents") or [],
        sim_days=args.days,
        shock_type=body.get("shockType", "step"),
        shock_mode=body.get("shockMode", "parallel"),
        base_shock_bp=body.get("baseShockBp", 50.0),
        base_date=body.get("baseDate", "2026-01-01"),
        irs_curves=body.get("irsCurves") or [],
        custom_path=body.get("customPath") or [],
        want_distribution=args.fan,
    )
    engine = []
    for _ in range(args.repeat):
        t = time.perf_counter(); out = ss.run_simulation(**kw); engine.append(time.perf_counter() - t)
    eng = min(engine)
    print(f"  engine in-proc  : {eng:.2f}s   <- what every prior harness measured")

    # ---- response assembly, measured separately ----
    from irs_pricer.api.routers.simulate import SimulateResponse
    ser = []
    for _ in range(args.repeat):
        t = time.perf_counter()
        SimulateResponse.model_validate(out).model_dump_json()
        ser.append(time.perf_counter() - t)
    s = min(ser)

    # ---- request validation, measured separately ----
    val = []
    for _ in range(args.repeat):
        t = time.perf_counter()
        [FrontendPosition(**p) for p in body["positions"]]
        val.append(time.perf_counter() - t)
    v = min(val)

    w = min(warm)
    print()
    print(f"  {'component':<34}{'seconds':>10}{'share of HTTP':>16}")
    print("  " + "-" * 60)
    for name, t in (("engine (run_simulation)", eng),
                    ("response validate+serialise", s),
                    ("request validation", v)):
        print(f"  {name:<34}{t:>9.2f}s{t / w * 100:>15.0f}%")
    rest = w - eng - s - v
    print(f"  {'transport + executor + rest':<34}{rest:>9.2f}s{rest / w * 100:>15.0f}%")
    print(f"  {'HTTP end-to-end (warm best)':<34}{w:>9.2f}s{100:>15.0f}%")
    print()
    print(f"  HTTP / engine ratio: {w / eng:.2f}x")


if __name__ == "__main__":
    main()
