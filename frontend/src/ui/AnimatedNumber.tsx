"use client";

/* A number that cross-fades when its value changes (DESIGN §14). No
 * digit-rolling library — a short opacity cross-fade only, and only on the
 * three readouts that carry it (the preview pane's hero level and the two
 * backtest entry levels). THE TABLE'S NUMBERS DO NOT ANIMATE: a level that
 * moves in a rates monitor reads as a live tick, which is the failure
 * `pane-still` exists to prevent. */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { ENTER, EXIT, instant } from "./motion";

export function AnimatedNumber({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  /* Routed through instant() rather than left to MotionConfig: reduced motion
   * is an INSTANT state change [OWNER, 2026-08-06], and MotionConfig's
   * "user" mode only zeroes transform/layout — an opacity cross-fade runs at
   * full duration under it. This is the whole reason the rule was false
   * everywhere except the backtest window. */
  const reduced = useReducedMotion() === true;
  return (
    <span className={`relative inline-block ${className ?? ""}`}>
      {/* keep layout width stable while the two copies cross-fade */}
      <span className="invisible">{value}</span>
      {/* DEFAULT mode, deliberately NOT popLayout [close-button fix,
          2026-08-05]. The copies are absolute (out of flow) so popLayout's
          layout-popping bought nothing — and a nested popLayout presence
          whose exit is in flight when an ANCESTOR presence starts ITS exit
          can block the ancestor's removal: the backtest window faded to
          opacity 0 and then STAYED MOUNTED, an invisible surface eating
          every click over its area ("닫기 버튼이 안 먹어요"). Guarded by
          backtest-context (no popLayout here). */}
      <AnimatePresence initial={false}>
        <motion.span
          key={value}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          /* the outgoing copy leaves faster than the incoming one arrives
             (§14: exits run shorter than entrances). A per-target
             `transition` inside `exit` is how motion scopes one — there is no
             separate exit-transition prop. */
          exit={{ opacity: 0, transition: instant(EXIT, reduced) }}
          transition={instant(ENTER, reduced)}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
