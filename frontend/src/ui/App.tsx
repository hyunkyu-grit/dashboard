"use client";

/* Sauron — list-first shell (DESIGN §2). One screen, two panes: the instrument
 * table on the left, a sticky preview on the right that responds to it. URL
 * `?tile=…` opens the enlarged view. No navigation, no basis selector. */

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EventCluster, PolicyStep } from "@/lib/api";
import {
  fetchForwards,
  fetchHealth,
  fetchVolatility,
  fetchWallSummary,
} from "@/lib/api";
import { syncUiFromDom, useUiStore } from "@/state/ui";
import { CommandBar } from "@/wall/CommandBar";
import { getTile } from "@/wall/tileRegistry";

import { ChangeLog } from "./ChangeLog";

import type { ChartType } from "@/wall/DetailChart";

import { mintBacktestKey } from "./backtestMemory";
import { BottomStrip, STRIP_H, useStripCollapsed } from "./BottomStrip";
import { CurveView } from "./CurveView";
import { ErrorState, LoadingState } from "./DataState";
import { EnlargedView } from "./EnlargedView";
import { ErrorBoundary } from "./ErrorBoundary";
import { classify } from "./gloss";
import { diagramSpec } from "./payReceiveModel";
import { BacktestWindow, BOOKABLE_GROUPS } from "./BacktestWindow";
import { InstrumentTable, type TabId } from "./InstrumentTable";
import { Z_MODAL } from "./layers";
import { SHEET_SPRING } from "./motion";
import { PreviewPane } from "./PreviewPane";
import { clearBtPatch, mergeQuery } from "./urlState";
import { PAGE_R, PAGE_X, PAGE_X_PX } from "./pageGutter";
import { buildRows, type Row } from "./rows";
import { useIsWide } from "./useIsWide";
import { useMeasure } from "./useMeasure";

// Table pane sizes to its columns (§ layout); the preview takes the rest with a
// floor. On an ultrawide the chart grows and the table does not stretch sparse.
const TABLE_W = 880;

/** Resolve a URL target (`series:<id>` or a row id) to its row — the one
 * grammar `tile` and `bti` share. Null until the row set can answer. */
function rowForTarget(rows: Row[], target: string | null): Row | null {
  if (!target) return null;
  if (target.startsWith("series:")) {
    const sid = target.slice("series:".length);
    return rows.find((r) => r.seriesId === sid) ?? null;
  }
  return rows.find((r) => r.id === target) ?? null;
}
// the preview pane's horizontal padding, subtracted from its measured width
// to size the chart: the page gutter on the window side, 20px on the divider
// side (that edge is interior, and the divider already separates the panes)
const PANE_PAD = PAGE_X_PX + 20;

/** Single-column preview: a bottom sheet over the full-width table (§ layout).
 * Opened by a row click (pin), dismissed by Esc / backdrop / downward drag. */
