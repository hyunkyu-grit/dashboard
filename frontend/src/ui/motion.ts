/* Motion tokens (DESIGN §14). Motion is chrome only — never applied to chart
 * path geometry. `prefers-reduced-motion` collapses every animation to an
 * instant state change [OWNER, 2026-08-06]: the CSS half is the blanket in
 * app/globals.css, the TS half is `instant()` on every authored `transition=`.
 *
 * THE TIMING SYSTEM IS THREE DURATIONS AND ONE CURVE (pass B). It is mirrored
 * from theme/tokens.css because motion/react takes numbers and cannot read a
 * custom property; guards/motion-tokens.test.ts fails on drift. Same
 * arrangement theme/ramp.ts EDGE_OPACITY has with the dark hairlines, and for
 * the same reason.
 *
 * What this replaced: seven distinct durations and four easing curves, of
 * which exactly one curve had been chosen deliberately. Every bare
 * `{duration: x}` inherited motion's tween default `easeInOut`, so nine of the
 * ten non-spring transitions in the product accelerated on entry. */

import type { Transition } from "motion/react";

/** Seconds. MIRRORS --bw-motion-* in theme/tokens.css (which is in ms). */
export const MOTION = {
  /** hover tint, focus ring, chip state */
  fast: 0.12,
  /** every entrance */
  base: 0.22,
  /** every exit — an exit always runs shorter than its entrance */
  exit: 0.16,
} as const;

/** MIRRORS --bw-ease-out. Hard deceleration, no overshoot [OWNER, 2026-08-06].
 * The product's previous curve was cubic-bezier(.22,1,.36,1); the owner chose
 * this one, so it is the ONLY curve and ARRIVE moved onto it too. */
export const EASE_OUT = [0.32, 0.72, 0, 1] as const;

/** The default entrance. */
export const ENTER: Transition = {
  duration: MOTION.base,
  ease: EASE_OUT,
};

/** The default exit. Exits never overshoot and never outlast an entrance. */
export const EXIT: Transition = {
  duration: MOTION.exit,
  ease: EASE_OUT,
};

/** State changes with no travel — a tint, a chip, a focus ring. */
export const FAST: Transition = {
  duration: MOTION.fast,
  ease: EASE_OUT,
};

/* ── The one signature moment ──────────────────────────────────────────────
 * EXACTLY ONE SURFACE MAY OVERSHOOT [OWNER, 2026-08-06], and it is the row
 * reorder. Six did before this pass (tab underline, row reorder, preview chart
 * entrance, the pay/receive morph and both sheets); the other five are now
 * ENTER/EXIT.
 *
 * Why the reorder won it: §14 ranks it as the only motion in the product that
 * is functional rather than decorative — it is what preserves "which row is
 * which" across a re-sort — and it is the only candidate where the overshoot
 * lands on a POSITION the eye is already tracking rather than on a surface
 * arriving from nothing. A row that overshoots and settles reads as "this one
 * landed here". (Pinning was the other candidate and is rejected: it already
 * carries three non-motion acknowledgments, and §14 closed that question when
 * the ghost gesture was removed.)
 *
 * ζ = 30 / (2·√400) = 0.75 — underdamped, one visible overshoot. */
export const SPRING: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 30,
};

export const STAGGER_STEP = 0.04; // 40ms between briefing/log rows
export const PRESS_SCALE = 0.98;

/* ── Content arrival (backtest answer) ─────────────────────────────────────
 * A short fade + rise for a block the reader just asked for. It was its own
 * 250ms / cubic-bezier(.22,1,.36,1) pair; it is ENTER now, because a timing
 * system with one exception is not a timing system. The chart-geometry ban
 * stands: the CONTAINER rises, no chart path ever animates. */
export const ARRIVE: Transition = ENTER;
/** the answer's two halves arrive as one gesture — chart pair first, the
 * money below it a beat later */
export const ARRIVE_STAGGER = 0.06;

/** The reduced-motion rule: any transition collapses to instant (duration 0).
 * EVERY authored `transition=` in the product routes through this — that is
 * the rule, and guards/reduced-motion.test.ts counts the call sites rather
 * than testing this function in isolation (which is what it used to do, and
 * why it passed while the rule was false everywhere except one file). */
