"use client";

/* Preview line chart (DESIGN §2). Hand-rolled SVG so the floating tooltip is
 * simple and lightweight-charts stays confined to the enlarged view (§11).
 * Blue line (--bw-line, §9 palette cut). Hovering shows a floating card near
 * the cursor:
 * 날짜 · 레벨 · 구간 최고 · 구간 최저 · 구간 평균 · 당일 변화. */

import { useState } from "react";

import type { HistoryPoint, PolicyStep, SeriesStats, Unit } from "@/lib/api";

import {
  alignSeries,
  policyExtent,
  policyPath,
  policySegments,
  seriesExtent,
  seriesPath,
  takesPolicyOverlay,
} from "./policyLine";

import {
  READOUT_CARD_W,
  READOUT_LABEL,
  ReadoutCard,
  ReadoutChange,
  ReadoutLevel,
} from "./ReadoutCard";
import { dateLabels } from "./timeAxis";

// top pad holds the reference-line legend (§ reference lines), so it is
// deeper than the 10px the plot alone needed
const PAD = { top: 16, right: 10, bottom: 18, left: 6 };

export function PreviewChart({
  points,
  stats,
  unit,
  width,
  height,
  policy,
  cd,
}: {
  points: HistoryPoint[];
  stats: SeriesStats | null; // range min/max/avg, precomputed server-side (§16)
  unit: Unit;
  width: number;
  height: number;
  /** BOK base rate step, drawn under % instruments only (§policy). */
  policy?: PolicyStep;
  /** CD 91d history — the second reference line, always drawn with the base
   * rate. Omitted when the instrument IS CD, where it would be the same line
   * twice. */
  cd?: HistoryPoint[];
}) {
  const [hi, setHi] = useState<number | null>(null);

  if (points.length < 2 || !stats) return null;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  // y-domain from the PLOTTED points, not from stats: the stats are 52-week
  // (annual-stats session) while the line still shows the full history — a
  // domain from annual stats would clip the 2020-21 trough.
  let lo = Infinity;
  let hi2 = -Infinity;
  for (const p of points) {
    if (p.v < lo) lo = p.v;
    if (p.v > hi2) hi2 = p.v;
  }
  // The policy step shares this axis, so the domain has to hold both before
  // anything is scaled — see policyLine.ts. Widening here (rather than
  // clipping the step) is what keeps two rates in the same unit comparable.
  const refs = takesPolicyOverlay(unit);
  const segments = refs ? policySegments(points, policy) : [];
  const cdVals = refs ? alignSeries(points, cd) : [];
  for (const e of [policyExtent(segments), seriesExtent(cdVals)]) {
    if (!e) continue;
    if (e.min < lo) lo = e.min;
    if (e.max > hi2) hi2 = e.max;
  }
  const pad = (hi2 - lo) * 0.06 || 0.01;
  const yMin = lo - pad;
  const yMax = hi2 + pad;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / plotW) * (points.length - 1));
    const idx = Math.max(0, Math.min(points.length - 1, i));
    setHi(idx);
  };
  const onLeave = () => {
    setHi(null);
  };

  const hp = hi != null ? points[hi] : null;
  // daily change arrives precomputed per point (§16) — no client differencing.
  const dailyChange = hp ? hp.d : null;
  const tipLeft =
    hi != null
      ? Math.min(width - READOUT_CARD_W - 10, Math.max(0, x(hi) + 10))
      : 0;

  // date labels (dates session, Pass B): sparse orientation marks in the
  // bottom pad — no ticks, no rule. The preview has no zoom, so the span is
  // the full fetched history; x = the first point on/after the boundary.
  const labels = dateLabels(points[0].t, points[points.length - 1].t)
    .map((l) => {
      let i = points.findIndex((p) => p.t >= l.iso);
      if (i < 0) i = points.length - 1;
      return { text: l.text, px: x(i) };
    })
    .filter((l) => l.px >= PAD.left && l.px <= width - PAD.right);

  /* What the two ink lines ARE, named on the chart (§ reference lines). Both
   * are the same ink at similar weights and differ only by dash pattern, so
   * without this the reader has to infer which is which from the shape — and
   * "the flat one is policy" stops being true the moment CD is flat too. */
  const legend: { label: string; dash: string }[] = [];
  if (cdVals.some((v) => v != null)) legend.push({ label: "CD 91일", dash: "1 2" });
  if (segments.length) legend.push({ label: "기준금리", dash: "3 3" });

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        className="text-line"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        role="img"
        aria-label="10y history"
      >
        {/* Both references go UNDER the instrument line: they are what the
            instrument is read against, not second subjects. Ink, not hue, and
            told apart by DASH PATTERN so the distinction survives in
            grayscale (§5): CD is a fine dotted line, the base rate a longer
            dash. The opacity is a layer on top of that, never the encoding. */}
        {seriesPath(cdVals, x, y).map((run) => (
          <polyline
            key={`cd-${run.slice(0, 24)}`}
            points={run}
            fill="none"
            className="stroke-ink"
            strokeWidth={1}
            strokeOpacity={0.4}
            strokeDasharray="1 2"
          />
        ))}
        {policyPath(segments, x, y).map((run) => (
          <polyline
            key={run.slice(0, 24)}
            points={run}
            fill="none"
            className="stroke-ink"
            strokeWidth={1}
            strokeOpacity={0.35}
            strokeDasharray="3 3"
          />
        ))}
        <polyline
          points={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        {legend.map((g, i) => {
          const lx = width - PAD.right - 74 - i * 82;
          return (
            <g key={g.label}>
              <line
                x1={lx}
                x2={lx + 14}
                y1={PAD.top - 4}
                y2={PAD.top - 4}
                className="stroke-ink"
                strokeWidth={1}
                strokeOpacity={0.45}
                strokeDasharray={g.dash}
              />
              <text
                x={lx + 18}
                y={PAD.top - 1}
                className="fill-ink"
                style={{ fontSize: 9, opacity: 0.45 }}
              >
                {g.label}
              </text>
            </g>
          );
        })}
        {labels.map((l) => (
          <text
            key={l.text}
            x={l.px}
            y={height - 4}
            textAnchor="middle"
            className="fill-ink"
            style={{ fontSize: 10, opacity: 0.45 }}
          >
            {l.text}
          </text>
        ))}
        {hi != null && hp && (
          <>
            <line
              x1={x(hi)}
              x2={x(hi)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-ink"
              strokeWidth={1}
              strokeOpacity={0.25}
            />
            <circle cx={x(hi)} cy={y(hp.v)} r={3} fill="currentColor" />
          </>
        )}
      </svg>
      {hi != null && hp && (
        // the shared card (pass N) — the idle curve's tooltip is the same
        // component, so the two cannot drift into two grammars for one quantity
        <ReadoutCard title={hp.t} left={tipLeft}>
          <ReadoutLevel k={READOUT_LABEL.level} v={hp.v} unit={unit} />
          {/* 52-week stats (annual-stats session) — the chart still shows the
              full history, only the statistics narrow; the popup, which
              zooms, uses visible-range "구간" stats (§F). */}
          <ReadoutLevel k={READOUT_LABEL.rangeHigh} v={stats.max} unit={unit} />
          <ReadoutLevel k={READOUT_LABEL.rangeLow} v={stats.min} unit={unit} />
          <ReadoutLevel k={READOUT_LABEL.rangeAvg} v={stats.avg} unit={unit} />
          <ReadoutChange
            k={READOUT_LABEL.dailyChange}
            v={dailyChange}
            unit={unit}
          />
        </ReadoutCard>
      )}
    </div>
  );
}
