"use client";

/* The COMPONENT-RATES panel of the backtest's linked stack [OWNER, 2026-08-05:
 * "진입레벨 뿐만 아니라, 그 구성요건들과 CD, Base도 보여야 함 … 안 겹치게
 * 잘 배치"].
 *
 * A spread or butterfly is a POSITION in two or three outright rates, but its
 * own chart plots the combination in bp — the legs that make it up are
 * invisible there, and overlaying three % lines on the bp plot is exactly the
 * "안 겹치게" failure the owner warned about. So the legs get their OWN panel,
 * where everything shares one unit: each leg's par rate, CD 91d and the BOK
 * base rate are all %, one axis, no rebasing. It draws between the instrument
 * chart and the P&L, third member of the linked stack.
 *
 * ALIGNMENT IS CONSTRUCTED, the LinkedPnlChart precedent: the SAME `pts`
 * slice the instrument chart plots, CHART_PAD's left/right, the same index→x
 * formula — one crosshair date lands on one pixel column in all three panels.
 * The legs are FULL-resolution series aligned onto the slice BY DATE
 * (`alignSeries` — index i is not the same day across independently
 * downsampled series, the policyLine module's founding rule).
 *
 * The references draw through the SHARED policyLine helpers and the ref
 * tokens (stroke-ref-cd / stroke-ref-policy, solid, the owner's 2026-08-04
 * encoding) — this panel is a sanctioned SECOND reference surface beside
 * PreviewChart, recorded in the backtest-context guard; what stays banned is
 * a hand-rolled projection or a third encoding.
 *
 * The legs themselves are LEVELS, so they stay ink (§9) — told apart by
 * opacity grade (short → long fades) and NAMED at the line's right end,
 * labels nudged apart when the curve pinches them together. Direction hue
 * would be wrong here: a rate line has no sign.
 */

import type { HistoryPoint, PolicyStep } from "@/lib/api";
import { fmtAxis } from "@/lib/format";

import { CHART_PAD } from "./PreviewChart";
import {
  alignSeries,
  policyExtent,
  policyPath,
  policySegments,
  seriesExtent,
  seriesPath,
} from "./policyLine";
import { READOUT_CARD_W, ReadoutCard, ReadoutLevel } from "./ReadoutCard";

/** Opacity grade for the leg lines, short tenor first. Three steps at most —
 * a fly has three legs — chosen so the faintest still clears the grid. */
const LEG_OPACITY = [0.9, 0.6, 0.4];

/** Minimum vertical separation between two end labels, px. */
const LABEL_GAP = 11;

/** How far the end labels sit INSIDE the right pad — clear of the % axis
 * labels, which own the right-edge column (verified live: at the edge the
 * two collide whenever a leg ends near a gridline). */
const LABEL_X_INSET = 32;

export interface LegSeries {
  id: string;
  points: HistoryPoint[];
}

