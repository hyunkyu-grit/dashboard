"use client";

/* Full-resolution stage-2 history chart (design spec §11/§12; §C/§F/§G S16).
 *
 * lightweight-charts is used ONLY here, inside the popup. Canvas cannot resolve
 * CSS custom properties, so every colour is resolved to hex through the theme
 * bridge and options run past assertNoCssVars().
 *
 * Two chart types (§G): a blue LINE, or weekly/monthly CANDLES aggregated
 * server-side from closes. The tooltip changes shape with the type — line shows
 * 날짜·레벨·구간 최고/최저/평균·당일 변화 (a superset of the preview, §C);
 * candles show 날짜·시가·고가·저가·종가·등락률. Candle bodies use the domestic
 * 상승 빨강 / 하락 파랑 convention (§9), never the line blue.
 *
 * assertDomainRendered guards both, and a candle chart additionally asserts the
 * rendered domain spans every supplied bar — a silently dropped bar is worse on
 * a candle chart than a line, because the picture still looks fine.
 */

import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type LogicalRange,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  type CandlesPayload,
  CD_SERIES_ID,
  fetchCandles,
  fetchSeries,
  type HistoryPoint,
  type Interval,
  type OhlcBar,
  type PolicyStep,
  type Unit,
} from "@/lib/api";
import { fmtDelta, fmtLevel } from "@/lib/format";
import {
  assertNoCssVars,
  onThemeChange,
  resolveDirection,
  resolveInk,
  resolveLine,
  resolveRefCd,
  resolveRefPolicy,
  resolveTheme,
  withAlpha,
} from "@/theme/bridge";
import { assertDomainRendered } from "@/theme/domainGuard";
import { candleSpans, extremeMarks, lineSpans, type Span } from "@/ui/extremes";
import { policyAxisMode, snapPolicyToTimes } from "@/ui/policyLine";
import { dateLabels } from "@/ui/timeAxis";

export type ChartType = "line" | Interval;

interface LineDetail {
  points: HistoryPoint[];
}

/* This hand-rolled its own URL until the static conversion, and that is exactly
 * how it broke: `?res=full` selects nothing on a static host, so the line chart
 * 404'd while the candle modes — which already went through fetchCandles —
 * worked. Every request goes through lib/api.ts now, and the guard in
 * failure-visible.test.ts checks EVERY component for a hand-built `/api/` path
 * rather than the three it happened to list before. */
const fetchLine = (id: string): Promise<LineDetail> => fetchSeries(id, "full");

// height of the date-label strip under the chart (dates session, Pass B)
const AXIS_H = 18;

function buildOptions(width: number, height: number) {
  const t = resolveTheme();
  const options = {
    width,
    height,
    layout: { background: { color: t.tile }, textColor: t.ink, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: t.border } },
    rightPriceScale: { borderColor: t.border },
    // LWC's own time axis is hidden: the date strip below renders our sparse
    // orientation labels instead (round boundaries, no ticks — Pass B).
    timeScale: { visible: false, borderColor: t.border, minBarSpacing: 0.05 },
    crosshair: { mode: 0 },
    /* KINETIC SCROLL OFF [OWNER, 2026-08-06 — provisional, re-check at QA].
     *
     * The library default is `{mouse: false, touch: true}`, and it was the one
     * animation in the product that nothing knew about: it runs on the
     * library's own rAF, outside React, outside MotionConfig, and
     * lightweight-charts has no per-preference switch — so a fling kept
     * coasting with prefers-reduced-motion set. §14's rule is that reduced
     * motion is literally instant, and turning it off is the only way to
     * comply.
     *
     * The cost is stated because it is not free: touch inertia is gone for
     * EVERY reader, not only the ones who asked for less motion. If dragging
     * the enlarged chart feels dead on a real touch device, this is the line
     * to reopen (A7 checklist item 10). */
    kineticScroll: { mouse: false, touch: false },
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
  x: number;
  y: number;
  v?: number;
  d?: number | null;
  bar?: OhlcBar;
}

