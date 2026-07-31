"use client";

/* CD 91d for the reference lines (§ reference lines). One hook so every chart
 * that draws it fetches the SAME series at the SAME resolution under the SAME
 * query key — a second copy at another resolution would be a second, subtly
 * different CD line on screen, and react-query would happily cache both.
 *
 * Returns undefined for a bp/ratio instrument and for CD itself: on the 3M
 * chart the reference IS the subject, and drawing it again is one line under
 * another. The check lives here rather than in each caller so "does this chart
 * take CD" has one answer. */

import { useQuery } from "@tanstack/react-query";

import { CD_SERIES_ID, fetchSeries, type HistoryPoint, type Unit } from "@/lib/api";

import { takesPolicyOverlay } from "./policyLine";

export function useCdReference(
  unit: Unit | undefined,
  seriesId: string | null | undefined,
): HistoryPoint[] | undefined {
  const wanted =
    !!unit && takesPolicyOverlay(unit) && seriesId !== CD_SERIES_ID;
  const { data } = useQuery({
    queryKey: ["series", CD_SERIES_ID, "preview"],
    queryFn: () => fetchSeries(CD_SERIES_ID, "preview"),
    enabled: wanted,
    staleTime: 30_000,
  });
  return wanted ? data?.points : undefined;
}
