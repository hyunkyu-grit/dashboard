/* Motion tokens (DESIGN §14). Springs may overshoot slightly now. Motion is
 * chrome only — never applied to chart path geometry. `prefers-reduced-motion`
 * collapses every animation to an instant state change (see App's MotionConfig
 * reducedMotion="user"; `instant()` is the unit-testable core of that rule). */

import type { Transition } from "motion/react";

export const SPRING: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 30,
};

// A touch more damping for the sheet so it settles without a second bounce.
export const SHEET_SPRING: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 34,
};

export const STAGGER_STEP = 0.04; // 40ms between briefing/log rows
export const PRESS_SCALE = 0.98;
export const NUMBER_FADE = 0.18; // cross-fade on a changed number

/** The reduced-motion rule: any transition collapses to instant (duration 0).
 * MotionConfig applies this globally; this is its testable form. */
export function instant(base: Transition, reduced: boolean): Transition {
  return reduced ? { duration: 0 } : base;
}

/* ── Row reorder (motion session, Pass C) ─────────────────────────────────
 * Sliding rows to their new positions on a re-sort is functional, not
 * decorative: it is the only thing that preserves which row is which across
 * 44+ rows. Enter fades in at destination; exit fades in place (popLayout).
 * Transform-only FLIP via motion's layout="position". */

/** Above this row count the reorder is instant — even viewport-culled
 * bookkeeping (a DOM read per row) stops being worth it. The forward tab
 * (168 rows) and 전체 (~200) stay under it and animate, culled. */
export const FLIP_MAX_ROWS = 400;

/** Screens of slack around the viewport: a row animates only if its old or
 * new position is within this many viewport-heights of the visible window. */
export const FLIP_NEAR_SCREENS = 1;

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
