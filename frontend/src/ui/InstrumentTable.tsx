"use client";

/* Left pane — the instrument table (DESIGN §2). Instrument · 현재 · five change
 * columns (red up / blue down + mini-bar) · 한 줄. Filter chips, sortable by
 * any change column, hover → preview, click → pin, Esc unpins (in App). Rows
 * self-register in the tile registry so the command bar can scroll to them. */

import { motion } from "motion/react";
import { useMemo, useState } from "react";

import type { BasisKey, CurveBanner, ForwardsPayload } from "@/lib/api";
import { dirClass, fmtDelta, fmtLevel } from "@/lib/format";
import { ForwardMatrix, KeyForwardBlock } from "@/wall/ForwardMatrix";
import { useRegisterTile } from "@/wall/useRegisterTile";

import { SPRING } from "./motion";
import { TintLegend } from "./TintLegend";
import {
  BASIS_ORDER,
  cmpKey,
  GROUP_LABEL,
  type Group,
  type Row,
} from "./rows";
import { SCREENERS } from "./screener";
import { columnCue } from "./tint";

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
  return fmtLevel(row.now, row.unit);
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
      className={`h-12 cursor-pointer border-b border-edge ${
        active ? "bg-page" : "hover:bg-page/50"
      }`}
    >
      <td className="relative py-3 pl-3 font-semibold">
        {pinned && (
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-interactive" />
        )}
        {/* quoted vs interpolated (§6): a filled dot = live-quoted node, a
            hollow dot = interpolated tenor (4Y/6Y/7Y/8Y/9Y). A dot, not a
            badge; outrights only, where the distinction exists. */}
        {row.quoted === true && (
          <span
            title="고시 만기"
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ink/45 align-middle"
          />
        )}
        {row.quoted === false && (
          <span
            title="보간 만기"
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full border border-ink/45 align-middle"
          />
        )}
        {row.label}
      </td>
      {/* 현재 is a structural anchor: weight 600, tabular, ink (§5) */}
      <td className="pr-3 text-right font-semibold tabular-nums text-ink">
        {levelText(row)}
      </td>
      {BASIS_ORDER.map((b) => (
        <td
          key={b}
          // own-history outlier cue on the live 어제 column only (§B): an
          // outlier day gets a leading-edge rule (not a fill — a fill behind
          // the coloured number can't clear contrast). Number keeps full hue.
          style={
            b === "d1"
              ? columnCue(row.movePct, (row.changes.d1 ?? 0) > 0)
              : undefined
          }
          className={`pr-3 text-right tabular-nums ${dirClass(row.changes[b])}`}
        >
          {fmtDelta(row.changes[b], row.unit)}
        </td>
      ))}
      <td className="whitespace-nowrap pr-3 text-[13px] opacity-55">
        {row.oneLiner}
      </td>
    </tr>
  );
}

