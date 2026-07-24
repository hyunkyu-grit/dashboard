"use client";

/* Left pane — the instrument table (DESIGN §2). Instrument · 현재 · five change
 * columns (red up / blue down + mini-bar) · 한 줄. Filter chips, sortable by
 * any change column, hover → preview, click → pin, Esc unpins (in App). Rows
 * self-register in the tile registry so the command bar can scroll to them. */

import { motion } from "motion/react";
import { useMemo, useState } from "react";

import type { BasisKey } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";
import { useRegisterTile } from "@/wall/useRegisterTile";

import { SPRING } from "./motion";

import {
  BASIS_ORDER,
  GROUP_LABEL,
  type Group,
  type Row,
} from "./rows";

const BASIS_HEAD: Record<BasisKey, string> = {
  d1: "어제",
  wtd: "WTD",
  mtd: "MTD",
  qtd: "QTD",
  ytd: "YTD",
};

const FILTERS: { id: Group | "all"; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "outright", label: GROUP_LABEL.outright },
  { id: "spread", label: GROUP_LABEL.spread },
  { id: "forward", label: GROUP_LABEL.forward },
  { id: "vol", label: GROUP_LABEL.vol },
];

function levelText(row: Row): string {
  if (row.now == null) return "–";
  return row.unit === "%" ? row.now.toFixed(4) : row.now.toFixed(1);
}

function TableRow({
  row,
  active,
  pinned,
  onHover,
  onPin,
}: {
  row: Row;
  active: boolean;
  pinned: boolean;
  onHover: (row: Row | null) => void;
  onPin: (row: Row) => void;
}) {
  const registerRef = useRegisterTile(row.id, row.label, [
    row.label,
    row.label.replace(/\s/g, ""),
    row.id,
  ]);
  return (
    <tr
      ref={registerRef as ((el: HTMLTableRowElement | null) => void) | undefined}
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPin(row)}
      className={`h-10 cursor-pointer border-b border-edge ${
        active ? "bg-page" : ""
      }`}
    >
      <td className="relative pl-3">
        {pinned && (
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ink" />
        )}
        {row.label}
      </td>
      <td className="pr-3 text-right tabular-nums">{levelText(row)}</td>
      {BASIS_ORDER.map((b) => (
        <td
          key={b}
          className={`pr-3 text-right tabular-nums ${dirClass(row.changes[b])}`}
        >
          {fmtBp(row.changes[b])}
        </td>
      ))}
      <td className="pr-3 text-[13px] opacity-55">{row.oneLiner}</td>
    </tr>
  );
}

export function InstrumentTable({
  rows,
  activeId,
  pinnedId,
  onHover,
  onPin,
}: {
  rows: Row[];
  activeId: string | null;
  pinnedId: string | null;
  onHover: (row: Row | null) => void;
  onPin: (row: Row) => void;
}) {
  const [filter, setFilter] = useState<Group | "all">("all");
  const [sortCol, setSortCol] = useState<BasisKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  const shown = useMemo(() => {
    const base = filter === "all" ? rows : rows.filter((r) => r.group === filter);
    if (!sortCol) return base;
    const withVal = base.filter((r) => r.changes[sortCol] != null);
    const without = base.filter((r) => r.changes[sortCol] == null);
    withVal.sort((a, b) => {
      const d = Math.abs(b.changes[sortCol]!) - Math.abs(a.changes[sortCol]!);
      return sortAsc ? -d : d;
    });
    return [...withVal, ...without];
  }, [rows, filter, sortCol, sortAsc]);

  const clickSort = (b: BasisKey) => {
    if (sortCol !== b) {
      setSortCol(b);
      setSortAsc(false);
    } else if (!sortAsc) {
      setSortAsc(true);
    } else {
      setSortCol(null); // third click → back to instrument order
    }
  };

  return (
    <div>
      {/* Tabs: a sliding underline indicator (§14). No press-scale here — a
          tab shares an alignment with its neighbours; transform press feedback
          is reserved for isolated targets (rows, standalone buttons). */}
      <div className="mb-3 flex gap-1 border-b border-edge">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`relative px-3 py-2 text-[13px] transition-opacity ${
                on ? "font-semibold" : "opacity-55 hover:opacity-90"
              }`}
            >
              {f.label}
              {on && (
                <motion.div
                  layoutId="tab-underline"
                  transition={SPRING}
                  className="absolute inset-x-2 -bottom-px h-[2.5px] rounded-full bg-ink"
                />
              )}
            </button>
          );
        })}
      </div>

      <table
        className="w-full text-[13px]"
        style={{ borderCollapse: "separate", borderSpacing: 0 }}
        onMouseLeave={() => onHover(null)}
      >
        <thead>
          <tr className="h-10 border-b border-edge text-left align-bottom opacity-50">
            <th className="pl-3 font-normal">종목</th>
            <th className="pr-3 text-right font-normal">현재</th>
            {BASIS_ORDER.map((b) => (
              <th key={b} className="pr-3 text-right font-normal">
                <button
                  type="button"
                  onClick={() => clickSort(b)}
                  className="hover:opacity-100"
                >
                  {BASIS_HEAD[b]}
                  {sortCol === b ? (sortAsc ? " ↑" : " ↓") : ""}
                </button>
              </th>
            ))}
            <th className="pr-3 font-normal">한 줄</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <TableRow
              key={row.id}
              row={row}
              active={row.id === activeId}
              pinned={row.id === pinnedId}
              onHover={onHover}
              onPin={onPin}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
