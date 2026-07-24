"use client";

/* Dense table view behind the "표로 보기" toggle (DESIGN §2). Tables are the
 * dense view now, not the default. label · now · delta (number in direction
 * color + center-zero mini-bar for grayscale). Hairlines survive here. */

import { useMemo } from "react";

import type { BasisKey, SeriesSummary } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";

import { MiniBar } from "@/wall/MiniBar";

export function SeriesTable({
  rows,
  basis,
  onOpen,
}: {
  rows: SeriesSummary[];
  basis: BasisKey;
  onOpen: (id: string) => void;
}) {
  const scale = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      const d = r.deltas[basis];
      if (d != null) m = Math.max(m, Math.abs(d));
    }
    return m;
  }, [rows, basis]);

  return (
    <table
      className="w-full text-[13px]"
      style={{ borderCollapse: "separate", borderSpacing: 0 }}
    >
      <thead>
        <tr className="h-8 border-b border-edge text-left opacity-50">
          <th className="font-normal">series</th>
          <th className="w-24 text-right font-normal">now</th>
          <th className="w-40 text-right font-normal">Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const d = r.deltas[basis];
          return (
            <tr
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="h-[26px] cursor-pointer border-b border-edge hover:bg-page"
            >
              <td>{r.label}</td>
              <td className="text-right tabular-nums">
                {r.now == null
                  ? "–"
                  : r.unit === "%"
                    ? r.now.toFixed(4)
                    : r.now.toFixed(1)}
              </td>
              <td className="pl-3">
                <div className="flex items-center gap-2">
                  <span className={`w-14 text-right tabular-nums ${dirClass(d)}`}>
                    {fmtBp(d)}
                  </span>
                  <div className="w-20">
                    <MiniBar delta={d} scale={scale} />
                  </div>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
