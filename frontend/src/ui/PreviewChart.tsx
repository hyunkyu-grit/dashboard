"use client";

/* Preview chart (DESIGN §2). Hand-rolled SVG so the floating tooltip is
 * simple and lightweight-charts stays confined to the enlarged view (§11).
 * Blue line (--bw-line, §9 palette cut). Hovering shows a floating card near
 * the cursor:
 * 날짜 · 레벨 · 구간 최고 · 구간 최저 · 구간 평균 · 당일 변화.
 *
 * SINCE 2026-08-13 IT ALSO DRAWS CANDLES [OWNER: "모드 설정하면 원하면
 * 캔들차트로 보여줄 수 있게"]. The mode is the reader's global preference
 * (`ui/chartType.ts`), not a property of one chart, and it arrives as
 * `chartType` + `bars`. What changes with it is deliberately SMALL:
 *
 *   the ink      one polyline → four paths (몸통·꼬리 × 상승·하락, candlePath.ts)
 *   the extent   a point is its close; a bar is its wick range (extremes.ts)
 *   the card     레벨/52주 셋/당일 변화 → 시가·고가·저가·종가·등락률
 *
 * Everything else — zoom, pan, the reference lines, the date labels, the
 * 최고/최저 dots, the crosshair, the backtest click — is written against the
 * plotted slice and does not know which mode it is in. That is why this is one
 * component and not two: pass O made every read a function of the slice, and a
 * candle window is just a slice whose points have three more numbers.
 *
 * ZOOMS IN PLACE (zoom-and-color session) [OWNER: "크게보기 버튼을 안 눌러도
 * 이 창에서 그냥 확대하고 축소하고"]: wheel zooms about the cursor, dragging
 * pans, 전체 기간 (and zooming all the way out) restores the full span. The
 * whole feature is choosing a slice of `points` — every read below (y-domain,
 * extremes, overlays, date labels, crosshair) was already a pure function of
 * the plotted slice (pass O), so the zoomed chart is the same chart over
 * fewer points. A drag is NOT a click: the backtest still opens on a clean
 * click [OWNER], and a pointer that panned suppresses the click that follows
 * it. */

import { useEffect, useRef, useState } from "react";

import type {
  HistoryPoint,
  OhlcBar,
  PolicyStep,
  SeriesStats,
  Unit,
} from "@/lib/api";

import { fmtAxis, fmtLevel } from "@/lib/format";

import { bodyWidth, candlePaths } from "./candlePath";
import { panRange, zoomRange, type ViewRange } from "./chartZoom";
import { type ChartType, isCandleType } from "./chartType";
import { candleSpans, lineSpans, spanExtremes } from "./extremes";
import {
  alignSeries,
  policyAxisMode,
  policyExtent,
  policyPath,
  policySegments,
  seriesExtent,
  seriesPath,
} from "./policyLine";

import {
  READOUT_CARD_W,
  READOUT_LABEL,
  ReadoutCard,
  ReadoutChange,
  ReadoutLevel,
  ReadoutPct,
} from "./ReadoutCard";
import { dateLabels } from "./timeAxis";

// top pad holds the reference-line legend (§ reference lines), so it is
// deeper than the 10px the plot alone needed. EXPORTED because the backtest's
// LinkedPnlChart must share left/right EXACTLY — vertical alignment between
// the two stacked charts is this object plus one x formula, and a copied
// constant is a drift waiting to happen.
export const CHART_PAD = { top: 16, right: 10, bottom: 18, left: 6 };
const PAD = CHART_PAD;

