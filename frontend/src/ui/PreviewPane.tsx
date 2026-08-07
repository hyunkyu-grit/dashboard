"use client";

/* Right preview pane (DESIGN §2). Responds to the active table row: an empty
 * sentence before anything is hovered; the series' 10y history (blue line) with a
 * floating tooltip and a calendar heatmap below; a sentence for forwards /
 * volatility (no stage-2 history). Clicking the chart opens the enlarged view. */

import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { fetchSeries, type PolicyStep } from "@/lib/api";
import { dirClass, fmtDelta, fmtLevel } from "@/lib/format";

import { AnimatedNumber } from "./AnimatedNumber";
import { ErrorState, LoadingState } from "./DataState";
import { ENTER, EXIT, instant, PRESS_SCALE } from "./motion";
import { PreviewChart } from "./PreviewChart";
import { useCdReference } from "./useCdReference";
import type { Row } from "./rows";

/* The hover chart is now PANE-SIZED, not a thumbnail [OWNER, 2026-07-31 —
 * "바로 보이는 커브를 내가 클릭했을 때의 커브 크기로... 조금 더 자세하고 세로로
 * 길게"]. It was a fixed 220px under a pane that is ~800px tall, so most of the
 * right-hand side was empty and the only way to see the series properly was to
 * open the popup — which is the thing the click is being repurposed for.
 *
 * `CHART_MIN_H` is the floor for a short window; the real height comes from the
 * measured pane (App passes it), less the header block above the chart. */
const CHART_MIN_H = 320;
const HEADER_H = 96; // name + level + delta, and the caption under the chart

function Sentence({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[320px] items-center justify-center px-8 text-center text-[16px] opacity-55">
      {children}
    </div>
  );
}

// dimensionless ratio carries no unit suffix (§ vol); % and bp keep theirs.
const UNIT_SUFFIX: Record<Row["unit"], string> = { "%": "%", bp: "bp", ratio: "" };

