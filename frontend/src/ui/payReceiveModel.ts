/* Pay/Receive diagram MODEL (closing session — diagram rebuild). Pure, no React,
 * so the arrow directions are unit-testable against the sign convention
 * (guards/pay-receive-arrows.test.ts): **Pay profits when the displayed value
 * rises; Receive is the exact mirror.**
 *
 * Every kind is drawn on the SAME base: the current par curve across nine
 * equal-spaced nodes. Outrights / spreads / flies move NODE LEVELS (arrows at
 * nodes). A forward is different — it responds to the SLOPE of a segment, not a
 * node level — so it rotates a stretch (near end down, far end up) instead of
 * lifting a node. This module produces, per kind and side: the full-strength
 * region, the leg markers + arrow directions, and the dashed "wanted-state"
 * ghost as control points in rate space. The SVG is in PayReceive.tsx. */

import type { Construct } from "./gloss";

export type Side = "pay" | "receive";
export type ArrowDir = 1 | -1;

// The nine standard curve nodes, equal-spaced on screen (§8/CurveView).
export const DIAGRAM_NODES = [
  "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y",
] as const;
export const NODE_YEARS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10];

export interface Leg {
  frac: number; // fractional node index (0..8), interpolated for forwards
  arrow: ArrowDir;
}
export interface GhostPoint {
  frac: number;
  rate: number;
}
export interface DiagramModel {
  kind: "outright" | "spread" | "butterfly" | "forward";
  term: string;
  note?: string; // extra line under the diagram (forward)
  regionLabel?: string; // label for the shaded stretch (forward: 선도 구간)
  region: [number, number]; // fractional bounds drawn at full strength
  shaded: boolean; // light fill behind the region (forward)
  legs: Leg[];
  ghost: GhostPoint[]; // wanted-state control points, rate space
}

/** Label → years. Handles the composite forward starts ("1Y3M" = 1.25),
 * halves ("1.5Y"), months ("9M" = 0.75), and the overnight "1D". */
export function labelToYears(label: string): number {
  if (label === "1D") return 1 / 365;
  if (label === "SPOT") return 0;
  let y = 0;
  const ym = label.match(/(\d+(?:\.\d+)?)Y/);
  const mm = label.match(/(\d+)M/);
  if (ym) y += parseFloat(ym[1]);
  if (mm) y += parseFloat(mm[1]) / 12;
  return y;
}

/** Years → a readable label in the product's composite style (1.25 → 1Y3M,
 * 10 → 10Y, 0.75 → 9M) — used for the forward's "A~B 구간" line. */
export function yearsToLabel(y: number): string {
  const whole = Math.floor(y + 1e-9);
  const months = Math.round((y - whole) * 12);
  if (months === 0) return `${whole}Y`;
  if (whole === 0) return `${months}M`;
  return `${whole}Y${months}M`;
}

/** Years → fractional index along the equal-spaced nodes (clamped 0..8). */
export function yearsToFrac(y: number): number {
  const n = NODE_YEARS.length;
  if (y <= NODE_YEARS[0]) return 0;
  if (y >= NODE_YEARS[n - 1]) return n - 1;
  for (let k = 0; k < n - 1; k++) {
    if (y >= NODE_YEARS[k] && y <= NODE_YEARS[k + 1]) {
      return k + (y - NODE_YEARS[k]) / (NODE_YEARS[k + 1] - NODE_YEARS[k]);
    }
  }
  return n - 1;
}

export function rateAtFrac(rates: number[], frac: number): number {
  const lo = Math.floor(frac);
  const hi = Math.ceil(frac);
  if (lo === hi) return rates[lo];
  return rates[lo] + (rates[hi] - rates[lo]) * (frac - lo);
}

function nodeIndex(id: string): number {
  return (DIAGRAM_NODES as readonly string[]).indexOf(id);
}

/** Schematic ghost deviation, in rate units — a fraction of the curve's own
 * span so it is visible but obviously not to scale. */
function liftFor(rates: number[]): number {
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const span = hi - lo;
  return span > 1e-6 ? span * 0.35 : 0.1;
}

/**
 * Build the diagram for a construct + side against a full nine-node par curve
 * (rates aligned to DIAGRAM_NODES, all non-null). Returns null for kinds with
 * no curve statement (volatility) or when a leg is missing.
 *
 * Sign convention, enforced here and tested: for a Pay position (`s = +1`) the
 * PRIMARY leg — the node whose rise defines "the displayed value rises" — gets
 * an UP arrow. Receive (`s = -1`) flips every arrow and mirrors the ghost.
 */
