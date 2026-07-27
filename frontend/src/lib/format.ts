/* Numeric display grammar.
 *
 * Sign is now carried by BOTH an explicit +/− prefix (U+2212) and a direction
 * hue (red up / blue down — §9, Session 12). The mini-bar keeps sign legible
 * in grayscale, so nothing depends on hue alone. */

import type { Unit } from "./api";

const MINUS = "−";
const EMDASH = "—"; // the null placeholder — never 0.00, never blank (§ vol)

/** Rate level, 4 decimals: 4.2600 */
export function fmtRate(v: number | null | undefined): string {
  return v == null ? "–" : v.toFixed(4);
}

/** Signed delta in bp, 1 decimal: +4.3 / −12.5 */
export function fmtBp(v: number | null | undefined): string {
  if (v == null) return "–";
  const s = Math.abs(v).toFixed(1);
  return v < 0 ? `${MINUS}${s}` : `+${s}`;
}

/** Level, unit-aware: % → 4dp, bp → 1dp, ratio → 2dp. Null → em dash. */
export function fmtLevel(v: number | null | undefined, unit: Unit): string {
  if (v == null) return EMDASH;
  if (unit === "%") return v.toFixed(4);
  if (unit === "ratio") return v.toFixed(2);
  return v.toFixed(1);
}

/** Signed change, unit-aware. A ratio's change is a ratio difference at 2dp
 * with no unit; bp/% changes stay at 1dp (fmtBp). Null → em dash. */
export function fmtDelta(v: number | null | undefined, unit: Unit): string {
  if (v == null) return EMDASH;
  if (unit === "ratio") {
    const s = Math.abs(v).toFixed(2);
    return v < 0 ? `${MINUS}${s}` : `+${s}`;
  }
  return fmtBp(v);
}

/** Tailwind text-color class for a signed value: red up, blue down, ink flat
 * (§9 direction). Null/zero is neutral ink. */
export function dirClass(v: number | null | undefined): string {
  if (v == null || v === 0) return "text-ink";
  return v > 0 ? "text-up" : "text-down";
}
