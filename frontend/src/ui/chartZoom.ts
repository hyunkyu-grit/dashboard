/* Preview-chart zoom state (zoom-and-color session, 2026-08-04).
 *
 * The preview chart zooms IN PLACE now [OWNER: "크게보기 버튼을 안 눌러도 이
 * 창에서 그냥 확대하고 축소하고"] — wheel to zoom around the cursor, drag to
 * pan, without leaving for the enlarged view. The state is ONE value: the
 * visible index range over the fetched points, or null for the whole span.
 * Everything downstream (extremes, y-domain, date labels, overlay alignment,
 * the tooltip's crosshair) is already a pure function of the plotted slice —
 * pass O built it that way on purpose — so zoom is: pick the slice.
 *
 * Pure functions, index space only. Pixels are the component's business.
 */

export interface ViewRange {
  /** first visible point index, inclusive */
  i0: number;
  /** last visible point index, inclusive */
  i1: number;
}

/** The narrowest window worth drawing — below this a 150-point preview is a
 * handful of segments and the crosshair outruns the data. */
export const MIN_SPAN = 10;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Zoom about an anchor. `anchorFrac` is where the cursor sits in the visible
 * window (0..1); `factor` scales the span (<1 zooms in, >1 zooms out). The
 * date under the cursor stays under the cursor. Returns null — the full span
 * — the moment zooming out reaches everything, so "fully zoomed out" and
 * "never zoomed" are one state, not two. */
export function zoomRange(
  cur: ViewRange | null,
  len: number,
  anchorFrac: number,
  factor: number,
): ViewRange | null {
  if (len < 2) return null;
  const base = cur ?? { i0: 0, i1: len - 1 };
  const span = base.i1 - base.i0 + 1;
  const nextSpan = clamp(Math.round(span * factor), MIN_SPAN, len);
  if (nextSpan >= len) return null;
  const frac = clamp(anchorFrac, 0, 1);
  // the anchor's index, held at the same fraction of the new window
  const anchor = base.i0 + frac * (span - 1);
  const i0 = clamp(Math.round(anchor - frac * (nextSpan - 1)), 0, len - nextSpan);
  return { i0, i1: i0 + nextSpan - 1 };
}

/** Pan by a signed index delta (positive = towards newer points). The window
 * slides and stops at the data's edges; its span never changes. Null in,
 * null out — the full span has nowhere to go. */
export function panRange(
  cur: ViewRange | null,
  len: number,
  deltaIdx: number,
): ViewRange | null {
  if (!cur) return null;
  const span = cur.i1 - cur.i0 + 1;
  const i0 = clamp(Math.round(cur.i0 + deltaIdx), 0, len - span);
  return { i0, i1: i0 + span - 1 };
}
