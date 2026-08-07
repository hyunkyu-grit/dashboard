"use client";

/**
 * Query layer for the preview's BASE market quotes — light data lookups only
 * (the market-data snapshot and the available date range), never the
 * simulation engine. Everything is keyed by valuation date and cached
 * indefinitely: historical quotes for a date do not change within a session,
 * so moving a slider re-reads the cache and only a baseDate switch refetches.
 *
 * Rates are DECIMAL (0.0282) — conversion to % happens in
 * lib/input-curve-preview, not here.
 */
import { useQuery } from "@tanstack/react-query";

import { marketDataApi } from "@/sim/lib/api-client";

import { yearsToTenorLabel, type BaseQuote } from "../lib/input-curve-preview";

export const INPUT_CURVE_KEYS = {
  dateRange: ["simulation", "market-date-range"] as const,
  swapQuotes: (d: string) => ["simulation", "input-curves", "swap", d] as const,
};

/** Available market-data dates — bounds + steps for the baseDate toggle. */
export function useMarketDateRange() {
  return useQuery({
    queryKey: INPUT_CURVE_KEYS.dateRange,
    queryFn: () => marketDataApi.dateRange(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** IRS par quotes (+ CD 3M short end) for the date → BaseQuote[]. A missing
 * snapshot (non-business day) surfaces as isError — the panel shows the
 * blank-policy notice instead of fabricating quotes. SIM2-1: `enabled` lets
 * the 시계열형 branch keep the whole preview network-free. */
export function useSwapInputQuotes(baseDate: string, enabled = true) {
  return useQuery({
    queryKey: INPUT_CURVE_KEYS.swapQuotes(baseDate),
    enabled: enabled && !!baseDate,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<BaseQuote[]> => {
      const snap = await marketDataApi.snapshot(baseDate);
      const quotes: BaseQuote[] = [{ t: 0.25, label: "3M", rate: snap.cd_rate ?? null }];
      for (const q of snap.swap_quotes) {
        // Sub-1Y quotes arrive as tenor_years:1 + tenor_months (6M/9M) — the
        // months field is the real tenor; ignoring it would stack them on 1Y.
        const t = q.tenor_months != null ? q.tenor_months / 12 : q.tenor_years;
        quotes.push({ t, label: yearsToTenorLabel(t), rate: q.rate ?? null });
      }
      return quotes.sort((a, b) => a.t - b.t);
    },
  });
}

/* REMOVED with the data consolidation [OWNER, 2026-08-07]:
 *   useCreditTaxonomy · representativeRating · useSectorInputQuotes ·
 *   useBondInputQuotes · PREVIEW_BOND_SECTORS · BOND_SECTOR
 *
 * All of them read /api/credit-curve/*, backed by `Credit Matrix Data.xlsx`
 * (42 MB) — deleted when the market source became this repo's own
 * irsdata.xlsx. Their only caller was CurvePreview's 국고 reference line, which
 * went with them.
 *
 * Deleted rather than parked: they kept an endpoint that now 500s inside the
 * client's reachable surface, and guards/live-routes-proxied reads that
 * surface to decide what the deployed site must forward. Dead code naming a
 * broken route is not neutral.
 */
