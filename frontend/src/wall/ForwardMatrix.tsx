"use client";

/* Forward matrix + key-forward block (DESIGN §8). 21 start rows × 8 forward
 * tenors; the cell VALUE is a level (ink, 4dp), and the cell BACKGROUND is a
 * directional tint of the D-1 change (red up / blue down, magnitude by alpha —
 * §2/§9, Session 13). Reading the field of colour is how a grid is scanned.
 * Live-quoted intersections keep the cell border. Row order is time — no sort.
 */

import type { ForwardsPayload } from "@/lib/api";
import { BASIS_LABELS, TIME_BASES } from "@/theme/ramp";

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
                <td className={`sticky left-0 z-10 bg-tile${sep}`}>{sp.label}</td>
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

export function KeyForwardBlock({ payload }: { payload: ForwardsPayload }) {
  // Plain ink levels — no tint (§J): the own-history scale is d1-only for
  // forwards, so a per-basis tint here would have no consistent normalisation.
  // This block stays a numeric reference; the tint story is the matrix.
  return (
    <table
      className="text-[13px]"
      style={{ borderCollapse: "separate", borderSpacing: 0 }}
    >
      <thead>
        <tr className="h-8">
          <th className="w-16 text-left font-semibold">주요 포워드</th>
          {TIME_BASES.map((b) => (
            <th key={b} className="w-[74px] text-right font-normal opacity-60">
              {BASIS_LABELS[b]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {payload.keyForwards.map((kf) => (
          <tr key={kf.label} className="h-[26px]">
            <td>{kf.label}</td>
            {TIME_BASES.map((b) => (
              <td key={b} className="px-1 text-right align-middle tabular-nums">
                {kf.values[b].toFixed(4)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
