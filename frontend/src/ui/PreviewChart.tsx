"use client";

/* Preview line chart (DESIGN §2). Hand-rolled SVG so the floating tooltip is
 * simple and lightweight-charts stays confined to the enlarged view (§11).
 * Blue line (--bw-line, §9 palette cut). Hovering shows a floating card near
 * the cursor:
 * 날짜 · 레벨 · 구간 최고 · 구간 최저 · 구간 평균 · 당일 변화.
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

import type { HistoryPoint, PolicyStep, SeriesStats, Unit } from "@/lib/api";

import { fmtAxis, fmtLevel } from "@/lib/format";

import { panRange, zoomRange, type ViewRange } from "./chartZoom";
import { windowExtremes } from "./extremes";
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
} from "./ReadoutCard";
import { dateLabels } from "./timeAxis";

// top pad holds the reference-line legend (§ reference lines), so it is
// deeper than the 10px the plot alone needed
const PAD = { top: 16, right: 10, bottom: 18, left: 6 };

/** Where the horizontal gridlines sit, as fractions of the plot height. ONE
 * list for the lines and their value labels, so the two cannot drift. */
const GRID_FRACS = [0.25, 0.5, 0.75];

export function PreviewChart({
  points,
  stats,
  unit,
  width,
  height,
  policy,
  cd,
  onHoverDate,
}: {
  points: HistoryPoint[];
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
}) {
  const [hi, setHi] = useState<number | null>(null);
  /* The visible slice, or null = the full span (chartZoom.ts). Series
   * changes remount this component (the pane keys on seriesId), so the view
   * resets with the data it indexed. */
  const [view, setView] = useState<ViewRange | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /* pan gesture — event-time snapshot of where the drag started and what it
   * started from; `moved` is what separates a pan from the backtest click */
  const drag = useRef<{ px: number; base: ViewRange; moved: boolean } | null>(
    null,
  );
  const justDragged = useRef(false);

  const plotW = width - PAD.left - PAD.right;
  const len = points.length;

  /* Wheel = zoom about the cursor. A native non-passive listener, because the
   * page must not scroll under a chart being zoomed and React's root-attached
   * wheel handler is passive (preventDefault is a no-op there). Functional
   * setView keeps the closure free of the current view. */
  useEffect(() => {
    const el = svgRef.current;
    if (!el || len < 2) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const frac = (e.clientX - rect.left - PAD.left) / plotW;
      setView((v) => zoomRange(v, len, frac, e.deltaY > 0 ? 1.25 : 0.8));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [plotW, len]);

  if (points.length < 2 || !stats) return null;

  /* the slice everything below plots; a view left over from longer data
   * (a refetch) falls back to the full span rather than indexing off the end */
  const pts =
    view && view.i1 < points.length
      ? points.slice(view.i0, view.i1 + 1)
      : points;

  const plotH = height - PAD.top - PAD.bottom;
  // y-domain from the PLOTTED points, not from stats: the stats are 52-week
  // (annual-stats session) while the line shows the visible slice — a
  // domain from annual stats would clip the 2020-21 trough. The same scan
  // yields the marked extremes (pass O): domain and dots share one source,
  // so the dot claiming "high" sits exactly where the domain was stretched —
  // and both re-derive from the slice as the reader zooms.
  const ext = windowExtremes(pts)!; // pts.length >= 2, checked above
  let lo = pts[ext.lo].v;
  let hi2 = pts[ext.hi].v;
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
  const path = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

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
    if (e.button !== 0 || !view) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, base: view, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    if (Math.abs(dx) > 3) d.moved = true;
    const span = d.base.i1 - d.base.i0 + 1;
    setView(panRange(d.base, len, (-dx / plotW) * (span - 1)));
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

  // a hover index left over from a different slice (zoom just changed) is
  // stale until the next mouse move — render nothing rather than a wrong date
  const hIdx = hi != null && hi < pts.length ? hi : null;
  const hp = hIdx != null ? pts[hIdx] : null;
  // daily change arrives precomputed per point (§16) — no client differencing.
  const dailyChange = hp ? hp.d : null;
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
   * lines). The DASH PATTERN is still the encoding — CD fine-dotted, base
   * rate long-dashed — so the distinction survives in grayscale (§5); the
   * quiet hue [OWNER, 2026-08-04] is a layer on top, and the legend swatch
   * and label carry the same hue so line and name connect without tracing. */
  const legend: { label: string; dash: string; stroke: string; fill: string }[] =
    [];
  if (cdVals.some((v) => v != null))
    legend.push({
      label: "CD 91일",
      dash: "1 2",
      stroke: "stroke-ref-cd",
      fill: "fill-ref-cd",
    });
  if (segments.length)
    legend.push({
      label: "기준금리",
      dash: "3 3",
      stroke: "stroke-ref-policy",
      fill: "fill-ref-policy",
    });

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="text-line touch-none"
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
            instrument is read against, not second subjects. Told apart by
            DASH PATTERN so the distinction survives in grayscale (§5): CD is
            a fine dotted line, the base rate a longer dash. The muted hue
            [OWNER, 2026-08-04 — "톤 안 깨면서 색"] and the partial opacity
            are layers on top of that, never the encoding. */}
        {seriesPath(cdVals, x, yRef).map((run) => (
          <polyline
            key={`cd-${run.slice(0, 24)}`}
            points={run}
            fill="none"
            className="stroke-ref-cd"
            strokeWidth={1}
            strokeOpacity={0.6}
            strokeDasharray="1 2"
          />
        ))}
        {policyPath(segments, x, yRef).map((run) => (
          <polyline
            key={run.slice(0, 24)}
            points={run}
            fill="none"
            className="stroke-ref-policy"
            strokeWidth={1}
            strokeOpacity={0.55}
            strokeDasharray="3 3"
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
        <polyline
          points={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
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
          { k: "hi", i: ext.hi },
          { k: "lo", i: ext.lo },
        ].map(({ k, i }) => {
          const px = x(i);
          const py = y(pts[i].v);
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
                    ? `${k === "hi" ? "최고" : "최저"} ${fmtLevel(pts[i].v, unit)}`
                    : fmtLevel(pts[i].v, unit)}
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
                strokeOpacity={0.7}
                strokeDasharray={g.dash}
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
            <line
              x1={x(hIdx)}
              x2={x(hIdx)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-ink"
              strokeWidth={1}
              strokeOpacity={0.25}
            />
            <circle cx={x(hIdx)} cy={y(hp.v)} r={3} fill="currentColor" />
          </>
        )}
      </svg>
      {/* the way back out, only there when there is somewhere to come back
          from. Its clicks are its own — never the backtest's. */}
      {view && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setView(null);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-1 top-0 cursor-pointer rounded-[8px] border border-edge bg-tile px-2 py-0.5 text-[11px] opacity-70 hover:opacity-100"
        >
          전체 기간
        </button>
      )}
      {hIdx != null && hp && (
        // the shared card (pass N) — the idle curve's tooltip is the same
        // component, so the two cannot drift into two grammars for one quantity
        <ReadoutCard title={hp.t} left={tipLeft}>
          <ReadoutLevel k={READOUT_LABEL.level} v={hp.v} unit={unit} />
          {/* 52-week stats (annual-stats session) — the chart still shows the
              full history, only the statistics narrow; the popup, which
              zooms, uses visible-range "구간" stats (§F). */}
          <ReadoutLevel k={READOUT_LABEL.rangeHigh} v={stats.max} unit={unit} />
          <ReadoutLevel k={READOUT_LABEL.rangeLow} v={stats.min} unit={unit} />
          <ReadoutLevel k={READOUT_LABEL.rangeAvg} v={stats.avg} unit={unit} />
          <ReadoutChange
            k={READOUT_LABEL.dailyChange}
            v={dailyChange}
            unit={unit}
          />
        </ReadoutCard>
      )}
    </div>
  );
}
