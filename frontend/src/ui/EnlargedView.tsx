"use client";

/* Enlarged view (DESIGN §2). Full-screen sheet over the list: for a series,
 * the large lightweight-charts history (orange, assertDomainRendered) + a
 * six-basis segmented readout (the full ramp lives here) + the larger calendar
 * heatmap + a reserved-but-empty strategy region. For a forward, the forward
 * matrix instead. Esc / backdrop dismiss (drag added in Pass 4); wrapped in an
 * error boundary so a thrown guard shows a message, not a blank region. */

import { useQuery } from "@tanstack/react-query";
import { motion, type PanInfo } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { fetchSeries, type WallSummary } from "@/lib/api";
import { dirClass, fmtBp, fmtRate } from "@/lib/format";
import { BASIS_LABELS, TIME_BASES, type TimeBasis } from "@/theme/ramp";
import { DetailChart } from "@/wall/DetailChart";

import { CalendarHeatmap } from "./CalendarHeatmap";
import { ERROR_SENTENCE, VOL_PLACEHOLDER } from "./copy";
import { ErrorBoundary } from "./ErrorBoundary";
import { SHEET_SPRING } from "./motion";
import type { Row } from "./rows";

function SixBasisReadout({
  summary,
  seriesId,
}: {
  summary: WallSummary;
  seriesId: string;
}) {
  const [basis, setBasis] = useState<TimeBasis>("now");
  const s = useMemo(
    () =>
      [...summary.outrights, ...summary.derived].find((x) => x.id === seriesId),
    [summary, seriesId],
  );
  if (!s) return null;
  const level = basis === "now" ? s.now : s.basisValues[basis];
  const delta = basis === "now" ? 0 : s.deltas[basis];
  return (
    <div className="mt-3">
      <div className="flex overflow-hidden rounded-[8px] border border-edge text-[13px]">
        {TIME_BASES.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBasis(b)}
            className={
              b === basis
                ? "flex-1 bg-ink px-2 py-1 text-center text-page"
                : "flex-1 px-2 py-1 text-center opacity-50 hover:opacity-90"
            }
          >
            {BASIS_LABELS[b]}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-[15px] tabular-nums">
          {s.unit === "%" ? fmtRate(level) : `${level?.toFixed(1)}`}
          <span className="ml-1 text-[12px] opacity-45">
            {s.unit === "%" ? "%" : "bp"}
          </span>
        </span>
        {basis !== "now" && (
          <span className={`text-[13px] tabular-nums ${dirClass(delta)}`}>
            {fmtBp(delta)}
          </span>
        )}
      </div>
    </div>
  );
}

function StrategyRegion() {
  return (
    <div className="mt-6 flex h-40 items-center justify-center rounded-[16px] border border-dashed border-edge text-[13px] opacity-40">
      전략 도구가 이 자리에 들어올 예정이에요
    </div>
  );
}

function Body({ row, summary }: { row: Row; summary: WallSummary }) {
  const { data } = useQuery({
    queryKey: ["series", row.seriesId],
    queryFn: () => fetchSeries(row.seriesId!),
    enabled: !!row.seriesId,
    staleTime: 30_000,
  });

  if (!row.seriesId) {
    // only volatility has no stage-2 history now (forwards derive theirs)
    return (
      <p className="p-10 text-center text-[15px] opacity-55">
        {VOL_PLACEHOLDER}
      </p>
    );
  }

  return (
    <>
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-[17px] font-semibold">{row.label}</h2>
        <span className="text-[12px] opacity-45">지난 10년 흐름이에요</span>
      </div>
      <DetailChart id={row.seriesId} width={900} height={420} />
      <SixBasisReadout summary={summary} seriesId={row.seriesId} />
      {data && (
        <div className="mt-4 overflow-x-auto">
          <CalendarHeatmap points={data.points} hoveredDate={null} cell={16} gap={4} />
        </div>
      )}
      <StrategyRegion />
    </>
  );
}

export function EnlargedView({
  row,
  summary,
  onClose,
}: {
  row: Row;
  summary: WallSummary;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 500) onClose();
  };

  return (
    <motion.div
      className="fixed inset-0 z-30 flex items-end justify-center bg-page/70"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="max-h-[92vh] w-full max-w-[1000px] overflow-y-auto rounded-t-[20px] bg-popover p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={SHEET_SPRING}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={onDragEnd}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-edge" />
        <ErrorBoundary fallback={ERROR_SENTENCE}>
          <Body row={row} summary={summary} />
        </ErrorBoundary>
      </motion.div>
    </motion.div>
  );
}
