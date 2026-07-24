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
