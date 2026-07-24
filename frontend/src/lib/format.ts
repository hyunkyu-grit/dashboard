/* Numeric display grammar. Sign is expressed with an explicit +/− prefix
 * (U+2212), never color (design spec §5). */

const MINUS = "−";

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
