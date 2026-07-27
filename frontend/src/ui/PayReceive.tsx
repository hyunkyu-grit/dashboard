"use client";

/* Pay/Receive curve diagram (DESIGN §2 popup, Session final Pass A). The
 * companion to the DV01 ratio: the ratio says what to execute, this says which
 * way the curve must move for the position to profit.
 *
 * One rule covers every kind: **Pay profits when the displayed value rises,
 * Receive when it falls.** Rendered as a compact curve sketch at the
 * instrument's legs — a solid current line, a dashed ghost of the wanted shape,
 * an up/down arrow per leg (up-colour up, down-colour down), and one desk-term
 * line: 금리 상승 / 스티프닝 / 플래트닝 / 벨리 약세 / 벨리 강세.
 *
 * With the DV01-neutral weights (§B) the quoted value IS the P&L driver, so
 * there is NO residual-duration caveat. Schematic: the ghost shift is a fixed
 * visual amount, not to scale. */

import { useState } from "react";

import type { WallSummary } from "@/lib/api";

import { classify } from "./gloss";
import type { Row } from "./rows";

type Side = "pay" | "receive";

interface Node {
  label: string;
  rate: number;
  arrow: 1 | -1 | 0; // +1 wants higher, -1 wants lower, 0 = context only
}

const W = 200;
const H = 120;
const PAD = 18;
const GHOST = 26; // schematic vertical shift of the ghost curve

/** Legs + arrow directions for a Pay position; term names the move. Receive is
 * the mirror (arrows flipped, term swapped). Returns null for kinds with no
 * rate position (volatility). */
function build(
  row: Row,
  summary: WallSummary,
  side: Side,
): { nodes: Node[]; term: string } | null {
  const c = classify(row);
  const s = side === "pay" ? 1 : -1;
  const outNow = new Map(summary.outrights.map((o) => [o.id, o.now] as const));
  const rate = (t: string) => outNow.get(t) ?? null;

  if (c.kind === "outright" || c.kind === "call") {
    const tenor = c.kind === "call" ? "1D" : c.tenor;
    const order = summary.outrights;
    const i = order.findIndex((o) => o.id === tenor);
    if (i < 0 || order[i].now == null) return null;
    // one highlighted node + context on either side
    const nodes: Node[] = [];
    for (let j = Math.max(0, i - 1); j <= Math.min(order.length - 1, i + 1); j++) {
      const o = order[j];
      if (o.now == null) continue;
      nodes.push({ label: o.id, rate: o.now, arrow: j === i ? (s as 1 | -1) : 0 });
    }
    return { nodes, term: s > 0 ? "금리 상승" : "금리 하락" };
  }

  if (c.kind === "spread") {
    const rs = rate(c.short);
    const rl = rate(c.long);
    if (rs == null || rl == null) return null;
    // pay the spread = long up relative to short = steepening
    return {
      nodes: [
        { label: c.short, rate: rs, arrow: (-s) as 1 | -1 },
        { label: c.long, rate: rl, arrow: (s) as 1 | -1 },
      ],
      term: s > 0 ? "스티프닝" : "플래트닝",
    };
  }

  if (c.kind === "butterfly") {
    const r1 = rate(c.short);
    const rb = rate(c.belly);
    const r2 = rate(c.long);
    if (r1 == null || rb == null || r2 == null) return null;
    // pay = belly up relative to wings = belly cheapens (벨리 약세)
    return {
      nodes: [
        { label: c.short, rate: r1, arrow: (-s) as 1 | -1 },
        { label: c.belly, rate: rb, arrow: (s) as 1 | -1 },
        { label: c.long, rate: r2, arrow: (-s) as 1 | -1 },
      ],
      term: s > 0 ? "벨리 약세" : "벨리 강세",
    };
  }

  if (c.kind === "forward") {
    if (row.now == null) return null;
    // a single forward point; pay = that forward rate rises
    return {
      nodes: [{ label: row.label, rate: row.now, arrow: (s) as 1 | -1 }],
      term: s > 0 ? "선도 금리 상승" : "선도 금리 하락",
    };
  }

  return null; // volatility etc. — no rate position
}

export function PayReceive({ row, summary }: { row: Row; summary: WallSummary }) {
  const [side, setSide] = useState<Side>("pay");
  const model = build(row, summary, side);
  if (!model) return null;
  const { nodes, term } = model;

  const rates = nodes.map((n) => n.rate);
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const span = hi - lo || 1;
  const plotH = H - 2 * PAD - GHOST;
  const x = (i: number) =>
    nodes.length === 1 ? W / 2 : PAD + (i / (nodes.length - 1)) * (W - 2 * PAD);
  // higher rate → higher on screen (smaller y); leave headroom for the ghost.
  const y = (r: number) => PAD + GHOST / 2 + (1 - (r - lo) / span) * plotH;
  const yGhost = (n: Node, i: number) => y(n.rate) - n.arrow * GHOST;

  const solid = nodes.map((n, i) => `${x(i)},${y(n.rate)}`).join(" ");
  const ghost = nodes.map((n, i) => `${x(i)},${yGhost(n, i)}`).join(" ");

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center gap-2">
        <div className="flex overflow-hidden rounded-[6px] border border-edge text-[12px]">
          {(["pay", "receive"] as Side[]).map((sd) => (
            <button
              key={sd}
              type="button"
              onClick={() => setSide(sd)}
              className={
                sd === side ? "bg-ink px-2.5 py-0.5 text-page" : "px-2.5 py-0.5 opacity-50 hover:opacity-90"
              }
            >
              {sd === "pay" ? "페이" : "리시브"}
            </button>
          ))}
        </div>
        <span className="text-[13px] font-semibold">{term}</span>
      </div>
      <svg width={W} height={H} className="text-ink" role="img" aria-label="pay/receive shape">
        {/* wanted shape (dashed ghost) */}
        {nodes.length > 1 && (
          <polyline points={ghost} fill="none" stroke="currentColor" strokeOpacity={0.28}
            strokeWidth={1.5} strokeDasharray="3 3" />
        )}
        {/* current curve (solid) */}
        {nodes.length > 1 && (
          <polyline points={solid} fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.5} />
        )}
        {nodes.map((n, i) => (
          <g key={n.label}>
            <circle cx={x(i)} cy={y(n.rate)} r={n.arrow ? 3 : 2} fill="currentColor"
              fillOpacity={n.arrow ? 0.9 : 0.35} />
            {n.arrow !== 0 && <Arrow x={x(i)} yFrom={y(n.rate)} up={n.arrow > 0} />}
            <text x={x(i)} y={H - 4} textAnchor="middle" className="fill-ink"
              style={{ fontSize: 9, opacity: 0.5 }}>
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** A short vertical arrow from a node in the direction the position wants the
 * rate to move — up-colour up, down-colour down (§9). */
function Arrow({ x, yFrom, up }: { x: number; yFrom: number; up: boolean }) {
  const len = 16;
  const tip = up ? yFrom - len : yFrom + len;
  const head = up ? tip + 5 : tip - 5;
  return (
    <g className={up ? "text-up" : "text-down"} stroke="currentColor" fill="currentColor">
      <line x1={x} y1={yFrom} x2={x} y2={tip} strokeWidth={1.5} />
      <polygon
        points={`${x},${tip} ${x - 3},${head} ${x + 3},${head}`}
        stroke="none"
      />
    </g>
  );
}
