/* The BOK base rate drawn onto a history chart [OWNER, 2026-07-31].
 *
 * The charts here are INDEX-SPACED, not time-spaced: x is the position of a
 * point in the fetched series, so the same trading day is a different x on a
 * preview (~150 points) and on a full history (~2,600). The policy step is
 * dated, so it has to be projected through the series' own dates rather than
 * scaled by calendar time — that projection is the whole of `policyPath`, and
 * it is why the step corners cannot simply be handed to an SVG.
 *
 * Three rules this module exists to enforce, each of which is a wrong number
 * on screen if it slips:
 *
 *   SQUARE CORNERS. A policy rate holds flat and jumps. A diagonal between two
 *   decisions would draw rates that were never in force, on days they were
 *   never in force.
 *
 *   NEVER PAST `through`. The backend stops the step short when the workbook
 *   has not been refreshed through a Board meeting (backend/app/policy.py).
 *   Running the line to the axis end instead is the exact failure that bound
 *   exists to prevent, and it looks completely normal.
 *
 *   ONE AXIS. The step shares the instrument's y-scale, so the caller widens
 *   its domain to contain both. Clipping the step to the instrument's own
 *   domain would pin it flat against an edge and read as "equal to the
 *   minimum"; a second axis would let two rates in the same unit be compared
 *   at two different scales, which is worse than not drawing it at all.
 */

import type { HistoryPoint, PolicyStep } from "@/lib/api";

export interface PolicySegment {
  /** inclusive point index the level starts at */
  from: number;
  /** inclusive point index the level runs to */
  to: number;
  rate: number;
}

/** First index whose date is on or after `iso`; `points.length` if none. */
function indexAtOrAfter(points: HistoryPoint[], iso: string): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < iso) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The step as flat segments over the series' index space, clipped to
 * `through` and to the series' own span. Empty when nothing overlaps — a
 * series that ends before the first decision, or a `through` before the
 * series begins. */
export function policySegments(
  points: HistoryPoint[],
  policy: PolicyStep | undefined,
): PolicySegment[] {
  if (!policy || points.length < 2) return [];

  // The last index the step is allowed to reach: the newest point on or
  // before `through`. Both bounds matter — `through` stops an unverified
  // carry, the series length stops us drawing off the end of the chart.
  const k = indexAtOrAfter(points, policy.through);
  const end = k < points.length && points[k].t === policy.through ? k : k - 1;
  if (end < 0) return [];

  const out: PolicySegment[] = [];
  for (let i = 0; i < policy.steps.length; i++) {
    const s = policy.steps[i];
    // a decision before the series starts is still IN FORCE at its start —
    // clamp to 0 rather than dropping it, or the chart opens with no line
    // until the next decision, which would be a gap that means nothing
    const start = Math.max(0, indexAtOrAfter(points, s.date));
    if (start > end) break;
    const next = policy.steps[i + 1];
    const stop = next
      ? Math.min(end, Math.max(start, indexAtOrAfter(points, next.date) - 1))
      : end;
    // later decisions overwrite an earlier one clamped to the same start
    if (out.length && out[out.length - 1].from >= start) out.pop();
    if (stop >= start) out.push({ from: start, to: stop, rate: s.rate });
  }
  return out;
}

/** The min/max the step occupies, so a caller can widen its y-domain to hold
 * both series before it scales anything. Null when there is nothing to draw. */
export function policyExtent(
  segments: PolicySegment[],
): { min: number; max: number } | null {
  if (!segments.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const s of segments) {
    if (s.rate < min) min = s.rate;
    if (s.rate > max) max = s.rate;
  }
  return { min, max };
}

/** SVG polyline points for the step: horizontal runs joined by vertical
 * risers. Adjacent segments share the riser; a gap between them (which the
 * builder above does not produce, but a future one might) breaks the line
 * rather than inventing a diagonal across it. */
export function policyPath(
  segments: PolicySegment[],
  x: (i: number) => number,
  y: (v: number) => number,
): string[] {
  const runs: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const prev = segments[i - 1];
    if (prev && prev.to + 1 !== s.from) {
      if (cur.length) runs.push(cur.join(" "));
      cur = [];
    }
    if (!cur.length) cur.push(`${x(s.from).toFixed(1)},${y(s.rate).toFixed(1)}`);
    else {
      // the riser: up/down at the decision's x, THEN along — square, never
      // a diagonal between two rates that were never in force
      cur.push(`${x(s.from).toFixed(1)},${y(s.rate).toFixed(1)}`);
    }
    cur.push(`${x(s.to).toFixed(1)},${y(s.rate).toFixed(1)}`);
  }
  if (cur.length) runs.push(cur.join(" "));
  return runs;
}

/** The step as `{time, value}` for a lightweight-charts line series with
 * `LineType.WithSteps` — the enlarged view's chart (the library draws the
 * square corner itself, so no interpolated rate is ever painted).
 *
 * Every corner is SNAPPED to a date the instrument's axis actually has. A
 * Board decision on a holiday is not a trading day, and handing that date to
 * the chart would insert a column no observation occupies — which shifts every
 * bar after it. Corners before the series begins collapse onto its first date,
 * keeping the last of them: the rate in force on day one.
 *
 * A closing point is appended at `through`, so the final level runs flat to
 * the bound the backend set and stops there rather than at the axis end.
 */
export function snapPolicyToTimes(
  times: string[],
  policy: PolicyStep,
): { time: string; value: number }[] {
  if (!times.length || !policy.steps.length) return [];
  const idx = (iso: string) => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < iso) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const k = idx(policy.through);
  const endI = k < times.length && times[k] === policy.through ? k : k - 1;
  if (endI < 0) return [];

  const out: { time: string; value: number }[] = [];
  for (const s of policy.steps) {
    const i = idx(s.date);
    if (i > endI) break;
    const time = times[Math.max(0, i)];
    // several pre-series decisions collapse onto the first date; the LAST is
    // the one in force there, so it replaces rather than appends
    if (out.length && out[out.length - 1].time === time) out.pop();
    out.push({ time, value: s.rate });
  }
  if (!out.length) return [];
  const endTime = times[endI];
  if (out[out.length - 1].time !== endTime) {
    out.push({ time: endTime, value: out[out.length - 1].value });
  }
  return out;
}

/** Does this instrument take the overlay at all? Percent only: the base rate
 * is a level in percent, and laying 2.75 over a ±30bp spread or a 12.0
 * volatility ratio rescales the chart instead of comparing anything. */
export function takesPolicyOverlay(unit: string): boolean {
  return unit === "%";
}
