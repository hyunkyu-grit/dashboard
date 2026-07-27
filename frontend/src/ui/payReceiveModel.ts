/* Pay/Receive diagram MODEL — a MODE picture, not a data plot (diagram rebuild).
 *
 * Curve moves decompose into three modes, and every instrument here bets on
 * exactly one: LEVEL (the whole curve shifts up — outright), SLOPE (it tilts,
 * steeper/flatter — spread, forward), CURVATURE (it arches, belly bulging or
 * sagging — butterfly). The diagram says which mode and which direction and
 * nothing else — no real data, no tenors, no axis. This module is pure so the
 * mode mapping, the Pay/Receive negation, the labels, and the "wanted stays in
 * the plot" bound are unit-testable (guards/pay-receive-mode.test.ts).
 *
 * Sign convention: `sign = +1` for Pay (profits when the displayed value rises),
 * `-1` for Receive — the exact negation of the deformation for every mode. */

import type { Construct } from "./gloss";

export type Side = "pay" | "receive";
// A forward is a SLOPE confined to a band (spec Pass B: "forward to slope"), so
// it shares the slope mode and carries a `band`; it is not a separate mode.
export type Mode = "level" | "slope" | "curvature" | "none";

// ≥ 320×180; fixed y-domain, no axis. Deformation headroom top and bottom.
export const PLOT = { w: 340, h: 190, ml: 18, mr: 18, top: 16, bot: 174 };
export const N = 64; // samples across the width

// Exaggerated on purpose — comparable to the curve's own rise (~0.32 of the
// band), not a fraction of it. A subtle diagram is a failed diagram.
const DEFORM = 0.26;
const DEFORM_FWD = 0.24;
const MAX_YEARS = 10; // maps a forward's period onto the schematic x-domain

export interface DiagramSpec {
  mode: Mode;
  term: string;
  sign: 1 | -1;
  band?: [number, number]; // forward only: [t0, t1] in [0, 1]
}

/** Label → years, for positioning a forward's band ("1Y3M" = 1.25, "9M" = 0.75). */
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

// [pay term, receive term] per mode, in the established register.
const TERMS: Record<Exclude<Mode, "none">, [string, string]> = {
  level: ["금리 상승", "금리 하락"],
  slope: ["스티프닝", "플래트닝"], // spread and forward both read as a tilt
  curvature: ["벨리 약세", "벨리 강세"],
};

export function diagramSpec(c: Construct, side: Side): DiagramSpec | null {
  const sign: 1 | -1 = side === "pay" ? 1 : -1;
  const term = (m: Exclude<Mode, "none">) => (sign > 0 ? TERMS[m][0] : TERMS[m][1]);

  if (c.kind === "outright" || c.kind === "call") {
    return { mode: "level", term: term("level"), sign };
  }
  if (c.kind === "spread") {
    return { mode: "slope", term: term("slope"), sign };
  }
  if (c.kind === "butterfly") {
    return { mode: "curvature", term: term("curvature"), sign };
  }
  if (c.kind === "forward") {
    const a = labelToYears(c.start);
    const e = c.tenor === "SPOT" ? a : a + labelToYears(c.tenor);
    let t0 = Math.max(0, Math.min(1, a / MAX_YEARS));
    let t1 = Math.max(0, Math.min(1, e / MAX_YEARS));
    if (t1 - t0 < 0.14) {
      // keep the band wide enough to read even for a short/near forward
      const mid = Math.max(0.09, Math.min(0.91, (t0 + t1) / 2));
      t0 = mid - 0.07;
      t1 = mid + 0.07;
    }
    return { mode: "slope", term: term("slope"), sign, band: [t0, t1] };
  }
  return null; // volatility / unknown — no curve statement
}

/** The fixed schematic curve: one gentle upward arc, in value units [0, 1]
 * (higher = higher on screen). Sits in [0.30, 0.62] so a full deformation has
 * headroom both ways. Identical every render — no relation to today's data. */
export function baseValue(t: number): number {
  return 0.3 + 0.32 * (1 - Math.pow(1 - t, 1.6));
}

/** The wanted shape for a spec at position t, in value units. Pay lifts/tilts/
 * arches; Receive (sign −1) is the exact negation. */
export function wantedValue(spec: DiagramSpec, t: number): number {
  const b = baseValue(t);
  const s = spec.sign;
  switch (spec.mode) {
    case "level": // whole curve translates up, parallel
      return b + s * DEFORM;
    case "slope":
      if (spec.band) {
        // forward: a slope confined to a band, meeting the current curve at
        // both band ends (near half down, far half up → the segment steepens)
        const [t0, t1] = spec.band;
        if (t <= t0 || t >= t1) return b;
        const u = (t - t0) / (t1 - t0);
        return b + s * DEFORM_FWD * -Math.sin(2 * Math.PI * u);
      }
      // spread: pivot about the midpoint — far up, near down
      return b + s * DEFORM * (2 * t - 1);
    case "curvature": // ends hold, middle arches
      return b + s * DEFORM * Math.sin(Math.PI * t);
    default:
      return b;
  }
}