export function DetailChart({
  id,
  unit,
  chartType,
  width,
  height,
  onVisibleRange,
  onHoverDate,
  policy,
}: {
  id: string;
  unit: Unit;
  chartType: ChartType;
  width: number;
  height: number;
  /** BOK base rate step — % instruments only (§policy). */
  policy?: PolicyStep;
  // §C: let the curve heatmap track the chart — the visible [from,to] date
  // window (rebucket target) and the crosshair date (hovered column).
  onVisibleRange?: (from: string | null, to: string | null) => void;
  onHoverDate?: (date: string | null) => void;
}) {
  const isCandle = chartType !== "line";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line" | "Candlestick"> | null>(null);
  const policyRef = useRef<ISeriesApi<"Line"> | null>(null);
  const cdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  // sparse date labels for the strip under the chart, recomputed on every
  // visible-range change (zoom / pan / candle interval — Pass B)
  const [axisLabels, setAxisLabels] = useState<{ x: number; text: string }[]>([]);

  // callbacks read via ref so the once-created subscriptions never go stale;
  // synced in an effect (refs must not be written during render)
  const cbRange = useRef(onVisibleRange);
  const cbHover = useRef(onHoverDate);
  useEffect(() => {
    cbRange.current = onVisibleRange;
    cbHover.current = onHoverDate;
  });

  const { data, isError } = useQuery<CandlesPayload | LineDetail>({
    queryKey: ["chart", id, chartType],
    queryFn: (): Promise<CandlesPayload | LineDetail> =>
      isCandle ? fetchCandles(id, chartType as Interval) : fetchLine(id),
    staleTime: 30_000,
  });

  /* CD at FULL resolution — this chart's axis is the full history, so the
   * preview's ~150 points would draw a visibly coarser CD than the instrument
   * beside it. Skipped when the instrument IS CD (one line under another).
   * SHARED-axis units only: this chart has a single price scale, so the
   * "secondary" mode the preview grew on 2026-08-03 would put a % rate on a
   * bp scale here — bp instruments draw NO overlay in the enlarged view
   * until it grows a second scale [TBD]. */
  const wantsCd = policyAxisMode(unit) === "shared" && id !== CD_SERIES_ID;
  const { data: cdData } = useQuery({
    queryKey: ["series", CD_SERIES_ID, "full"],
    queryFn: () => fetchSeries(CD_SERIES_ID, "full"),
    enabled: wantsCd,
    staleTime: 30_000,
  });

  useEffect(() => onThemeChange(() => setThemeTick((n) => n + 1)), []);

  // refs so the once-created subscriptions always read the latest data
  const dByTime = useRef<Map<string, number | null>>(new Map());
  const barByTime = useRef<Map<string, OhlcBar>>(new Map());
  const linePointsRef = useRef<HistoryPoint[]>([]);
  const timesRef = useRef<string[]>([]); // ordered times, both modes
  // vertical extents per x-position for the 최고/최저 marks (extremes.ts):
  // closes in line mode, wick ranges in candle mode — the same data the
  // library's autoscale stretches the visible y-axis to.
  const spansRef = useRef<Span[]>([]);
  useEffect(() => {
    if (data && "points" in data) {
      linePointsRef.current = data.points;
      dByTime.current = new Map(data.points.map((p) => [p.t, p.d]));
      timesRef.current = data.points.map((p) => p.t);
      spansRef.current = lineSpans(data.points);
    } else if (data && "bars" in data) {
      barByTime.current = new Map(data.bars.map((b) => [b.t, b]));
      timesRef.current = data.bars.map((b) => b.t);
      spansRef.current = candleSpans(data.bars);
    }
  }, [data]);

  // map a logical range (fractional data indices) to the visible date window
  function emitRange(r: LogicalRange | null) {
    const times = timesRef.current;
    if (times.length === 0) return;
    const clamp = (v: number) => Math.max(0, Math.min(times.length - 1, v));
    const lo = r ? clamp(Math.round(r.from)) : 0;
    const hi = r ? clamp(Math.round(r.to)) : times.length - 1;
    cbRange.current?.(times[lo], times[hi]);
  }

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
      mn = Math.min(mn, points[i].v);
      mx = Math.max(mx, points[i].v);
      sum += points[i].v;
      n++;
    }
    return n ? { min: mn, max: mx, avg: sum / n } : null;
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, buildOptions(width, height - AXIS_H));

    let series: ISeriesApi<"Line" | "Candlestick">;
    if (isCandle) {
      const up = resolveDirection(true); // 상승 빨강
      const down = resolveDirection(false); // 하락 파랑
      const opts = {
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
      };
      assertNoCssVars(opts);
      series = chart.addSeries(CandlestickSeries, opts);
    } else {
      const opts = { color: resolveLine(), lineWidth: 2 as const, priceLineVisible: false, lastValueVisible: true };
      assertNoCssVars(opts);
      series = chart.addSeries(LineSeries, opts);
    }
    chartRef.current = chart;
    seriesRef.current = series;

    /* The BOK base rate, on % instruments only (§policy). `LineType.WithSteps`
     * is what makes this correct rather than merely decorative: the library
     * draws the horizontal-then-vertical corner itself, so no interpolated
     * rate is ever painted between two decisions. Added AFTER the instrument
     * series so it shares the price scale (one axis — two rates in percent
     * compared at one scale), and styled down to a dashed hairline so the
     * reference never competes with the subject. It is excluded from the
     * crosshair: `subscribeCrosshairMove` reads `seriesData.get(series)`,
     * which is the instrument's series and not this one. */
    if (wantsCd) {
      /* CD 91d — a plain line (no `WithSteps`: it is a daily fixing, not a
       * policy decision). SOLID grey [OWNER, 2026-08-04 revision], the same
       * colour + translucency the preview carries (canvas has no
       * stroke-opacity, so the alpha rides in the colour). Added before the
       * base rate so the two references stack under the instrument. */
      const copts = {
        color: withAlpha(resolveRefCd(), 0.55),
        lineWidth: 1 as const,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      };
      assertNoCssVars(copts);
      cdRef.current = chart.addSeries(LineSeries, copts);
    } else {
      cdRef.current = null;
    }

    if (policyAxisMode(unit) === "shared" && policy && policy.steps.length) {
      const popts = {
        // translucent red, solid [OWNER, 2026-08-04 revision] — the heavy
        // alpha is what keeps a red reference from reading as a direction
        color: withAlpha(resolveRefPolicy(), 0.35),
        lineWidth: 1 as const,
        lineType: LineType.WithSteps,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      };
      assertNoCssVars(popts);
      policyRef.current = chart.addSeries(LineSeries, popts);
    } else {
      policyRef.current = null;
    }

    /* 최고/최저 marks that FOLLOW THE ZOOM (2026-08-03). The preview's marks
     * cover its whole (unzoomed) plot; here the window is whatever the reader
     * has zoomed or panned to, so the extremes are recomputed from the visible
     * slice on every range change and the marks REPLACE the old pair — an
     * extreme that scrolls out of view is not retained. Same red-high /
     * blue-low pair as the preview (§9 owner exception), values through
     * `fmtLevel` via extremeMarks; a flat window's single bare mark is ink —
     * neither a high nor a low, so it takes the levels' colour.
     *
     * Wired into the ONE existing range subscription below (the pipeline the
     * date strip and 구간 stats already use), throttled to one recompute per
     * animation frame so drag-panning scans once per painted frame, not once
     * per event. The markers primitive repositions with the chart's own
     * paint — no transition of ours, so there is nothing reduced-motion
     * would need to disable, and the data line itself never animates
     * (pane-still). */
    const markers = createSeriesMarkers(series, []);
    const markHue = { hi: resolveDirection(true), lo: resolveDirection(false), flat: resolveInk() };
    assertNoCssVars(markHue);
    let extremesRaf = 0;
    let lastRange: LogicalRange | null = null;
    const scheduleExtremes = (r: LogicalRange | null) => {
      lastRange = r;
      if (extremesRaf) return; // one scan per frame — drag emits many events
      extremesRaf = requestAnimationFrame(() => {
        extremesRaf = 0;
        markers.setMarkers(
          extremeMarks(spansRef.current, lastRange, unit).map(
            (m): SeriesMarker<Time> => ({
              time: m.time,
              position: m.kind === "lo" ? "belowBar" : "aboveBar",
              color: markHue[m.kind],
              shape: "circle",
              text: m.text,
              size: 0.5,
            }),
          ),
        );
      });
    };

    chart.subscribeCrosshairMove((param) => {
      const t = param.time as string | undefined;
      if (!t || !param.point) {
        setHover(null);
        cbHover.current?.(null);
        return;
      }
      cbHover.current?.(t); // §C: heatmap highlights the hovered column
      if (isCandle) {
        const bar = barByTime.current.get(t);
        if (!bar) return setHover(null);
        setHover({ t, x: param.point.x, y: param.point.y, bar });
      } else {
        const sd = param.seriesData.get(series) as { value?: number } | undefined;
        if (sd?.value == null) return setHover(null);
        setHover({ t, x: param.point.x, y: param.point.y, v: sd.value, d: dByTime.current.get(t) ?? null });
      }
    });

    // visible range → stats (line), the heatmap x-domain (§C), and the date
    // strip (Pass B) — all modes; candle intervals follow automatically since
    // the buckets set the span.
    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (!isCandle) setStats(statsForRange(linePointsRef.current, r));
      // the r the library actually rendered — the same object the domain
      // guard validates after fitContent — so the marks can never cover
      // indices the chart silently dropped (the minBarSpacing clip class)
      scheduleExtremes(r);
      emitRange(r);
      const times = timesRef.current;
      if (times.length === 0) {
        setAxisLabels([]);
        return;
      }
      const clamp = (v: number) => Math.max(0, Math.min(times.length - 1, v));
      const lo = r ? clamp(Math.round(r.from)) : 0;
      const hi = r ? clamp(Math.round(r.to)) : times.length - 1;
      // x for the first bar on or after an ISO date, within the view
      const xFor = (iso: string): number | null => {
        let i = lo;
        while (i < hi && times[i] < iso) i++;
        const x = chart.timeScale().logicalToCoordinate(i as Logical);
        return x != null && x >= 0 && x <= width ? x : null;
      };
      const out: { x: number; text: string }[] = [];
      for (const l of dateLabels(times[lo], times[hi])) {
        const x = xFor(l.iso);
        if (x != null) out.push({ x, text: l.text });
      }
      setAxisLabels(out);

    });

    return () => {
      cancelAnimationFrame(extremesRaf);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, themeTick, id, chartType, unit, policy, wantsCd]);

  useEffect(() => {
    if (!data || !seriesRef.current || !chartRef.current) return;
    let count = 0;
    let first = "";
    let last = "";
    if ("bars" in data) {
      const bars = data.bars;
      seriesRef.current.setData(
        bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })),
      );
      count = bars.length;
      first = bars[0]?.t ?? "";
      last = bars[bars.length - 1]?.t ?? "";
    } else {
      const pts = data.points;
      seriesRef.current.setData(pts.map((p) => ({ time: p.t, value: p.v })));
      // stats are set by the visible-range subscription, which fitContent below
      // fires (empty → full) — no synchronous setState in this effect.
      count = pts.length;
      first = pts[0]?.t ?? "";
      last = pts[pts.length - 1]?.t ?? "";
    }
    // The step is snapped onto the instrument's OWN dates (policyLine.ts):
    // a decision that fell on a weekend or a holiday is not a date this axis
    // has, and handing it to the chart would insert a column no trading day
    // occupies. Fed here rather than in the create effect so it refreshes
    // with the data, and bounded by `policy.through` — never the axis end.
    if (cdRef.current && cdData) {
      cdRef.current.setData(cdData.points.map((p) => ({ time: p.t, value: p.v })));
    }
    if (policyRef.current && policy) {
      policyRef.current.setData(
        snapPolicyToTimes(timesRef.current.length ? timesRef.current : [first, last], policy),
      );
    }
    chartRef.current.timeScale().fitContent();
    const raf = requestAnimationFrame(() => {
      const c = chartRef.current;
      if (!c || count === 0) return;
      // domain guard (both types) — the candle chart's silently-dropped-bar
      // failure is exactly this: the rendered domain must span every bar (§G).
      assertDomainRendered(c.timeScale().getVisibleLogicalRange(), count, { first, last });
    });
    return () => cancelAnimationFrame(raf);
  }, [data, themeTick, policy, cdData]);

  if (isError) {
    return (
      <div className="flex items-center justify-center opacity-60" style={{ width, height }}>
        불러오지 못했어요. 잠시 뒤 다시 시도해 주세요
      </div>
    );
  }

  const tip = renderTip(hover, stats, unit, isCandle);
  return (
    <div className="relative" style={{ width, height }}>
      <div ref={containerRef} style={{ width, height: height - AXIS_H }} />
      {/* date strip (Pass B): sparse orientation labels at round boundaries —
          no ticks, no rule; they update with zoom / pan / candle interval. */}
      <div className="relative" style={{ width, height: AXIS_H }}>
        {axisLabels.map((l) => (
          <span
            key={`${l.text}@${Math.round(l.x)}`}
            className="absolute top-0.5 -translate-x-1/2 whitespace-nowrap text-[11px] text-ink opacity-45"
            style={{ left: l.x }}
          >
            {l.text}
          </span>
        ))}
      </div>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-[8px] bg-popover p-2 text-[12px] shadow-lg"
          style={{ left: Math.min(width - 150, hover!.x + 12), top: Math.max(4, hover!.y - 40), width: 140 }}
        >
          {tip}
        </div>
      )}
    </div>
  );
}

