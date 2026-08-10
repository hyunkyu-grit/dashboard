"use client";

/* 백테스트의 손익 차트 둘 — BacktestWindow.tsx 에서 추출 (2026-08-10).
 *
 * PnlChart 는 결과 헤드라인 아래의 독립 누적 손익 선이고, LinkedPnlChart 는
 * 종목 차트 밑에 픽셀 정렬로 붙는 쌍둥이다. 렌더 문법(0선 항상 프레임 안,
 * 부호색, 돈 카드)이 같아 한 모듈이 맞고, 1,778줄짜리 창 컴포넌트가 이 둘을
 * 품고 있을 이유는 없었다. 값·동작 불변 — guards/readout-parity 의 "toFixed
 * 는 픽셀 좌표뿐" 규칙이 이 파일도 같이 스캔한다.
 */

import { useState } from "react";

import type { BacktestResult, HistoryPoint } from "@/lib/api";

import { fmtKrw } from "./krw";
import { CHART_PAD } from "./PreviewChart";

/** The hover card's fixed width, so the caller can clamp it inside the plot. */
export const CARD_W = 150;

/** The P&L line, with a hovered readout [OWNER].
 *
 * Hand-rolled SVG like every other chart here. Two things are deliberate:
 *
 * The zero line is always in frame, because it is the win/lose boundary and a
 * P&L chart that can be entirely above or below its own axis cannot be read at
 * a glance.
 *
 * The readout is LOCAL and not the shared `ReadoutCard`. That card owns
 * `fmtLevel` and `fmtDelta` precisely so the preview chart and the idle curve
 * cannot drift into two grammars for one quantity — but this axis is MONEY,
 * formatted by `fmtKrw` in 억/만. Passing pre-formatted strings into the shared
 * card, or teaching it a money mode, would dissolve the property it exists
 * for. Different quantity, different card.
 */
