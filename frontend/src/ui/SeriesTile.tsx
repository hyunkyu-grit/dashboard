"use client";

/* Per-series tile for the outrights and spreads band-views (DESIGN §2 Level
 * 2). Hero value 28px, label + delta (direction color) small, a wide navy
 * sparkline of the series' own history. Whole tile → Level 3 detail. */

import { motion } from "motion/react";

import type { BasisKey, SeriesSummary } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";
import { useRegisterTile } from "@/wall/useRegisterTile";

import { BASIS_PHRASE } from "./copy";
import { PRESS_SCALE } from "./motion";
import { Sparkline } from "./Sparkline";

export function SeriesTile({
  s,
  basis,
  onOpen,
}: {
  s: SeriesSummary;
  basis: BasisKey;
  onOpen: () => void;
}) {
  // Self-register for command-bar scroll-to (tile registry, repurposed §2).
  const registerRef = useRegisterTile(s.id, s.label, [
    s.id,
    s.id.replace(/-/g, ""),
    s.id.replace(/Y/g, "s").replace(/\./g, ""),
  ]);
  const delta = s.deltas[basis];
  const heroText =
    s.now == null ? "–" : s.unit === "%" ? s.now.toFixed(2) : s.now.toFixed(1);

  return (
    <motion.button
      type="button"
      ref={registerRef as ((el: HTMLButtonElement | null) => void) | undefined}
      onClick={onOpen}
      whileTap={{ scale: PRESS_SCALE }}
      className="flex w-full items-center gap-5 rounded-[16px] bg-tile p-5 text-left shadow-card"
    >
      <div className="w-40 shrink-0">
        <div className="text-[13px] opacity-50">{s.label}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[28px] font-bold leading-none tabular-nums">
            {heroText}
          </span>
          <span className="text-[12px] opacity-45">
            {s.unit === "%" ? "%" : "bp"}
          </span>
        </div>
        <div className={`text-[13px] tabular-nums ${dirClass(delta)}`}>
          {fmtBp(delta)}{" "}
          <span className="opacity-45">{BASIS_PHRASE[basis]}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <Sparkline values={s.spark.map((p) => p.v)} width={640} height={72} />
      </div>
    </motion.button>
  );
}
