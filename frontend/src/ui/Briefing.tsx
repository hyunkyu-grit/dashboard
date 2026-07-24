"use client";

/* Briefing card (DESIGN §2 Level 1). "마지막으로 보신 뒤로 …" plus up to five
 * change-log leading lines from the events endpoint (§12, unchanged — D-1
 * fixed, event/state split). Most visual weight after the hero numbers.
 * Tapping a line opens that series' detail (Level 3). */

import { motion } from "motion/react";

import type { EventCluster } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";

import { briefingHeadline, BRIEFING_EMPTY } from "./copy";
import { PRESS_SCALE, SPRING, STAGGER_STEP } from "./motion";

const MAX_ROWS = 5;

const REASON: Record<string, string> = {
  transition: "밴드 전환",
  move: "급변",
};

export function Briefing({
  events,
  onOpenSeries,
}: {
  events: EventCluster[];
  onOpenSeries: (id: string) => void;
}) {
  const rows = events.slice(0, MAX_ROWS);
  return (
    <section className="rounded-[16px] bg-tile p-5 shadow-card">
      <h2 className="text-[17px] font-semibold">
        {briefingHeadline(events.length)}
      </h2>
      {events.length === 0 ? (
        <p className="mt-1.5 text-[15px] opacity-60">{BRIEFING_EMPTY}</p>
      ) : (
        <motion.ul
          className="mt-3 flex flex-col gap-0.5"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: STAGGER_STEP } } }}
        >
          {rows.map((c) => {
            const e = c.leading;
            return (
              <motion.li
                key={e.id}
                variants={{
                  hidden: { opacity: 0, y: 6 },
                  show: { opacity: 1, y: 0, transition: SPRING },
                }}
              >
                <motion.button
                  type="button"
                  onClick={() => onOpenSeries(e.id)}
                  whileTap={{ scale: PRESS_SCALE }}
                  className="flex w-full items-baseline gap-3 rounded-[8px] py-1.5 text-left hover:bg-page"
                >
                  <span className="w-24 shrink-0 text-[15px]">{e.label}</span>
                  <span
                    className={`w-16 shrink-0 text-[15px] tabular-nums ${dirClass(e.deltaBp)}`}
                  >
                    {fmtBp(e.deltaBp)}
                  </span>
                  <span className="text-[13px] opacity-50">
                    {e.reasons.map((r) => REASON[r] ?? r).join(" + ")}
                    {c.count > 0 ? ` · 연관 ${c.count}건` : ""}
                  </span>
                </motion.button>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </section>
  );
}
