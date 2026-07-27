"use client";

/* Idle right-pane curve (DESIGN §2/§4, restored Session 13). No row hovered →
 * the pane shows the curve for the active tab. Equal-spaced nodes, orange
 * line, two lines only (Now + D-1 comparison — the full six-basis ramp lives
 * in the enlarged view). Hand-rolled SVG (lightweight-charts stays enlarged-
 * only, §11). */

import { useMemo } from "react";

import type { ForwardsPayload, Unit, VolatilityPayload, WallSummary } from "@/lib/api";
import { BASIS_SECONDARY_OPACITY } from "@/theme/ramp";

import { cmpKey, type Group } from "./rows";

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

export function CurveView({
  tab,
  summary,
  forwards,
  volatility,
  width,
  height,
}: {
  tab: Group | "all";
  summary: WallSummary;
  forwards?: ForwardsPayload;
  volatility?: VolatilityPayload;
  width: number;
  height: number;
}) {
  let title = "IRS 커브";
  let unit: Unit = "%";
  let nodes: Node[] = [];

  if (tab === "vol") {
    // relative-ATR across tenors (now + D-1), matching the other tabs' idle pane
    title = "변동성 커브";
    unit = "ratio";
    nodes = (volatility?.curve ?? []).map((c) => ({
      label: c.label,
      now: c.now,
      prev: c.prev,
    }));
  } else if (tab === "spread") {
    title = "스프레드 커브";
    unit = "bp";
    nodes = [...summary.derived]
      .filter((d) => d.id.split("-").length === 2) // 2-point spreads only
      // order by the backend-supplied sort key (§16), not a client tenor map
      .sort((a, b) => cmpKey(a.sortKey, b.sortKey))
      .map((d) => ({
        label: d.id.split("-").map((t) => t.replace("Y", "")).join("s"),
        now: d.now,
        prev: d.basisValues.d1,
      }));
  } else if (tab === "forward" && forwards) {
    // 1YF forward ladder: the 1y-forward rate at each start point (§2 choice).
    title = "포워드 래더 (1YF)";
    const col = forwards.grid["1YF"] ?? [];
    nodes = col.map((c) => ({
      label: c.start,
      now: c.values.now,
      prev: c.values.d1,
    }));
  } else {
    // outrights / all → the IRS par curve across the 9 equal-spaced nodes
    const byId = new Map(summary.outrights.map((o) => [o.id, o]));
    nodes = CURVE_NODES.map((t) => {
      const o = byId.get(t);
      return { label: t, now: o?.now ?? null, prev: o?.basisValues.d1 ?? null };
    });
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[12px] opacity-40">지금 · 어제</span>
      </div>
      <NodeLine nodes={nodes} unit={unit} width={width} height={height - 24} />
    </div>
  );
}