export function buildDiagramModel(
  c: Construct,
  rates: number[],
  side: Side,
): DiagramModel | null {
  if (rates.length !== DIAGRAM_NODES.length || rates.some((r) => r == null)) {
    return null;
  }
  const s: ArrowDir = side === "pay" ? 1 : -1;
  const lift = liftFor(rates);
  const base: GhostPoint[] = rates.map((rate, frac) => ({ frac, rate }));

  if (c.kind === "outright" || c.kind === "call") {
    const tenor = c.kind === "call" ? "1D" : c.tenor;
    const frac = yearsToFrac(labelToYears(tenor));
    const k = Math.round(frac);
    const ghost = base.map((p) => ({ ...p }));
    ghost[k] = { frac: k, rate: ghost[k].rate + s * lift };
    return {
      kind: "outright",
      term: s > 0 ? "금리 상승" : "금리 하락",
      // an outright statement is about the whole level curve → all of it is the
      // instrument's region (spec: "the whole curve at full strength").
      region: [0, DIAGRAM_NODES.length - 1],
      shaded: false,
      legs: [{ frac, arrow: s }],
      ghost,
    };
  }

  if (c.kind === "spread") {
    const a = nodeIndex(c.short);
    const b = nodeIndex(c.long);
    if (a < 0 || b < 0) return null;
    const ghost = base.map((p) => ({ ...p }));
    ghost[b] = { frac: b, rate: ghost[b].rate + s * lift }; // long up (pay)
    ghost[a] = { frac: a, rate: ghost[a].rate - s * lift }; // short down
    return {
      kind: "spread",
      term: s > 0 ? "스티프닝" : "플래트닝",
      region: [Math.min(a, b), Math.max(a, b)],
      shaded: false,
      legs: [
        { frac: b, arrow: s }, // long leg
        { frac: a, arrow: (-s) as ArrowDir }, // short leg
      ],
      ghost,
    };
  }

  if (c.kind === "butterfly") {
    const a = nodeIndex(c.short);
    const m = nodeIndex(c.belly);
    const b = nodeIndex(c.long);
    if (a < 0 || m < 0 || b < 0) return null;
    const ghost = base.map((p) => ({ ...p }));
    ghost[m] = { frac: m, rate: ghost[m].rate + s * lift }; // belly up (pay)
    ghost[a] = { frac: a, rate: ghost[a].rate - s * lift * 0.6 }; // wings down
    ghost[b] = { frac: b, rate: ghost[b].rate - s * lift * 0.6 };
    return {
      kind: "butterfly",
      term: s > 0 ? "벨리 약세" : "벨리 강세",
      region: [Math.min(a, b), Math.max(a, b)],
      shaded: false,
      legs: [
        { frac: m, arrow: s }, // belly
        { frac: a, arrow: (-s) as ArrowDir }, // short wing
        { frac: b, arrow: (-s) as ArrowDir }, // long wing
      ],
      ghost,
    };
  }

  if (c.kind === "forward") {
    const startY = labelToYears(c.start);
    const endY = c.tenor === "SPOT" ? startY : startY + labelToYears(c.tenor);
    const iA = yearsToFrac(startY);
    const iEnd = yearsToFrac(endY);
    if (iEnd <= iA) return null;
    const rateA = rateAtFrac(rates, iA);
    const rateEnd = rateAtFrac(rates, iEnd);
    // A forward rises when its segment STEEPENS: near end down, far end up — a
    // rotation, not a parallel shift. Pay (s>0) = steepen; Receive mirrors.
    const ghost: GhostPoint[] = [
      { frac: iA, rate: rateA - s * lift },
      { frac: iEnd, rate: rateEnd + s * lift },
    ];
    const steepenWord =
      s > 0 ? "가팔라질 때 오릅니다" : "완만해질 때 내립니다";
    return {
      kind: "forward",
      term: s > 0 ? "선도 금리 상승" : "선도 금리 하락",
      note: `${c.start}~${yearsToLabel(endY)} 구간이 ${steepenWord}.`,
      regionLabel: "선도 구간",
      region: [iA, iEnd],
      shaded: true,
      legs: [
        { frac: iEnd, arrow: s }, // far end
        { frac: iA, arrow: (-s) as ArrowDir }, // near end
      ],
      ghost,
    };
  }

  return null; // volatility / unknown — no curve statement
}
