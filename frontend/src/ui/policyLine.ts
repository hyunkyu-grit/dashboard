/* The two REFERENCE lines every %-unit chart carries [OWNER, 2026-07-31]:
 * CD 91d and the BOK base rate, always drawn together.
 *
 * The pairing is the owner's and it is one instruction, not two: CD is the
 * floating leg every KRW IRS quote is struck against and the base rate is what
 * CD tracks, so a rate is read against both or against neither. A first pass
 * drew only the base rate on the reasoning that the 3M node IS CD91, so CD was
 * already on screen wherever it mattered — which is true of exactly one chart
 * out of twenty and was the wrong reading.
 *
 * The charts here are INDEX-SPACED, not time-spaced: x is the position of a
 * point in the fetched series, so the same trading day is a different x on a
 * preview (~150 points) and on a full history (~2,600). The policy step is
 * dated, so it has to be projected through the series' own dates rather than
 * scaled by calendar time — that projection is the whole of `policyPath`, and
 * it is why the step corners cannot simply be handed to an SVG.
 *
 * CD is a daily SERIES, the base rate a STEP, and they are projected the same
 * way but drawn differently — see `alignSeries` and `policySegments` below.
 *
 * Rules this module exists to enforce, each of which is a wrong number on
 * screen if it slips:
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
 *   ONE AXIS PER UNIT. On a %-unit chart both references share the
 *   instrument's y-scale and the caller widens its domain to contain all
 *   three — a second axis would let rates in the SAME unit be compared at two
 *   different scales, which is worse than not drawing them. On a bp-unit
 *   chart (spread, butterfly) the references keep their OWN percent scale
 *   beside the instrument's [OWNER, 2026-08-03]: the two units cannot share
 *   an axis at all, and neither rebasing to a common index (destroys the
 *   level, which is the point of the overlay) nor clipping to the
 *   instrument's domain (pins the line to an edge) is a comparison. Each
 *   axis is labelled with its unit — see `policyAxisMode` below.
 *
 *   ALIGNED BY DATE, NOT BY POSITION. Two ~150-point previews of different
 *   series are downsampled independently, so index i is not the same day in
 *   both. Zipping them would draw a CD level against an instrument level from
 *   a different week — a plausible-looking chart that is simply wrong.
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

/** CD 91d projected onto another series' index space: for each of `points`,
 * CD's level on that date, or the most recent one before it.
 *
 * A merge, not a zip. The two previews are downsampled independently — ~150
 * points chosen per series — so index i is a different trading day in each,
 * and pairing by position would plot a CD level from one week against an
 * instrument level from another. It looks entirely plausible and is wrong,
 * which is why this walks both date axes.
 *
 * `null` before CD's first observation; the caller breaks the line there
 * rather than drawing a flat lead-in nobody measured. */
export function alignSeries(
  points: HistoryPoint[],
  ref: HistoryPoint[] | undefined,
): (number | null)[] {
  if (!ref || !ref.length) return [];
  const out: (number | null)[] = new Array(points.length).fill(null);
  let j = 0;
  for (let i = 0; i < points.length; i++) {
    while (j + 1 < ref.length && ref[j + 1].t <= points[i].t) j++;
    out[i] = ref[j].t <= points[i].t ? ref[j].v : null;
  }
  return out;
}

/** min/max of an aligned reference, so the caller can widen its y-domain. */
export function seriesExtent(
  values: (number | null)[],
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v == null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}

/** SVG polyline runs for an aligned reference, broken wherever it is null. */
export function seriesPath(
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string[] {
  const runs: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      if (cur.length > 1) runs.push(cur.join(" "));
      cur = [];
      continue;
    }
    cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  }
  if (cur.length > 1) runs.push(cur.join(" "));
  return runs;
}

/** How this instrument's chart carries the overlay [OWNER, 2026-08-03]:
 *
 *   "shared"    — % instruments. Same unit as the references, ONE axis; the
 *                 caller widens its y-domain to hold all three series.
 *   "secondary" — bp instruments (spreads, butterflies). The references keep
 *                 their own % scale beside the instrument's bp scale, and the
 *                 chart labels BOTH axes with their unit — two unlabelled
 *                 scales on one plot is a misreading waiting to happen.
 *   null        — ratio (volatility). A policy rate says nothing about a
 *                 dimensionless ratio; no overlay.
 *
 * The mode is decided by UNIT, not by chart kind, because unit is what the
 * axis actually plots — the row model routes every kind through its unit. */
export type PolicyAxisMode = "shared" | "secondary";

export function policyAxisMode(unit: string): PolicyAxisMode | null {
  if (unit === "%") return "shared";
  if (unit === "bp") return "secondary";
  return null;
}

/** Does this instrument take the overlay at all? % and bp; never ratio. */
export function takesPolicyOverlay(unit: string): boolean {
  return policyAxisMode(unit) !== null;
}
