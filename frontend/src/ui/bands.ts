/* Band taxonomy + hero selection for the three-level column (DESIGN §2).
 * Instrument names stay technical (§15); only chrome copy is 해요체. */

import type {
  BasisKey,
  ForwardsPayload,
  SeriesSummary,
  WallSummary,
} from "@/lib/api";

export type BandId = "curve" | "vol" | "forwards" | "outrights" | "spreads";

export const BAND_ORDER: BandId[] = [
  "curve",
  "vol",
  "forwards",
  "outrights",
  "spreads",
];

export const BAND_NAME: Record<BandId, string> = {
  curve: "커브",
  vol: "변동성",
  forwards: "스왑 포워드",
  outrights: "아웃라이트",
  spreads: "스프레드",
};

export interface Hero {
  seriesId: string | null; // null → placeholder (volatility)
  label: string;
  unit: "%" | "bp";
  now: number | null;
  deltaBp: number | null;
  /** sparkline values (navy), newest last */
  spark: number[];
  /** cross-sectional shape line rather than a time series (forwards) */
  sparkIsShape?: boolean;
}

function fromSummary(s: SeriesSummary | undefined, basis: BasisKey): Hero | null {
  if (!s) return null;
  return {
    seriesId: s.id,
    label: s.label,
    unit: s.unit,
    now: s.now,
    deltaBp: s.deltas[basis],
    spark: s.spark.map((p) => p.v),
  };
}

/** The band's hero series/number (§2). */
export function heroFor(
  band: BandId,
  summary: WallSummary,
  forwards: ForwardsPayload | undefined,
  basis: BasisKey,
): Hero {
  const outright = (id: string) =>
    summary.outrights.find((o) => o.id === id);

  switch (band) {
    case "curve":
      return (
        fromSummary(outright("10Y"), basis) ?? placeholder("커브")
      );
    case "outrights":
      return fromSummary(outright("10Y"), basis) ?? placeholder("아웃라이트");
    case "spreads": {
      // largest absolute mover vs the active basis
      const ranked = [...summary.derived]
        .filter((d) => d.deltas[basis] != null)
        .sort(
          (a, b) => Math.abs(b.deltas[basis]!) - Math.abs(a.deltas[basis]!),
        );
      return fromSummary(ranked[0], basis) ?? placeholder("스프레드");
    }
    case "forwards": {
      if (!forwards) return placeholder("스왑 포워드");
      const kf = forwards.keyForwards.find((k) => k.label === "1Yx1Y");
      const spotShape = forwards.grid["SPOT"]?.map((c) => c.values.now) ?? [];
      return {
        seriesId: "fwd:1Yx1Y",
        label: "1Yx1Y",
        unit: "%",
        now: kf?.values.now ?? null,
        deltaBp: kf?.deltas[basis] ?? null,
        spark: spotShape,
        sparkIsShape: true,
      };
    }
    case "vol":
    default:
      return placeholder("변동성");
  }
}

function placeholder(label: string): Hero {
  return { seriesId: null, label, unit: "%", now: null, deltaBp: null, spark: [] };
}
