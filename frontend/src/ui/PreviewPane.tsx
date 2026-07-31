"use client";

/* Right preview pane (DESIGN §2). Responds to the active table row: an empty
 * sentence before anything is hovered; the series' 10y history (blue line) with a
 * floating tooltip and a calendar heatmap below; a sentence for forwards /
 * volatility (no stage-2 history). Clicking the chart opens the enlarged view. */

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";

import { fetchSeries, type PolicyStep } from "@/lib/api";
import { dirClass, fmtDelta, fmtLevel } from "@/lib/format";

import { AnimatedNumber } from "./AnimatedNumber";
import { ErrorState, LoadingState } from "./DataState";
import { PRESS_SCALE, SPRING } from "./motion";
import { PreviewChart } from "./PreviewChart";
import type { Row } from "./rows";

const CHART_H = 220;

function Sentence({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[320px] items-center justify-center px-8 text-center text-[15px] opacity-55">
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
      <div className="flex items-baseline">
        <span className="text-[17px] font-semibold">{row.label}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <AnimatedNumber
          value={fmtLevel(row.now, row.unit)}
          className="text-[28px] font-bold leading-none tabular-nums"
        />
        {UNIT_SUFFIX[row.unit] && (
          <span className="text-[12px] opacity-45">{UNIT_SUFFIX[row.unit]}</span>
        )}
        <span className={`text-[13px] tabular-nums ${dirClass(row.changes.d1)}`}>
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
  policy,
}: {
  row: Row | null;
  onOpen: (row: Row) => void;
  width: number;
  /** BOK base rate step — drawn on % instruments only (§policy). */
  policy?: PolicyStep;
}) {
  const { data, isError, isLoading, isFetching, refetch } = useQuery({
    // preview resolution: ~150 downsampled line points (§16); the enlarged view
    // fetches full resolution under a distinct key.
    queryKey: ["series", row?.seriesId, "preview"],
    queryFn: () => fetchSeries(row!.seriesId!, "preview"),
    enabled: !!row?.seriesId,
    staleTime: 30_000,
  });

  if (!row) {
    return <Sentence>행에 올려두면 그 종목 흐름이 나옵니다</Sentence>;
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
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <PreviewBody
            row={row}
            onOpen={onOpen}
            width={width}
            data={data}
            isError={isError}
            isLoading={isLoading}
            retrying={isFetching}
            onRetry={() => void refetch()}
            policy={policy}
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
  data,
  isError,
  isLoading,
  retrying,
  onRetry,
  policy,
}: {
  row: Row;
  onOpen: (row: Row) => void;
  width: number;
  policy?: PolicyStep;
  data: Awaited<ReturnType<typeof fetchSeries>> | undefined;
  isError: boolean;
  isLoading: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (!row.seriesId) {
    return (
      <>
        <Header row={row} />
        <Sentence>과거 흐름을 볼 수 없습니다</Sentence>
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
          onClick={() => onOpen(row)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(row)}
          whileTap={{ scale: PRESS_SCALE }}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...SPRING, duration: 0.18 }}
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
            height={CHART_H}
            policy={policy}
          />
          <p className="mt-2 text-[12px] opacity-40">눌러서 크게 볼 수 있습니다</p>
        </motion.div>
      )}
    </>
  );
}