export function InstrumentTable({
  rows,
  forwards,
  curveBanner,
  filter,
  onFilter,
  activeId,
  pinnedId,
  onHover,
  onPin,
  matrixOpen,
  onToggleMatrix,
}: {
  rows: Row[];
  forwards?: ForwardsPayload;
  curveBanner?: CurveBanner;
  filter: Group | "all";
  onFilter: (f: Group | "all") => void;
  activeId: string | null;
  pinnedId: string | null;
  onHover: (row: Row | null) => void;
  onPin: (row: Row) => void;
  // matrix mode is lifted to App: while open it takes the full surface width
  // and the preview pane is hidden (§F).
  matrixOpen: boolean;
  onToggleMatrix: () => void;
}) {
  const [sortCol, setSortCol] = useState<BasisKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [startFilter, setStartFilter] = useState<string>("all");
  const [screener, setScreener] = useState<string | null>(null);

  const isForward = filter === "forward";
  const activeScreener = SCREENERS.find((s) => s.id === screener) ?? null;

  const startOptions = useMemo(() => {
    const s: string[] = [];
    for (const r of rows) {
      if (r.group === "forward" && r.startLabel && !s.includes(r.startLabel)) {
        s.push(r.startLabel);
      }
    }
    return s;
  }, [rows]);

  const shown = useMemo(() => {
    let base = filter === "all" ? rows : rows.filter((r) => r.group === filter);
    if (isForward && startFilter !== "all") {
      base = base.filter((r) => r.startLabel === startFilter);
    }
    // a screener preset is a filter on top of the active tab (§D)
    if (activeScreener) base = base.filter(activeScreener.test);
    if (sortCol) {
      const withVal = base.filter((r) => r.changes[sortCol] != null);
      const without = base.filter((r) => r.changes[sortCol] == null);
      withVal.sort((a, b) => {
        const d = Math.abs(b.changes[sortCol]!) - Math.abs(a.changes[sortCol]!);
        return sortAsc ? -d : d;
      });
      return [...withVal, ...without];
    }
    // default: explicit numeric sort key ascending (§6); forwards pin the six
    // quoted key forwards to the top.
    return [...base].sort((a, b) => {
      if (isForward) {
        const ak = a.keyForward ? 0 : 1;
        const bk = b.keyForward ? 0 : 1;
        if (ak !== bk) return ak - bk;
      }
      return cmpKey(a.sortKey, b.sortKey);
    });
  }, [rows, filter, startFilter, sortCol, sortAsc, isForward, activeScreener]);

  // interleave group headings for the forward tab in default order (§3)
  const items = useMemo(() => {
    if (!(isForward && !sortCol)) {
      return shown.map((row) => ({ head: null, row }) as const);
    }
    const out: { head: string | null; row: Row | null }[] = [];
    let phase: "key" | "rest" | null = null;
    for (const row of shown) {
      const p = row.keyForward ? "key" : "rest";
      if (p !== phase) {
        out.push({ head: p === "key" ? "주요 포워드" : "전체 포워드", row: null });
        phase = p;
      }
      out.push({ head: null, row });
    }
    return out;
  }, [shown, isForward, sortCol]);

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
    <div className="flex h-full min-h-0 flex-col">
      {/* fixed: tabs + forward controls stay at the top of the surface (§shell) */}
      <div className="shrink-0 px-5 pt-4">
      {/* Tabs: a sliding underline indicator (§14). No press-scale here — a
          tab shares an alignment with its neighbours; transform press feedback
          is reserved for isolated targets (rows, standalone buttons). */}
      <div className="flex gap-1 border-b border-edge">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilter(f.id)}
              className={`relative px-3 py-2 text-[13px] transition-opacity ${
                on ? "font-semibold" : "opacity-55 hover:opacity-90"
              }`}
            >
              {f.label}
              {on && (
                <motion.div
                  layoutId="tab-underline"
                  transition={SPRING}
                  className="absolute inset-x-2 -bottom-px h-[2.5px] rounded-full bg-interactive"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* curve-level extreme, stated once (§I) — a fact about the whole curve,
          not any row, so the per-row percentile is suppressed on outrights. */}
      {curveBanner?.kind && (
        <p className="mt-2 text-[12px] text-up">
          {curveBanner.kind === "curve_high"
            ? "커브 전 구간이 10년 고점권입니다"
            : "커브 전 구간이 10년 저점권입니다"}
        </p>
      )}

      {/* screener presets (§D): a second row of chips, a filter on top of the
          active tab — one at a time, click again clears. Not a sidebar. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SCREENERS.map((sc) => {
          const on = screener === sc.id;
          return (
            <button
              key={sc.id}
              type="button"
              onClick={() => setScreener(on ? null : sc.id)}
              className={`rounded-full px-2.5 py-1 text-[12px] transition-colors ${
                on
                  ? "bg-ink text-page"
                  : "border border-edge opacity-65 hover:opacity-100"
              }`}
            >
              {sc.label}
            </button>
          );
        })}
      </div>
      {activeScreener && (
        <p className="mt-1.5 text-[12px] opacity-55">{activeScreener.description}</p>
      )}

      {/* forward-tab secondary controls (§3): narrow by start point, or flip
          to the 21×8 matrix */}
      {isForward && (
        <div className="mt-2 flex items-center gap-3 text-[13px]">
          <select
            value={startFilter}
            onChange={(e) => setStartFilter(e.target.value)}
            className="rounded-[8px] bg-page px-2 py-1 opacity-70"
          >
            <option value="all">전체 시작</option>
            {startOptions.map((s) => (
              <option key={s} value={s}>
                {s} 시작
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onToggleMatrix}
            className="opacity-60 hover:opacity-100"
          >
            {matrixOpen ? "▾ 목록으로" : "▸ 표로 보기"}
          </button>
        </div>
      )}
      </div>

      {/* scroll: the table body scrolls under the fixed header (§shell) */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-4 pt-3">
        {isForward && matrixOpen && forwards ? (
          // wrap the 주요 포워드 block below the matrix rather than clipping it
          // off the right edge (§F); the matrix scrolls horizontally itself.
          <div>
            <div className="flex flex-wrap items-start gap-6">
              <ForwardMatrix payload={forwards} />
              <KeyForwardBlock payload={forwards} />
            </div>
            {/* what the 168 tinted cells mean (§E2) — same key as the heatmap */}
            <TintLegend className="mt-4" />
          </div>
        ) : (
          <table
            className="w-full text-[13px]"
            style={{ borderCollapse: "separate", borderSpacing: 0 }}
            onMouseLeave={() => onHover(null)}
          >
            <thead>
              {/* muting is a TEXT-colour alpha (text-ink/50), never element
                  opacity — opacity on the row would sink the sticky th
                  backgrounds and let rows bleed through (§G). A hairline (not a
                  shadow) marks the boundary. */}
              <tr className="text-left align-bottom text-ink/50">
                <th className="sticky top-0 z-10 border-b border-edge bg-tile pb-2 pl-3 font-normal">
                  종목
                </th>
                <th className="sticky top-0 z-10 border-b border-edge bg-tile pb-2 pr-3 text-right font-normal">
                  현재
                </th>
                {BASIS_ORDER.map((b) => (
                  <th
                    key={b}
                    className="sticky top-0 z-10 border-b border-edge bg-tile pb-2 pr-3 text-right font-normal"
                  >
                    <button
                      type="button"
                      onClick={() => clickSort(b)}
                      className="hover:text-ink"
                    >
                      {BASIS_HEAD[b]}
                      {sortCol === b ? (sortAsc ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
                <th className="sticky top-0 z-10 border-b border-edge bg-tile pb-2 pr-3 font-normal">
                  한 줄
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) =>
                it.row ? (
                  <TableRow
                    key={it.row.id}
                    row={it.row}
                    active={it.row.id === activeId}
                    pinned={it.row.id === pinnedId}
                    onHover={onHover}
                    onPin={onPin}
                  />
                ) : (
                  <tr key={`head-${i}`}>
                    <td
                      colSpan={8}
                      className="border-t-2 border-t-edge pb-1 pl-3 pt-4 text-[12px] font-semibold opacity-45"
                    >
                      {it.head}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
