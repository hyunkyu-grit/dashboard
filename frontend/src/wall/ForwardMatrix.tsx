"use client";

/* Band 2 — forward matrix table + key-forward block (design spec §8).
 *
 * The table is for exact value reading; the tiles above are for shape.
 * 21 start rows × 8 forward tenors, 4dp values, each cell carrying a
 * center-zero mini-bar for the delta vs the GLOBAL comparison basis.
 * Live-quoted intersections get a cell border (same rule as tile markers).
 * Row order is time — NO sorting, ever. Hovering a cell highlights the
 * matching point in the column-slice tile above (linked highlight).
 */

import { useMemo } from "react";

import type { ForwardsPayload } from "@/lib/api";
import { useUiStore } from "@/state/ui";
import { BASIS_LABELS, TIME_BASES, type TimeBasis } from "@/theme/ramp";

import { MiniBar } from "./MiniBar";

const YEAR_ROWS = new Set(["2Y", "3Y", "4Y", "5Y"]);

function cellDelta(
  cell: { values: Record<string, number> },
  basis: TimeBasis,
): number | null {
  if (basis === "now") return null;
  return (cell.values.now - cell.values[basis]) * 100;
}

export function ForwardMatrix({ payload }: { payload: ForwardsPayload }) {
  const basis = useUiStore((s) => s.basis);
  const setFwdHover = useUiStore((s) => s.setFwdHover);

  // One bar scale for the whole grid so lengths are comparable (§8).
  const scale = useMemo(() => {
    let m = 0;
    for (const tenor of payload.tenors) {
      for (const cell of payload.grid[tenor]) {
        const d = cellDelta(cell, basis);
        if (d != null) m = Math.max(m, Math.abs(d));
      }
    }
    return m;
  }, [payload, basis]);

  return (
    <table
      className="text-[13px]"
      style={{ borderCollapse: "separate", borderSpacing: 0 }}
      onMouseLeave={() => setFwdHover(null)}
    >
      <thead>
        <tr className="h-8">
          <th className="w-12 text-left font-normal opacity-60">시작</th>
          <th className="w-24 text-left font-normal opacity-60">날짜</th>
          {payload.tenors.map((t) => (
            <th key={t} className="w-[74px] text-right font-semibold">
              {t}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {payload.startPoints.map((sp, i) => {
          // Bold separator above each integer-year row (§8). Class-based, not
          // inline var(): shared rules keep per-cell paint cheap.
          const sep = YEAR_ROWS.has(sp.label) ? " border-t-2 border-t-edge" : "";
          return (
            <tr key={sp.label} className="h-[26px]">
              <td className={sep}>{sp.label}</td>
              <td className={`opacity-60${sep}`}>{sp.date}</td>
              {payload.tenors.map((tenor) => {
                const cell = payload.grid[tenor][i];
                return (
                  <td
                    key={tenor}
                    className={`border px-1 text-right align-middle ${
                      cell.live ? "border-edge-live" : "border-transparent"
                    }${sep}`}
                    onMouseEnter={() => setFwdHover({ tenor, startIdx: i })}
                  >
                    <div className="leading-4">
                      {cell.values.now.toFixed(4)}
                    </div>
                    <MiniBar delta={cellDelta(cell, basis)} scale={scale} />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function KeyForwardBlock({ payload }: { payload: ForwardsPayload }) {
  // Columns enumerate ALL bases (§8), so each cell's bar is Now − value(b);
  // the global selector doesn't re-base this block.
  const scale = useMemo(() => {
    let m = 0;
    for (const kf of payload.keyForwards) {
      for (const b of TIME_BASES) {
        m = Math.max(m, Math.abs((kf.values.now - kf.values[b]) * 100));
      }
    }
    return m;
  }, [payload]);

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
              <td key={b} className="px-1 text-right align-middle">
                <div className="leading-4">{kf.values[b].toFixed(4)}</div>
                <MiniBar
                  delta={
                    b === "now"
                      ? null
                      : (kf.values.now - kf.values[b]) * 100
                  }
                  scale={scale}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
