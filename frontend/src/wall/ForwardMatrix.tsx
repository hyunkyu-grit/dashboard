"use client";

/* Forward matrix + key-forward block (DESIGN §8). 21 start rows × 8 forward
 * tenors; the cell VALUE is a level (ink, 4dp), and the cell BACKGROUND is a
 * directional tint of the D-1 change (red up / blue down, magnitude by alpha —
 * §2/§9, Session 13). Reading the field of colour is how a grid is scanned.
 * Live-quoted intersections keep the cell border. Row order is time — no sort.
 */

import { useMemo } from "react";

import type { ForwardsPayload } from "@/lib/api";
import { BASIS_LABELS, TIME_BASES } from "@/theme/ramp";

import { tintStyle } from "@/ui/tint";

const YEAR_ROWS = new Set(["2Y", "3Y", "4Y", "5Y"]);

export function ForwardMatrix({ payload }: { payload: ForwardsPayload }) {
  // one grid tint scale so cells are comparable across the matrix (§2)
  const gridMax = useMemo(() => {
    let m = 0;
    for (const tenor of payload.tenors) {
      for (const cell of payload.grid[tenor]) {
        const d = cell.deltas.d1;
        if (d != null) m = Math.max(m, Math.abs(d));
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
                    style={tintStyle(cell.deltas.d1, gridMax)}
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
  );
}

export function KeyForwardBlock({ payload }: { payload: ForwardsPayload }) {
  // level cells tinted by their change from Now (the "now" column is untinted).
  const gridMax = useMemo(() => {
    let m = 0;
    for (const kf of payload.keyForwards) {
      for (const b of TIME_BASES) {
        if (b !== "now")
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
            {TIME_BASES.map((b) => {
              const change =
                b === "now" ? null : (kf.values.now - kf.values[b]) * 100;
              return (
                <td
                  key={b}
                  style={tintStyle(change, gridMax)}
                  className="px-1 text-right align-middle tabular-nums"
                >
                  {kf.values[b].toFixed(4)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
