"use client";

/* Idle right-pane curve (DESIGN §2/§4, restored Session 13). No row hovered →
 * the pane shows the curve for the active tab. Equal-spaced nodes, blue
 * line (--bw-line, §9 palette cut), two lines only (Now + D-1 comparison — the full six-basis ramp lives
 * in the enlarged view). Hand-rolled SVG (lightweight-charts stays enlarged-
 * only, §11).
 *
 * CurveGesture (motion session, Pass E): on pin, a GHOST copy of the par
 * curve deforms to the shape the pinned trade wants (mode geometry reused
 * from the diagram via ui/gesture.ts), holds, fades. The data line itself
 * NEVER moves — an animating curve on a rates monitor reads as a live
 * update, which is worse than the feature is worth. */

import { animate, useReducedMotion, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ForwardsPayload, Unit, VolatilityPayload, WallSummary } from "@/lib/api";
import { BASIS_SECONDARY_OPACITY } from "@/theme/ramp";

import { classify } from "./gloss";
import { GESTURE, gestureOffsets } from "./gesture";
import { diagramSpec } from "./payReceiveModel";
import { cmpKey, type Group, type Row } from "./rows";

interface Node {
  label: string;
  now: number | null;
  prev: number | null; // D-1 comparison
}

const PAD = { top: 14, right: 12, bottom: 20, left: 40 };

/** Ghost overlay: px offsets per node, animation progress, fade. Drawn as a
 * dashed INK line so it cannot be mistaken for the blue data line or the
 * D-1 comparison — this is a demonstration, not data updating. */
interface Ghost {
  offsets: number[];
  progress: number;
  opacity: number;
}

function NodeLine({
  nodes,
  unit,
  width,
  height,
  ghost,
}: {
  nodes: Node[];
  unit: Unit;
  width: number;
  height: number;
  ghost?: Ghost;
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
      {/* the gesture's ghost — dashed ink, above the data line; the data
          line's points are untouched (§14: never animate chart geometry) */}
      {ghost && (
        <polyline
          points={nodes
            .map((n, i) =>
              n.now == null
                ? null
                : `${x(i)},${y(n.now) - (ghost.offsets[i] ?? 0) * ghost.progress}`,
            )
            .filter(Boolean)
            .join(" ")}
          fill="none"
          className="text-ink"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeOpacity={0.6 * ghost.opacity}
          strokeDasharray="6 5"
          strokeLinejoin="round"
        />
      )}
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

export const CURVE_NODES = ["3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"];

/** The IRS par curve across the 9 equal-spaced nodes — also the gesture's
 * stage regardless of the active tab (mode semantics live on the par curve). */
function parNodes(summary: WallSummary): Node[] {
  const byId = new Map(summary.outrights.map((o) => [o.id, o]));
  return CURVE_NODES.map((t) => {
    const o = byId.get(t);
    return { label: t, now: o?.now ?? null, prev: o?.basisValues.d1 ?? null };
  });
}

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
    // outrights / all → the IRS par curve
    nodes = parNodes(summary);
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

/** The pin gesture (Pass E): the par curve with a ghost that springs out to
 * the wanted shape (~400ms), holds (~600ms), fades (~300ms) — slower than
 * the interface's other motion because it is meant to be watched. Under
 * reduced motion the deformed ghost shows statically for the hold duration.
 * The caller gates on hasCurveStatement (volatility plays nothing). */
export function CurveGesture({
  row,
  summary,
  width,
  height,
  onDone,
}: {
  row: Row;
  summary: WallSummary;
  width: number;
  height: number;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  // reduced motion: the ghost shows fully deformed from the first frame and
  // simply holds — no animating to it (state initialised, not set in effect)
  const [progress, setProgress] = useState(reduced ? 1 : 0);
  const [fade, setFade] = useState(1);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const nodes = useMemo(() => parNodes(summary), [summary]);
  const offsets = useMemo(() => gestureOffsets(row, CURVE_NODES), [row]);
  const spec = diagramSpec(classify(row), "pay");

  useEffect(() => {
    if (!offsets) {
      onDoneRef.current();
      return;
    }
    if (reduced) {
      // deformed ghost held statically, then gone
      const t = setTimeout(() => onDoneRef.current(), GESTURE.holdMs);
      return () => clearTimeout(t);
    }
    const out = animate(0, 1, {
      type: "spring",
      visualDuration: GESTURE.deformMs / 1000,
      bounce: 0.25,
      onUpdate: setProgress,
    });
    let fadeCtrl: AnimationPlaybackControls | undefined;
    const t = setTimeout(() => {
      fadeCtrl = animate(1, 0, {
        duration: GESTURE.fadeMs / 1000,
        ease: "easeOut",
        onUpdate: setFade,
        onComplete: () => onDoneRef.current(),
      });
    }, GESTURE.deformMs + GESTURE.holdMs);
    return () => {
      out.stop();
      fadeCtrl?.stop();
      clearTimeout(t);
    };
  }, [offsets, reduced]);

  if (!offsets || !spec) return null;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[15px] font-semibold">IRS 커브</span>
        <span className="text-[12px] opacity-55">
          {row.label} · {spec.term}
        </span>
      </div>
      <NodeLine
        nodes={nodes}
        unit="%"
        width={width}
        height={height - 24}
        ghost={{ offsets, progress, opacity: fade }}
      />
    </div>
  );
}
