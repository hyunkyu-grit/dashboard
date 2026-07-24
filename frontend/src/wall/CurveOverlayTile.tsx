"use client";

/* Band 1 — IRS curve overlay tile (design spec §6).
 *
 * 9 equal-spaced tenor nodes (1D excluded; 3M currently absent from the
 * feed, so it renders only the nodes present and the gap is surfaced in the
 * status strip). 6 time-basis curves under the §9 opacity/width ramp, all
 * ink — the ramp is drawn with CSS vars, which SVG resolves natively (the
 * theme bridge is only for canvas consumers).
 */

import { useMemo, useState } from "react";

import type { SeriesSummary, WallSummary } from "@/lib/api";
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

// Spec node axis, in order. Nodes missing from the feed are skipped.
const NODE_AXIS = ["3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"];

const TENOR_YEARS: Record<string, number> = {
  "3M": 0.25, "6M": 0.5, "9M": 0.75, "1Y": 1, "1.5Y": 1.5,
  "2Y": 2, "3Y": 3, "5Y": 5, "10Y": 10,
};

const PAD = { left: 44, right: 14, top: 14, bottom: 22 };

function basisValue(s: SeriesSummary, basis: TimeBasis): number | null {
  return basis === "now" ? s.now : s.basisValues[basis];
}

interface Props {
  summary: WallSummary;
  width: number;
  height: number;
  /** Which time-basis curves to draw. Level 1–2 pass [now, basis]; the full
   * six-curve ramp is Level-3 only (DESIGN §2/§9). Defaults to all six. */
  bases?: TimeBasis[];
}