export function LinkedLegsChart({
  legs,
  pts,
  cd,
  policy,
  markDates,
  width,
  height,
  hoverIso,
  onHover,
}: {
  /** the instrument's legs, FULL resolution, in id order (short → long) */
  legs: LegSeries[];
  /** the slice the instrument chart above plots — dates drive every x */
  pts: HistoryPoint[];
  /** CD 91d — the same fetch the chart above draws (one CD hook) */
  cd?: HistoryPoint[];
  policy?: PolicyStep;
  /** 진입/청산 dates — hairlines only; the chart above carries the labels */
  markDates?: string[];
  width: number;
  height: number;
  hoverIso: string | null;
  onHover: (iso: string | null) => void;
}) {
  const PAD = {
    top: CHART_PAD.top,
    right: CHART_PAD.right,
    bottom: 6,
    left: CHART_PAD.left,
  };
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  if (pts.length < 2 || legs.length < 2) return null;

  /* every series projected onto the slice's date axis — a merge, never a zip */
  const legVals = legs.map((l) => alignSeries(pts, l.points));
  const cdVals = alignSeries(pts, cd);
  const segments = policySegments(pts, policy);

  /* one % domain over everything drawn — legs, CD and the step all share the
   * unit, so widening (the "shared" axis mode) is the correct comparison */
  let lo = Infinity;
  let hi = -Infinity;
  for (const vals of [...legVals, cdVals]) {
    const e = seriesExtent(vals);
    if (e) {
      lo = Math.min(lo, e.min);
      hi = Math.max(hi, e.max);
    }
  }
  const pe = policyExtent(segments);
  if (pe) {
    lo = Math.min(lo, pe.min);
    hi = Math.max(hi, pe.max);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const pad = (hi - lo) * 0.06 || 0.01;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (i: number) => PAD.left + (i / (pts.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  /* end labels: each leg named at its last drawn point, nudged apart when the
   * curve pinches them together — names must never overlap (안 겹치게) */
  const ends = legs
    .map((l, k) => {
      let i = legVals[k].length - 1;
      while (i >= 0 && legVals[k][i] == null) i--;
      return i >= 0 ? { id: l.id, k, y: y(legVals[k][i] as number) } : null;
    })
    .filter((e): e is { id: string; k: number; y: number } => e !== null)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].y - ends[i - 1].y < LABEL_GAP)
      ends[i].y = ends[i - 1].y + LABEL_GAP;
  }

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(
      ((e.clientX - rect.left - PAD.left) / plotW) * (pts.length - 1),
    );
    onHover(pts[Math.max(0, Math.min(pts.length - 1, i))].t);
  };

  /* the crosshair index from the SHARED date — the same on-or-after mapping
   * the sibling panels use, so one date is one pixel column in all three */
  const hIdx =
    hoverIso != null && hoverIso >= pts[0].t && hoverIso <= pts[pts.length - 1].t
      ? Math.max(0, pts.findIndex((p) => p.t >= hoverIso))
      : null;
  /* the base rate IN FORCE at the hovered index — read from the drawn
   * segments, so the card reports exactly what the line shows */
  const hoverPolicy =
    hIdx != null
      ? (segments.find((s) => s.from <= hIdx && hIdx <= s.to)?.rate ?? null)
      : null;
  const tipLeft =
    hIdx != null
      ? Math.min(width - READOUT_CARD_W - 10, Math.max(0, x(hIdx) + 10))
      : 0;

  /* the reference legend, byte-for-byte the top chart's encoding (swatch
   * repeats the line's opacity so the sample looks like the thing it names) */
  const legend: { label: string; op: number; stroke: string; fill: string }[] =
    [];
  if (cdVals.some((v) => v != null))
    legend.push({
      label: "CD 91일",
      op: 0.55,
      stroke: "stroke-ref-cd",
      fill: "fill-ref-cd",
    });
  if (segments.length)
    legend.push({
      label: "기준금리",
      op: 0.35,
      stroke: "stroke-ref-policy",
      fill: "fill-ref-policy",
    });

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="구성 금리"
        className="select-none"
        onMouseMove={onMove}
        onMouseLeave={() => onHover(null)}
      >
        {/* the panel says what it is — the LinkedPnlChart precedent: an
            unlabelled extra chart one gap below reads as a mystery */}
        <text
          x={PAD.left + 2}
          y={PAD.top - 4}
          className="fill-ink"
          style={{ fontSize: 10, opacity: 0.45 }}
        >
          구성 금리
        </text>
        {legend.map((g, i) => {
          const lx = width - PAD.right - 74 - i * 82;
          return (
            <g key={g.label}>
              <line
                x1={lx}
                x2={lx + 14}
                y1={PAD.top - 4}
                y2={PAD.top - 4}
                className={g.stroke}
                strokeWidth={1}
                strokeOpacity={g.op}
              />
              <text
                x={lx + 18}
                y={PAD.top - 1}
                className={g.fill}
                style={{ fontSize: 9, opacity: 0.75 }}
              >
                {g.label}
              </text>
            </g>
          );
        })}
        {/* horizontal grid + its value: % reads on the RIGHT (the axis-side
            rule), bare because this panel has a single scale */}
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={PAD.top + f * plotH}
              y2={PAD.top + f * plotH}
              className="stroke-edge"
              strokeWidth={1}
            />
            <text
              x={width - PAD.right - 2}
              y={PAD.top + f * plotH - 3}
              textAnchor="end"
              className="fill-ink"
              style={{ fontSize: 10, opacity: 0.5 }}
            >
              {fmtAxis(yMax - f * (yMax - yMin), "%")}
            </text>
          </g>
        ))}
        {/* references UNDER the legs — what the rates are read against */}
        {seriesPath(cdVals, x, y).map((run) => (
          <polyline
            key={`cd-${run.slice(0, 24)}`}
            points={run}
            fill="none"
            className="stroke-ref-cd"
            strokeWidth={1}
            strokeOpacity={0.55}
          />
        ))}
        {policyPath(segments, x, y).map((run) => (
          <polyline
            key={`po-${run.slice(0, 24)}`}
            points={run}
            fill="none"
            className="stroke-ref-policy"
            strokeWidth={1}
            strokeOpacity={0.35}
          />
        ))}
        {/* 진입/청산 hairlines — dates only, dashed like the chart above;
            the labels live there, and repeating them here would collide
            with the caption band in a panel this short */}
        {(markDates ?? []).map((d) => {
          if (d < pts[0].t || d > pts[pts.length - 1].t) return null;
          let i = pts.findIndex((p) => p.t >= d);
          if (i < 0) i = pts.length - 1;
          return (
            <line
              key={`mark-${d}`}
              data-mark="date"
              x1={x(i)}
              x2={x(i)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-ink"
              strokeWidth={1}
              strokeOpacity={0.3}
              strokeDasharray="3 3"
            />
          );
        })}
        {/* the legs: levels stay ink, graded short → long, named at the end */}
        {legVals.map((vals, k) => (
          <g key={legs[k].id}>
            {seriesPath(vals, x, y).map((run) => (
              <polyline
                key={run.slice(0, 24)}
                data-leg={legs[k].id}
                points={run}
                fill="none"
                className="stroke-ink"
                strokeWidth={1.4}
                strokeOpacity={LEG_OPACITY[k] ?? 0.4}
                strokeLinejoin="round"
              />
            ))}
          </g>
        ))}
        {ends.map((e) => (
          <text
            key={`end-${e.id}`}
            x={width - PAD.right - LABEL_X_INSET}
            y={e.y + 3}
            textAnchor="end"
            className="fill-ink"
            style={{ fontSize: 9, fontWeight: 600, opacity: LEG_OPACITY[e.k] ?? 0.4 }}
          >
            {e.id}
          </text>
        ))}
        {hIdx != null && (
          <>
            <line
              data-crosshair=""
              x1={x(hIdx)}
              x2={x(hIdx)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-ink"
              strokeWidth={1}
              strokeOpacity={0.25}
            />
            {legVals.map((vals, k) =>
              vals[hIdx] == null ? null : (
                <circle
                  key={`dot-${legs[k].id}`}
                  cx={x(hIdx)}
                  cy={y(vals[hIdx] as number)}
                  r={2.6}
                  className="fill-ink"
                  fillOpacity={LEG_OPACITY[k] ?? 0.4}
                />
              ),
            )}
          </>
        )}
      </svg>
      {hIdx != null && (
        /* the shared card: one grammar for a level everywhere (fmtLevel via
           ReadoutLevel) — legs first, then the two references AS DRAWN */
        <ReadoutCard title={pts[hIdx].t} left={tipLeft}>
          {legs.map((l, k) => (
            <ReadoutLevel key={l.id} k={l.id} v={legVals[k][hIdx]} unit="%" />
          ))}
          <ReadoutLevel k="CD 91일" v={cdVals[hIdx] ?? null} unit="%" />
          <ReadoutLevel k="기준금리" v={hoverPolicy} unit="%" />
        </ReadoutCard>
      )}
    </div>
  );
}
