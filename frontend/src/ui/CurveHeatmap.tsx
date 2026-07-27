"use client";

/* Tenor × date heatmap (DESIGN §D, Session 16). Popup only. This is NOT the
 * removed preview heatmap (which plotted daily change = the slope of the line
 * above it); this shows the whole CURVE over time, which a single line cannot:
 * a column one colour top-to-bottom is a parallel shift, colour concentrated at
 * the top is a front-end-led move, a light middle with dark ends is a fly move.
 *
 * Rows are the 10 curve nodes (short at top, long at bottom); columns are date
 * buckets across the 10y window (sized so cells stay ≥ ~8px). Contiguous cells,
 * no gaps, radius only on the block's outer corners; below the intensity floor
 * a cell is untinted (that is what lets the shape emerge). Own-history tint,
 * the same scale as the forward matrix (§J). It shows the curve, not the
 * popup's instrument — labelled so. */

import { useQuery } from "@tanstack/react-query";

import { fetchCurveHeatmap } from "@/lib/api";

import { matrixTint } from "./tint";

export function CurveHeatmap({
  width,
  visibleRange,
  hoveredDate,
}: {
  width: number;
  // §C: the chart's visible [from,to] date window and crosshair date, so the
  // heatmap shares the chart's x-axis and marks the hovered column.
  visibleRange?: [string, string] | null;
  hoveredDate?: string | null;
}) {
  const { data } = useQuery({
    queryKey: ["curve-heatmap"],
    queryFn: fetchCurveHeatmap,
    staleTime: 60_000,
  });
  if (!data) return null;

  const nNodes = data.nodes.length;
  const LABEL_W = 42;
  const gridW = Math.max(0, width - LABEL_W);
  const rowH = 12;

  // bind the x-domain to the chart's visible range: show only the buckets in
  // view, stretched to fill the width (fewer columns when zoomed → wider cells,
  // so cells stay ≥8px; the 110-bucket full range is already ~8px, §C).
  const cols = data.dates
    .map((t, i) => ({ t, i }))
    .filter(({ t }) =>
      visibleRange ? t >= visibleRange[0] && t <= visibleRange[1] : true,
    );
  const nCols = cols.length;

  // the column under the crosshair = the visible bucket nearest the hovered
  // date (buckets are period-end dates, so the first with date ≥ hovered).
  let hoverCol = -1;
  if (hoveredDate && nCols > 0) {
    hoverCol = cols.findIndex((c) => c.t >= hoveredDate);
    if (hoverCol < 0) hoverCol = nCols - 1;
  }

  return (
    <div className="mt-4" style={{ width }}>
      <div className="mb-1 text-[12px] opacity-45">
        커브 히트맵 (이 종목이 아니라 커브 전체입니다)
      </div>
      <div className="flex">
        {/* node labels, short at top → long at bottom */}
        <div
          className="grid pr-1 text-right text-[10px] opacity-45"
          style={{ width: LABEL_W, gridTemplateRows: `repeat(${nNodes}, ${rowH}px)` }}
        >
          {data.nodes.map((n) => (
            <span key={n} className="flex items-center justify-end tabular-nums">
              {n}
            </span>
          ))}
        </div>
        {/* contiguous cells; radius only on the block's outer corners */}
        <div className="relative" style={{ width: gridW }}>
          <div
            className="grid overflow-hidden rounded-[6px]"
            style={{
              width: gridW,
              gridTemplateColumns: `repeat(${nCols}, 1fr)`,
              gridTemplateRows: `repeat(${nNodes}, ${rowH}px)`,
            }}
          >
            {data.cells.flatMap((row, ri) =>
              cols.map(({ i }) => {
                const cell = row[i];
                return (
                  <div
                    key={`${ri}-${i}`}
                    style={cell ? matrixTint(cell.pct, cell.d > 0) : undefined}
                  />
                );
              }),
            )}
          </div>
          {/* crosshair through the heatmap: the hovered column takes focus */}
          {hoverCol >= 0 && nCols > 0 && (
            <div
              className="pointer-events-none absolute top-0 bg-ink"
              style={{
                left: `${((hoverCol + 0.5) / nCols) * 100}%`,
                width: 2,
                height: nNodes * rowH,
                transform: "translateX(-1px)",
              }}
            />
          )}
        </div>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed opacity-45">
        한 열이 위아래로 같은 색이면 평행 이동, 위쪽만 진하면 단기 구간 주도,
        가운데가 옅고 양끝이 진하면 나비형 움직임입니다.
      </p>
    </div>
  );
}