export function CurveOverlayTile({
  summary,
  width,
  height,
  bases = [...TIME_BASES],
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const globalBasis = useUiStore((s) => s.basis);
  const theme = useUiStore((s) => s.theme);
  const rampOpacity = RAMP_OPACITY[theme];
  const edge = EDGE_OPACITY[theme];

  const byId = useMemo(
    () => new Map(summary.outrights.map((o) => [o.id, o])),
    [summary],
  );
  const nodes = NODE_AXIS.filter((t) => byId.has(t));
  const call = byId.get("1D");

  // Level-extreme STATE (DESIGN §12): tenors whose outright sits in the
  // extreme percentile band get weight-600 on the tile — the persistent
  // condition lives here, not in the change log.
  const extremeTenors = useMemo(() => {
    const s = new Set<string>();
    for (const o of summary.outrights) {
      const p = o.range10y.pct;
      if (p != null && (p >= 95 || p <= 5)) s.add(o.id);
    }
    return s;
  }, [summary]);

  const chartH = height - 40; // readout strip reserves two 20px lines
  const plotW = width - PAD.left - PAD.right;
  const plotH = chartH - PAD.top - PAD.bottom;

  const { yMin, yMax } = useMemo(() => {
    // Auto-fit: min/max across all 6 curves + 5% pad. Range policy is
    // [TBD fixed-vs-auto] — keep this function swappable.
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of nodes) {
      const s = byId.get(t)!;
      for (const b of bases) {
        const v = basisValue(s, b);
        if (v != null) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    const pad = (hi - lo) * 0.05 || 0.1;
    return { yMin: lo - pad, yMax: hi + pad };
  }, [nodes, byId, bases]);

  const x = (i: number) =>
    PAD.left + (nodes.length > 1 ? (i * plotW) / (nodes.length - 1) : plotW / 2);
  const y = (v: number) =>
    PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    nodes.forEach((_, i) => {
      const d = Math.abs(px - x(i));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  // Default readout = 10Y (last node) when nothing is hovered.
  const focusIdx = hover ?? nodes.length - 1;
  const focusTenor = nodes[focusIdx];
  const focus = byId.get(focusTenor);

  // Annualized slope of the hovered segment (prev node → hovered node),
  // in bp/yr — corrects the equal-spacing distortion (design spec §6).
  const slope = useMemo(() => {
    if (focusIdx === 0 || !focus) return null;
    const prevTenor = nodes[focusIdx - 1];
    const prev = byId.get(prevTenor);
    if (!prev || prev.now == null || focus.now == null) return null;
    const dt = TENOR_YEARS[focusTenor] - TENOR_YEARS[prevTenor];
    return {
      from: prevTenor,
      bpPerYear: ((focus.now - prev.now) * 100) / dt,
    };
  }, [focusIdx, focus, nodes, byId, focusTenor]);

  const last = byId.get(nodes[nodes.length - 1]);
  const yTicks = useMemo(() => {
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / n);
  }, [yMin, yMax]);

  return (
    <div className="flex h-full flex-col">
      {/* currentColor from text-ink; no per-element var() (see ForwardTile) */}
      <svg
        width={width}
        height={chartH}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="IRS curve overlay"
        className="text-ink"
      >
        {/* vertical tenor gridlines (double as tenor guides) */}
        {nodes.map((t, i) => (
          <line
            key={t}
            x1={x(i)}
            x2={x(i)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="currentColor"
            strokeWidth={1}
            strokeOpacity={hover === i ? edge.live : edge.base}
          />
        ))}
        {/* y tick labels, no horizontal gridlines */}
        {yTicks.map((v) => (
          <text
            key={v}
            x={PAD.left - 6}
            y={y(v) + 4}
            textAnchor="end"
            fill="currentColor"
            fillOpacity={0.6}
            style={{ fontSize: 11 }}
          >
            {v.toFixed(2)}
          </text>
        ))}
        {/* Navy (§9, Session 12) applies to DATA only — one currentColor on
            this <g>, inherited by every line/marker; axis/gridlines/text stay
            ink. The opacity ramp within the tile separates the bases. */}
        <g className="text-brand">
        {/* draw requested bases, back-to-front so Now paints on top. In the
            two-line Level-1/2 mode the basis line is at 45% (§9); the full
            six-step ramp is used only when all bases are passed (Level 3). */}
        {[...bases].reverse().map((b) => {
          const op =
            b === "now"
              ? rampOpacity.now
              : bases.length <= 2
                ? BASIS_SECONDARY_OPACITY
                : rampOpacity[b];
          const pts = nodes
            .map((t, i) => {
              const v = basisValue(byId.get(t)!, b);
              return v == null ? null : `${x(i)},${y(v)}`;
            })
            .filter(Boolean)
            .join(" ");
          return (
            <g key={b}>
              <polyline
                points={pts}
                fill="none"
                stroke="currentColor"
                strokeOpacity={op}
                strokeWidth={RAMP_WIDTH[b]}
              />
              {nodes.map((t, i) => {
                const v = basisValue(byId.get(t)!, b);
                return v == null ? null : (
                  <circle
                    key={t}
                    cx={x(i)}
                    cy={y(v)}
                    r={b === "now" ? 2.8 : 2.2}
                    fill="var(--bw-tile)"
                    stroke="currentColor"
                    strokeOpacity={op}
                    strokeWidth={b === "now" ? 1.6 : 1.1}
                  />
                );
              })}
            </g>
          );
        })}
        </g>
        {/* tenor labels */}
        {nodes.map((t, i) => (
          <text
            key={t}
            x={x(i)}
            y={chartH - 6}
            textAnchor="middle"
            fill="currentColor"
            fillOpacity={hover === i || extremeTenors.has(t) ? 1 : 0.7}
            style={{
              fontSize: 12,
              // weight-600 = outlier: hover, or persistent level-extreme state
              fontWeight: hover === i || extremeTenors.has(t) ? 600 : 400,
            }}
          >
            {t}
          </text>
        ))}
        {/* last-value badge: Now only (design spec §6) */}
        {last?.now != null && (
          <text
            x={width - PAD.right}
            y={PAD.top + 4}
            textAnchor="end"
            fill="currentColor"
            style={{ fontSize: 12 }}
          >
            {nodes[nodes.length - 1]} {fmtRate(last.now)}
          </text>
        )}
      </svg>

      {/* fixed readout strip — reserved space, never a tooltip (§6/§10) */}
      <div className="flex h-10 flex-col justify-center border-t border-edge px-1 leading-5">
        <div className="truncate">
          <span className="inline-block w-12">{focusTenor}</span>
          <span className="inline-block w-16">{fmtRate(focus?.now)}</span>
          {/* all 5 deltas stay visible (§6); the global basis is emphasized */}
          {(["d1", "wtd", "mtd", "qtd", "ytd"] as const).map((k) => (
            <span
              key={k}
              className={k === globalBasis ? "ml-3" : "ml-3 opacity-50"}
            >
              <span className="opacity-60">{BASIS_LABELS[k]}</span>{" "}
              {fmtBp(focus?.deltas[k])}
            </span>
          ))}
        </div>
        <div className="truncate opacity-80">
          {slope
            ? `${slope.from}→${focusTenor} ${fmtBp(slope.bpPerYear)} bp/yr`
            : "segment –"}
          <span className="ml-4">
            <span className="opacity-60">Call 1D</span> {fmtRate(call?.now)}
          </span>
        </div>
      </div>
    </div>
  );
}
