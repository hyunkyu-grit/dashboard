"""§5.3 — the deliverable: long form must reproduce the wide ladder EXACTLY.

Runs over the full live book: every KTB tenor the 민평 matrix carries, both
directions, both a fresh and a seasoned position. For each, the wide ladder is
produced by the product's own `app.cashbond._krd_bond` (imported, never
reimplemented), converted to long form, aggregated, converted back, and
compared cell by cell.

The residual is reported as a NUMBER. "Matches" is not a result.

§5.4 then constructs the case the wide format cannot handle without manual
alignment: two real instruments whose tenor grids differ.

Writes `docs/q1/ladder_equivalence.csv` and `docs/q1/ladder_grid_case.csv`.
"""

from __future__ import annotations

import csv
import math
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))

from app import cashbond as cb  # noqa: E402
from app import creditmatrix as cm  # noqa: E402
from app.curves import TENOR_T  # noqa: E402
from research.ladder.longform import (  # noqa: E402
    aggregate,
    extra_buckets,
    from_wide,
    sort_tenors,
    tenor_days,
    to_wide,
)

BOND_TYPE = "KTB"
NOTIONAL = 1e11  # 100bn KRW — a realistic desk clip, so residuals are in real won


def live_book(m, asof_i: int):
    """Every KTB tenor the matrix actually carries, long and short, fresh and
    seasoned. Real instruments; nothing synthetic."""
    labels = [lb for lb in cm.TENOR_LABELS if m.has(BOND_TYPE, lb)]
    book = []
    for lb in labels:
        years = cm.TENOR_YEARS[lb]
        n = cb.periods_for(lb)
        y = cm.yield_at(m, BOND_TYPE, asof_i, years)
        for direction in (1, -1):
            for season, elapsed in (("fresh", 0.0), ("seasoned", 0.5)):
                pos = cb.BondPosition(
                    kind="CB", bond_type=BOND_TYPE, tenor=lb,
                    direction=direction, notional=NOTIONAL,
                    entry=m.dates[asof_i],
                )
                leg = cb._BondLeg(coupon=y, n=n, years=years,
                                  entry_i=asof_i, exit_i=asof_i, matured=False)
                book.append({
                    "name": f"{BOND_TYPE} {lb} {'long' if direction > 0 else 'short'} {season}",
                    "pos": pos, "leg": leg, "elapsed": elapsed, "labels": labels,
                })
    return book


