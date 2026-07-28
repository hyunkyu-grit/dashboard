"use client";

/* Forward matrix + key-forward block (DESIGN §8). 21 start rows × 8 forward
 * tenors; the cell VALUE is a level (ink, 4dp), and the cell BACKGROUND is a
 * directional tint of the D-1 change (red up / blue down, magnitude by alpha —
 * §2/§9, Session 13). Reading the field of colour is how a grid is scanned.
 * Live-quoted intersections keep the cell border. Row order is time — no sort.
 */

import type { ForwardsPayload } from "@/lib/api";

import { matrixTint } from "@/ui/tint";

const YEAR_ROWS = new Set(["2Y", "3Y", "4Y", "5Y"]);

export function ForwardMatrix({ payload }: { payload: ForwardsPayload }) {
  // The 시작 and 날짜 columns are PINNED (sticky-left) so horizontal scroll
  // never loses row identity (§F). They carry an opaque bg (§G) or cells would
  // bleed through them; opacity goes on the text span, never the sticky cell.
  return (
    <div className="max-w-full overflow-x-auto">
      <table
        className="text-[13px]"
        style={{ borderCollapse: "separate", borderSpacing: 0 }}
      >
        <thead>
          <tr className="h-8">
            {/* opacity goes on the label span, never the sticky cell — an
                opacity on the cell would sink its opaque bg and let rows bleed
                through (§G). */}
            <th className="sticky left-0 top-0 z-30 w-12 bg-tile text-left font-normal">
              <span className="opacity-60">시작</span>
            </th>
            <th className="sticky left-12 top-0 z-30 w-24 bg-tile text-left font-normal">
              <span className="opacity-60">날짜</span>
            </th>
            {payload.tenors.map((t) => (
              <th key={t} className="sticky top-0 z-20 w-[74px] bg-tile text-right font-semibold">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.startPoints.map((sp, i) => {
            const sep = YEAR_ROWS.has(sp.label) ? " border-t-2 border-t-edge" : "";
            return (
              <tr key={sp.label} className="h-[26px]">
                {/* the ON row is the grid's anchor but it IS the spot curve
                    (an overnight start is today) — label it as such rather
                    than presenting it as forwards (carry session, Pass A). */}
                <td className={`sticky left-0 z-10 bg-tile${sep}`}>
                  {sp.label === "ON" ? "현물" : sp.label}
                </td>
                <td className={`sticky left-12 z-10 bg-tile${sep}`}>
                  <span className="opacity-60">{sp.date}</span>
                </td>
                {payload.tenors.map((tenor) => {
                  const cell = payload.grid[tenor][i];
                  return (
                    <td
                      key={tenor}
                      // graded own-history tint (§J): the cell's move vs its own
                      // past, not vs the day's grid-max. Ink on tint.
                      style={matrixTint(cell.movePct, cell.deltas.d1 > 0)}
                      className={`border px-1 text-right align-middle tabular-nums ${
                        cell.live ? "border-edge-live" : "border-transparent"
                      }${sep}`}
                    >
                      {cell.values.now.toFixed(4)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// A level is "extreme" in its own 52-week range at the tails (Pass E; annual
// window per the annual-stats session): the marker goes full ink so a
// 99th-percentile row is distinct from a 72nd one.
const GAUGE_EXTREME_PCT = 90;

function isExtreme(pct: number): boolean {
  return pct >= GAUGE_EXTREME_PCT || pct <= 100 - GAUGE_EXTREME_PCT;
}

/** Thin 52-week min→max track with a fill up to the current level, a marker
 * on it, and a hairline tick at the annual AVERAGE (§8 gauge; annual-stats
 * session — high/low alone say how wide the range is, the average says where
 * the level sits inside it). The marker is the accent at the tails, secondary
 * ink otherwise. `frac`/`avgFrac` are POSITIONS in [min,max]; the percentile
 * is shown separately as a number. */
function GaugeTrack({
  frac,
  avgFrac,
  extreme,
}: {
  frac: number;
  avgFrac: number | null;
  extreme: boolean;
}) {
  const pos = `${(frac * 100).toFixed(1)}%`;
  return (
    <div className="relative h-1.5 w-full min-w-[150px] rounded-full bg-edge">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-ink opacity-20"
        style={{ width: pos }}
      />
      {/* the 52-week average — a hairline tick, quieter than the marker */}
      {avgFrac != null && (
        <div
          className="absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-ink/45"
          style={{ left: `${(avgFrac * 100).toFixed(1)}%` }}
        />
      )}
      {/* extreme vs not is distinguished by LIGHTNESS, not hue (palette cut):
          full ink at the tails, half-ink otherwise. */}
      <div
        className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
          extreme ? "bg-ink" : "bg-ink/50"
        }`}
        style={{ left: pos }}
      />
    </div>
  );
}

export function KeyForwardBlock({ payload }: { payload: ForwardsPayload }) {
  // The six actually-quoted forwards — the most important block in this view,
  // and (before Pass E) the only region with no visual encoding. It shows the
  // current LEVEL and, via a gauge, where that level sits in its own 52-week range —
  // which is what a reader wants from a quoted forward. The per-basis LEVEL
  // columns that used to sit here were REMOVED: they carried the same
  // WTD/MTD/QTD/YTD headers as the main table's CHANGE columns while showing a
  // different quantity (level, not change) — the ambiguity §E1 flags. The block
  // is now unambiguously "current level + position", the table owns changes.
  return (
    <table
      className="text-[13px]"
      style={{ borderCollapse: "separate", borderSpacing: 0 }}
    >
      <thead>
        <tr className="h-8 align-bottom">
          <th className="w-16 text-left font-semibold">주요 포워드</th>
          <th className="w-[74px] pr-3 text-right font-normal opacity-60">현재</th>
          {/* track ends labelled ONCE, here, not per row (§E1) */}
          <th className="min-w-[150px] px-1 font-normal">
            <div className="flex justify-between text-[11px] opacity-45">
              <span>52주 최저</span>
              <span>52주 최고</span>
            </div>
          </th>
          <th className="w-10 pl-2 text-right font-normal opacity-45">백분위</th>
        </tr>
      </thead>
      <tbody>
        {payload.keyForwards.map((kf) => {
          const { min, max, avg, pct } = kf.range1y;
          const now = kf.values.now;
          const hasGauge =
            min != null && max != null && pct != null && max > min;
          const frac = hasGauge
            ? Math.min(1, Math.max(0, (now - min) / (max - min)))
            : 0;
          const avgFrac =
            hasGauge && avg != null
              ? Math.min(1, Math.max(0, (avg - min) / (max - min)))
              : null;
          const extreme = hasGauge && isExtreme(pct);
          return (
            <tr key={kf.label} className="h-[26px]">
              <td className="font-medium">{kf.label}</td>
              <td className="pr-3 text-right align-middle tabular-nums">
                {now.toFixed(4)}
              </td>
              <td className="px-1 align-middle">
                {hasGauge ? (
                  <GaugeTrack frac={frac} avgFrac={avgFrac} extreme={extreme} />
                ) : (
                  <span className="opacity-40">–</span>
                )}
              </td>
              <td
                className={`pl-2 text-right align-middle tabular-nums ${
                  extreme ? "font-semibold text-ink" : "opacity-55"
                }`}
              >
                {hasGauge ? Math.round(pct) : "–"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
