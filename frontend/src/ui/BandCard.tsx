"use client";

/* Home band card (DESIGN §2 Level 1). Summary sentence, one 28px hero number,
 * the delta beside it in direction color, a wide navy sparkline. Whole card
 * is the tap target → Level 2. Borderless; separation is surface + shadow. */

import { motion } from "motion/react";

import type { BasisKey } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";

import { AnimatedNumber } from "./AnimatedNumber";
import { BAND_NAME, type BandId, type Hero } from "./bands";
import { bandSummary } from "./copy";
import { PRESS_SCALE } from "./motion";
import { Sparkline } from "./Sparkline";

function heroText(hero: Hero): string {
  if (hero.now == null) return "–";
  return hero.unit === "%" ? hero.now.toFixed(2) : `${hero.now.toFixed(1)}`;
}

export function BandCard({
  band,
  hero,
  basis,
  onOpen,
}: {
  band: BandId;
  hero: Hero;
  basis: BasisKey;
  onOpen: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileTap={{ scale: PRESS_SCALE }}
      className="w-full rounded-[16px] bg-tile p-5 text-left shadow-card"
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[17px] font-semibold">{BAND_NAME[band]}</span>
        <span className="text-[13px] opacity-45">{hero.label}</span>
      </div>

      <div className="flex items-baseline gap-2">
        <AnimatedNumber
          value={heroText(hero)}
          className="text-[28px] font-bold leading-none tabular-nums"
        />
        <span className="text-[13px] opacity-45">
          {hero.unit === "%" ? "%" : "bp"}
        </span>
        {hero.deltaBp != null && (
          <span className={`text-[13px] tabular-nums ${dirClass(hero.deltaBp)}`}>
            {fmtBp(hero.deltaBp)}
          </span>
        )}
      </div>

      <p className="mt-1.5 text-[15px] opacity-70">
        {bandSummary(band, hero, basis)}
      </p>

      {hero.spark.length >= 2 && (
        <div className="mt-3">
          <Sparkline values={hero.spark} width={880} height={44} />
        </div>
      )}
    </motion.button>
  );
}