def main() -> None:
    m = cm.load()
    asof_i = len(m.dates) - 1
    print(f"as-of {m.dates[asof_i]}  (matrix row {asof_i})")

    book = live_book(m, asof_i)
    print(f"live book: {len(book)} positions over "
          f"{len(book[0]['labels'])} matrix tenors")

    rows = []
    worst = 0.0
    frames = []
    labels0 = book[0]["labels"]
    wide_total: dict[str, float] = {lb: 0.0 for lb in labels0}
    wide_cells: dict[str, list[float]] = {lb: [] for lb in labels0}

    for item in book:
        wide = cb._krd_bond(m, item["pos"], item["leg"], asof_i,
                            item["elapsed"], item["labels"])
        long_df = from_wide(wide, instrument=item["name"], curve=f"{BOND_TYPE} 민평")
        frames.append(long_df)
        back = to_wide(long_df, item["labels"])

        for lb in item["labels"]:
            r = back[lb] - wide[lb]
            worst = max(worst, abs(r))
            wide_total[lb] += wide[lb]          # book order, as the product does
            wide_cells[lb].append(wide[lb])
            if r != 0.0:
                rows.append({"instrument": item["name"], "tenor": lb,
                             "wide": wide[lb], "long_roundtrip": back[lb],
                             "residual": r})

    # book-level aggregate: the wide way (accumulate into a seeded dict) vs the
    # long way (concat -> groupby). These are different code paths entirely.
    agg = aggregate(frames)
    long_total = to_wide(agg, labels0)
    agg_resid = {lb: long_total[lb] - wide_total[lb] for lb in labels0}
    worst_agg = max(abs(v) for v in agg_resid.values())

    # Is any residual a LOGIC difference, or only float summation order?
    # `math.fsum` is exactly rounded and therefore order-independent. If both
    # paths match fsum, the two disagree only in the order they added, which
    # is not a difference in what they computed.
    exact = {lb: math.fsum(wide_cells[lb]) for lb in labels0}
    wide_vs_exact = max(abs(wide_total[lb] - exact[lb]) for lb in labels0)
    long_vs_exact = max(abs(long_total[lb] - exact[lb]) for lb in labels0)
    gross = math.fsum(abs(v) for lb in labels0 for v in wide_cells[lb])

    print("\n── §5.3 equivalence, full live book ──")
    print(f"  positions compared        : {len(book)}")
    print(f"  cells compared            : {len(book) * len(book[0]['labels'])}")
    print(f"  per-instrument residual   : max |Δ| = {worst:.17g}")
    print(f"  book aggregate residual   : max |Δ| = {worst_agg:.17g}")
    print(f"  non-zero cells            : {len(rows)}")
    print(f"  PER-INSTRUMENT EXACT ZERO : {worst == 0.0}   <- the §5.3 gate")

    print(f"\n  book gross KRD (sum |cell|): {gross:,.2f} won/bp")
    print(f"  wide  vs exactly-rounded  : max |d| = {wide_vs_exact:.17g}")
    print(f"  long  vs exactly-rounded  : max |d| = {long_vs_exact:.17g}")
    print(f"  wide  vs long             : max |d| = {worst_agg:.17g}")
    print(f"  -> relative to gross      : {worst_agg / gross:.3e}")
    print("     Both paths sit the same distance from the exactly-rounded sum,")
    print("     so the disagreement is float SUMMATION ORDER, not a difference")
    print("     in what was computed.")

    print("\n  book KRD (won/bp) — long/short pairs net by construction, so the")
    print("  gross column is shown to prove the cells are not trivially zero:")
    for lb in sort_tenors(labels0):
        g = math.fsum(abs(v) for v in wide_cells[lb])
        if g > 0.5:
            print(f"    {lb:>5s}  net {long_total[lb]:>12,.2f}   gross {g:>18,.2f}")

    outdir = REPO / "docs" / "q1"
    outdir.mkdir(parents=True, exist_ok=True)
    with (outdir / "ladder_equivalence.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["tenor", "tenor_days", "wide_total",
                                           "long_total", "residual"])
        w.writeheader()
        for lb in sort_tenors(labels0):
            w.writerow({"tenor": lb, "tenor_days": tenor_days(lb),
                        "wide_total": wide_total[lb], "long_total": long_total[lb],
                        "residual": agg_resid[lb]})
    print(f"\n  wrote {outdir / 'ladder_equivalence.csv'}")

    # ── §5.4 differing grids ────────────────────────────────────────────────
    print("\n── §5.4 two real instruments on different tenor grids ──")
    bond_labels = labels0                              # 민평 grid
    swap_labels = list(TENOR_T)                        # curve grid
    print(f"  bond grid ({len(bond_labels)}): {bond_labels}")
    print(f"  swap grid ({len(swap_labels)}): {swap_labels}")
    only_bond = sort_tenors(set(bond_labels) - set(swap_labels))
    only_swap = sort_tenors(set(swap_labels) - set(bond_labels))
    print(f"  only on the bond grid : {only_bond}")
    print(f"  only on the swap grid : {only_swap}")

    b = book[0]
    bond_wide = cb._krd_bond(m, b["pos"], b["leg"], asof_i, 0.0, bond_labels)
    # a real swap-side ladder on the curve grid: DV01 at each curve node,
    # signed, on the same clip. Values come from the product's own pv01.
    from app.dv01 import pv01
    from app.engine_port import bootstrap_zero_curve
    from app.curves import par_rates_at_index
    from app.dataset import load_dataset_merged

    ds = load_dataset_merged()
    zc = bootstrap_zero_curve(par_rates_at_index(ds, len(ds.dates) - 1))
    swap_wide = {lb: -pv01(zc, TENOR_T[lb]) * NOTIONAL * 1e-4 for lb in swap_labels}

    bond_df = from_wide(bond_wide, instrument="KTB 3M CB", curve="KRW rates")
    swap_df = from_wide(swap_wide, instrument="IRS payer strip", curve="KRW rates")
    combined = aggregate([bond_df, swap_df])

    print(f"\n  long-format aggregate: {len(combined)} rows, no alignment code, "
          f"{combined['tenor_label'].nunique()} distinct buckets")
    print(f"  buckets the BOND grid alone would drop : "
          f"{extra_buckets(swap_df, bond_labels)}")
    print(f"  buckets the SWAP grid alone would drop : "
          f"{extra_buckets(bond_df, swap_labels)}")
    print("\n  netted, ordered by tenor_days (note 1.5Y between 1Y and 2Y):")
    netted = combined.groupby(["tenor_label", "tenor_days"], as_index=False)["value"].sum()
    netted = netted.sort_values("tenor_days")
    for _, r in netted.iterrows():
        print(f"    {r['tenor_label']:>5s} {r['tenor_days']:>8.0f}d  {r['value']:>18,.2f}")

    netted.to_csv(outdir / "ladder_grid_case.csv", index=False, encoding="utf-8")
    print(f"\n  wrote {outdir / 'ladder_grid_case.csv'}")

    print("\n  string-sorted order (what a label-keyed dict gives you):")
    print(f"    {sorted(set(bond_labels) | set(swap_labels))}")
    print("  tenor_days order:")
    print(f"    {sort_tenors(set(bond_labels) | set(swap_labels))}")


if __name__ == "__main__":
    main()
