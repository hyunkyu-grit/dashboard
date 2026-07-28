/* Curve gesture MODEL (motion session, Pass E) — pure, unit-testable.
 *
 * The popup diagram teaches the mode in the abstract; the curve view shows
 * what that mode looks like on today's shape — as a GESTURE, not a picture. A
 * few bp of curvature is invisible as a static shape but obvious as movement,
 * so a ghost copy of the real curve deforms to the wanted shape, holds, and
 * fades. The exaggeration is a FIXED visible amount (px at the leg), never
 * the true bp — magnitude is stated in numbers a few centimetres away.
 *
 * Geometry is REUSED from the diagram model (diagramSpec → mode/sign/band via
 * toBand, modeShape for the deformation) — one geometry, two renderings. */

import { classify } from "./gloss";
import { diagramSpec, labelToYears, modeShape, type Side } from "./payReceiveModel";
import type { Row } from "./rows";

/** Fixed exaggeration at the deformation's peak, in px. A truthful 5bp
 * deformation would be invisible; this is a gesture. */
export const GESTURE_AMP_PX = 10;

/** Timing (ms): slower than the interface's other motion — this one is meant
 * to be watched rather than felt. Deform out, hold, fade. */
export const GESTURE = { deformMs: 400, holdMs: 600, fadeMs: 300 };

/** Whether a row makes a curve statement at all — volatility and unknown
 * rows play nothing. */
export function hasCurveStatement(row: Row): boolean {
  return diagramSpec(classify(row), "pay") !== null;
}

/** Per-node ghost offsets in px (positive = curve moves UP on screen) for a
 * pinned instrument, from the Pay perspective by default. Node tenor labels
 * map onto the band's linear 10y domain. Returns null when the row makes no
 * curve statement (volatility / unknown) — nothing plays. */
export function gestureOffsets(
  row: Row,
  nodeLabels: string[],
  side: Side = "pay",
): number[] | null {
  const spec = diagramSpec(classify(row), side);
  if (!spec) return null;
  const [b0, b1] = spec.band;
  return nodeLabels.map((label) => {
    const t = Math.max(0, Math.min(1, labelToYears(label) / 10));
    if (t <= b0 || t >= b1) return 0;
    const u = (t - b0) / (b1 - b0);
    return spec.sign * GESTURE_AMP_PX * modeShape(spec.mode, u);
  });
}
