"use client";

/* Enlarged view (DESIGN §2) — LIVE AGAIN since the backtest-window session
 * (2026-08-03). The chart click still opens the backtest [OWNER, 2026-07-31:
 * "차트 클릭 → 백테스트"]; this view returned on `?tile` with its own way in
 * (the pane header's 크게 보기), now that the backtest window lives in its
 * own `bt` URL namespace and no longer squats on the tile slot. Between
 * 2026-07-31 and then this file was kept-but-unreferenced precisely so the
 * candles, the six-basis readout and the DV01 block could come back like
 * this rather than be rebuilt.
 *
 * Full-screen sheet over the list: for a series, the large lightweight-charts
 * history (blue line, assertDomainRendered, visible-range 최고/최저) + a
 * six-basis segmented readout (the full ramp lives here) + a reserved-but-
 * empty strategy region. Esc / backdrop dismiss (drag added in Pass 4);
 * wrapped in an error boundary so a thrown guard shows a message, not a
 * blank region. A MODAL (Z_MODAL): it dims and takes the screen — including
 * over the floating backtest window, whose state it never touches. */

import { useQuery } from "@tanstack/react-query";
import { motion, type PanInfo, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { fetchDv01, type WallSummary } from "@/lib/api";
import { dirClass, fmtBp, fmtRate } from "@/lib/format";
import { BASIS_LABELS, TIME_BASES, type TimeBasis } from "@/theme/ramp";
import type { ChartType } from "@/wall/DetailChart";

import { ERROR_SENTENCE } from "./copy";
import { LoadingState } from "./DataState";
import { ErrorBoundary } from "./ErrorBoundary";
import { instrumentGloss, instrumentSubtitle } from "./gloss";
import { Z_MODAL } from "./layers";
import { PayReceive } from "./PayReceive";
import type { Side } from "./payReceiveModel";
import { ENTER, EXIT, instant } from "./motion";
import type { Row } from "./rows";

/* lightweight-charts is the largest dependency in the build (196 KB raw) and
 * §11 already confines it to this popup — but a static import put it on the
 * first-load path anyway, so every reader downloaded and parsed it whether or
 * not they ever opened a popup (measured: docs/diagnostics/perf-baseline.md).
 * Behind `dynamic` it arrives with the popup instead. `ssr: false` because the
 * library needs a real canvas; the type import above is erased at compile time
 * and does NOT pull the module back into the initial chunk. */
const DetailChart = dynamic(
  () => import("@/wall/DetailChart").then((m) => m.DetailChart),
  { ssr: false, loading: () => <LoadingState what="차트" className="h-[420px]" /> },
);

function SixBasisReadout({
  summary,
  seriesId,
}: {
  summary: WallSummary;
  seriesId: string;
}) {
  const [basis, setBasis] = useState<TimeBasis>("now");
  const s = useMemo(
    () =>
      [...summary.outrights, ...summary.derived].find((x) => x.id === seriesId),
    [summary, seriesId],
  );
  if (!s) return null;
  const level = basis === "now" ? s.now : s.basisValues[basis];
  const delta = basis === "now" ? 0 : s.deltas[basis];
  return (
    <div className="mt-3">
      {/* 세그먼티드 컨트롤이다 — 배타 선택 넷이 한 칸에 든다 [2026-08-07].
          모양은 이미 그랬고 두 가지가 킷과 달랐다.
          1. 선택 칸이 잉크 채움이었다. 킷은 여기를 **액센트**로 칠한다
             (Segmented Control/Active, On). 라벨도 같이 on-accent 로 간다 —
             주황 위 흰 글자는 2.31:1 이다.
          2. 안 고른 칸이 `opacity-50` 이었다. 요소 불투명도는 배경까지 같이
             내려서 칸이 뚫려 보인다(§G). 잉크 층위(ink-2)가 그 자리다. */}
      <div className="flex overflow-hidden rounded-control border border-edge text-[13px]">
        {TIME_BASES.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBasis(b)}
            className={
              b === basis
                ? "flex-1 bg-accent px-2 py-1 text-center font-medium text-on-accent"
                : "flex-1 px-2 py-1 text-center text-ink-2 transition-colors hover:text-ink"
            }
          >
            {BASIS_LABELS[b]}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-[15px] tabular-nums">
          {s.unit === "%" ? fmtRate(level) : `${level?.toFixed(1)}`}
          <span className="ml-1 text-[12px] opacity-45">
            {s.unit === "%" ? "%" : "bp"}
          </span>
        </span>
        {basis !== "now" && (
          <span className={`text-[13px] tabular-nums ${dirClass(delta)}`}>
            {fmtBp(delta)}
          </span>
        )}
      </div>
    </div>
  );
}

/** DV01-neutral leg weights (§B) — what you actually have to execute. Numbers
 * only, no chart. Spread/fly show the ratio; an outright shows its DV01 alone.
 * Indicative at the current curve; drifts as it moves. */
function LegWeights({ seriesId }: { seriesId: string }) {
  const { data } = useQuery({
    queryKey: ["dv01", seriesId],
    queryFn: () => fetchDv01(seriesId),
    staleTime: 60_000,
  });
  if (!data || !data.kind) return null;

  if (data.kind === "outright") {
    const leg = data.legs[0];
    // annuity → KRW/bp per 100억 notional = annuity × 1e6; shown in 만원.
    const manwon = Math.round(leg.dv01 * 100);
    return (
      <div className="mt-4">
        <div className="text-[12px] opacity-45">DV01</div>
        <div className="mt-0.5 text-[15px] tabular-nums">
          {manwon.toLocaleString()}만원 / bp
          <span className="ml-1 text-[12px] opacity-45">100억 명목 기준</span>
        </div>
      </div>
    );
  }

  const ratio = data.legs.map((l) => `${l.tenor} ${l.notional}`).join(" : ");
  return (
    <div className="mt-4">
      <div className="text-[12px] opacity-45">DV01 중립 비중</div>
      <div className="mt-0.5 text-[15px] tabular-nums">{ratio}</div>
      <p className="mt-1 text-[12px] opacity-45">
        현재 커브 기준 지표예요. 커브가 움직이면 함께 변해요.
      </p>
    </div>
  );
}

function StrategyRegion() {
  return (
    <div className="mt-6 flex h-40 items-center justify-center rounded-card border border-dashed border-edge text-[13px] opacity-40">
      전략 도구가 이 자리에 들어올 예정이에요
    </div>
  );
}

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "line", label: "선" },
  { id: "w", label: "주봉" },
  { id: "m", label: "월봉" },
];

