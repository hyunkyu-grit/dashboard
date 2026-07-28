"use client";

/* Left pane — the instrument table (DESIGN §2). Instrument · 현재 · five change
 * columns (red up / blue down + mini-bar) · 한 줄. Filter chips, sortable by
 * any change column, hover → preview, click → pin, Esc unpins (in App). Rows
 * self-register in the tile registry so the command bar can scroll to them. */

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";

import type { BasisKey, CurveBanner, ForwardsPayload } from "@/lib/api";
import { dirClass, fmtDelta, fmtLevel } from "@/lib/format";
import { ForwardMatrix, KeyForwardBlock } from "@/wall/ForwardMatrix";
import { getTile } from "@/wall/tileRegistry";
import { useRegisterTile } from "@/wall/useRegisterTile";

import { GRID_TEMPLATE } from "./columns";
import { reorderAnimates, rowShouldFlip, SPRING } from "./motion";
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
  flip,
  orderKey,
  enter,
}: {
  row: Row;
  active: boolean;
  pinned: boolean;
  onHover: (row: Row | null) => void;
  onPin: (row: Row) => void;
  /** FLIP this row on the next reorder (Pass C) — transform-only. */
  flip: boolean;
  /** reorder generation: layout is measured only when this changes. */
  orderKey: string;
  /** row entered the set via a screener toggle → fade in at destination. */
  enter: boolean;
}) {
  const registerRef = useRegisterTile(row.id, row.label, [
    row.label,
    row.label.replace(/\s/g, ""),
    row.id,
  ]);
  return (
    <motion.div
      role="row"
      ref={registerRef}
      layout={flip ? "position" : false}
      layoutDependency={orderKey}
      transition={SPRING}
      initial={enter ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      variants={{
        // exits fade in place (popLayout pops them out of the flow so the
        // survivors slide at the same time); the cause decides whether the
        // fade runs at all — a tab switch snaps.
        exit: (fade: boolean) => ({
          opacity: 0,
          transition: { duration: fade ? 0.14 : 0 },
        }),
      }}
      exit="exit"
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPin(row)}
      style={{ gridTemplateColumns: GRID_TEMPLATE }}
      className={`grid h-12 cursor-pointer items-center border-b border-edge ${
        active ? "bg-page" : "hover:bg-page/50"
      }`}
    >
      <div role="cell" className="relative pl-3 font-semibold">
        {pinned && (
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ink" />
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
      </div>
      {/* 현재 is a structural anchor: weight 600, tabular, ink (§5) */}
      <div role="cell" className="pr-3 text-right font-semibold tabular-nums text-ink">
        {levelText(row)}
      </div>
      {BASIS_ORDER.map((b) => (
        <div
          role="cell"
          key={b}
          // own-history outlier cue on the live 어제 column only (§B): an
          // outlier day gets a leading-edge rule (not a fill — a fill behind
          // the coloured number can't clear contrast). Number keeps full hue.
          style={
            b === "d1"
              ? columnCue(row.movePct, (row.changes.d1 ?? 0) > 0)
              : undefined
          }
          className={`self-stretch content-center pr-3 text-right tabular-nums ${dirClass(row.changes[b])}`}
        >
          {fmtDelta(row.changes[b], row.unit)}
        </div>
      ))}
      <div role="cell" className="truncate pr-3 text-[13px] opacity-55">
        {row.oneLiner}
      </div>
    </motion.div>
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Reorder snapshot (Pass C): captured in the EVENT HANDLER, before the
  // state update, so render stays pure (no ref/DOM reads during render —
  // compiler rule). Holds what caused the current arrangement (only sort and
  // screener animate; a tab / start-filter switch is a view change and
  // snaps), the pre-change row positions, and the viewport window.
  const [flipSnap, setFlipSnap] = useState<{
    cause: "sort" | "screener" | "other";
    scrollTop: number;
    viewH: number;
    tops: ReadonlyMap<string, number>;
  }>({ cause: "other", scrollTop: 0, viewH: 800, tops: new Map() });

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

  /** Event-time snapshot: old row tops (tile registry) + viewport window. */
  const snapReorder = (cause: "sort" | "screener" | "other") => {
    if (cause === "other") {
      setFlipSnap({ cause, scrollTop: 0, viewH: 800, tops: new Map() });
      return;
    }
    const tops = new Map<string, number>();
    for (const r of shown) {
      const el = getTile(r.id)?.el;
      if (el) tops.set(r.id, el.offsetTop);
    }
    const vp = scrollRef.current;
    setFlipSnap({
      cause,
      scrollTop: vp?.scrollTop ?? 0,
      viewH: vp?.clientHeight ?? 800,
      tops,
    });
  };

  const clickSort = (b: BasisKey) => {
    snapReorder("sort");
    if (sortCol !== b) {
      setSortCol(b);
      setSortAsc(false);
    } else if (!sortAsc) {
      setSortAsc(true);
    } else {
      setSortCol(null); // third click → back to instrument order
    }
  };

  // Reorder motion (Pass C): FLIP rows to their new positions on sort and on
  // screener filtering. Transform-only (layout="position"); measured only
  // when orderKey changes; culled to the viewport's neighbourhood; instant
  // above FLIP_MAX_ROWS and under prefers-reduced-motion (MotionConfig).
  const orderKey = `${sortCol ?? ""}|${sortAsc}|${screener ?? ""}`;
  const flipOn = reorderAnimates(flipSnap.cause, shown.length);
  const ROW_H = 48; // h-12 — used only to estimate a row's destination

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
              onClick={() => {
                snapReorder("other"); // view change — reorder snaps
                onFilter(f.id);
              }}
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

      {/* curve-level extreme, stated once (§I) — a fact about the whole curve,
          not any row, so the per-row percentile is suppressed on outrights. */}
      {curveBanner?.kind && (
        <p className="mt-2 text-[12px] text-up">
          {curveBanner.kind === "curve_high"
            ? "커브 전 구간이 52주 고점권입니다"
            : "커브 전 구간이 52주 저점권입니다"}
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
              onClick={() => {
                snapReorder("screener");
                setScreener(on ? null : sc.id);
              }}
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
            onChange={(e) => {
              snapReorder("other"); // view change — reorder snaps
              setStartFilter(e.target.value);
            }}
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

      {/* scroll: the table body scrolls under the fixed header (§shell).
          scrollbar-gutter keeps the usable width constant whether or not the
          scrollbar is present (§ Pass A) — without it the grid would shift on
          every filter that crosses the overflow boundary. */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-4 pt-3 [scrollbar-gutter:stable]"
      >
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
          <div
            role="table"
            className="w-full text-[13px]"
            onMouseLeave={() => onHover(null)}
          >
            {/* THE column grid (§ Pass A): one template, format-derived and
                frozen (columns.ts), shared by the header row and every body
                row — widths never depend on today's values or the open tab.
                Muting is a TEXT-colour alpha (text-ink/50), never element
                opacity — opacity on the row would sink the sticky header
                background and let rows bleed through (§G). A hairline (not a
                shadow) marks the boundary. */}
            <div
              role="row"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
              className="sticky top-0 z-10 grid items-end border-b border-edge bg-tile pb-2 text-left text-ink/50"
            >
              <div role="columnheader" className="pl-3">
                종목
              </div>
              <div role="columnheader" className="pr-3 text-right">
                현재
              </div>
              {BASIS_ORDER.map((b) => (
                <div key={b} role="columnheader" className="pr-3 text-right">
                  <button
                    type="button"
                    onClick={() => clickSort(b)}
                    className="hover:text-ink"
                  >
                    {BASIS_HEAD[b]}
                    {sortCol === b ? (sortAsc ? " ↑" : " ↓") : ""}
                  </button>
                </div>
              ))}
              <div role="columnheader" className="pr-3">
                한 줄
              </div>
            </div>
            {/* relative: popLayout pops exiting rows out of the flow so they
                fade in place while the survivors slide (Pass C). */}
            <div role="rowgroup" className="relative">
              <AnimatePresence
                initial={false}
                mode="popLayout"
                custom={flipOn && flipSnap.cause === "screener"}
              >
                {items.map((it, i) =>
                  it.row ? (
                    <TableRow
                      key={it.row.id}
                      row={it.row}
                      active={it.row.id === activeId}
                      pinned={it.row.id === pinnedId}
                      onHover={onHover}
                      onPin={onPin}
                      orderKey={orderKey}
                      flip={
                        flipOn &&
                        rowShouldFlip(
                          flipSnap.tops.get(it.row.id) ?? null,
                          i * ROW_H,
                          flipSnap.scrollTop,
                          flipSnap.viewH,
                        )
                      }
                      enter={flipOn && flipSnap.cause === "screener"}
                    />
                  ) : (
                    <div
                      role="row"
                      key={`head-${i}`}
                      className="border-t-2 border-t-edge pb-1 pl-3 pt-4 text-[12px] font-semibold opacity-45"
                    >
                      {it.head}
                    </div>
                  ),
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
