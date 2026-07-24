"use client";

/* Band 2 — forward column-slice tile (design spec §7).
 *
 * X: 21 forward start points, equal spacing (genuinely uniform in time).
 * 6 time-basis lines under the §9 ramp. Markers ONLY where both the start
 * and end of the forward period land on live-quoted nodes (live flag comes
 * from the backend). Y axis independent per tile; the Y-span in bp is
 * printed in the header so cross-tile magnitude comparison survives.
 */

import { useMemo, useState } from "react";

import type { ForwardCell, ForwardsPayload } from "@/lib/api";
import { fmtBp, fmtRate } from "@/lib/format";
import { useUiStore } from "@/state/ui";
import {
  BASIS_LABELS,
  BASIS_SECONDARY_OPACITY,
  EDGE_OPACITY,
  RAMP_OPACITY,
  RAMP_WIDTH,
  TIME_BASES,
  type TimeBasis,
} from "@/theme/ramp";

const PAD = { left: 42, right: 10, top: 12, bottom: 18 };
// x labels only at year starts to keep 21 points legible
const LABELED_STARTS = new Set(["ON", "1Y", "2Y", "3Y", "4Y", "5Y"]);

interface Props {
  tenor: string;
  payload: ForwardsPayload;
  width: number;
  height: number;
  refCb?: (el: HTMLElement | null) => void;
  /** Time-basis lines to draw; Level 1–2 pass [now, basis] (DESIGN §2). */
  bases?: TimeBasis[];
}

export function ForwardTile({
  tenor,
  payload,
  width,
  height,
  refCb,
  bases = [...TIME_BASES],
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const theme = useUiStore((s) => s.theme);
  const rampOpacity = RAMP_OPACITY[theme];
  const edge = EDGE_OPACITY[theme];
  const op = (b: TimeBasis) =>
    b === "now"
      ? rampOpacity.now
      : bases.length <= 2
        ? BASIS_SECONDARY_OPACITY
        : rampOpacity[b];
  // Linked highlight from the matrix (§8) — only this tile's hover matters.
  const linkedIdx = useUiStore((s) =>
    s.fwdHover?.tenor === tenor ? s.fwdHover.startIdx : null,
  );

  const rows: ForwardCell[] = payload.grid[tenor];
  const chartH = height - 40 - 24; // readout strip + header

  const plotW = width - PAD.left - PAD.right;
  const plotH = chartH - PAD.top - PAD.bottom;

  const { yMin, yMax, spanBp } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      for (const b of bases) {
        const v = r.values[b];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    const pad = (hi - lo) * 0.05 || 0.02;
    return {
      yMin: lo - pad,
      yMax: hi + pad,
      spanBp: Math.round((hi - lo) * 100),
    };
  }, [rows, bases]);

  const x = (i: number) => PAD.left + (i * plotW) / (rows.length - 1);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / plotW) * (rows.length - 1));
    setHover(Math.max(0, Math.min(rows.length - 1, i)));
  };

  const focusIdx = hover ?? linkedIdx ?? rows.length - 1;
  const focus = rows[focusIdx];
  const focusStart = payload.startPoints[focusIdx];
  const activeIdx = hover ?? linkedIdx;

  return (
    <section ref={refCb} className="flex flex-col rounded-[16px] bg-tile p-4" style={{ width, height }}>
      <h2 className="mb-1 flex items-baseline justify-between text-[14px] font-semibold">
        <span>{tenor}</span>
        <span className="text-[12px] font-normal opacity-60">span {spanBp}bp</span>
      </h2>
      {/* text-ink sets currentColor for the whole SVG: every stroke/fill
          below inherits it, so paint never resolves a var() per element
          (hundreds of them here — that stalls rasterization). */}
      <svg
        width={width - 24}
        height={chartH}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${tenor} forwards`}
        className="text-ink"
      >
        {rows.map((r, i) => (
          <line
            key={r.start}
            x1={x(i)}
            x2={x(i)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="currentColor"
            strokeWidth={1}
            strokeOpacity={
              activeIdx === i
                ? edge.live
                : edge.base * (LABELED_STARTS.has(r.start) ? 1 : 0.45)
            }
          />
        ))}
        {[yMin + (yMax - yMin) * 0.1, yMax - (yMax - yMin) * 0.1].map((v) => (
          <text
            key={v}
            x={PAD.left - 5}
            y={y(v) + 4}
            textAnchor="end"
            fill="currentColor"
            fillOpacity={0.6}
            style={{ fontSize: 11 }}
          >
            {v.toFixed(2)}
          </text>
        ))}
        {/* Navy data lines (§9, Session 12) — one currentColor here. */}
        <g className="text-brand">
        {[...bases].reverse().map((b) => (
          <g key={b}>
            <polyline
              points={rows.map((r, i) => `${x(i)},${y(r.values[b])}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeOpacity={op(b)}
              strokeWidth={RAMP_WIDTH[b]}
            />
            {/* markers = live-quoted points only (§7) */}
            {rows.map((r, i) =>
              r.live ? (
                <circle
                  key={r.start}
                  cx={x(i)}
                  cy={y(r.values[b])}
                  r={b === "now" ? 2.4 : 1.9}
                  fill="currentColor"
                  fillOpacity={op(b)}
                />
              ) : null,
            )}
          </g>
        ))}
        </g>
        {rows.map((r, i) =>
          LABELED_STARTS.has(r.start) ? (
            <text
              key={r.start}
              x={x(i)}
              y={chartH - 4}
              textAnchor="middle"
              className="fill-ink"
              style={{
                fontSize: 11,
                fontWeight: activeIdx === i ? 600 : 400,
                opacity: activeIdx === i ? 1 : 0.7,
              }}
            >
              {r.start}
            </text>
          ) : null,
        )}
      </svg>

      {/* fixed readout strip (§7) — reserved space, never a tooltip */}
      <div className="flex h-10 flex-col justify-center border-t border-edge px-1 text-[12px] leading-4">
        <div className="truncate">
          <span className="inline-block w-10">{focus.start}</span>
          <span className="inline-block w-14">{fmtRate(focus.values.now)}</span>
          {(["d1", "wtd", "mtd", "qtd", "ytd"] as const).map((k) => (
            <span key={k} className="ml-2">
              <span className="opacity-60">{BASIS_LABELS[k]}</span>{" "}
              {fmtBp(focus.deltas[k])}
            </span>
          ))}
        </div>
        <div className="truncate opacity-80">
          {focus.live ? "on quotes" : "interpolated"}
          <span className="ml-3">
            <span className="opacity-60">start</span> {focusStart.date}
          </span>
        </div>
      </div>
    </section>
  );
}
