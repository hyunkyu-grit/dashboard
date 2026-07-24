"use client";

/* Briefing card (DESIGN §2 Level 1). "마지막으로 보신 뒤로 …" plus up to five
 * change-log leading lines from the events endpoint (§12, unchanged — D-1
 * fixed, event/state split). Most visual weight after the hero numbers.
 * Tapping a line opens that series' detail (Level 3). */

import type { EventCluster } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";

import { briefingHeadline, BRIEFING_EMPTY } from "./copy";

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
        <ul className="mt-3 flex flex-col gap-0.5">
          {rows.map((c) => {
            const e = c.leading;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onOpenSeries(e.id)}
                  className="flex w-full items-baseline gap-3 rounded-[8px] py-1.5 text-left transition-transform active:scale-[0.99] hover:bg-page"
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
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
