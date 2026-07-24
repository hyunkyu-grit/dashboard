"use client";

/* Full-resolution stage-2 history chart (design spec §11/§12 step 9).
 *
 * lightweight-charts is used ONLY here, inside the detail overlay — never
 * per wall tile. Canvas cannot resolve CSS custom properties, so every
 * color is resolved to hex through the theme bridge and the options object
 * is run past assertNoCssVars() before it touches the chart (the recurring
 * canvas-var defect class the spec calls out). A theme flip rebuilds the
 * options and redraws.
 */

import {
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { API_BASE } from "@/lib/api";
import {
  assertNoCssVars,
  onThemeChange,
  resolveBandHue,
  resolveTheme,
} from "@/theme/bridge";
import { assertDomainRendered } from "@/theme/domainGuard";

interface SeriesDetail {
  id: string;
  asof: string;
  points: { t: string; v: number }[];
}

async function fetchSeries(id: string): Promise<SeriesDetail> {
  const res = await fetch(`${API_BASE}/api/series/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`series ${id}: HTTP ${res.status}`);
  return res.json();
}

function buildOptions(width: number, height: number) {
  const t = resolveTheme();
  const options = {
    width,
    height,
    layout: {
      background: { color: t.tile },
      textColor: t.ink,
      attributionLogo: false,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { color: t.border },
    },
    rightPriceScale: { borderColor: t.border },
    timeScale: {
      borderColor: t.border,
      // ~2600 daily points must compress into ~1000px; the v5 default
      // minBarSpacing (0.5) forces ~1300px and silently clips the early
      // years, so fitContent can't show the full 10y domain without this.
      minBarSpacing: 0.05,
    },
    crosshair: { mode: 0 },
  };
  assertNoCssVars(options); // resolved-hex gate (spec §9)
  return { options, ink: t.ink };
}

export function DetailChart({
  id,
  label,
  width,
  height,
}: {
  id: string;
  label: string;
  width: number;
  height: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  const { data, isError } = useQuery({
    queryKey: ["series", id],
    queryFn: () => fetchSeries(id),
    staleTime: 30_000,
  });

  useEffect(() => onThemeChange(() => setThemeTick((n) => n + 1)), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { options } = buildOptions(width, height);
    const chart = createChart(el, options);
    // Band hue by object (§9): a spread/fly id carries a "-"; anything else
    // is an outright. Resolved to hex via the bridge (no var on canvas).
    const seriesOptions = {
      color: resolveBandHue(id.includes("-") ? "spread" : "outright"),
      lineWidth: 2 as const,
      priceLineVisible: false,
      lastValueVisible: true,
    };
    assertNoCssVars(seriesOptions);
    const series = chart.addSeries(LineSeries, seriesOptions);
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // themeTick rebuilds with freshly resolved hex on theme flip; id rebuilds
    // to re-resolve the series' band hue (outright vs spread).
  }, [width, height, themeTick, id]);

  useEffect(() => {
    if (!data || !seriesRef.current) return;
    seriesRef.current.setData(
      data.points.map((p) => ({ time: p.t, value: p.v })),
    );
    const ts = chartRef.current?.timeScale();
    ts?.fitContent();
    // Guard on the next frame, once fitContent's layout has settled: the
    // rendered domain must match what we asked for, or throw loudly (Pass C).
    const raf = requestAnimationFrame(() => {
      if (!chartRef.current || data.points.length === 0) return;
      assertDomainRendered(
        chartRef.current.timeScale().getVisibleLogicalRange(),
        data.points.length,
        {
          first: data.points[0].t,
          last: data.points[data.points.length - 1].t,
        },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [data, themeTick]);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[14px] font-semibold">{label}</h2>
        <span className="text-[12px] opacity-60">
          {data ? `${data.points.length} daily closes · to ${data.asof}` : "…"}
        </span>
      </div>
      {isError ? (
        <div
          className="flex items-center justify-center opacity-60"
          style={{ width, height }}
        >
          series unavailable
        </div>
      ) : (
        <div ref={containerRef} style={{ width, height }} />
      )}
    </div>
  );
}
