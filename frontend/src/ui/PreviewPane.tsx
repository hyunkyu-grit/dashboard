"use client";

/* Right preview pane (DESIGN §2). Responds to the active table row: an empty
 * sentence before anything is hovered; the series' 10y history (blue line) with a
 * floating tooltip and a calendar heatmap below; a sentence for forwards /
 * volatility (no stage-2 history). Clicking the chart opens the enlarged view. */

import { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { type PolicyStep } from "@/lib/api";
import { dirClass, fmtDelta, fmtLevel } from "@/lib/format";

import { useUiStore } from "@/state/ui";

import { AnimatedNumber } from "./AnimatedNumber";
import type { ChartType } from "./chartType";
import { ErrorState, LoadingState } from "./DataState";
import { ENTER, EXIT, instant, PRESS_SCALE } from "./motion";
import { PreviewChart } from "./PreviewChart";
import { useCdReference } from "./useCdReference";
import { type ChartSeries, useChartSeries } from "./useChartSeries";
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

function Header({ row }: { row: Row }) {
  return (
    <div className="mb-3">
      {/* the 한 줄 fragment that sat opposite the name is gone with the column
          (pass L); the pane's own readouts already carry the 52-week range */}
      {/* 크게 보기 IS GONE [OWNER, 2026-08-13 — "이제 그러면 크게보기탭을
          없애면 될 듯"]. It was the only way into the enlarged view, so the
          view goes with it. What that view still held that this pane did not
          is now here or beside it: candles are a GLOBAL chart type since
          2026-08-13 (`chartType.ts` — the popup used to be the only surface
          that knew them), the DV01 figure it printed is in the 세타 column's
          own tooltip, and its four-basis readout restates the table's own
          columns. `ui/EnlargedView.tsx` and `wall/DetailChart.tsx` stay ON
          DISK, unreferenced — this repo's restoration rule, and the same
          file's own history: it was kept unreferenced from 2026-07-31 to
          08-03 and came back whole rather than being rebuilt. */}
      <div className="flex items-baseline">
        <span className="text-[18px] font-semibold">{row.label}</span>
        <span className="flex-1" />
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
  width,
  height,
  policy,
}: {
  row: Row | null;
  onOpen: (row: Row, from?: string) => void;
  width: number;
  /** the pane's measured height; the chart takes what the header leaves */
  height: number;
  /** BOK base rate step — shared axis on %, own labelled % scale on bp,
   * absent on ratio (§policy). */
  policy?: PolicyStep;
}) {
  /* 차트 종류는 읽는 사람의 전역 설정이라 스토어에서 바로 온다 [OWNER,
   * 2026-08-13] — 테마와 같은 자리, 같은 길. 이 창을 여는 표도, 표를 여는
   * 셸도 차트 종류를 알 필요가 없다. */
  const chartType = useUiStore((s) => s.chartType);
  /* FULL resolution in line mode, never "preview": the ~150-point preview was
   * cut for a 220px thumbnail, and across a pane-width chart that is one point
   * per ~3.5 weeks — the line reads as a polygon and the crosshair cannot land
   * on a day. Candle mode takes the server's weekly/monthly bars instead. Both
   * answers live in `useChartSeries`, which the overview's three charts share,
   * so this pane and those cannot disagree about what a mode fetches. */
  const series = useChartSeries(row?.seriesId, chartType);
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
            width={width}
            series={series}
            chartType={chartType}
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
  width,
  series,
  chartType,
  policy,
  height,
}: {
  row: Row;
  onOpen: (row: Row, from?: string) => void;
  width: number;
  height: number;
  policy?: PolicyStep;
  series: ChartSeries;
  chartType: ChartType;
}) {
  const { points, bars, stats, isError, isLoading, isFetching, refetch } = series;
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
      <Header row={row} />
      {/* stage-2 detail: its own retry, so a failed series fetch does not
          require reloading the page or moving to another row and back
          (stability session, Pass B) */}
      {isError && (
        <ErrorState
          what="이 종목의 과거 흐름을"
          onRetry={refetch}
          retrying={isFetching}
        />
      )}
      {isLoading && <LoadingState />}
      {(points || bars) && (
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
            points={points}
            bars={bars}
            chartType={chartType}
            stats={stats}
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
