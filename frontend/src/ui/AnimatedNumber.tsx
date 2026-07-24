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
      <AnimatePresence initial={false} mode="popLayout">
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
