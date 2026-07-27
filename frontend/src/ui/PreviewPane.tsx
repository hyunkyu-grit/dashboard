"use client";

/* Right preview pane (DESIGN §2). Responds to the active table row: an empty
 * sentence before anything is hovered; the series' 10y history (orange) with a
 * floating tooltip and a calendar heatmap below; a sentence for forwards /
 * volatility (no stage-2 history). Clicking the chart opens the enlarged view. */

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";

import { fetchSeries } from "@/lib/api";
import { dirClass, fmtDelta, fmtLevel } from "@/lib/format";

import { AnimatedNumber } from "./AnimatedNumber";
import { ERROR_SENTENCE, LOADING_SENTENCE } from "./copy";
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
      <div className="flex items-baseline justify-between">
        <span className="text-[17px] font-semibold">{row.label}</span>
        <span className="text-[13px] opacity-45">{row.oneLiner}</span>
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
}: {
  row: Row | null;
  onOpen: (row: Row) => void;
  width: number;
}) {
  const { data, isError, isLoading } = useQuery({
    // preview resolution: ~150 downsampled line points (§16); the enlarged view
    // fetches full resolution under a distinct key.
    queryKey: ["series", row?.seriesId, "preview"],
    queryFn: () => fetchSeries(row!.seriesId!, "preview"),
    enabled: !!row?.seriesId,
    staleTime: 30_000,
  });

  if (!row) {
    return <Sentence>행을 올려두면 그래프가 나와요</Sentence>;
  }

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
      {isError && <Sentence>{ERROR_SENTENCE}</Sentence>}
      {isLoading && <Sentence>{LOADING_SENTENCE}</Sentence>}
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
          />
          <p className="mt-2 text-[12px] opacity-40">눌러서 크게 볼 수 있어요</p>
        </motion.div>
      )}
    </>
  );
}
