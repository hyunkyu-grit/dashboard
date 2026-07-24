"use client";

/* Right preview pane (DESIGN §2). Responds to the active table row: an empty
 * sentence before anything is hovered; the series' 10y history (orange) with a
 * floating tooltip and a calendar heatmap below; a sentence for forwards /
 * volatility (no stage-2 history). Clicking the chart opens the enlarged view. */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchSeries } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";

import { CalendarHeatmap } from "./CalendarHeatmap";
import { ERROR_SENTENCE, LOADING_SENTENCE } from "./copy";
import { PreviewChart } from "./PreviewChart";
import type { Row } from "./rows";

const CHART_W = 460;
const CHART_H = 220;

function Sentence({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[320px] items-center justify-center px-8 text-center text-[15px] opacity-55">
      {children}
    </div>
  );
}

function Header({ row }: { row: Row }) {
  const level =
    row.now == null ? "–" : row.unit === "%" ? row.now.toFixed(4) : row.now.toFixed(1);
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[17px] font-semibold">{row.label}</span>
        <span className="text-[13px] opacity-45">{row.oneLiner}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-[28px] font-bold leading-none tabular-nums">
          {level}
        </span>
        <span className="text-[12px] opacity-45">{row.unit === "%" ? "%" : "bp"}</span>
        <span className={`text-[13px] tabular-nums ${dirClass(row.changes.d1)}`}>
          {fmtBp(row.changes.d1)}
        </span>
      </div>
    </div>
  );
}

export function PreviewPane({
  row,
  onOpen,
}: {
  row: Row | null;
  onOpen: (row: Row) => void;
}) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const { data, isError, isLoading } = useQuery({
    queryKey: ["series", row?.seriesId],
    queryFn: () => fetchSeries(row!.seriesId!),
    enabled: !!row?.seriesId,
    staleTime: 30_000,
  });

  if (!row) {
    return <Sentence>행을 올려두면 그래프가 나와요</Sentence>;
  }

  if (row.group === "vol") {
    return (
      <>
        <Header row={row} />
        <Sentence>변동성은 아직 준비 중이에요</Sentence>
      </>
    );
  }

  if (!row.seriesId) {
    // forwards: no stage-2 history
    return (
      <>
        <Header row={row} />
        <button
          type="button"
          onClick={() => onOpen(row)}
          className="flex h-[280px] w-full items-center justify-center rounded-[16px] px-8 text-center text-[15px] opacity-55 hover:bg-page"
        >
          포워드는 과거 흐름이 없어요. 눌러서 매트릭스를 볼 수 있어요
        </button>
      </>
    );
  }

  return (
    <>
      <Header row={row} />
      {isError && <Sentence>{ERROR_SENTENCE}</Sentence>}
      {isLoading && <Sentence>{LOADING_SENTENCE}</Sentence>}
      {data && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpen(row)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(row)}
          className="cursor-pointer"
        >
          <PreviewChart
            points={data.points}
            unit={row.unit}
            width={CHART_W}
            height={CHART_H}
            onHoverDate={setHoveredDate}
          />
          <div className="mt-3 overflow-x-auto">
            <CalendarHeatmap points={data.points} hoveredDate={hoveredDate} />
          </div>
          <p className="mt-2 text-[12px] opacity-40">눌러서 크게 볼 수 있어요</p>
        </div>
      )}
    </>
  );
}
