"use client";

/* Home — Level 1 (DESIGN §2). Status line, briefing card, five band cards. */

import type { BasisKey, ForwardsPayload, WallSummary } from "@/lib/api";

import { BAND_ORDER, heroFor, type BandId } from "./bands";
import { BandCard } from "./BandCard";
import { Briefing } from "./Briefing";
import { statusLine, stamp } from "./copy";

export function Home({
  summary,
  forwards,
  basis,
  onOpenBand,
  onOpenSeries,
}: {
  summary: WallSummary;
  forwards?: ForwardsPayload;
  basis: BasisKey;
  onOpenBand: (band: BandId) => void;
  onOpenSeries: (id: string) => void;
}) {
  const tenY = summary.outrights.find((o) => o.id === "10Y");

  return (
    <div className="flex flex-col gap-8">
      {/* status line */}
      <div className="flex items-baseline justify-between px-1">
        <p className="text-[17px] font-semibold">
          {statusLine(tenY?.deltas[basis] ?? null, basis)}
        </p>
        <span className="text-[13px] opacity-45">{stamp(summary.asof)}</span>
      </div>

      <Briefing events={summary.events} onOpenSeries={onOpenSeries} />

      <div className="flex flex-col gap-3">
        {BAND_ORDER.map((band) => (
          <BandCard
            key={band}
            band={band}
            hero={heroFor(band, summary, forwards, basis)}
            basis={basis}
            onOpen={() => onOpenBand(band)}
          />
        ))}
      </div>
    </div>
  );
}
