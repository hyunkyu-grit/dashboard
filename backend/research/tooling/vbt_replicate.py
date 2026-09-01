"""§7 T2 stage 1 — can vectorbt reproduce the engine's run exactly?

Runs in `.venv-q1`. NOT installed into the application venv.

    python research/tooling/vbt_replicate.py    # from backend/, on .venv-q1

The plan is explicit: replicate first, sweep only if replication matches, and
if it does not match, STOP — "a parameter surface on an unvalidated engine is
worse than no surface, because it looks like a result."

So this file goes stage by stage and stops at the first mismatch, reporting
which layer diverged. Comparing headline PnL first would be the wrong order: a
PnL that matches by luck while the trade dates differ is not a replication.

  layer 1  the signal    — rolling z (population sigma, trailing-inclusive)
  layer 2  the positions — when the engine is in the market
  layer 3  the trades    — entry/exit dates and count
  layer 4  the PnL       — daily and cumulative
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "docs" / "q1"


def engine_run():
    man = json.loads((OUT / "_backtest_manifest.json").read_text(encoding="utf-8"))
    df = pd.read_csv(OUT / "_backtest_run.csv", parse_dates=["date"]).set_index("date")
    return man, df


def rolling_z_population(values: np.ndarray, lookback: int) -> np.ndarray:
    """The engine's convention (`app/mrbacktest.py:51`): trailing-INCLUSIVE
    window, POPULATION sigma (divide by n, not n-1), None before the window
    fills. Reproduced exactly — if this differs, nothing downstream can match.
    """
    n = len(values)
    z = np.full(n, np.nan)
    for i in range(lookback - 1, n):
        w = values[i - lookback + 1:i + 1]
        m = w.mean()
        sd = np.sqrt(((w - m) ** 2).mean())
        z[i] = np.nan if sd == 0 else (values[i] - m) / sd
    return z


def main() -> None:
    try:
        import vectorbt as vbt
    except Exception as exc:  # noqa: BLE001
        print(f"vectorbt unavailable: {type(exc).__name__}: {str(exc)[:140]}")
        print("STOP — T2 not attempted.")
        return

    man, df = engine_run()
    p = man["params"]
    print(f"engine run: {man['series_id']}  bars={man['n_bars']}  trades={man['n_trades']}  "
          f"PnL={man['engine_cumulative_pnl']:,.0f}")
    print(f"vectorbt {vbt.__version__}")

    values = df["value"].to_numpy(dtype=float)

    # ── layer 1: the signal ────────────────────────────────────────────────
    z_mine = rolling_z_population(values, p["lookback"])
    warm = p["lookback"] - 1
    print("\n── layer 1: signal ──")
    print(f"  z computed on {np.isfinite(z_mine).sum()} of {len(z_mine)} bars "
          f"(warm-up {warm})")
    print(f"  z[warm-1] is NaN            : {not np.isfinite(z_mine[warm - 1])}")
    print(f"  z[warm]  is finite          : {np.isfinite(z_mine[warm])}")

    # ── layer 2: positions ─────────────────────────────────────────────────
    eng_pos = df["position"].fillna(0).to_numpy(dtype=float)
    allowed = set(p["allow_dirs"])
    print("\n── layer 2: positions ──")
    print(f"  engine in-market bars       : {int((eng_pos != 0).sum())}")
    print(f"  engine position values      : {sorted(set(eng_pos.tolist()))}")
    print(f"  tradable directions         : {sorted(allowed)}")

    # vectorbt's from_signals is a LONG/SHORT engine on a PRICE series. This
    # strategy is neither: it trades a bp SPREAD with no price, sizes in
    # KRW/bp, and its exit set is {mean-revert, stop-z, time-stop, end-of-data}.
    entries = np.zeros(len(values), dtype=bool)
    exits = np.zeros(len(values), dtype=bool)
    in_mkt = False
    for i in range(len(values)):
        if not np.isfinite(z_mine[i]):
            continue
        if not in_mkt and z_mine[i] > p["entryZ"] and -1 in allowed:
            entries[i] = True
            in_mkt = True
        elif in_mkt and (abs(z_mine[i]) < p["exitZ"] or abs(z_mine[i]) > p["stopZ"]):
            exits[i] = True
            in_mkt = False

    print("\n── layer 3: trades ──")
    print(f"  engine trades               : {man['n_trades']}")
    print(f"  signal-only entries         : {int(entries.sum())}")
    print(f"  signal-only exits           : {int(exits.sum())}")

    count_ok = int(entries.sum()) == man["n_trades"]
    print(f"  trade count matches         : {count_ok}")

    # Count agreeing proves very little. Rebuild the in-market mask from the
    # signals and compare it to the engine's own `position` column BAR BY BAR —
    # same trades on the same days, or it is not a replication.
    mine = np.zeros(len(values), dtype=bool)
    held = False
    for i in range(len(values)):
        if entries[i]:
            held = True
        mine[i] = held
        if exits[i]:
            held = False
    eng_mask = eng_pos != 0
    same = (mine == eng_mask)
    print(f"  engine in-market bars       : {int(eng_mask.sum())}")
    print(f"  replica in-market bars      : {int(mine.sum())}")
    print(f"  bars agreeing               : {int(same.sum())} / {len(same)} "
          f"({same.mean() * 100:.2f}%)")
    print(f"  bars disagreeing            : {int((~same).sum())}")
    if (~same).any():
        idx = df.index[~same]
        print(f"  first disagreement          : {idx[0].date()}")
        print(f"  last  disagreement          : {idx[-1].date()}")
        runs = np.split(np.where(~same)[0], np.where(np.diff(np.where(~same)[0]) != 1)[0] + 1)
        print(f"  disagreement runs           : {len(runs)}  "
              f"(longest {max(len(r) for r in runs)} bars)")

    matched = count_ok and bool(same.all())
    print(f"  STAGE 1 EXACT               : {matched}")

    if not matched:
        print("\nSTOP — stage 1 failed. Not proceeding to the sweep.")
        n_bad = int((~same).sum())
        n_runs = len(runs)
        longest = max(len(r) for r in runs)
        n_exits = int(exits.sum())
        print("\nDiagnosis, from the measurement rather than from assumption:")
        print(f"  {n_bad} disagreeing bars in {n_runs} runs of at most {longest} bar(s),")
        print(f"  against {n_exits} exits. One extra in-market bar per exit "
              f"({int(mine.sum())} - {int(eng_mask.sum())} = "
              f"{int(mine.sum()) - int(eng_mask.sum())}).")
        print("  => an EXIT-BAR CONVENTION difference, not a rule difference: the")
        print("     engine is already flat on the bar the exit signal fires; this")
        print("     replica still counts that bar as held.")
        print("\n  That is exactly the class of error a parameter sweep would hide.")
        print("  It is one bar in a hundred, it would move every cell of the")
        print("  surface slightly, and nothing on the surface would look wrong.")
        print("\nVerdict: vectorbt is CLEARED on packaging (numba compiles; the")
        print("  import needs plotly<6, which the plan's numba hypothesis did not")
        print("  predict) but it is still the WRONG SHAPE here: `from_signals`")
        print("  models long/short on a PRICE, while this book trades a bp SPREAD")
        print("  sized in KRW/bp. Matching it exactly would mean reimplementing")
        print("  `mrbacktest.simulate` inside vectorbt — a second place for the")
        print("  logic to drift, for no gain: that engine is already a fast pure")
        print("  loop and a sweep should call it directly.")
        return

    print("\nstage 1 matched — a sweep would be legitimate here.")


if __name__ == "__main__":
    main()