/** A dated mark on the chart [OWNER feedback, 2026-08-04 — the backtest
 * window's context chart]. The vertical hairline names a DATE; with `level`
 * set the mark also pins the LEVEL there — a dot on the line and a
 * horizontal hairline at its height — so the eye can track where the line
 * sits against where it was entered. The label prints WITHOUT the value
 * [lighten pass, 2026-08-05]: the figure already sits in the 진입 레벨
 * readout and the result table, and the digits made the label wide enough
 * to collide with the 최고 extreme whenever the high fell near the entry —
 * both live in the same top band, so width is the collision budget. The
 * level is never passed in: it IS the series' value at the snapped date,
 * read from the same points the line is drawn from, so the dot cannot sit
 * off the line. Snapping is ON OR AFTER the date — the same rule the
 * backtest server strikes entries with (`_span_of`) — and a mark whose date
 * falls before the visible slice (zoomed past) or after its end draws
 * nothing rather than pinning itself to an edge it does not belong to.
 * Dashed on purpose: the solid ink hairline is the hover crosshair, and a
 * marker that looked identical would read as a stuck cursor. (The owner
 * retired dashes as the REFERENCE-line encoding; this is not a reference,
 * it is annotation.) */
export interface ChartMark {
  date: string;
  label: string;
  level?: boolean;
}

/* A P&L OVERLAY briefly lived here (2026-08-04, one owner pass) and was
 * replaced the same day by the LINKED PANEL [OWNER 재피드백: "겹치는 거보다
 * PL은 밑에 그려지되 … 완전히 수직적으로 얼라인"]: the money series now
 * draws in `LinkedPnlChart` (BacktestWindow.tsx) directly below this chart,
 * sharing CHART_PAD and the index→x formula so the two are pixel-aligned by
 * construction. What this chart contributes to that pairing is `still`
 * (alignment forbids a zoom the sibling cannot follow) and `hoverDate` (one
 * crosshair driven from either half). */

/** Where the horizontal gridlines sit, as fractions of the plot height. ONE
 * list for the lines and their value labels, so the two cannot drift. */
const GRID_FRACS = [0.25, 0.5, 0.75];

