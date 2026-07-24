/* Outlier detection for the change log (design spec §3/§5/§12 step 7).
 *
 * The weight-600 "outlier" channel is reserved for percentile extremes and
 * large moves. §12 seeds the threshold at 10y-percentile 95 and says make
 * it a constant — so it is one, here.
 */

import type { SeriesSummary, WallSummary } from "@/lib/api";
import type { TimeBasis } from "@/theme/ramp";

export const OUTLIER_PCT = 95; // percentile band: ≥95 or ≤(100−95)

export interface OutlierEvent {
  id: string;
  label: string;
  kind: SeriesSummary["kind"];
  unit: SeriesSummary["unit"];
  now: number | null;
  pct: number | null;
  delta: number | null; // vs the active basis
  reasons: ("percentile" | "move")[];
  /** registry anchor to pan to (Band 3 tiles will own precise anchors). */
  anchor: string;
}

function anchorFor(kind: SeriesSummary["kind"]): string {
  // Until Band 3 exists, outright/spread/fly series all live in the curve
  // tile — pan there. Band 3 rows will register their own anchors later.
  return kind === "outright" ? "curve" : "curve";
}

/** Largest |Δ| among the 5 deltas that marks a "large move" outlier. Uses
 * the same percentile idea applied across the wall's current deltas. */
function moveThreshold(series: SeriesSummary[], basis: TimeBasis): number {
  const mags = series
    .map((s) => (basis === "now" ? null : s.deltas[basis]))
    .filter((d): d is number => d != null)
    .map(Math.abs)
    .sort((a, b) => a - b);
  if (!mags.length) return Infinity;
  const i = Math.floor((OUTLIER_PCT / 100) * (mags.length - 1));
  return mags[i];
}

export function detectOutliers(
  summary: WallSummary,
  basis: TimeBasis,
): OutlierEvent[] {
  const all = [...summary.outrights, ...summary.derived];
  const moveCut = moveThreshold(all, basis);

  const events: OutlierEvent[] = [];
  for (const s of all) {
    const reasons: OutlierEvent["reasons"] = [];
    if (s.range10y.pct != null &&
        (s.range10y.pct >= OUTLIER_PCT || s.range10y.pct <= 100 - OUTLIER_PCT)) {
      reasons.push("percentile");
    }
    const delta = basis === "now" ? null : s.deltas[basis];
    if (delta != null && Math.abs(delta) >= moveCut && moveCut > 0) {
      reasons.push("move");
    }
    if (reasons.length) {
      events.push({
        id: s.id,
        label: s.label,
        kind: s.kind,
        unit: s.unit,
        now: s.now,
        pct: s.range10y.pct,
        delta,
        reasons,
        anchor: anchorFor(s.kind),
      });
    }
  }
  // Most extreme first: percentile distance from 50, then |move|.
  return events.sort((a, b) => {
    const pa = a.pct == null ? 0 : Math.abs(a.pct - 50);
    const pb = b.pct == null ? 0 : Math.abs(b.pct - 50);
    if (pb !== pa) return pb - pa;
    return Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);
  });
}