/** 선 · 주봉 · 월봉 selector (popup only — candles need width the preview lacks,
 * §G). The type lives in the URL alongside ?tile so a view can be linked. */
function ChartTypeToggle({
  chartType,
  onChartType,
}: {
  chartType: ChartType;
  onChartType: (t: ChartType) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-control border border-edge text-[13px]">
      {CHART_TYPES.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChartType(c.id)}
          /* 위 기준 세그먼티드와 같은 문법 — 선택은 액센트 채움 + on-accent
             라벨, 나머지는 요소 불투명도가 아니라 잉크 층위. */
          className={
            c.id === chartType
              ? "bg-accent px-3 py-1 font-medium text-on-accent"
              : "px-3 py-1 text-ink-2 transition-colors hover:text-ink"
          }
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function Body({
  row,
  summary,
  chartType,
  onChartType,
}: {
  row: Row;
  summary: WallSummary;
  chartType: ChartType;
  onChartType: (t: ChartType) => void;
}) {
  // Pay/Receive side. It was lifted here so the diagram and the carry panel
  // could share one sign convention; carry is gone, so the diagram is the
  // only consumer left. Kept lifted — the popup is the natural owner, and a
  // second consumer (a Pay/Receive-signed readout) would need it again.
  const [side, setSide] = useState<Side>("pay");
  if (!row.seriesId) {
    // every group now derives a history (outrights, spreads, forwards, vol);
    // this stays only as a defensive fallback.
    return (
      <p className="p-10 text-center text-[15px] opacity-55">
        과거 흐름을 볼 수 없어요
      </p>
    );
  }

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <h2 className="text-[17px] font-semibold">{row.label}</h2>
          {/* subtitle naming the construct (§ Pass C1) */}
          <p className="mt-0.5 text-[13px] opacity-55">{instrumentSubtitle(row)}</p>
        </div>
        <ChartTypeToggle chartType={chartType} onChartType={onChartType} />
      </div>
      <DetailChart
        id={row.seriesId}
        unit={row.unit}
        chartType={chartType}
        width={900}
        height={420}
        policy={summary.policy}
      />
      {/* This space is deliberately EMPTY. The curve heatmap sat here, then
          carry & roll; both were removed (see DESIGN §2) and nothing has
          replaced them. Do not fill it to balance the layout. */}
      {/* what this instrument IS — static, keyed to kind (§ Pass C1) */}
      <p className="mt-3 max-w-[720px] text-[13px] leading-relaxed opacity-70">
        {instrumentGloss(row)}
      </p>
      {/* what you execute (DV01 ratio, §B) beside which way it profits (§A) */}
      <div className="flex flex-wrap items-start gap-10">
        <LegWeights seriesId={row.seriesId} />
        <PayReceive row={row} side={side} onSide={setSide} />
      </div>
      <SixBasisReadout summary={summary} seriesId={row.seriesId} />
      <StrategyRegion />
    </>
  );
}

export function EnlargedView({
  row,
  summary,
  chartType,
  onChartType,
  onClose,
}: {
  row: Row;
  summary: WallSummary;
  chartType: ChartType;
  onChartType: (t: ChartType) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 500) onClose();
  };

  /* No spring here any more [OWNER, 2026-08-06]: exactly one surface may
   * overshoot and it is the row reorder. The sheet rises on the shared
   * ease-out and leaves on the shorter exit. Drag-dismiss is unchanged — it
   * follows the pointer, which is direct manipulation, not an animation. */
  const reduced = useReducedMotion() === true;

  return (
    <motion.div
      className={`fixed inset-0 ${Z_MODAL} flex items-end justify-center bg-page/70`}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: instant(EXIT, reduced) }}
      transition={instant(ENTER, reduced)}
    >
      <motion.div
        className="max-h-[92vh] w-full max-w-[1000px] overflow-y-auto rounded-t-sheet bg-popover p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%", transition: instant(EXIT, reduced) }}
        transition={instant(ENTER, reduced)}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={onDragEnd}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-edge" />
        <ErrorBoundary fallback={ERROR_SENTENCE}>
          <Body
            row={row}
            summary={summary}
            chartType={chartType}
            onChartType={onChartType}
          />
        </ErrorBoundary>
      </motion.div>
    </motion.div>
  );
}
