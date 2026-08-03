"use client";

/* Preview line chart (DESIGN §2). Hand-rolled SVG so the floating tooltip is
 * simple and lightweight-charts stays confined to the enlarged view (§11).
 * Blue line (--bw-line, §9 palette cut). Hovering shows a floating card near
 * the cursor:
 * 날짜 · 레벨 · 구간 최고 · 구간 최저 · 구간 평균 · 당일 변화. */

import { useState } from "react";

import type { HistoryPoint, PolicyStep, SeriesStats, Unit } from "@/lib/api";

import { fmtAxis, fmtLevel } from "@/lib/format";

import { windowExtremes } from "./extremes";
import {
  alignSeries,
  policyAxisMode,
  policyExtent,
  policyPath,
  policySegments,
  seriesExtent,
  seriesPath,
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

/** Where the horizontal gridlines sit, as fractions of the plot height. ONE
 * list for the lines and their value labels, so the two cannot drift. */
const GRID_FRACS = [0.25, 0.5, 0.75];

export function PreviewChart({
  points,
  stats,
  unit,
  width,
  height,
  policy,
  cd,
  onHoverDate,
}: {
  points: HistoryPoint[];
  stats: SeriesStats | null; // range min/max/avg, precomputed server-side (§16)
  unit: Unit;
  width: number;
  height: number;
  /** BOK base rate step — shares the axis on % instruments, keeps its own
   * labelled % scale on bp instruments, absent on ratio (§policy). */
  policy?: PolicyStep;
  /** CD 91d history — the second reference line, always drawn with the base
   * rate. Omitted when the instrument IS CD, where it would be the same line
   * twice. */
  cd?: HistoryPoint[];
  /** The date under the cursor, reported as it moves. The chart click opens
   * the backtest AT that date [OWNER: "커서가 가는 곳에서 누르면 그 날부터
   * 스타트해야지"], and the crosshair is the only thing that knows which day
   * the reader is pointing at. */
  onHoverDate?: (iso: string | null) => void;
}) {
  const [hi, setHi] = useState<number | null>(null);

  if (points.length < 2 || !stats) return null;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  // y-domain from the PLOTTED points, not from stats: the stats are 52-week
  // (annual-stats session) while the line still shows the full history — a
  // domain from annual stats would clip the 2020-21 trough. The same scan
  // yields the marked extremes (pass O): domain and dots share one source,
  // so the dot claiming "high" sits exactly where the domain was stretched.
  const ext = windowExtremes(points)!; // points.length >= 2, checked above
  let lo = points[ext.lo].v;
  let hi2 = points[ext.hi].v;
  /* How the overlay meets this axis is a UNIT question (policyLine.ts):
   *
   *   shared    (%)  — the references are in the instrument's own unit, so the
   *                    domain has to hold all three series before anything is
   *                    scaled. Widening here (rather than clipping the step) is
   *                    what keeps two rates in the same unit comparable.
   *   secondary (bp) — a spread and a policy rate share no unit; the
   *                    references get their OWN % scale over the same plot,
   *                    the instrument's bp domain stays exactly what its own
   *                    points make it, and BOTH axes are labelled with their
   *                    unit below. Never a shared scale, never a rebasing —
   *                    the overlay exists to read the spread against the
   *                    policy LEVEL, and an index rebase destroys the level. */
  const mode = policyAxisMode(unit);
  const segments = mode ? policySegments(points, policy) : [];
  const cdVals = mode ? alignSeries(points, cd) : [];
  if (mode === "shared") {
    for (const e of [policyExtent(segments), seriesExtent(cdVals)]) {
      if (!e) continue;
      if (e.min < lo) lo = e.min;
      if (e.max > hi2) hi2 = e.max;
    }
  }
  const pad = (hi2 - lo) * 0.06 || 0.01;
  const yMin = lo - pad;
  const yMax = hi2 + pad;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  /* The secondary % scale, derived from the references alone. `yRef` is the
   * y-mapping every reference stroke uses: identical to `y` when the axis is
   * shared, its own scale when it is not — so the draw code below cannot
   * accidentally mix scales per series. */
  let refDomain: { min: number; max: number } | null = null;
  if (mode === "secondary") {
    for (const e of [policyExtent(segments), seriesExtent(cdVals)]) {
      if (!e) continue;
      refDomain = refDomain
        ? { min: Math.min(refDomain.min, e.min), max: Math.max(refDomain.max, e.max) }
        : { ...e };
    }
  }
  const refPad = refDomain ? (refDomain.max - refDomain.min) * 0.06 || 0.01 : 0;
  const refMin = refDomain ? refDomain.min - refPad : 0;
  const refMax = refDomain ? refDomain.max + refPad : 1;
  const yRef =
    mode === "secondary" && refDomain
      ? (v: number) => PAD.top + (1 - (v - refMin) / (refMax - refMin)) * plotH
      : y;
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / plotW) * (points.length - 1));
    const idx = Math.max(0, Math.min(points.length - 1, i));
    setHi(idx);
    onHoverDate?.(points[idx].t);
  };
  const onLeave = () => {
    setHi(null);
    onHoverDate?.(null);
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
        {/* Background grid (pass O) — furniture, so it takes the palette's
            lightest ink (`stroke-edge`, the hairline token: ink at 12% light /
            18% dark, already contrast-tuned per theme) and sits UNDER
            everything else. Verticals ride the date labels' own x positions
            so furniture aligns with furniture; horizontals quarter the plot
            and CARRY THEIR VALUE (the labels render above the series, below).
            This chart is the sanctioned exception to the S14 "no vertical
            gridlines" default [OWNER, pass O]. */}
        <g>
          {GRID_FRACS.map((f) => (
            <line
              key={`gh-${f}`}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={PAD.top + f * plotH}
              y2={PAD.top + f * plotH}
              className="stroke-edge"
              strokeWidth={1}
            />
          ))}
          {labels.map((l) => (
            <line
              key={`gv-${l.text}`}
              x1={l.px}
              x2={l.px}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-edge"
              strokeWidth={1}
            />
          ))}
        </g>
        {/* Both references go UNDER the instrument line: they are what the
            instrument is read against, not second subjects. Ink, not hue, and
            told apart by DASH PATTERN so the distinction survives in
            grayscale (§5): CD is a fine dotted line, the base rate a longer
            dash. The opacity is a layer on top of that, never the encoding. */}
        {seriesPath(cdVals, x, yRef).map((run) => (
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
        {policyPath(segments, x, yRef).map((run) => (
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
        {/* EVERY horizontal gridline carries its value [OWNER, 2026-08-03 —
            "그리드에 해당하는 금리나 레벨 적어주고"], and WHICH SIDE is a
            rule, not an accident [OWNER]: a LEVEL in bp or ratio (spreads,
            butterflies, volatility) reads on the LEFT axis, a RATE in %
            reads on the RIGHT — on every chart, single- or dual-scale. On a
            dual-scale chart that lands the instrument's bp on the left and
            the references' % on the right, each with its unit; a single
            scale needs no disambiguating suffix, so those print bare.
            `fmtAxis`'s coarse orientation grammar throughout (same role as
            CurveView's y labels — the precise numbers live on the extremes
            and in the tooltip). */}
        {GRID_FRACS.map((f) => {
          const gy = PAD.top + f * plotH - 3;
          const own = fmtAxis(yMax - f * (yMax - yMin), unit);
          const dual = mode === "secondary" && !!refDomain;
          return (
            <g key={`glabel-${f}`}>
              {unit === "%" ? (
                <text
                  x={width - PAD.right - 2}
                  y={gy}
                  textAnchor="end"
                  className="fill-ink"
                  style={{ fontSize: 10, opacity: 0.5 }}
                >
                  {own}
                </text>
              ) : (
                <text
                  x={PAD.left + 2}
                  y={gy}
                  className="fill-ink"
                  style={{ fontSize: 10, opacity: 0.5 }}
                >
                  {`${own}${dual ? unit : ""}`}
                </text>
              )}
              {dual && (
                <text
                  x={width - PAD.right - 2}
                  y={gy}
                  textAnchor="end"
                  className="fill-ink"
                  style={{ fontSize: 10, opacity: 0.5 }}
                >
                  {`${fmtAxis(refMax - f * (refMax - refMin), "%")}%`}
                </text>
              )}
            </g>
          );
        })}
        <polyline
          points={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        {/* The extremes of what is CURRENTLY PLOTTED, marked on the line AND
            SAYING THEIR VALUE (pass O; the value and the hue by owner
            instruction, 2026-08-03 — "지난 10년간 최고치 최저치를 바로 보일
            수 있게", "최고=빨간색으로, 최저는 파란색으로 확실하게 눈에
            띄게"). The HIGH is red, the LOW is blue — the product's own
            up/down pair (§9), landing on the ends it already means; an
            owner-sanctioned exception to "levels stay ink", recorded in
            DESIGN. Viewport property: they derive from the same scan the
            y-domain uses, over the `points` prop — so any windowing (a
            different slice, a future zoom) moves them by construction. Ties
            take the first occurrence; a flat window's two marks coincide on
            its first point and print their one value ONCE (extremes.ts).
            NOT the 52-week stats: those are a fixed server-side window in
            the tooltip. The value is DATA, so it prints through `fmtLevel`
            — the product's level grammar — never the axis' coarse one; the
            high sits above its dot, the low below, each clamped inside the
            plot and end-anchored near the edges. */}
        {[
          { k: "hi", i: ext.hi },
          { k: "lo", i: ext.lo },
        ].map(({ k, i }) => {
          const px = x(i);
          const py = y(points[i].v);
          const anchor =
            px < PAD.left + plotW * 0.08
              ? "start"
              : px > PAD.left + plotW * 0.92
                ? "end"
                : "middle";
          const ty =
            k === "hi"
              ? Math.max(PAD.top + 10, py - 7)
              : Math.min(height - PAD.bottom - 3, py + 15);
          const hue = k === "hi" ? "fill-up" : "fill-down";
          return (
            <g key={k}>
              <circle data-extreme={k} cx={px} cy={py} r={3} className={hue} />
              {(k === "hi" || ext.lo !== ext.hi) && (
                <text
                  x={px}
                  y={ty}
                  textAnchor={anchor}
                  className={hue}
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  {/* named, not just valued — the Toss reference prints a
                      range's endpoints beside a label, and 최고/최저 is the
                      readout card's own vocabulary. A flat window prints its
                      one value bare: it is neither a high nor a low. */}
                  {ext.lo !== ext.hi
                    ? `${k === "hi" ? "최고" : "최저"} ${fmtLevel(points[i].v, unit)}`
                    : fmtLevel(points[i].v, unit)}
                </text>
              )}
            </g>
          );
        })}
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
