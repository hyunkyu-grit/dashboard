"use client";

/* A number that cross-fades when its value changes (DESIGN §14). No
 * digit-rolling library — a short opacity cross-fade only. Collapses to an
 * instant swap under reduced motion via the app's MotionConfig. */

import { AnimatePresence, motion } from "motion/react";

import { NUMBER_FADE } from "./motion";

export function AnimatedNumber({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
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
          exit={{ opacity: 0 }}
          transition={{ duration: NUMBER_FADE }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