export function PreviewChart({
  points,
  bars,
  chartType = "line",
  stats,
  unit,
  width,
  height,
  policy,
  cd,
  onHoverDate,
  marks,
  still,
  hoverDate,
}: {
  points?: HistoryPoint[];
  /** 주/월 OHLC 막대 — 캔들 모드에서만 쓰인다 (§G, 서버 집계). */
  bars?: OhlcBar[];
  /** 선 · 주봉 · 월봉. 기본값이 "line" 인 것은 호출부 하나가 **영원히 선**이기
   * 때문이다: 백테스트 문맥 차트는 아래 손익 차트와 인덱스 단위로 수직 정렬돼
   * 있고 [OWNER: "완전히 수직적으로 얼라인"], 주/월봉은 인덱스 공간 자체를
   * 바꾸므로 정렬이 조용히 깨진다. 그 차트는 이 prop 을 넘기지 않는다. */
  chartType?: ChartType;
  stats: SeriesStats | null; // range min/max/avg, precomputed server-side (§16)
  unit: Unit;
  width: number;
  height: number;
  /** BOK base rate step — shares the axis on % instruments, keeps its own
   * labelled % scale on bp instruments, absent on ratio (§policy). */
  policy?: PolicyStep;
  /** CD 91d history — the second reference line, always drawn with the base
   * rate. Omitted when the instrument IS CD, where it would be the same line
   * twice. */
  cd?: HistoryPoint[];
  /** The date under the cursor, reported as it moves. The chart click opens
   * the backtest AT that date [OWNER: "커서가 가는 곳에서 누르면 그 날부터
   * 스타트해야지"], and the crosshair is the only thing that knows which day
   * the reader is pointing at. */
  onHoverDate?: (iso: string | null) => void;
  /** 진입/청산 annotations for the backtest's context chart — see ChartMark. */
  marks?: ChartMark[];
  /** No wheel zoom, no pan — the linked-panel mode [OWNER: "시계열을
   * 여기서는 확대 및 축소할 필요는 없으나"]. Alignment with the P&L chart
   * below is the whole point there, and a zoom the sibling cannot follow
   * would silently break it. */
  still?: boolean;
  /** An EXTERNAL crosshair date — the linked P&L chart below reports its own
   * hover through the shared parent, and this chart shows its readout at
   * that date as if the cursor were here. The pointer's own hover wins when
   * both exist (they only disagree for a frame). */
  hoverDate?: string | null;
}) {
  const [hi, setHi] = useState<number | null>(null);
  /* The visible slice, or null = the full span (chartZoom.ts).
   *
   * IT REMEMBERS THE LENGTH IT INDEXED [2026-08-13]. A view is a pair of
   * INDICES, and indices only mean something against the array they were taken
   * from — switching 선 → 주봉 takes the same series from 2,621 points to 553
   * bars, and a leftover {i0: 100, i1: 200} silently becomes a different four
   * months of a different resolution. It looks entirely normal, which is the
   * dangerous part. A view whose length no longer matches is discarded during
   * render (no effect, no extra pass — the overview's rule), which also covers
   * the case this used to rely on remounting for: a series switch. */
  const [view, setView] = useState<{ r: ViewRange; len: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /* pan gesture — event-time snapshot of where the drag started and what it
   * started from; `moved` is what separates a pan from the backtest click */
  const drag = useRef<{ px: number; base: ViewRange; moved: boolean } | null>(
    null,
  );
  const justDragged = useRef(false);

  const plotW = width - PAD.left - PAD.right;
  /* WHICH ARRAY IS PLOTTED. Candle mode needs bars and falls back to the line
   * whenever they have not arrived (or are too short to be a chart) — a mode
   * switch must never blank a chart that has data to show. */
  const candle = isCandleType(chartType) && (bars?.length ?? 0) >= 2;
  const srcLine = points ?? [];
  const srcBars = bars ?? [];
  const len = candle ? srcBars.length : srcLine.length;

  /* Wheel = zoom about the cursor. A native non-passive listener, because the
   * page must not scroll under a chart being zoomed and React's root-attached
   * wheel handler is passive (preventDefault is a no-op there). Functional
   * setView keeps the closure free of the current view. */
  useEffect(() => {
    const el = svgRef.current;
    if (!el || len < 2 || still) return; // still: zoom is off, see the prop
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const frac = (e.clientX - rect.left - PAD.left) / plotW;
      setView((v) => {
        const cur = v && v.len === len ? v.r : null;
        const next = zoomRange(cur, len, frac, e.deltaY > 0 ? 1.25 : 0.8);
        return next && { r: next, len };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [plotW, len, still]);

  // a line window needs its 52-week stats (the card prints three of them); a
  // candle window prints the bar itself and needs none
  if (len < 2 || (!candle && !stats)) return null;

  /* the slice everything below plots. `view.len` is checked, not just the end
   * index: a stale view from another array length is not a window into this
   * one (see the state's comment). */
  const vr = view && view.len === len ? view.r : null;
  const barsPlot = candle ? (vr ? srcBars.slice(vr.i0, vr.i1 + 1) : srcBars) : [];
  const ptsPlot = candle ? [] : vr ? srcLine.slice(vr.i0, vr.i1 + 1) : srcLine;

  /* THE PLOTTED SLICE, as the rest of this component sees it.
   *
   *   `pts`   {t, v} per x-position — v is the close in both modes. The line
   *           path, the crosshair dot, the date labels, the marks and BOTH
   *           reference overlays read this and stay mode-blind.
   *   `spans` each x-position's vertical extent: a close twice over on a line,
   *           the wick range on a candle. The y-domain and the 최고/최저 dots
   *           read this, so a candle's domain holds its wicks. */
  const pts: { t: string; v: number }[] = candle
    ? barsPlot.map((b) => ({ t: b.t, v: b.c }))
    : ptsPlot;
  const spans = candle ? candleSpans(barsPlot) : lineSpans(ptsPlot);

  const plotH = height - PAD.top - PAD.bottom;
  // y-domain from the PLOTTED slice, not from stats: the stats are 52-week
  // (annual-stats session) while the chart shows the visible slice — a
  // domain from annual stats would clip the 2020-21 trough. The same scan
  // yields the marked extremes (pass O): domain and dots share one source,
  // so the dot claiming "high" sits exactly where the domain was stretched —
  // and both re-derive from the slice as the reader zooms.
  const ext = spanExtremes(spans)!; // len >= 2, checked above
  let lo = spans[ext.lo].lo;
  let hi2 = spans[ext.hi].hi;
  /* How the overlay meets this axis is a UNIT question (policyLine.ts):
   *
   *   shared    (%)  — the references are in the instrument's own unit, so the
   *                    domain has to hold all three series before anything is
   *                    scaled. Widening here (rather than clipping the step) is
   *                    what keeps two rates in the same unit comparable.
   *   secondary (bp) — a spread and a policy rate share no unit; the
   *                    references get their OWN % scale over the same plot,
   *                    the instrument's bp domain stays exactly what its own
   *                    points make it, and BOTH axes are labelled with their
   *                    unit below. Never a shared scale, never a rebasing —
   *                    the overlay exists to read the spread against the
   *                    policy LEVEL, and an index rebase destroys the level. */
  const mode = policyAxisMode(unit);
  const segments = mode ? policySegments(pts, policy) : [];
  const cdVals = mode ? alignSeries(pts, cd) : [];
  if (mode === "shared") {
    for (const e of [policyExtent(segments), seriesExtent(cdVals)]) {
      if (!e) continue;
      if (e.min < lo) lo = e.min;
      if (e.max > hi2) hi2 = e.max;
    }
  }
  const pad = (hi2 - lo) * 0.06 || 0.01;
  const yMin = lo - pad;
  const yMax = hi2 + pad;
  const x = (i: number) => PAD.left + (i / (pts.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  /* The secondary % scale, derived from the references alone. `yRef` is the
   * y-mapping every reference stroke uses: identical to `y` when the axis is
   * shared, its own scale when it is not — so the draw code below cannot
   * accidentally mix scales per series. */
  let refDomain: { min: number; max: number } | null = null;
  if (mode === "secondary") {
    for (const e of [policyExtent(segments), seriesExtent(cdVals)]) {
      if (!e) continue;
      refDomain = refDomain
        ? { min: Math.min(refDomain.min, e.min), max: Math.max(refDomain.max, e.max) }
        : { ...e };
    }
  }
  const refPad = refDomain ? (refDomain.max - refDomain.min) * 0.06 || 0.01 : 0;
  const refMin = refDomain ? refDomain.min - refPad : 0;
  const refMax = refDomain ? refDomain.max + refPad : 1;
  const yRef =
    mode === "secondary" && refDomain
      ? (v: number) => PAD.top + (1 - (v - refMin) / (refMax - refMin)) * plotH
      : y;
  const path = candle
    ? ""
    : pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  /* Candle ink: four paths, not two per bar (candlePath.ts explains the
   * arithmetic and why it is a module). The step is measured from the SAME x
   * formula everything else uses, so bodies stay centred on the crosshair and
   * on the 최고/최저 dots at every zoom. */
  const cw = candle ? bodyWidth(plotW / Math.max(1, pts.length - 1)) : 0;
  const candles = candle ? candlePaths(barsPlot, x, y, cw) : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / plotW) * (pts.length - 1));
    const idx = Math.max(0, Math.min(pts.length - 1, i));
    setHi(idx);
    onHoverDate?.(pts[idx].t);
  };
  const onLeave = () => {
    setHi(null);
    onHoverDate?.(null);
  };

  /* Pan: drag slides the window (chartZoom.panRange), from an event-time
   * snapshot of the drag's origin. Only a zoomed chart pans — at full span
   * there is nowhere to go and the pointer should stay a click. The `moved`
   * flag survives to the click event that follows pointerup, where it
   * suppresses the backtest open bubbling to the pane (a pan is not a
   * click); `justDragged` carries it across the pointerup→click boundary. */
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    justDragged.current = false;
    if (e.button !== 0 || !vr) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, base: vr, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    if (Math.abs(dx) > 3) d.moved = true;
    const span = d.base.i1 - d.base.i0 + 1;
    const next = panRange(d.base, len, (-dx / plotW) * (span - 1));
    setView(next && { r: next, len });
  };
  const onPointerUp = () => {
    justDragged.current = drag.current?.moved ?? false;
    drag.current = null;
  };
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (justDragged.current) {
      justDragged.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /* the EXTERNAL crosshair (`hoverDate`, linked-panel mode): the sibling
   * chart's hovered date mapped into this slice — on-or-after, the snap
   * every date lookup here uses; outside the slice nothing draws. The
   * pointer's own hover wins when both exist. */
  const extIdx =
    hoverDate != null &&
    pts.length > 0 &&
    hoverDate >= pts[0].t &&
    hoverDate <= pts[pts.length - 1].t
      ? pts.findIndex((p) => p.t >= hoverDate)
      : null;
  // a hover index left over from a different slice (zoom just changed) is
  // stale until the next mouse move — render nothing rather than a wrong date
  const hIdx =
    hi != null && hi < pts.length ? hi : extIdx != null && extIdx >= 0 ? extIdx : null;
  const hp = hIdx != null ? pts[hIdx] : null;
  /** the hovered BAR, candle mode only — the card prints its five values. */
  const hbar = candle && hIdx != null ? barsPlot[hIdx] : null;
  // daily change arrives precomputed per point (§16) — no client differencing.
  // Candle mode has none: a weekly bar has no "당일", it has 등락률.
  const dailyChange = candle ? null : (hIdx != null ? ptsPlot[hIdx].d : null);
  const tipLeft =
    hIdx != null
      ? Math.min(width - READOUT_CARD_W - 10, Math.max(0, x(hIdx) + 10))
      : 0;

  // date labels (dates session, Pass B): sparse orientation marks in the
  // bottom pad — no ticks, no rule. The span is the VISIBLE slice (zoom
  // narrows it); x = the first point on/after the boundary.
  const labels = dateLabels(pts[0].t, pts[pts.length - 1].t)
    .map((l) => {
      let i = pts.findIndex((p) => p.t >= l.iso);
      if (i < 0) i = pts.length - 1;
      return { text: l.text, px: x(i) };
    })
    .filter((l) => l.px >= PAD.left && l.px <= width - PAD.right);

  /* What the two reference lines ARE, named on the chart (§ reference
   * lines). Both are solid [OWNER, 2026-08-04 revision], so the legend is
   * what tells them apart beyond grey-vs-translucent-red: swatch and label
   * carry each line's own colour, and the swatch repeats the line's opacity
   * so the sample looks like the thing it names. */
  const legend: {
    label: string;
    op: number;
    stroke: string;
    fill: string;
  }[] = [];
  if (cdVals.some((v) => v != null))
    legend.push({
      label: "CD 91일",
      op: 0.55,
      stroke: "stroke-ref-cd",
      fill: "fill-ref-cd",
    });
  if (segments.length)
    legend.push({
      label: "기준금리",
      op: 0.35,
      stroke: "stroke-ref-policy",
      fill: "fill-ref-policy",
    });

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        // select-none: a pan drag must move the window, not select the
        // extreme/axis labels it sweeps across
        className="text-line touch-none select-none"
        style={view ? { cursor: "grab" } : undefined}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onClick}
        role="img"
        aria-label="10y history"
      >
        {/* Background grid (pass O) — furniture, so it takes the palette's
            lightest ink (`stroke-edge`, the hairline token: ink at 12% light /
            18% dark, already contrast-tuned per theme) and sits UNDER
            everything else. Verticals ride the date labels' own x positions
            so furniture aligns with furniture; horizontals quarter the plot
            and CARRY THEIR VALUE (the labels render above the series, below).
            This chart is the sanctioned exception to the S14 "no vertical
            gridlines" default [OWNER, pass O]. */}
        <g>
          {GRID_FRACS.map((f) => (
            <line
              key={`gh-${f}`}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={PAD.top + f * plotH}
              y2={PAD.top + f * plotH}
              className="stroke-edge"
              strokeWidth={1}
            />
          ))}
          {labels.map((l) => (
            <line
              key={`gv-${l.text}`}
              x1={l.px}
              x2={l.px}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-edge"
              strokeWidth={1}
            />
          ))}
        </g>
        {/* Both references go UNDER the instrument line: they are what the
            instrument is read against, not second subjects. SOLID, per
            [OWNER, 2026-08-04 revision — "회색 실선 / 빨간색인데 투명도 좀
            올려서 실선"]: CD a grey line, the base rate the product's red
            drawn extra-translucent — the transparency is what keeps a red
            reference from shouting direction. Told apart by lightness/hue
            and the legend (the dash encoding was retired by that owner
            call). */}
        {seriesPath(cdVals, x, yRef).map((run) => (
          <polyline
            key={`cd-${run.slice(0, 24)}`}
            points={run}
            fill="none"
            className="stroke-ref-cd"
            strokeWidth={1}
            strokeOpacity={0.55}
          />
        ))}
        {policyPath(segments, x, yRef).map((run) => (
          <polyline
            key={run.slice(0, 24)}
            points={run}
            fill="none"
            className="stroke-ref-policy"
            strokeWidth={1}
            strokeOpacity={0.35}
          />
        ))}
        {/* EVERY horizontal gridline carries its value [OWNER, 2026-08-03 —
            "그리드에 해당하는 금리나 레벨 적어주고"], and WHICH SIDE is a
            rule, not an accident [OWNER]: a LEVEL in bp or ratio (spreads,
            butterflies, volatility) reads on the LEFT axis, a RATE in %
            reads on the RIGHT — on every chart, single- or dual-scale. On a
            dual-scale chart that lands the instrument's bp on the left and
            the references' % on the right, each with its unit; a single
            scale needs no disambiguating suffix, so those print bare.
            `fmtAxis`'s coarse orientation grammar throughout (same role as
            CurveView's y labels — the precise numbers live on the extremes
            and in the tooltip). */}
        {GRID_FRACS.map((f) => {
          const gy = PAD.top + f * plotH - 3;
          const own = fmtAxis(yMax - f * (yMax - yMin), unit);
          const dual = mode === "secondary" && !!refDomain;
          return (
            <g key={`glabel-${f}`}>
              {unit === "%" ? (
                <text
                  x={width - PAD.right - 2}
                  y={gy}
                  textAnchor="end"
                  className="fill-ink"
                  style={{ fontSize: 10, opacity: 0.5 }}
                >
                  {own}
                </text>
              ) : (
                <text
                  x={PAD.left + 2}
                  y={gy}
                  className="fill-ink"
                  style={{ fontSize: 10, opacity: 0.5 }}
                >
                  {`${own}${dual ? unit : ""}`}
                </text>
              )}
              {dual && (
                <text
                  x={width - PAD.right - 2}
                  y={gy}
                  textAnchor="end"
                  className="fill-ink"
                  style={{ fontSize: 10, opacity: 0.5 }}
                >
                  {`${fmtAxis(refMax - f * (refMax - refMin), "%")}%`}
                </text>
              )}
            </g>
          );
        })}
        {/* THE SUBJECT. One polyline, or four candle paths — same slot in the
            stack, over the references and under the annotations.

            상승 빨강 / 하락 파랑 (§9 direction tokens, never the line blue):
            a candle body HAS a sign, which is exactly the condition §9 sets
            for spending the direction pair on a fill. The wick is the same
            hue a shade quieter (stroke at 0.75) so a dense window reads as
            bars rather than as a hedge of vertical lines.

            `data-candle` is the guard's anchor — candle-mode.test.ts asserts
            the four paths exist and carry direction tokens, because a candle
            chart that has silently fallen back to a line still looks fine. */}
        {candle && candles ? (
          <g data-candle="">
            <path
              data-candle-part="up-wick"
              d={candles.up.wicks}
              className="stroke-up"
              strokeWidth={1}
              strokeOpacity={0.75}
              fill="none"
            />
            <path
              data-candle-part="down-wick"
              d={candles.down.wicks}
              className="stroke-down"
              strokeWidth={1}
              strokeOpacity={0.75}
              fill="none"
            />
            <path data-candle-part="up-body" d={candles.up.bodies} className="fill-up" />
            <path
              data-candle-part="down-body"
              d={candles.down.bodies}
              className="fill-down"
            />
          </g>
        ) : (
          <polyline
            points={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        )}
        {/* Dated marks (ChartMark) — drawn over the line so a 진입 dot is
            never buried under it, under the extremes/crosshair so the marks
            annotate rather than compete. Snap and skip rules live in the
            type's comment; the skip below is the zoom case, where the
            snapped point has left the visible slice. */}
        {(marks ?? []).map((m) => {
          if (m.date < pts[0].t || m.date > pts[pts.length - 1].t) return null;
          let i = pts.findIndex((p) => p.t >= m.date);
          if (i < 0) i = pts.length - 1;
          const px = x(i);
          const py = y(pts[i].v);
          const anchor =
            px < PAD.left + plotW * 0.08
              ? "start"
              : px > PAD.left + plotW * 0.92
                ? "end"
                : "middle";
          return (
            <g key={`mark-${m.label}-${m.date}`} data-mark={m.level ? "level" : "date"}>
              <line
                x1={px}
                x2={px}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="stroke-ink"
                strokeWidth={1}
                strokeOpacity={0.3}
                strokeDasharray="3 3"
              />
              {m.level && (
                <>
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={py}
                    y2={py}
                    className="stroke-ink"
                    strokeWidth={1}
                    strokeOpacity={0.18}
                    strokeDasharray="3 3"
                  />
                  <circle cx={px} cy={py} r={3} className="fill-ink" />
                </>
              )}
              <text
                x={px}
                y={PAD.top + 10}
                textAnchor={anchor}
                className="fill-ink"
                style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}
              >
                {/* label only — the value lives in the readouts, and the
                    dot + level hairline carry it here (see ChartMark) */}
                {m.label}
              </text>
            </g>
          );
        })}
        {/* The extremes of what is CURRENTLY PLOTTED, marked on the line AND
            SAYING THEIR VALUE (pass O; the value and the hue by owner
            instruction, 2026-08-03 — "지난 10년간 최고치 최저치를 바로 보일
            수 있게", "최고=빨간색으로, 최저는 파란색으로 확실하게 눈에
            띄게"). The HIGH is red, the LOW is blue — the product's own
            up/down pair (§9), landing on the ends it already means; an
            owner-sanctioned exception to "levels stay ink", recorded in
            DESIGN. Viewport property: they derive from the same scan the
            y-domain uses, over the VISIBLE slice — so the in-place zoom
            (this session) moves them by construction. Ties
            take the first occurrence; a flat window's two marks coincide on
            its first point and print their one value ONCE (extremes.ts).
            NOT the 52-week stats: those are a fixed server-side window in
            the tooltip. The value is DATA, so it prints through `fmtLevel`
            — the product's level grammar — never the axis' coarse one; the
            high sits above its dot, the low below, each clamped inside the
            plot and end-anchored near the edges. */}
        {[
          // the MARKED VALUE is the span's edge, not the close: on a candle the
          // window's high is a wick tip, and a dot at that bar's close would
          // float below the very point it claims to mark. On a line the two are
          // the same number (a close-only span), so this is one expression.
          { k: "hi", i: ext.hi, v: spans[ext.hi].hi },
          { k: "lo", i: ext.lo, v: spans[ext.lo].lo },
        ].map(({ k, i, v }) => {
          const px = x(i);
          const py = y(v);
          const anchor =
            px < PAD.left + plotW * 0.08
              ? "start"
              : px > PAD.left + plotW * 0.92
                ? "end"
                : "middle";
          const ty =
            k === "hi"
              ? Math.max(PAD.top + 10, py - 7)
              : Math.min(height - PAD.bottom - 3, py + 15);
          const hue = k === "hi" ? "fill-up" : "fill-down";
          return (
            <g key={k}>
              <circle data-extreme={k} cx={px} cy={py} r={3} className={hue} />
              {(k === "hi" || ext.lo !== ext.hi) && (
                <text
                  x={px}
                  y={ty}
                  textAnchor={anchor}
                  className={hue}
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  {/* named, not just valued — the Toss reference prints a
                      range's endpoints beside a label, and 최고/최저 is the
                      readout card's own vocabulary. A flat window prints its
                      one value bare: it is neither a high nor a low. */}
                  {ext.lo !== ext.hi
                    ? `${k === "hi" ? "최고" : "최저"} ${fmtLevel(v, unit)}`
                    : fmtLevel(v, unit)}
                </text>
              )}
            </g>
          );
        })}
        {legend.map((g, i) => {
          const lx = width - PAD.right - 74 - i * 82;
          return (
            <g key={g.label}>
              <line
                x1={lx}
                x2={lx + 14}
                y1={PAD.top - 4}
                y2={PAD.top - 4}
                className={g.stroke}
                strokeWidth={1}
                strokeOpacity={g.op}
              />
              <text
                x={lx + 18}
                y={PAD.top - 1}
                className={g.fill}
                style={{ fontSize: 9, opacity: 0.75 }}
              >
                {g.label}
              </text>
            </g>
          );
        })}
        {labels.map((l) => (
          <text
            key={l.text}
            x={l.px}
            y={height - 4}
            textAnchor="middle"
            className="fill-ink"
            style={{ fontSize: 10, opacity: 0.45 }}
          >
            {l.text}
          </text>
        ))}
        {hIdx != null && hp && (
          <>
            {/* data-crosshair anchors the alignment guard: the linked P&L
                chart's crosshair at the same date must land on the same x */}
            <line
              data-crosshair=""
              x1={x(hIdx)}
              x2={x(hIdx)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-ink"
              strokeWidth={1}
              strokeOpacity={0.25}
            />
            {/* The dot marks the LINE's value under the cursor. A candle has
                no single value to sit on — the bar under the hairline already
                shows all four — and a dot pinned at its close would read as a
                fifth number the bar does not have. */}
            {!candle && (
              <circle cx={x(hIdx)} cy={y(hp.v)} r={3} fill="currentColor" />
            )}
          </>
        )}
      </svg>
      {/* the way back out, only there when there is somewhere to come back
          from. Its clicks are its own — never the backtest's. */}
      {vr && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setView(null);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-1 top-0 cursor-pointer rounded-control border border-edge bg-tile px-2 py-0.5 text-[12px] opacity-70 hover:opacity-100"
        >
          전체 기간
        </button>
      )}
      {hIdx != null && hp && (
        // the shared card (pass N) — the idle curve's tooltip is the same
        // component, so the two cannot drift into two grammars for one quantity
        <ReadoutCard title={hp.t} left={tipLeft}>
          {hbar ? (
            /* CANDLE: the five values of one BAR (§G), the same five the popup
               prints and in the same order — 등락률 through the shared
               formatter, so the two surfaces cannot round it differently.
               No 52주 rows: this card answers "what did this week do", which
               is a different question from "where does this level sit in its
               year", and nine rows do not fit 140px. */
            <>
              <ReadoutLevel k={READOUT_LABEL.open} v={hbar.o} unit={unit} />
              <ReadoutLevel k={READOUT_LABEL.high} v={hbar.h} unit={unit} />
              <ReadoutLevel k={READOUT_LABEL.low} v={hbar.l} unit={unit} />
              <ReadoutLevel k={READOUT_LABEL.close} v={hbar.c} unit={unit} />
              <ReadoutPct k={READOUT_LABEL.changePct} open={hbar.o} close={hbar.c} />
            </>
          ) : (
            <>
              <ReadoutLevel k={READOUT_LABEL.level} v={hp.v} unit={unit} />
              {/* 52-week stats (annual-stats session) — the chart still shows
                  the full history, only the statistics narrow; the popup,
                  which zooms, uses visible-range "구간" stats (§F). */}
              <ReadoutLevel k={READOUT_LABEL.rangeHigh} v={stats!.max} unit={unit} />
              <ReadoutLevel k={READOUT_LABEL.rangeLow} v={stats!.min} unit={unit} />
              <ReadoutLevel k={READOUT_LABEL.rangeAvg} v={stats!.avg} unit={unit} />
              <ReadoutChange
                k={READOUT_LABEL.dailyChange}
                v={dailyChange}
                unit={unit}
              />
            </>
          )}
        </ReadoutCard>
      )}
    </div>
  );
}
