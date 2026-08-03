/* Visible-window extremes (pass O, 2026-08-03).
 *
 * The high and the low OF WHAT IS PLOTTED — a property of the viewport, not
 * of the series. The 52-week statistics in the tooltip answer a different
 * question (a fixed trailing window, computed server-side); these answer
 * "where are the extremes of the picture in front of me", so they are
 * computed client-side from the plotted slice and move with it. They are
 * deliberately NOT in the payload: a payload field would be one window
 * baked for every reader, which is the opposite of a viewport property.
 *
 * ONE SCAN, TWO CONSUMERS. The chart's y-domain and the marked points both
 * come from this result, so the dot that claims "this is the high" is at the
 * exact value the domain was stretched to — they cannot disagree.
 *
 * Stated rules:
 *   TIES — the FIRST occurrence wins (strict comparisons). Two days printing
 *   the same extreme level mark the earlier one; a rule either way is fine,
 *   but it has to be one rule.
 *   FLAT WINDOW — every point equal means hi === lo === 0: the high IS the
 *   low, and both marks sit on the first point. The caller may treat the
 *   coincidence however it likes; this module reports the indices honestly.
 *   EMPTY — null. A window with nothing in it has no extremes.
 */

import type { Unit } from "@/lib/api";
import { fmtLevel } from "@/lib/format";

export interface WindowExtremes {
  /** index of the window's highest value (first occurrence) */
  hi: number;
  /** index of the window's lowest value (first occurrence) */
  lo: number;
}

export function windowExtremes(
  points: readonly { v: number }[],
): WindowExtremes | null {
  if (!points.length) return null;
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < points.length; i++) {
    const v = points[i].v;
    if (v > points[hi].v) hi = i;
    if (v < points[lo].v) lo = i;
  }
  return { hi, lo };
}

/* ——— Visible-range extremes for the ZOOMABLE chart (2026-08-03) ———
 *
 * The preview above has no zoom, so its window IS its `points` prop and
 * `windowExtremes` scans all of it. The detail chart (wall/DetailChart —
 * currently unreachable, see its header ⚠) zooms and pans: there the window
 * is the VISIBLE LOGICAL RANGE, a fractional [from, to] over data indices,
 * and the extremes must follow it — the same view-state category as the
 * date-axis labels and the tooltip's 구간 stats, computed client-side from
 * data already served (§16: no API for a viewport property).
 *
 * The scan works on SPANS so line and candle modes share it: a line point
 * occupies one value (hi === lo === close); a candle occupies [low, high].
 * The high of the window is the max of span highs, the low the min of span
 * lows — exactly what the library's autoscale stretches the y-axis to, so
 * the marks agree with the picture by construction.
 *
 * Stated rules (these deliberately DIFFER from `windowExtremes` where noted):
 *   RANGE — visible indices are ceil(from)..floor(to), clamped: the same
 *   convention the tooltip's 구간 stats use, so a mark and the tooltip can
 *   never disagree about one window. `null` means "everything" (what the
 *   library reports before a range exists).
 *   TIES — the MOST RECENT occurrence wins [OWNER task, 2026-08-03]. The
 *   preview's fixed window marks the first; on a zooming chart the newest
 *   print is the one the reader can act on. One rule per surface, stated.
 *   FLAT — a window with one distinct value has neither a high nor a low:
 *   ONE mark, on the last visible point, value printed bare (the preview's
 *   own flat grammar).
 *   EMPTY — no visible indices, no marks.
 */

/** One plotted x-position's vertical extent. */
export interface Span {
  t: string;
  hi: number;
  lo: number;
}

/** Line mode: a point's extent is its close, twice. */
export const lineSpans = (
  points: readonly { t: string; v: number }[],
): Span[] => points.map((p) => ({ t: p.t, hi: p.v, lo: p.v }));

/** Candle mode: a bar's extent is its wick range. */
export const candleSpans = (
  bars: readonly { t: string; h: number; l: number }[],
): Span[] => bars.map((b) => ({ t: b.t, hi: b.h, lo: b.l }));

export interface ExtremeMark {
  kind: "hi" | "lo" | "flat";
  /** data index the mark sits on — always inside the visible window */
  i: number;
  time: string;
  v: number;
  /** 최고/최저 + the value through `fmtLevel` — the level grammar every
   * surface prints (readout-parity); bare for a flat window. */
  text: string;
}

export function extremeMarks(
  spans: readonly Span[],
  range: { from: number; to: number } | null,
  unit: Unit,
): ExtremeMark[] {
  if (!spans.length) return [];
  const a = Math.max(0, range ? Math.ceil(range.from) : 0);
  const b = Math.min(spans.length - 1, range ? Math.floor(range.to) : spans.length - 1);
  if (b < a) return [];
  let hi = a;
  let lo = a;
  for (let i = a + 1; i <= b; i++) {
    if (spans[i].hi >= spans[hi].hi) hi = i; // >= : ties take the newest
    if (spans[i].lo <= spans[lo].lo) lo = i;
  }
  if (spans[hi].hi === spans[lo].lo) {
    return [
      { kind: "flat", i: b, time: spans[b].t, v: spans[b].hi, text: fmtLevel(spans[b].hi, unit) },
    ];
  }
  const marks: ExtremeMark[] = [
    { kind: "hi", i: hi, time: spans[hi].t, v: spans[hi].hi, text: `최고 ${fmtLevel(spans[hi].hi, unit)}` },
    { kind: "lo", i: lo, time: spans[lo].t, v: spans[lo].lo, text: `최저 ${fmtLevel(spans[lo].lo, unit)}` },
  ];
  // the markers API requires ascending time; same-time (one visible candle)
  // keeps hi first
  return marks.sort((x, y) => (x.i === y.i ? 0 : x.i - y.i));
}
