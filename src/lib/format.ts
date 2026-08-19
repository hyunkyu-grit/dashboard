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

/**
 * The unit as it is WRITTEN BESIDE A NUMBER in running text — a row's subtitle,
 * a tooltip, a sentence. NOT for column headers: a column names its unit once at
 * the top, and repeating it in every cell pushes the digits apart, which is the
 * one thing a column of comparable numbers must not do.
 *
 * `가격` and `ratio` return the empty string, and neither is an oversight.
 * A futures price point is a price — nobody writes "104.230가격" — and a ratio is
 * dimensionless, so any suffix here would be a unit this product invented rather
 * than one its readers use.
 */
export function unitSuffix(unit: Unit): string {
  if (unit === "%") return "%";
  if (unit === "bp") return "bp";
  return "";
}

/** Level, unit-aware: % → 4dp, bp → 1dp, ratio → 2dp. Null → em dash. */
export function fmtLevel(v: number | null | undefined, unit: Unit): string {
  if (v == null) return EMDASH;
  if (unit === "%") return v.toFixed(4);
  if (unit === "ratio") return v.toFixed(2);
  // 가격: futures price points. Three places, because 저평가 lives in the third —
  // at two it prints as -0.0 and reads as "no basis".
  if (unit === "가격") return v.toFixed(3);
  return v.toFixed(1);
}

/** A candle's 등락률 — (종가 − 시가) / 시가, 2dp, signed (§G).
 *
 * ONE function because two surfaces print it: the popup's candle tooltip and,
 * since 2026-08-13, the preview chart's. It lived inline in DetailChart as a
 * bare `toFixed(2)`, which is exactly the second-display-grammar failure this
 * module exists to prevent (readout-parity).
 *
 * A ZERO OPEN HAS NO PERCENT CHANGE and prints the em dash. The inline version
 * returned `+0.00%` there, which is not a rounding — it is a fabricated number
 * on a bar that moved. Spreads and butterflies cross zero, so this is a real
 * bar in this product, not a theoretical one.
 */
export function fmtChangePct(
  open: number | null | undefined,
  close: number | null | undefined,
): string {
  if (open == null || close == null || open === 0) return EMDASH;
  const pct = ((close - open) / open) * 100;
  const s = `${Math.abs(pct).toFixed(2)}%`;
  return pct < 0 ? `${MINUS}${s}` : `+${s}`;
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

/**
 * The dataset's as-of date as the level header — **month and day, no year**
 * [OWNER 2026-08-14: "앞에 연도는 없애줘도 될 듯"].
 *
 * MEASURED, and the reason the owner saw it wrap: a CDS `TableCell` spends 16px
 * on each side, so the 104px 현재 column offers 72px of text width, and
 * `2026-08-13` at 13px/600 renders 78.2px. It broke to two lines and made the
 * header row taller than every other column's.
 *
 *     2026-08-13   78.2 px   ← wraps in 72
 *          08-13   ~40  px   ← one line, with room
 *
 * The year is not lost: `levelHeadTitle` keeps the full date in the cell's
 * tooltip, and the freshness chip in the top bar states it in full beside the
 * feed's name. A column header names the day; the page states the date.
 *
 * Falls back to the quantity's name if a payload arrives without one — a header
 * that names nothing is worse than the old word. Width comes from
 * `WIDEST.levelHead` (table/columns.ts); keep the two in step.
 */
export function levelHeadText(asof: string | null | undefined): string {
  if (!asof || asof.length === 0) return "현재";
  // ISO `YYYY-MM-DD` → `MM-DD`. Anything else is passed through untouched
  // rather than sliced blindly: a payload with a different shape should look
  // wrong, not be silently trimmed to five characters of something else.
  const m = /^\d{4}-(\d{2}-\d{2})$/.exec(asof);
  return m ? m[1] : asof;
}

/** The header's tooltip: what the column's numbers are. */
export function levelHeadTitle(asof: string | null | undefined): string {
  return asof && asof.length > 0 ? `${asof} 종가 기준` : "가장 최근 레벨";
}

/** AXIS orientation label — deliberately COARSER than a level (bp → 1dp,
 * % / ratio → 2dp). Two gridline values exist to orient the eye on a y-range,
 * and `4.2446` in that role reads as data; full precision belongs to the
 * readout card, through `fmtLevel`. One definition for every chart axis
 * (CurveView's y marks, the preview's dual-axis unit ticks) so "how coarse is
 * an axis" cannot drift per surface. */
export function fmtAxis(v: number, unit: Unit): string {
  return unit === "bp" ? v.toFixed(1) : v.toFixed(2);
}

/** Tailwind text-color class for a signed value: red up, blue down, ink flat
 * (§9 direction). Null/zero is neutral ink. */
export function dirClass(v: number | null | undefined): string {
  if (v == null || v === 0) return "text-ink";
  return v > 0 ? "text-up" : "text-down";
}
