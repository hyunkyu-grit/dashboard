"use client";

/* Sauron — list-first shell (DESIGN §2). One screen, two panes: the instrument
 * table on the left, a sticky preview on the right that responds to it. URL
 * `?tile=…` opens the enlarged view. No navigation, no basis selector. */

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchForwards, fetchVolatility, fetchWallSummary } from "@/lib/api";
import { syncUiFromDom, useUiStore } from "@/state/ui";
import { CommandBar } from "@/wall/CommandBar";

import { ERROR_SENTENCE, LOADING_SENTENCE } from "./copy";
import { CurveView } from "./CurveView";
import { EnlargedView } from "./EnlargedView";
import { InstrumentTable } from "./InstrumentTable";
import { SHEET_SPRING } from "./motion";
import { PreviewPane } from "./PreviewPane";
import { buildRows, type Group, type Row } from "./rows";
import { useIsWide } from "./useIsWide";
import { useMeasure } from "./useMeasure";

// Table pane sizes to its columns (§ layout); the preview takes the rest with a
// floor. On an ultrawide the chart grows and the table does not stretch sparse.
const TABLE_W = 880;
const PANE_PAD = 40; // p-5 both sides

/** Single-column preview: a bottom sheet over the full-width table (§ layout).
 * Opened by a row click (pin), dismissed by Esc / backdrop / downward drag. */
function PreviewSheet({
  row,
  onOpen,
  onClose,
}: {
  row: Row;
  onOpen: (row: Row) => void;
  onClose: () => void;
}) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  return (
    <motion.div
      className="fixed inset-0 z-20 flex items-end justify-center bg-page/70"
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
          {w > 0 && <PreviewPane row={row} onOpen={onOpen} width={w} />}
        </div>
      </motion.div>
    </motion.div>
  );
}

function Header() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  // The title bar is the top of the one continuous surface (§ shell) — a
  // hairline separates it from the panes; no page-level sticky, no shadow.
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-edge px-5 py-3">
      <span className="text-[17px] font-bold text-brand">Sauron</span>
      <span className="text-[13px] opacity-45">KRW IRS</span>
      <span className="flex-1" />
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

  const { data: summary, isError } = useQuery({
    queryKey: ["wall-summary"],
    queryFn: fetchWallSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: forwards } = useQuery({
    queryKey: ["forwards"],
    queryFn: fetchForwards,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: volatility } = useQuery({
    queryKey: ["volatility"],
    queryFn: fetchVolatility,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [hovered, setHovered] = useState<Row | null>(null);
  const [pinned, setPinned] = useState<Row | null>(null);
  const [tab, setTab] = useState<Group | "all">("all");
  const [matrixOpenRaw, setMatrixOpenRaw] = useState(false);
  const active = hovered ?? pinned;
  // the 표로 보기 matrix is a full-width MODE, only on the forward tab (§F)
  const matrixOpen = matrixOpenRaw && tab === "forward";

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

  const openEnlarged = useCallback(
    (row: Row) => {
      const target = row.seriesId ? `series:${row.seriesId}` : row.id;
      router.push(`/?tile=${encodeURIComponent(target)}`, { scroll: false });
    },
    [router],
  );
  const closeEnlarged = useCallback(
    () => router.push("/", { scroll: false }),
    [router],
  );

  const enlargedRow = useMemo(() => {
    if (!tileParam) return null;
    if (tileParam.startsWith("series:")) {
      const sid = tileParam.slice("series:".length);
      return rows.find((r) => r.seriesId === sid) ?? null;
    }
    return rows.find((r) => r.id === tileParam) ?? null;
  }, [tileParam, rows]);

  const scrollTo = useCallback((el: HTMLElement) => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const wide = useIsWide();
  const [paneRef, paneW, paneH] = useMeasure<HTMLDivElement>();

  // Two panes: hover or pin drives the preview. Single column: only a click
  // (pin) opens the bottom sheet — there is no pane for a hover preview.
  const previewRow = wide ? active : null;

  return (
    <MotionConfig reducedMotion="user">
    {/* The page never scrolls; grey shows only as a thin margin around the one
        continuous surface that now spans the viewport (§ layout, Session 15). */}
    <div className="h-screen bg-page p-2">
      <div className="flex h-full flex-col overflow-hidden rounded-[16px] bg-tile">
        <Header />

        {isError && (
          <p className="p-10 text-center text-[15px] opacity-60">
            {ERROR_SENTENCE}
          </p>
        )}
        {!summary && !isError && (
          <p className="p-10 text-center text-[15px] opacity-50">
            {LOADING_SENTENCE}
          </p>
        )}
        {summary && (
          <div className="flex min-h-0 flex-1">
            {/* left pane: content-sized in two panes; full width in one column
                OR while the forward matrix mode is open (§F). */}
            <div
              className={`flex min-w-0 flex-col ${
                wide && !matrixOpen ? "shrink-0 border-r border-edge" : "flex-1"
              }`}
              style={wide && !matrixOpen ? { width: TABLE_W } : undefined}
            >
              <InstrumentTable
                rows={rows}
                forwards={forwards}
                filter={tab}
                onFilter={setTab}
                activeId={(wide ? active : pinned)?.id ?? null}
                pinnedId={pinned?.id ?? null}
                onHover={handleHover}
                onPin={setPinned}
                matrixOpen={matrixOpen}
                onToggleMatrix={() => setMatrixOpenRaw((v) => !v)}
              />
            </div>
            {/* right pane: hidden in one column and while the matrix mode is
                open; else takes the leftover width, floored at 600px, and the
                idle curve fills its full height (§ layout / §F). */}
            {wide && !matrixOpen && (
              <div
                ref={paneRef}
                className="min-w-[600px] flex-1 overflow-y-auto overflow-x-hidden p-5"
              >
                {paneW > 0 &&
                  (previewRow ? (
                    <PreviewPane
                      row={previewRow}
                      onOpen={openEnlarged}
                      width={paneW - PANE_PAD}
                    />
                  ) : (
                    <CurveView
                      tab={tab}
                      summary={summary}
                      forwards={forwards}
                      volatility={volatility}
                      width={paneW - PANE_PAD}
                      height={Math.max(300, paneH - PANE_PAD)}
                    />
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* single-column preview: a bottom sheet opened by a row click */}
      <AnimatePresence>
        {summary && !wide && pinned && (
          <PreviewSheet
            row={pinned}
            onOpen={openEnlarged}
            onClose={() => setPinned(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {enlargedRow && summary && (
          <EnlargedView
            row={enlargedRow}
            summary={summary}
            onClose={closeEnlarged}
          />
        )}
      </AnimatePresence>

      <CommandBar onJump={scrollTo} />
    </div>
    </MotionConfig>
  );
}
