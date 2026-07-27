"use client";

/* Full-resolution stage-2 history chart (design spec §11/§12; §C/§F Session 16).
 *
 * lightweight-charts is used ONLY here, inside the popup — never per wall tile.
 * Canvas cannot resolve CSS custom properties, so every colour is resolved to
 * hex through the theme bridge and the options object is run past
 * assertNoCssVars() before it touches the chart.
 *
 * The popup is a SUPERSET of the preview (§C, guarded): a crosshair, a floating
 * tooltip (날짜 · 레벨 · 구간 최고/최저/평균 · 당일 변화), a last-value badge, and
 * — because the popup zooms — range statistics that follow the VISIBLE window
 * and recompute on zoom (§F; the preview, which cannot zoom, shows the full 10y
 * and labels it 10년). The readout set is declared in ui/readouts.ts.
 */

import {
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
} from "lightweight-charts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { API_BASE, type HistoryPoint, type Unit } from "@/lib/api";
import { fmtDelta, fmtLevel } from "@/lib/format";
import {
  assertNoCssVars,
  onThemeChange,
  resolveLine,
  resolveTheme,
} from "@/theme/bridge";
import { assertDomainRendered } from "@/theme/domainGuard";

interface SeriesDetail {
  id: string;
  asof: string;
  unit: Unit;
  points: HistoryPoint[];
}

async function fetchSeries(id: string): Promise<SeriesDetail> {
  const res = await fetch(`${API_BASE}/api/series/${encodeURIComponent(id)}?res=full`);
  if (!res.ok) throw new Error(`series ${id}: HTTP ${res.status}`);
  return res.json();
}

function buildOptions(width: number, height: number) {
  const t = resolveTheme();
  const options = {
    width,
    height,
    layout: { background: { color: t.tile }, textColor: t.ink, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: t.border } },
    rightPriceScale: { borderColor: t.border },
    timeScale: { borderColor: t.border, minBarSpacing: 0.05 },
    crosshair: { mode: 0 },
  };
  assertNoCssVars(options);
  return options;
}

interface Stats {
  min: number;
  max: number;
  avg: number;
}
interface Hover {
  t: string;
  v: number;
  d: number | null;
  x: number;
  y: number;
}

export function DetailChart({
  id,
  unit,
  width,
  height,
}: {
  id: string;
  unit: Unit;
  width: number;
  height: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  const { data, isError } = useQuery({
    queryKey: ["series", id, "full"],
    queryFn: () => fetchSeries(id),
    staleTime: 30_000,
  });

  useEffect(() => onThemeChange(() => setThemeTick((n) => n + 1)), []);

  // Refs so the chart subscriptions (created once, before data loads) always
  // read the LATEST points rather than a stale closure — the stats handler
  // otherwise clobbers to null when fitContent fires with empty data.
  const dByTime = useRef<Map<string, number | null>>(new Map());
  const pointsRef = useRef<HistoryPoint[]>([]);
  useEffect(() => {
    pointsRef.current = data?.points ?? [];
    dByTime.current = new Map((data?.points ?? []).map((p) => [p.t, p.d]));
  }, [data]);

  // range stats over the currently VISIBLE window (§F): recompute on zoom
  function statsForRange(points: HistoryPoint[], range: LogicalRange | null): Stats | null {
    if (points.length === 0) return null;
    const lo = range ? Math.max(0, Math.ceil(range.from)) : 0;
    const hi = range ? Math.min(points.length - 1, Math.floor(range.to)) : points.length - 1;
    if (hi < lo) return null;
    let mn = Infinity;
    let mx = -Infinity;
    let sum = 0;
    let n = 0;
    for (let i = lo; i <= hi; i++) {
      const v = points[i].v;
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
      sum += v;
      n++;
    }
    return n ? { min: mn, max: mx, avg: sum / n } : null;
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, buildOptions(width, height));
    const seriesOptions = {
      color: resolveLine(), // blue (§9 Pass E)
      lineWidth: 2 as const,
      priceLineVisible: false,
      lastValueVisible: true, // the last-value badge (§C readout)
    };
    assertNoCssVars(seriesOptions);
    const series = chart.addSeries(LineSeries, seriesOptions);
    chartRef.current = chart;
    seriesRef.current = series;

    chart.subscribeCrosshairMove((param) => {
      const pt = param.time as string | undefined;
      if (!pt || !param.point) {
        setHover(null);
        return;
      }
      const sd = param.seriesData.get(series) as { value?: number } | undefined;
      if (sd?.value == null) {
        setHover(null);
        return;
      }
      setHover({ t: pt, v: sd.value, d: dByTime.current.get(pt) ?? null, x: param.point.x, y: param.point.y });
    });

    const ts = chart.timeScale();
    const onRange = (r: LogicalRange | null) => setStats(statsForRange(pointsRef.current, r));
    ts.subscribeVisibleLogicalRangeChange(onRange);

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, themeTick, id]);

  useEffect(() => {
    if (!data || !seriesRef.current) return;
    seriesRef.current.setData(data.points.map((p) => ({ time: p.t, value: p.v })));
    const ts = chartRef.current?.timeScale();
    ts?.fitContent();
    setStats(statsForRange(data.points, null));
    const raf = requestAnimationFrame(() => {
      if (!chartRef.current || data.points.length === 0) return;
      assertDomainRendered(
        chartRef.current.timeScale().getVisibleLogicalRange(),
        data.points.length,
        { first: data.points[0].t, last: data.points[data.points.length - 1].t },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [data, themeTick]);

  if (isError) {
    return (
      <div className="flex items-center justify-center opacity-60" style={{ width, height }}>
        불러오지 못했어요. 잠시 뒤 다시 시도해 주세요
      </div>
    );
  }

  return (
    <div className="relative" style={{ width, height }}>
      <div ref={containerRef} style={{ width, height }} />
      {hover && stats && (
        <div
          className="pointer-events-none absolute z-10 rounded-[8px] bg-popover p-2 text-[12px] shadow-lg"
          style={{ left: Math.min(width - 150, hover.x + 12), top: Math.max(4, hover.y - 40), width: 140 }}
        >
          <div className="mb-1 font-semibold">{hover.t}</div>
          <Row k="레벨" v={fmtLevel(hover.v, unit)} />
          <Row k="구간 최고" v={fmtLevel(stats.max, unit)} />
          <Row k="구간 최저" v={fmtLevel(stats.min, unit)} />
          <Row k="구간 평균" v={fmtLevel(stats.avg, unit)} />
          <Row k="당일 변화" v={fmtDelta(hover.d, unit)} />
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="opacity-50">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
