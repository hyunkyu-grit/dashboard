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
export type Mode = "level" | "slope" | "curvature" | "none";

// ≥ 320×180; fixed y-domain, no axis. Deformation headroom top and bottom.
export const PLOT = { w: 340, h: 190, ml: 18, mr: 18, top: 16, bot: 174 };
export const N = 64; // samples across the width

// Exaggerated on purpose — comparable to the curve's own rise (~0.32 of the
// band), not a fraction of it. A subtle diagram is a failed diagram.
const DEFORM = 0.26;
const DEFORM_TILT = 0.24;
const MAX_YEARS = 10; // maps an instrument's legs onto the schematic x-domain

/** Every kind's deformation is confined to a positional band (band session:
 * where along the curve the trade lives — front vs belly vs long end). The
 * band is impressionistic, never a measurement: no labels, no boundary marks,
 * no tenors. A narrow-span instrument (1s1.5s) still needs a legible
 * deformation, so the band never shrinks below ~30% of the plot. */
export const MIN_BAND = 0.3;

export interface DiagramSpec {
  mode: Mode;
  term: string;
  sign: 1 | -1;
  band: [number, number]; // [t0, t1] in [0, 1] — every kind carries one
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

/** Legs (in years) → band [t0, t1] on the schematic x-domain, widened to
 * MIN_BAND about its centre when the raw span is narrower (shifted inward so
 * it stays in [0, 1]). */
function toBand(aYears: number, eYears: number): [number, number] {
  let t0 = Math.max(0, Math.min(1, aYears / MAX_YEARS));
  let t1 = Math.max(0, Math.min(1, eYears / MAX_YEARS));
  if (t1 - t0 < MIN_BAND) {
    const half = MIN_BAND / 2;
    const mid = Math.max(half, Math.min(1 - half, (t0 + t1) / 2));
    t0 = mid - half;
    t1 = mid + half;
  }
  return [t0, t1];
}

export function diagramSpec(c: Construct, side: Side): DiagramSpec | null {
  const sign: 1 | -1 = side === "pay" ? 1 : -1;
  const term = (m: Exclude<Mode, "none">) => (sign > 0 ? TERMS[m][0] : TERMS[m][1]);

  if (c.kind === "outright" || c.kind === "call") {
    // band = its tenor, narrow (MIN_BAND centred on the tenor's position)
    const y = c.kind === "call" ? 0 : labelToYears(c.tenor);
    return { mode: "level", term: term("level"), sign, band: toBand(y, y) };
  }
  if (c.kind === "spread") {
    // band = leg to leg, so 1s2s and 5s10s tilt in different places
    return {
      mode: "slope",
      term: term("slope"),
      sign,
      band: toBand(labelToYears(c.short), labelToYears(c.long)),
    };
  }
  if (c.kind === "butterfly") {
    // band = wing to wing
    return {
      mode: "curvature",
      term: term("curvature"),
      sign,
      band: toBand(labelToYears(c.short), labelToYears(c.long)),
    };
  }
  if (c.kind === "forward") {
    const a = labelToYears(c.start);
    const e = c.tenor === "SPOT" ? a : a + labelToYears(c.tenor);
    return { mode: "slope", term: term("slope"), sign, band: toBand(a, e) };
  }
  return null; // volatility / unknown — no curve statement
}

/** The fixed schematic curve: one gentle upward arc, in value units [0, 1]
 * (higher = higher on screen). Sits in [0.30, 0.62] so a full deformation has
 * headroom both ways. Identical every render — no relation to today's data. */
export function baseValue(t: number): number {
  return 0.3 + 0.32 * (1 - Math.pow(1 - t, 1.6));
}

/** Smoothstep plateau over [0, 1]: rises over the first quarter, holds at 1,
 * falls over the last quarter — a lift that tapers to nothing at the band
 * ends, so a level move reads as a lift, not an arch. */
function plateau(u: number): number {
  const RAMP = 0.25;
  const edge = Math.min(u, 1 - u);
  if (edge >= RAMP) return 1;
  const x = edge / RAMP;
  return x * x * (3 - 2 * x);
}

/** The wanted shape for a spec at position t, in value units. Pay lifts/tilts/
 * arches; Receive (sign −1) is the exact negation. The deformation is confined
 * to the band: outside it the wanted curve coincides with the current one, so
 * the eye goes straight to the region the trade is about. */
export function wantedValue(spec: DiagramSpec, t: number): number {
  const b = baseValue(t);
  const [t0, t1] = spec.band;
  if (t <= t0 || t >= t1) return b;
  const u = (t - t0) / (t1 - t0);
  const s = spec.sign;
  switch (spec.mode) {
    case "level": // the banded stretch lifts, tapering to the band ends
      return b + s * DEFORM * plateau(u);
    case "slope": // tilt meeting the current curve at both band ends
      // (near half down, far half up → the segment steepens for Pay)
      return b + s * DEFORM_TILT * -Math.sin(2 * Math.PI * u);
    case "curvature": // arch — band ends hold, the middle bulges
      return b + s * DEFORM * Math.sin(Math.PI * u);
    default:
      return b;
  }
}