function renderTip(hover: Hover | null, stats: Stats | null, unit: Unit, isCandle: boolean) {
  if (!hover) return null;
  if (isCandle && hover.bar) {
    const b = hover.bar;
    const chg = b.o !== 0 ? ((b.c - b.o) / b.o) * 100 : 0;
    return (
      <>
        <div className="mb-1 font-semibold">{hover.t}</div>
        <Row k="시가" v={fmtLevel(b.o, unit)} />
        <Row k="고가" v={fmtLevel(b.h, unit)} />
        <Row k="저가" v={fmtLevel(b.l, unit)} />
        <Row k="종가" v={fmtLevel(b.c, unit)} />
        <Row k="등락률" v={`${chg >= 0 ? "+" : "−"}${Math.abs(chg).toFixed(2)}%`} />
      </>
    );
  }
  if (!isCandle && hover.v != null && stats) {
    return (
      <>
        <div className="mb-1 font-semibold">{hover.t}</div>
        <Row k="레벨" v={fmtLevel(hover.v, unit)} />
        <Row k="구간 최고" v={fmtLevel(stats.max, unit)} />
        <Row k="구간 최저" v={fmtLevel(stats.min, unit)} />
        <Row k="구간 평균" v={fmtLevel(stats.avg, unit)} />
        <Row k="당일 변화" v={fmtDelta(hover.d ?? null, unit)} />
      </>
    );
  }
  return null;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="opacity-50">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