export function PnlChart({
  result,
  width,
  height,
}: {
  result: BacktestResult;
  width: number;
  height: number;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const pts = result.points;

  const PAD = { top: 8, right: 8, bottom: 18, left: 8 };
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  let lo = 0; // the zero line is always in frame — it is the win/lose boundary
  let hi2 = 0;
  for (const p of pts) {
    if (p.pnl < lo) lo = p.pnl;
    if (p.pnl > hi2) hi2 = p.pnl;
  }
  const pad = (hi2 - lo) * 0.08 || 1;
  const yMin = lo - pad;
  const yMax = hi2 + pad;
  const x = (i: number) => PAD.left + (i / Math.max(1, pts.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  if (pts.length < 2) return null;

  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.pnl).toFixed(1)}`).join(" ");
  const up = result.pnl >= 0;
  // the area closed on the ZERO axis rather than the bottom of the box, so the
  // fill reads as "distance from breakeven", which is what it is
  const area = `${line} ${x(pts.length - 1).toFixed(1)},${y(0).toFixed(1)} ${x(0).toFixed(1)},${y(0).toFixed(1)}`;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - PAD.left) / plotW) * (pts.length - 1));
    setHi(Math.max(0, Math.min(pts.length - 1, i)));
  };

  const hp = hi != null ? pts[hi] : null;
  const tipLeft =
    hi != null ? Math.min(width - CARD_W - 8, Math.max(0, x(hi) + 10)) : 0;

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="누적 손익"
        onMouseMove={onMove}
        onMouseLeave={() => setHi(null)}
      >
        <defs>
          <linearGradient id="btfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <g className={up ? "text-up" : "text-down"}>
          <polygon points={area} fill="url(#btfill)" stroke="none" />
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </g>
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-ink"
          strokeWidth={1}
          strokeOpacity={0.25}
        />
        {hp && (
          <>
            <line
              x1={x(hi!)}
              x2={x(hi!)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-ink"
              strokeWidth={1}
              strokeOpacity={0.25}
            />
            <circle
              cx={x(hi!)}
              cy={y(hp.pnl)}
              r={3.5}
              className={up ? "fill-up" : "fill-down"}
            />
          </>
        )}
        <text x={PAD.left} y={height - 5} className="fill-ink"
          style={{ fontSize: 10, opacity: 0.45 }}>
          {result.from}
        </text>
        <text x={width - PAD.right} y={height - 5} textAnchor="end"
          className="fill-ink" style={{ fontSize: 10, opacity: 0.45 }}>
          {result.to}
        </text>
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 rounded-popover bg-popover px-2.5 py-2 text-[13px] shadow-popover"
          style={{ left: tipLeft, width: CARD_W }}
        >
          <div className="tabular-nums opacity-50">{hp.t}</div>
          <div className="mt-1 flex justify-between gap-2">
            <span className="opacity-50">누적</span>
            <span
              className={`font-semibold tabular-nums ${
                hp.pnl >= 0 ? "text-up" : "text-down"
              }`}
            >
              {fmtKrw(hp.pnl)}
            </span>
          </div>
          <div className="mt-0.5 flex justify-between gap-2">
            {/* Always 당일: the server values the business day before every
                published point, so this is a real one-day change even where
                the line is drawn at one dot per ~6 days. */}
            <span className="opacity-50">당일</span>
            <span
              className={`tabular-nums ${
                hp.d == null ? "opacity-40" : hp.d >= 0 ? "text-up" : "text-down"
              }`}
            >
              {hp.d == null ? "—" : fmtKrw(hp.d)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The P&L, drawn UNDER the instrument it was earned on and PIXEL-ALIGNED
 * with it [OWNER 재피드백, 2026-08-04 — "PL은 밑에 그려지되 … far left가
 * 진입일, far right가 청산일로 해서 … 완전히 수직적으로 얼라인"].
 *
 * Alignment is CONSTRUCTED, not tuned: this chart takes the SAME `pts` slice
 * the instrument chart plots (entry → exit), shares `CHART_PAD`'s left/right,
 * and uses the same index→x formula — a date's x here equals its x above to
 * the pixel, which is what lets one crosshair serve both. The money at each
 * date is the SERVER's cumulative P&L at the most recent published point on
 * or before it (§16: the line is thinned server-side; 누적 and 당일 are both
 * served, never differenced here).
 *
 * PnlChart's rules carry over — the zero line always in frame (the win/lose
 * boundary), the area closed on zero, the hue the run's final sign, and the
 * hover card the same money card (fmtKrw; the shared ReadoutCard stays
 * level-only, see PnlChart's note). What it deliberately does NOT have:
 * its own x labels (the instrument chart's date labels sit between the two
 * charts and serve both) and any zoom (`still` above, same reason). */
export function LinkedPnlChart({
  pts,
  result,
  width,
  height,
  hoverIso,
  onHover,
}: {
  pts: HistoryPoint[];
  result: BacktestResult;
  width: number;
  height: number;
  hoverIso: string | null;
  onHover: (iso: string | null) => void;
}) {
  const PAD = {
    top: 8,
    right: CHART_PAD.right,
    bottom: 6,
    left: CHART_PAD.left,
  };
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  /* cumulative P&L per plotted date — a forward walk, both series sorted */
  const vals: number[] = [];
  {
    let j = -1;
    for (const p of pts) {
      while (j + 1 < result.points.length && result.points[j + 1].t <= p.t) j++;
      vals.push(j >= 0 ? result.points[j].pnl : 0);
    }
  }
  let lo = 0; // zero always in frame — the win/lose boundary
  let hi = 0;
  for (const v of vals) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const pad = (hi - lo) * 0.08 || 1;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (i: number) => PAD.left + (i / (pts.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const line = vals
    .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  // closed on ZERO, so the fill reads as distance from breakeven
  const area = `${line} ${x(vals.length - 1).toFixed(1)},${y(0).toFixed(1)} ${x(0).toFixed(1)},${y(0).toFixed(1)}`;
  const up = result.pnl >= 0;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(
      ((e.clientX - rect.left - PAD.left) / plotW) * (pts.length - 1),
    );
    onHover(pts[Math.max(0, Math.min(pts.length - 1, i))].t);
  };

  /* the crosshair index from the SHARED date — same on-or-after mapping the
   * instrument chart uses for its external hover, so the two verticals land
   * on the same x for the same date */
  const hIdx =
    hoverIso != null && hoverIso >= pts[0].t && hoverIso <= pts[pts.length - 1].t
      ? Math.max(0, pts.findIndex((p) => p.t >= hoverIso))
      : null;
  const hp =
    hIdx != null
      ? ([...result.points].reverse().find((p) => p.t <= pts[hIdx].t) ?? null)
      : null;
  const tipLeft =
    hIdx != null ? Math.min(width - CARD_W - 8, Math.max(0, x(hIdx) + 10)) : 0;

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="누적 손익"
        className="select-none"
        onMouseMove={onMove}
        onMouseLeave={() => onHover(null)}
      >
        {/* the panel says what it is — the top chart carries a legend for
            its references, and an unlabelled second chart one gap below
            would make the reader infer "this is the money" */}
        <text
          x={PAD.left + 2}
          y={PAD.top + 8}
          className="fill-ink"
          style={{ fontSize: 10, opacity: 0.45 }}
        >
          누적 손익
        </text>
        <g className={up ? "text-up" : "text-down"}>
          <polygon
            points={area}
            fill="currentColor"
            fillOpacity={0.08}
            stroke="none"
          />
          <polyline
            data-linked-pnl=""
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        </g>
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-ink"
          strokeWidth={1}
          strokeOpacity={0.25}
        />
        {hIdx != null && (
          <>
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
            <circle
              cx={x(hIdx)}
              cy={y(vals[hIdx])}
              r={3}
              className={up ? "fill-up" : "fill-down"}
            />
          </>
        )}
      </svg>
      {hp && hIdx != null && (
        <div
          className="pointer-events-none absolute top-1 rounded-popover bg-popover px-2.5 py-2 text-[13px] shadow-popover"
          style={{ left: tipLeft, width: CARD_W }}
        >
          <div className="tabular-nums opacity-50">{hp.t}</div>
          <div className="mt-1 flex justify-between gap-2">
            <span className="opacity-50">누적</span>
            <span
              className={`font-semibold tabular-nums ${
                hp.pnl >= 0 ? "text-up" : "text-down"
              }`}
            >
              {fmtKrw(hp.pnl)}
            </span>
          </div>
          <div className="mt-0.5 flex justify-between gap-2">
            <span className="opacity-50">당일</span>
            <span
              className={`tabular-nums ${
                hp.d == null ? "opacity-40" : hp.d >= 0 ? "text-up" : "text-down"
              }`}
            >
              {hp.d == null ? "—" : fmtKrw(hp.d)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
