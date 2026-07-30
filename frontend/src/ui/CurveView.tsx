"use client";

/* Idle right-pane curve (DESIGN §2/§4, restored Session 13). No row hovered →
 * the pane shows THE IRS PAR CURVE, on every tab. Equal-spaced nodes, blue
 * line (--bw-line, §9 palette cut), two lines only (the dataset's date + D-1
 * comparison — the full six-basis ramp lives in the enlarged view).
 * Hand-rolled SVG (lightweight-charts stays enlarged-only, §11).
 *
 * ONE CURVE, NOT ONE PER TAB [OWNER, pass M]. The idle pane used to switch with
 * the tab: the 1YF ladder on forwards, the two-point-spread curve on spreads,
 * the relative-ATR curve on volatility. Curve viewing is priority 1 (§1) and
 * "the curve" is the IRS par curve — that is what the idle state is FOR. The
 * other three restated, in a shape that takes a moment to identify, columns the
 * table beside it already prints; and a pane whose subject changes under a
 * filter chip is a second thing to keep track of. So the tab now moves the list
 * only, and the curve stays put. `VolatilityPayload.curve` is still served and
 * no longer rendered (see HANDOFF "Open").
 *
 * NOTHING in this pane animates on pin (strip session, Pass A). The ghost
 * curve gesture was removed: at a 10px peak against a curve spanning 136bp it
 * was too small to read as an intent and large enough to draw the eye —
 * illegible and distracting at once. The popup's mode diagram says the same
 * thing on a SCHEMATIC curve where the exaggeration can be large enough to
 * work, so the gesture was the worse of two attempts at one job. What
 * survives is the pane's corner label (App.tsx): pinned instrument · mode. */

import { useMemo } from "react";

import type { Unit, WallSummary } from "@/lib/api";
import { levelHeadText, levelHeadTitle } from "@/lib/format";
import { BASIS_SECONDARY_OPACITY } from "@/theme/ramp";

interface Node {
  label: string;
  now: number | null;
  prev: number | null; // D-1 comparison
}

const PAD = { top: 14, right: 12, bottom: 20, left: 40 };

function NodeLine({
  nodes,
  unit,
  width,
  height,
}: {
  nodes: Node[];
  unit: Unit;
  width: number;
  height: number;
}) {
  const pts = nodes.filter((n) => n.now != null);
  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of nodes) {
      for (const v of [n.now, n.prev]) {
        if (v != null) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    const pad = (hi - lo) * 0.08 || 0.05;
    return { yMin: lo - pad, yMax: hi + pad };
  }, [nodes]);

  if (pts.length < 2) return null;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (nodes.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const line = (key: "now" | "prev") =>
    nodes
      .map((n, i) => (n[key] == null ? null : `${x(i)},${y(n[key]!)}`))
      .filter(Boolean)
      .join(" ");
  const fmt = (v: number) => (unit === "bp" ? v.toFixed(1) : v.toFixed(2));
  const labelEvery = Math.ceil(nodes.length / 8);

  return (
    <svg width={width} height={height} className="text-line" role="img" aria-label="curve">
      {[yMin + (yMax - yMin) * 0.15, yMax - (yMax - yMin) * 0.15].map((v) => (
        <text key={v} x={PAD.left - 5} y={y(v) + 4} textAnchor="end"
          className="fill-ink" style={{ fontSize: 11, opacity: 0.5 }}>
          {fmt(v)}
        </text>
      ))}
      <polyline points={line("prev")} fill="none" stroke="currentColor"
        strokeOpacity={BASIS_SECONDARY_OPACITY} strokeWidth={1.4} />
      <polyline points={line("now")} fill="none" stroke="currentColor"
        strokeWidth={1.8} strokeLinejoin="round" />
      {nodes.map((n, i) =>
        n.now == null ? null : (
          <circle key={n.label} cx={x(i)} cy={y(n.now)} r={2.4} fill="currentColor" />
        ),
      )}
      {nodes.map((n, i) =>
        i % labelEvery === 0 || i === nodes.length - 1 ? (
          <text key={`l-${n.label}`} x={x(i)} y={height - 6} textAnchor="middle"
            className="fill-ink" style={{ fontSize: 10, opacity: 0.5 }}>
            {n.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

const CURVE_NODES = ["3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"];

/** The IRS par curve across the 9 equal-spaced nodes. */
function parNodes(summary: WallSummary): Node[] {
  const byId = new Map(summary.outrights.map((o) => [o.id, o]));
  return CURVE_NODES.map((t) => {
    const o = byId.get(t);
    return { label: t, now: o?.now ?? null, prev: o?.basisValues.d1 ?? null };
  });
}

export function CurveView({
  summary,
  width,
  height,
}: {
  summary: WallSummary;
  width: number;
  height: number;
}) {
  const nodes = parNodes(summary);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[15px] font-semibold">IRS 커브</span>
        {/* the solid line's DAY and the dashed one's, in the level header's
            grammar (pass M) — the pane no longer claims "지금" either. */}
        <span
          className="text-[12px] tabular-nums opacity-40"
          title={levelHeadTitle(summary.asof)}
        >
          {levelHeadText(summary.asof)} · 어제
        </span>
      </div>
      <NodeLine nodes={nodes} unit="%" width={width} height={height - 24} />
    </div>
  );
}
