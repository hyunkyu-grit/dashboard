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

/* The LEVEL HEADER — the label over every current-level surface (pass M).
 *
 * It used to read 현재, which named the quantity and not the DAY it belongs to.
 * Against a dataset that is a file, those are different facts: the level under
 * that header is a CLOSE, and on any day the file has not been rebuilt, "현재"
 * asserts something the data cannot support. The header now prints the date
 * instead, and the word is gone from the level surfaces.
 *
 * THE DATE IS THE DATASET'S `asof`, NEVER THE READER'S CLOCK [OWNER]. A header
 * derived from `new Date()` would print today over last Friday's closes — the
 * silent-staleness failure `lib/freshness.ts` exists to prevent, restated in
 * the one place a reader trusts most. When the data IS current the two agree,
 * which is the whole point; when they disagree the honest one is `asof`, and
 * the header then says the same day as the freshness chip beside it.
 */

/** The dataset's as-of date as the level header (ISO, `2026-07-24`). Falls back
 * to the quantity's name if a payload arrives without one — a header that names
 * nothing is worse than the old word. Width comes from `WIDEST.levelHead`
 * (ui/columns.ts); keep the two in step. */
export function levelHeadText(asof: string | null | undefined): string {
  return asof && asof.length > 0 ? asof : "현재";
}

/** The header's tooltip: what the column's numbers are. */
export function levelHeadTitle(asof: string | null | undefined): string {
  return asof && asof.length > 0 ? `${asof} 종가 기준` : "가장 최근 레벨";
}

/** Tailwind text-color class for a signed value: red up, blue down, ink flat
 * (§9 direction). Null/zero is neutral ink. */
export function dirClass(v: number | null | undefined): string {
  if (v == null || v === 0) return "text-ink";
  return v > 0 ? "text-up" : "text-down";
}