function Header({
  row,
  onEnlarge,
}: {
  row: Row;
  /** opens the enlarged view (?tile) — absent for rows with no history */
  onEnlarge?: (row: Row) => void;
}) {
  return (
    <div className="mb-3">
      {/* the 한 줄 fragment that sat opposite the name is gone with the column
          (pass L); the pane's own readouts already carry the 52-week range */}
      <div className="flex items-baseline">
        <span className="text-[18px] font-semibold">{row.label}</span>
        <span className="flex-1" />
        {/* the enlarged view's way in (backtest-window session): the CHART
            click belongs to the backtest [OWNER], so the bigger view gets a
            named, quiet control instead of a gesture. */}
        {onEnlarge && (
          <button
            type="button"
            onClick={() => onEnlarge(row)}
            className="text-[13px] opacity-50 hover:opacity-100"
          >
            크게 보기
          </button>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <AnimatedNumber
          value={fmtLevel(row.now, row.unit)}
          className="text-[28px] font-bold leading-none tabular-nums"
        />
        {UNIT_SUFFIX[row.unit] && (
          <span className="text-[13px] opacity-45">{UNIT_SUFFIX[row.unit]}</span>
        )}
        <span className={`text-[14px] tabular-nums ${dirClass(row.changes.d1)}`}>
          {fmtDelta(row.changes.d1, row.unit)}
        </span>
      </div>
    </div>
  );
}

export function PreviewPane({
  row,
  onOpen,
  onEnlarge,
  width,
  height,
  policy,
}: {
  row: Row | null;
  onOpen: (row: Row, from?: string) => void;
  /** opens the enlarged view (?tile) — the 크게 보기 control in the header */
  onEnlarge: (row: Row) => void;
  width: number;
  /** the pane's measured height; the chart takes what the header leaves */
  height: number;
  /** BOK base rate step — shared axis on %, own labelled % scale on bp,
   * absent on ratio (§policy). */
  policy?: PolicyStep;
}) {
  const { data, isError, isLoading, isFetching, refetch } = useQuery({
    // preview resolution: ~150 downsampled line points (§16); the enlarged view
    // fetches full resolution under a distinct key.
    /* FULL resolution, not "preview". The ~150-point preview was cut for a
     * 220px thumbnail; across a pane-width chart that is one point per ~3.5
     * weeks and the line reads as a polygon. react-query caches per id, so
     * re-hovering a row costs nothing after the first look. */
    queryKey: ["series", row?.seriesId, "full"],
    queryFn: () => fetchSeries(row!.seriesId!, "full"),
    enabled: !!row?.seriesId,
    staleTime: 30_000,
  });
  // hooks run before any early return
  const reduced = useReducedMotion() === true;

  if (!row) {
    return <Sentence>행에 올려두면 그 종목 흐름이 나와요</Sentence>;
  }

  /* Cross-fade on a series switch (motion session, Pass D): moving between
   * rows is the most frequent action in the product and it hard-swapped.
   * popLayout pops the outgoing pane out of the flow so the incoming one
   * takes its place immediately — old fades out over new fading in. */
  return (
    <div className="relative">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={row.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: instant(EXIT, reduced) }}
          transition={instant(ENTER, reduced)}
        >
          <PreviewBody
            row={row}
            onOpen={onOpen}
            onEnlarge={onEnlarge}
            width={width}
            data={data}
            isError={isError}
            isLoading={isLoading}
            retrying={isFetching}
            onRetry={() => void refetch()}
            policy={policy}
            height={height}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function PreviewBody({
  row,
  onOpen,
  onEnlarge,
  width,
  data,
  isError,
  isLoading,
  retrying,
  onRetry,
  policy,
  height,
}: {
  row: Row;
  onOpen: (row: Row, from?: string) => void;
  onEnlarge: (row: Row) => void;
  width: number;
  height: number;
  policy?: PolicyStep;
  data: Awaited<ReturnType<typeof fetchSeries>> | undefined;
  isError: boolean;
  isLoading: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  // hooks run before any early return
  const reduced = useReducedMotion() === true;
  const cd = useCdReference(row.unit, row.seriesId);
  /* The date under the cursor when the chart is clicked. A ref, not state:
   * nothing renders from it, and re-rendering the chart on every mouse move
   * would fight the crosshair it already draws. */
  const hoveredDate = useRef<string | null>(null);
  if (!row.seriesId) {
    return (
      <>
        <Header row={row} />
        <Sentence>과거 흐름을 볼 수 없어요</Sentence>
      </>
    );
  }

  return (
    <>
      <Header row={row} onEnlarge={onEnlarge} />
      {/* stage-2 detail: its own retry, so a failed series fetch does not
          require reloading the page or moving to another row and back
          (stability session, Pass B) */}
      {isError && (
        <ErrorState
          what="이 종목의 과거 흐름을"
          onRetry={onRetry}
          retrying={retrying}
        />
      )}
      {isLoading && <LoadingState />}
      {data && (
        <motion.div
          key={row.seriesId}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(row, hoveredDate.current ?? undefined)}
          onKeyDown={(e) =>
            (e.key === "Enter" || e.key === " ") && onOpen(row)
          }
          whileTap={{ scale: PRESS_SCALE }}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          /* Was `{...SPRING, duration: 0.18}`, and the duration was DEAD:
             motion's getSpringOptions resolves stiffness/damping ahead of
             duration/bounce, so the documented "~180ms" never existed — the
             spring physics ran. It is ENTER now: this stopped being the
             signature moment when the owner moved that to the row reorder
             [2026-08-06], and a chart block appearing from nothing is exactly
             the case where an overshoot has no object to track. */
          transition={instant(ENTER, reduced)}
          className="cursor-pointer"
        >
          {/* the chart hover tooltip is the sole readout for a hovered date
              (§I) — the daily-change heatmap was removed: it plotted the slope
              of the line above it, and volatility clustering is now answered
              numerically by the relative-ATR series. */}
          <PreviewChart
            points={data.points}
            stats={data.stats}
            unit={row.unit}
            width={width}
            height={Math.max(CHART_MIN_H, height - HEADER_H)}
            policy={policy}
            cd={cd}
            onHoverDate={(d) => {
              hoveredDate.current = d;
            }}
          />
          {/* the click's real destination (pass Q): it has opened the
              BACKTEST since the enlarged view was replaced, and this caption
              still promised "크게 볼 수 있습니다" — a claim about a view that
              no longer opens. The date under the cursor becomes the entry
              date, which is the half worth saying. */}
          <p className="mt-2 text-[13px] opacity-40">
            누르면 커서 날짜부터 백테스트가 열려요
          </p>
        </motion.div>
      )}
    </>
  );
}