export function instant(base: Transition, reduced: boolean): Transition {
  return reduced ? { duration: 0 } : base;
}

/** Event-time read of the OS preference, for the imperative paths CSS and
 * MotionConfig cannot reach: `scrollIntoView({behavior:"smooth"})` outranks
 * `scroll-behavior: auto` because the argument is explicit. Called from
 * handlers, never during render, so there is nothing for the compiler rules to
 * object to and no store to subscribe. Defaults to "not reduced" where
 * matchMedia is absent (SSR, jsdom). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Scroll an element into view, honouring the preference. The only scrolling
 * the product does programmatically (command bar jump, change-log focus). */
export function scrollIntoViewSafely(el: Element): void {
  el.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
}

/* ── Row reorder ───────────────────────────────────────────────────────────
 * Sliding rows to their new positions on a re-sort is functional, not
 * decorative: it is the only thing that preserves which row is which across
 * 140 rows. Enter fades in at destination; exit fades in place (popLayout).
 * Transform-only FLIP via motion's layout="position". */

/** Above this row count the reorder is instant — even viewport-culled
 * bookkeeping (a DOM read per row) stops being worth it. The largest tab
 * (포워드, 140 rows) stays well under it and animates, culled. */
export const FLIP_MAX_ROWS = 400;

/** Screens of slack around the viewport: a row animates only if its old or
 * new position is within this many viewport-heights of the visible window. */
export const FLIP_NEAR_SCREENS = 1;

/** Hard ceiling on how many rows may animate at once, ON TOP of the
 * geometric cull (pass B).
 *
 * The cull alone scales WITH the viewport, which is the half that was missing:
 * ±1 viewport-height admits ~44 rows on a ~700px table and ~125 on a 2000px
 * one, so the cost of a re-sort grew with the monitor. 48 is ~2.5x the ~19
 * rows visible at 48px in a ~900px table — enough slack for rows that scroll
 * into view mid-animation, and a bound that does not move.
 *
 * It is also the snapshot window (see `flipWindow`): reading offsetTop for
 * every row was the one O(all rows) step left in the reorder path. */
export const FLIP_MAX_ANIMATED = 48;

/** Whether a reorder should animate at all: only user actions whose meaning
 * is "same set, new arrangement" (sort) or "subset of the same view"
 * (screener chip) — a tab or start-filter switch is a view change and snaps. */
export function reorderAnimates(
  cause: "sort" | "screener" | "other",
  rowCount: number,
): boolean {
  return (cause === "sort" || cause === "screener") && rowCount <= FLIP_MAX_ROWS;
}

/** Per-row cull: animate only rows within or near the viewport, judged at
 * either endpoint of the move. Null tops (unmeasured) animate — never let a
 * missing measurement freeze a visible row. */
export function rowShouldFlip(
  oldTop: number | null,
  newTop: number | null,
  scrollTop: number,
  viewH: number,
): boolean {
  const lo = scrollTop - FLIP_NEAR_SCREENS * viewH;
  const hi = scrollTop + (1 + FLIP_NEAR_SCREENS) * viewH;
  const near = (t: number | null) => t == null || (t >= lo && t <= hi);
  return near(oldTop) || near(newTop);
}

/** The index range worth measuring and animating: the rows the geometric cull
 * could possibly admit, clamped to FLIP_MAX_ANIMATED and centred on the
 * viewport. Returned as a half-open [from, to) over the CURRENT order.
 *
 * This is what makes the snapshot O(1) in the tab's size. It runs at event
 * time against row heights, not against measured tops, because the whole point
 * is to decide what to measure. */
export function flipWindow(
  rowCount: number,
  scrollTop: number,
  viewH: number,
  rowH: number,
): { from: number; to: number } {
  if (rowCount <= FLIP_MAX_ANIMATED) return { from: 0, to: rowCount };
  const centre = (scrollTop + viewH / 2) / Math.max(1, rowH);
  const half = FLIP_MAX_ANIMATED / 2;
  const from = Math.max(0, Math.min(rowCount - FLIP_MAX_ANIMATED, Math.round(centre - half)));
  return { from, to: from + FLIP_MAX_ANIMATED };
}
