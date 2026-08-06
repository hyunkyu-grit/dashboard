"use client";

/* Pay/Receive diagram — a MODE picture (diagram rebuild). Beside the DV01 block:
 * a fixed schematic curve (a gentle upward arc, identical every time — NOT
 * today's data, which is on screen in the curve view) showing which of the
 * three curve modes the instrument bets on and which way.
 *
 * Two curves only: the current shape (thin ink at 35%) and the wanted shape
 * (full-weight ink). The change between them — a lift (level), a tilt (slope),
 * or an arch (curvature) — is the entire content, and it is confined to a
 * neutral positional band (every kind) saying where along the curve the trade
 * lives; outside the band the two curves coincide. A direction-coloured fill between them (red where the wanted
 * shape is above the current, blue where below) makes the mode legible at a
 * glance. No leg markers, no tenor labels, no axis — the tenors already appear
 * twice on this panel; everything that is not the shape is noise. Logic +
 * bounds are in payReceiveModel.ts (unit-tested). Colours follow the palette
 * (ink structure, red/blue direction) — the palette session owns those. */

import {
  animate,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import { useEffect, useRef, useState } from "react";

import { classify } from "./gloss";
import { ENTER } from "./motion";
import {
  baseValue,
  diagramSpec,
  N,
  PLOT,
  wantedValue,
  type DiagramSpec,
  type Side,
} from "./payReceiveModel";
import type { Row } from "./rows";

type Pt = [number, number];

const xAt = (t: number) => PLOT.ml + t * (PLOT.w - PLOT.ml - PLOT.mr);
const yAt = (v: number) => PLOT.top + (1 - v) * (PLOT.bot - PLOT.top);

/** Catmull-Rom → cubic bezier: a smooth path through the sampled points. */
function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  const f = (n: number) => n.toFixed(2);
  let d = `M ${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

interface FillRegion {
  up: boolean;
  pts: Pt[];
}

/** Split the area between the two curves into runs of constant sign (wanted
 * above vs below current), so each run is filled with one direction colour and
 * the colour flips exactly where the curves cross. */
function fillRegions(cur: Pt[], want: Pt[], dv: number[]): FillRegion[] {
  const EPS = 1e-9;
  const cross = (a: number, b: number): Pt | null => {
    const da = dv[a];
    const db = dv[b];
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const g = da / (da - db);
      // at the crossing the two curves meet, so the point lies on the curve
      return [cur[a][0] + (cur[b][0] - cur[a][0]) * g, cur[a][1] + (cur[b][1] - cur[a][1]) * g];
    }
    return null;
  };
  const out: FillRegion[] = [];
  let i = 0;
  while (i < cur.length) {
    const s = dv[i] > EPS ? 1 : dv[i] < -EPS ? -1 : 0;
    if (s === 0) {
      i++;
      continue;
    }
    const curPts: Pt[] = [];
    const wantPts: Pt[] = [];
    const head = i > 0 ? cross(i - 1, i) : null;
    if (head) {
      curPts.push(head);
      wantPts.push(head);
    }
    let j = i;
    while (j < cur.length && (dv[j] > EPS ? 1 : dv[j] < -EPS ? -1 : 0) !== -s) {
      curPts.push(cur[j]);
      wantPts.push(want[j]);
      j++;
    }
    const tail = j < cur.length ? cross(j - 1, j) : null;
    if (tail) {
      curPts.push(tail);
      wantPts.push(tail);
    }
    out.push({ up: s > 0, pts: [...curPts, ...wantPts.reverse()] });
    i = j;
  }
  return out;
}

function Toggle({ side, onSide }: { side: Side; onSide: (s: Side) => void }) {
  return (
    <div className="flex overflow-hidden rounded-[6px] border border-edge text-[12px]">
      {(["pay", "receive"] as Side[]).map((sd) => (
        <button
          key={sd}
          type="button"
          onClick={() => onSide(sd)}
          className={
            sd === side
              ? "bg-ink px-2.5 py-0.5 text-page"
              : "px-2.5 py-0.5 opacity-50 hover:opacity-90"
          }
        >
          {sd === "pay" ? "페이" : "리시브"}
        </button>
      ))}
    </div>
  );
}

function Diagram({ spec }: { spec: DiagramSpec }) {
  /* Pay/Receive morph (motion session, Pass D). The deformation is LINEAR in
   * the sign, so one factor q ∈ [−1, +1] interpolates the wanted (ghost)
   * curve through the base curve to its mirrored position — the reader sees
   * one transformation, not two drawings. The solid current curve never
   * moves; the fill recomputes per frame and flips colour as q crosses 0.
   * An instrument change (different mode/band) snaps instead of morphing —
   * a morph between two different trades would be a lie.
   *
   * ENTER, not a spring [OWNER, 2026-08-06 — one overshoot, and it is the row
   * reorder]. An overshoot here was actively wrong: q past ±1 draws a curve
   * MORE deformed than the trade being described, so the diagram briefly
   * asserted a position nobody holds. This is also the one place in the
   * product that animates a non-composited property on purpose — `q` drives a
   * React render per frame and the SVG `d` and polygon points are recomputed.
   * That is allowed here and only here: it is a SCHEMATIC curve, not chart
   * data (§14's ban is on chart path geometry, which `pane-still` guards). */
  const reduced = useReducedMotion();
  const mv = useMotionValue<number>(spec.sign);
  const [q, setQ] = useState<number>(spec.sign);
  useMotionValueEvent(mv, "change", setQ);
  const shapeKey = `${spec.mode}|${spec.band[0]}|${spec.band[1]}`;
  const prevShapeKey = useRef(shapeKey);
  useEffect(() => {
    const shapeChanged = prevShapeKey.current !== shapeKey;
    prevShapeKey.current = shapeKey;
    if (reduced || shapeChanged) {
      mv.jump(spec.sign);
      setQ(spec.sign);
      return;
    }
    const controls = animate(mv, spec.sign, ENTER);
    return () => controls.stop();
  }, [spec.sign, shapeKey, reduced, mv]);

  const paySpec: DiagramSpec = { ...spec, sign: 1 };
  const ts = Array.from({ length: N }, (_, i) => i / (N - 1));
  const cur: Pt[] = ts.map((t) => [xAt(t), yAt(baseValue(t))]);
  const wantAt = (t: number) =>
    baseValue(t) + q * (wantedValue(paySpec, t) - baseValue(t));
  const want: Pt[] = ts.map((t) => [xAt(t), yAt(wantAt(t))]);
  const dv = ts.map((t) => wantAt(t) - baseValue(t)); // +ve = above
  const regions = fillRegions(cur, want, dv);

  return (
    <svg
      width={PLOT.w}
      height={PLOT.h}
      className="text-ink"
      role="img"
      aria-label={`pay/receive 커브 모드: ${spec.term}`}
    >
      {/* positional band (every kind): a soft, unlabelled neutral wash marking
          where along the curve the trade lives — front vs belly vs long end.
          A region, not a measurement: no boundary marks, no tenors, and never
          a direction colour (that is reserved for the fill). */}
      <rect
        x={xAt(spec.band[0])}
        y={PLOT.top}
        width={xAt(spec.band[1]) - xAt(spec.band[0])}
        height={PLOT.bot - PLOT.top}
        fill="currentColor"
        fillOpacity={0.05}
      />

      {/* direction-coloured fill between the two curves (the mode made legible) */}
      {regions.map((r, k) => (
        <polygon
          key={k}
          className={r.up ? "text-up" : "text-down"}
          points={r.pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ")}
          fill="currentColor"
          fillOpacity={0.16}
        />
      ))}

      {/* current shape — thin, faint */}
      <path
        d={smoothPath(cur)}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.35}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* wanted shape — confident, full weight */}
      <path
        d={smoothPath(want)}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* side is CONTROLLED by the popup (carry session, Pass C): the same toggle
 * signs the diagram and the carry panel, so the two can never disagree. */
export function PayReceive({
  row,
  side,
  onSide,
}: {
  row: Row;
  side: Side;
  onSide: (s: Side) => void;
}) {
  const c = classify(row);

  // Volatility (and anything with no curve statement): say so, don't invent a
  // picture — a ratio has no shape on the curve.
  if (c.kind === "volatility") {
    return (
      <div className="mt-4">
        <div className="flex h-[180px] w-[340px] items-center justify-center rounded-[10px] border border-dashed border-edge px-6 text-center text-[12px] leading-relaxed opacity-45">
          변동성은 커브의 모양이 아니라 크기의 비율이에요. 그래서 페이/리시브 그림으로 나타내지 않아요.
        </div>
      </div>
    );
  }

  const spec = diagramSpec(c, side);
  if (!spec) return null;

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center gap-2">
        <Toggle side={side} onSide={onSide} />
        <span className="text-[13px] font-semibold">{spec.term}</span>
      </div>
      <Diagram spec={spec} />
    </div>
  );
}