function PreviewSheet({
  row,
  onOpen,
  onEnlarge,
  onClose,
  policy,
}: {
  row: Row;
  onOpen: (row: Row) => void;
  onEnlarge: (row: Row) => void;
  onClose: () => void;
  policy?: PolicyStep;
}) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  return (
    <motion.div
      className={`fixed inset-0 ${Z_MODAL} flex items-end justify-center bg-page/70`}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-[20px] bg-popover p-5"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={SHEET_SPRING}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) onClose();
        }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-edge" />
        <div ref={ref}>
          {w > 0 && (
            <PreviewPane
              row={row}
              onOpen={onOpen}
              onEnlarge={onEnlarge}
              width={w}
              // the sheet is capped at 85vh; the chart takes a readable slice of it
              height={Math.round(window.innerHeight * 0.5)}
              policy={policy}
            />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Dataset freshness in the chrome (§ Pass C). The file is static, so without
 * this the product shows yesterday's curve as today's silently. Loudness scales
 * with age (KR business days): same-day is quiet (just the date), one day behind
 * is a visible chip, more than that is a red-outlined chip that says so in
 * words. Monochrome-first: the border + weight + words carry the meaning; the
 * red is a layer (§5). Polls so the age advances even on a long-lived tab. */
function DataFreshness() {
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const f = data?.freshness;
  if (!f) return null;

  const asOf = `${f.asOf} 기준`;
  const title = `데이터 최신일 ${f.asOf} · 오늘 ${f.today} · ${f.ageBusinessDays}영업일 경과`;

  if (f.level === "stale") {
    return (
      <span
        title={title}
        className="rounded-[8px] border border-up px-2 py-0.5 text-[12px] font-semibold text-up"
      >
        데이터 {f.ageBusinessDays}영업일 지연 — 최신 커브가 아닐 수 있습니다 · {f.asOf}
      </span>
    );
  }
  if (f.level === "behind") {
    return (
      <span
        title={title}
        className="rounded-[8px] border border-edge px-2 py-0.5 text-[12px] text-ink"
      >
        {asOf} · {f.ageBusinessDays}영업일 지연
      </span>
    );
  }
  return (
    <span title={title} className="text-[12px] opacity-45">
      {asOf}
    </span>
  );
}

function Header({
  events,
  onFocus,
}: {
  events: EventCluster[];
  onFocus: (id: string) => void;
}) {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  // Full-bleed chrome band (§H, Session 16): full window width, its own band at
  // the top, an opaque bg + a hairline along the bottom and nothing else — no
  // card, no radius. It is chrome, not content.
  return (
    <header
      className={`flex shrink-0 items-center gap-3 border-b border-edge bg-tile py-3 ${PAGE_X}`}
    >
      <span className="text-[17px] font-bold text-ink">Sauron</span>
      <span className="text-[13px] opacity-45">KRW IRS</span>
      <span className="flex-1" />
      <ChangeLog events={events} onFocus={onFocus} />
      <DataFreshness />
      <button
        type="button"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="rounded-[8px] px-2 py-0.5 text-[13px] opacity-60 hover:opacity-100"
      >
        {theme === "dark" ? "밝게" : "어둡게"}
      </button>
    </header>
  );
}

export function App() {
  const router = useRouter();
  const params = useSearchParams();
  const tileParam = params.get("tile");

  const {
    data: summary,
    isError,
    isFetching: summaryFetching,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["wall-summary"],
    queryFn: fetchWallSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: forwards, isPending: forwardsPending } = useQuery({
    queryKey: ["forwards"],
    queryFn: fetchForwards,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: volatility, isPending: volatilityPending } = useQuery({
    queryKey: ["volatility"],
    queryFn: fetchVolatility,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  /* The row set is only COMPLETE once all three payloads have settled — the
   * summary alone contributes outrights and spreads, forwards and volatility
   * contribute the rest. Anything that asks "is this id unknown?" has to wait
   * for this, not merely for the first rows to appear. Settled, not
   * successful: if one payload fails outright, its rows are never coming and
   * waiting forever would be worse than answering with what arrived. */
  const rowsComplete = !forwardsPending && !volatilityPending && !!summary;

  const [hovered, setHovered] = useState<Row | null>(null);
  const [pinned, setPinned] = useState<Row | null>(null);
  const [stripCollapsed, setStripCollapsed] = useStripCollapsed();
  const [tab, setTab] = useState<TabId>("all");
  const [matrixOpenRaw, setMatrixOpenRaw] = useState(false);
  const active = hovered ?? pinned;
  // the 표로 보기 matrix is a full-width MODE, only on the forward tab (§F)
  const matrixOpen = matrixOpenRaw && tab === "forward";
  /* 전체 is the three-column overview and takes the full surface (§전체): it
   * carries its own chart per column, so the shared preview pane beside it
   * would be a fourth chart answering a question nobody asked, in space the
   * three columns need. Same mechanism as the matrix mode — one flag that
   * both widens the left pane and hides the right one, so the two can never
   * disagree about who owns the width. */
  const fullWidth = matrixOpen || tab === "all";

  // ~120ms hover delay so crossing the table does not strobe the preview (§2).
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handleHover = useCallback((row: Row | null) => {
    clearTimeout(hoverTimer.current);
    if (row) hoverTimer.current = setTimeout(() => setHovered(row), 120);
    else setHovered(null);
  }, []);

  const rows = useMemo(
    () => (summary ? buildRows(summary, forwards, volatility) : []),
    [summary, forwards, volatility],
  );

  // Clear the pin on a tab change (§I): a pinned row from another tab shown
  // silently in the preview is the defect; dropping it is the simplest cure
  // (recorded under DESIGN ## Provisional).
  const onTab = useCallback((t: TabId) => {
    setTab(t);
    setPinned(null);
    setHovered(null);
  }, []);

  const wide = useIsWide();

  useEffect(() => {
    syncUiFromDom();
  }, []);

  // Esc unpins (and the enlarged view closes itself on Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !tileParam) setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tileParam]);

  /* THE BACKTEST WINDOW IS PARALLEL, NOT A PAGE (backtest-window session).
   * Its namespace — `bt` (instance nonce, pass Q), `bti` (seed instrument),
   * `btf` (the date under the cursor when the chart was clicked [OWNER:
   * "커서가 가는 곳에서 누르면 그 날부터 스타트해야지"]) — rides the URL so a
   * shared link restores the window, but open/close REPLACE the current
   * history entry rather than pushing one: a floating window is not a place
   * you navigate to, and back/forward should walk tab/tile state UNDER it
   * without ever closing it or wiping its inputs. Every write goes through
   * `mergeQuery`, so the `tile` namespace is carried untouched — and vice
   * versa. This is the structural fix for the back-wipes-the-popup class;
   * pass Q's nonce + session memory still carry the contents. Opening while
   * a window is already open REPLACES it (one instance — presence IS the
   * `bt` param); the new nonce seeds fresh, the position stays where the
   * reader put it (floatingWindow.ts). */
  const openBacktest = useCallback(
    (row: Row, from?: string) => {
      const target = row.seriesId ? `series:${row.seriesId}` : row.id;
      router.replace(
        `/${mergeQuery(params, {
          bt: mintBacktestKey(),
          bti: target,
          btf: from ?? null,
        })}`,
        { scroll: false },
      );
    },
    [router, params],
  );
  const closeBacktest = useCallback(() => {
    router.replace(`/${mergeQuery(params, clearBtPatch())}`, { scroll: false });
  }, [router, params]);

  /* The ENLARGED VIEW (?tile) is a page-like modal again — the backtest no
   * longer squats on its slot. Open PUSHES (a view you navigate into), so
   * CLOSE IS BACK (pass Q's rule, unchanged): one step, one meaning, no
   * popup residue in the stack. A cold link replaces instead of backing out
   * of the site. `type` (선/주봉/월봉) rides beside it; both writes preserve
   * the bt namespace through `mergeQuery`, so navigating the enlarged view
   * never touches the backtest window. */
  const pushedTile = useRef(false);
  const openEnlarged = useCallback(
    (row: Row) => {
      const target = row.seriesId ? `series:${row.seriesId}` : row.id;
      pushedTile.current = true;
      router.push(`/${mergeQuery(params, { tile: target })}`, { scroll: false });
    },
    [router, params],
  );
  const closeEnlarged = useCallback(() => {
    if (pushedTile.current) {
      pushedTile.current = false;
      router.back();
    } else {
      router.replace(`/${mergeQuery(params, { tile: null, type: null })}`, {
        scroll: false,
      });
    }
  }, [router, params]);

  const typeParam = params.get("type");
  const chartType: ChartType =
    typeParam === "w" || typeParam === "m" ? typeParam : "line";
  const onChartType = useCallback(
    (t: ChartType) => {
      router.replace(
        `/${mergeQuery(params, { type: t === "line" ? null : t })}`,
        { scroll: false },
      );
    },
    [router, params],
  );

  /* An unknown `?tile=` used to render the ordinary screen with the bogus
   * parameter still in the URL, no sheet and no message (Pass A finding).
   * Now the id is cleared and named. The notice is derived from the URL
   * rather than held in state — a `setState` inside the clearing effect is
   * what the compiler lint rejects, and the URL is the honest home for it. */
  const missingTile = params.get("missing");

  const enlargedRow = useMemo(
    () => rowForTarget(rows, tileParam),
    [tileParam, rows],
  );

  /* The backtest window: presence IS the `bt` nonce; `bti` names its seed
   * instrument in the same target grammar `tile` uses. */
  const btKey = params.get("bt");
  const btiParam = params.get("bti");
  const btRow = useMemo(
    () => (btKey ? rowForTarget(rows, btiParam) : null),
    [btKey, btiParam, rows],
  );

  /* A `bt` whose seed instrument names nothing (a stale link) is cleared and
   * said — the tile-missing rule, applied to the other namespace. Waits for
   * the COMPLETE row set for the same reason. */
  useEffect(() => {
    if (!btKey || !rowsComplete || btRow) return;
    router.replace(
      `/${mergeQuery(params, {
        ...clearBtPatch(),
        missing: btiParam ?? btKey,
      })}`,
      { scroll: false },
    );
  }, [btKey, btiParam, rowsComplete, btRow, router, params]);

  /* Clear a `?tile=` that names nothing — but only once the row set is
   * COMPLETE.
   *
   * This was guarded on `rows.length === 0`, which is not the same thing and
   * the difference shipped a bug: the summary lands first and contributes only
   * outrights and spreads, so for the window between it and the forwards /
   * volatility payloads, `rows` is non-empty while every forward and vol id in
   * it is still "unknown". A cold shared link to one of those cleared itself.
   * Found by walking the built site (Pass H): `?tile=series:vol:10Y` opened
   * cold landed on `?missing=` every time. */
  useEffect(() => {
    if (!tileParam || !rowsComplete || enlargedRow) return;
    // strip ONLY the tile namespace — an open backtest window survives a
    // stale tile link (mergeQuery carries `bt` and friends forward)
    router.replace(
      `/${mergeQuery(params, { tile: null, type: null, missing: tileParam })}`,
      { scroll: false },
    );
  }, [tileParam, rowsComplete, enlargedRow, router, params]);

  const scrollTo = useCallback((el: HTMLElement) => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Change-log line → focus (§3/§12): switch to the instrument's OWN group tab
  // (전체 lists spreads/flies far down; its own tab puts it up top), pin it (the
  // preview / bottom sheet follows), and pan the table to it. The pan is a
  // double-rAF after the state updates so the tab switch has committed and the
  // target row has laid out + registered its tile element (§3).
  const focusFromChangeLog = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      setTab(row.group);
      setPinned(row);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          getTile(id)?.el.scrollIntoView({ behavior: "smooth", block: "center" }),
        ),
      );
    },
    [rows],
  );

  const [paneRef, paneW, paneH] = useMeasure<HTMLDivElement>();

  // Two panes: hover or pin drives the preview. Single column: only a click
  // (pin) opens the bottom sheet — there is no pane for a hover preview.
  const previewRow = wide ? active : null;

  // the pinned instrument's curve MODE for the pane's corner label (Pass A);
  // null for volatility, which makes no curve statement.
  const pinnedMode = pinned
    ? (diagramSpec(classify(pinned), "pay")?.term ?? null)
    : null;

  return (
    <MotionConfig reducedMotion="user">
    {/* Full-bleed (§H, Session 16): the surface fills the window edge to edge —
        no outer card, no radius, no page-coloured gutter. The window edge is the
        boundary; structure comes from the header hairline, the pane divider, and
        the row hairlines. Card radius survives only where something floats (the
        popup + the chart tooltip). */}
    {/* the app root pads by the strip's height (strip session, Pass C): the
        strip is fixed chrome, so padding the border-box root shortens every
        pane and scroll container inside it at once — the last row is never
        underneath the strip, collapsed or expanded. */}
    <div
      className="flex h-screen flex-col overflow-hidden bg-tile"
      style={{ paddingBottom: stripCollapsed ? STRIP_H.collapsed : STRIP_H.open }}
    >
        <Header events={summary?.events ?? []} onFocus={focusFromChangeLog} />

        {/* A failure must LOOK different from a wait, and carry a way out
            (stability session, Pass B). Before this, both rendered the same
            sentence and the failure never arrived at all — the screen said
            "loading" indefinitely with the backend down. The retry does not
            wait for the fetch layer's retry budget: it is a button. */}
        {!summary && isError && (
          <ErrorState
            what="커브를"
            onRetry={() => void refetchSummary()}
            retrying={summaryFetching}
          />
        )}
        {!summary && !isError && <LoadingState />}
        {/* an unknown ?tile= id: the parameter is cleared and said, rather
            than leaving a bogus URL rendering nothing (Pass B) */}
        {missingTile && (
          <p className={`pb-2 text-center text-[12px] opacity-55 ${PAGE_X}`}>
            {missingTile} 종목을 찾지 못해 닫았어요
          </p>
        )}
        {summary && (
          <div className="flex min-h-0 flex-1">
            {/* left pane: content-sized in two panes; full width in one column
                OR while the forward matrix mode is open (§F). */}
            <div
              className={`flex min-w-0 flex-col ${
                wide && !fullWidth ? "shrink-0 border-r border-edge" : "flex-1"
              }`}
              style={wide && !fullWidth ? { width: TABLE_W } : undefined}
            >
              {/* Each region gets its OWN boundary (stability session, Pass B).
                  A throw anywhere under the root used to unmount the whole
                  tree and leave a white page — one bad row killed the strip,
                  the preview and the header with it. Bounded here, a failing
                  table leaves the rest of the screen usable. */}
              <ErrorBoundary region="table" fallback="표를 그리지 못했어요">
                <InstrumentTable
                  rows={rows}
                  asOf={summary.asof}
                  forwards={forwards}
                  curveBanner={summary.curveBanner}
                  filter={tab}
                  onFilter={onTab}
                  activeId={(wide ? active : pinned)?.id ?? null}
                  pinnedId={pinned?.id ?? null}
                  onHover={handleHover}
                  onPin={setPinned}
                  matrixOpen={matrixOpen}
                  onToggleMatrix={() => setMatrixOpenRaw((v) => !v)}
                  policy={summary.policy}
                  regret={summary.regret ?? []}
                  onLabFocus={focusFromChangeLog}
                />
              </ErrorBoundary>
            </div>
            {/* right pane: hidden in one column and while the matrix mode is
                open; else takes the leftover width, floored at 600px, and the
                idle curve fills its full height (§ layout / §F). */}
            {wide && !fullWidth && (
              <div
                ref={paneRef}
                className={`relative min-w-[600px] flex-1 overflow-y-auto overflow-x-hidden py-5 pl-5 ${PAGE_R}`}
              >
                <ErrorBoundary region="pane" fallback="이 화면을 그리지 못했어요">
                  {paneW > 0 &&
                    (previewRow ? (
                      <PreviewPane
                        row={previewRow}
                        onOpen={openBacktest}
                        onEnlarge={openEnlarged}
                        width={paneW - PANE_PAD}
                        height={Math.max(360, paneH - PANE_PAD)}
                        policy={summary.policy}
                      />
                    ) : (
                      <CurveView
                        summary={summary}
                        width={paneW - PANE_PAD}
                        height={Math.max(300, paneH - PANE_PAD)}
                      />
                    ))}
                </ErrorBoundary>
                {/* what is selected, stated in the pane's corner (strip
                    session, Pass A — all that survives of the removed pin
                    gesture): the pinned instrument and its curve MODE, e.g.
                    `3Mx2Y · 스티프닝`. Sticky so it stays in the corner while
                    the pane scrolls; nothing animates. */}
                {pinned && (
                  // §G: a sticky element carries an opaque bg and mutes via a
                  // TEXT alpha (text-ink/45), never element opacity — opacity
                  // would sink the bg and let the chart bleed through it.
                  <div className="pointer-events-none sticky bottom-0 -mb-2 bg-tile pt-1 text-[11px] text-ink/45">
                    {pinned.label}
                    {pinnedMode ? ` · ${pinnedMode}` : ""}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      {/* single-column preview: a bottom sheet opened by a row click */}
      <AnimatePresence>
        {summary && !wide && pinned && (
          <PreviewSheet
            row={pinned}
            onOpen={openBacktest}
            onEnlarge={openEnlarged}
            onClose={() => setPinned(null)}
            policy={summary.policy}
          />
        )}
      </AnimatePresence>

      {/* the enlarged view (?tile) — a modal over everything, including the
          floating window; closing it leaves the window exactly as it was */}
      <AnimatePresence>
        {enlargedRow && summary && (
          <ErrorBoundary
            key="enlarged"
            region="popup"
            fallback="큰 화면을 그리지 못했어요"
          >
            <EnlargedView
              row={enlargedRow}
              summary={summary}
              chartType={chartType}
              onChartType={onChartType}
              onClose={closeEnlarged}
            />
          </ErrorBoundary>
        )}
      </AnimatePresence>

      {/* the floating backtest window (?bt) — parallel to everything above:
          tabs, pins and the enlarged view all keep working underneath it.
          Keyed by the instance nonce so REPLACING (a new chart click while
          one is open) remounts and re-seeds; the window boundaries its own
          body, this covers the shell. */}
      <AnimatePresence>
        {btKey && btRow && summary && (
          <ErrorBoundary
            key={btKey}
            region="popup"
            fallback="백테스트 화면을 그리지 못했어요"
          >
            <BacktestWindow
              row={btRow}
              rows={rows}
              asOf={summary.asof}
              entryFrom={params.get("btf") ?? undefined}
              memoryKey={btKey}
              /* only BOOKABLE pins are captured [V-PASS V5]: a pinned
                 forward or 변동성 row slipped past the dropdown's filter
                 into the book and 422'd two clicks later at 실행. Filtered
                 at the source — the window's capture effect cannot grow a
                 branch around its setState (compiler lint). */
              captured={
                pinned && BOOKABLE_GROUPS.includes(pinned.group)
                  ? pinned
                  : null
              }
              policy={summary.policy}
              onClose={closeBacktest}
            />
          </ErrorBoundary>
        )}
      </AnimatePresence>

      <CommandBar onJump={scrollTo} />

      {/* anchors + the next policy meeting, on every tab and in both layouts
          (strip session, Pass C). Chrome: fixed above the card, never
          scrolling with content. */}
      {summary && (
        <ErrorBoundary region="strip" compact fallback="지표 바를 그리지 못했어요">
          <BottomStrip
            rows={rows}
            onPin={setPinned}
            collapsed={stripCollapsed}
            onCollapsed={setStripCollapsed}
          />
        </ErrorBoundary>
      )}
    </div>
    </MotionConfig>
  );
}
