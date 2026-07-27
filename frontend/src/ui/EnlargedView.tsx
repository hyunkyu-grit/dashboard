"use client";

/* Enlarged view (DESIGN §2). Full-screen sheet over the list: for a series,
 * the large lightweight-charts history (orange, assertDomainRendered) + a
 * six-basis segmented readout (the full ramp lives here) + the larger calendar
 * heatmap + a reserved-but-empty strategy region. For a forward, the forward
 * matrix instead. Esc / backdrop dismiss (drag added in Pass 4); wrapped in an
 * error boundary so a thrown guard shows a message, not a blank region. */

import { useQuery } from "@tanstack/react-query";
import { motion, type PanInfo } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { fetchDv01, type WallSummary } from "@/lib/api";
import { dirClass, fmtBp, fmtRate } from "@/lib/format";
import { BASIS_LABELS, TIME_BASES, type TimeBasis } from "@/theme/ramp";
import { DetailChart } from "@/wall/DetailChart";

import { ERROR_SENTENCE } from "./copy";
import { ErrorBoundary } from "./ErrorBoundary";
import { instrumentGloss, instrumentSubtitle } from "./gloss";
import { SHEET_SPRING } from "./motion";
import type { Row } from "./rows";

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
      <div className="flex overflow-hidden rounded-[8px] border border-edge text-[13px]">
        {TIME_BASES.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBasis(b)}
            className={
              b === basis
                ? "flex-1 bg-ink px-2 py-1 text-center text-page"
                : "flex-1 px-2 py-1 text-center opacity-50 hover:opacity-90"
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
        현재 커브 기준 지표이며, 커브가 움직이면 함께 변합니다.
      </p>
    </div>
  );
}

function StrategyRegion() {
  return (
    <div className="mt-6 flex h-40 items-center justify-center rounded-[16px] border border-dashed border-edge text-[13px] opacity-40">
      전략 도구가 이 자리에 들어올 예정입니다
    </div>
  );
}

function Body({ row, summary }: { row: Row; summary: WallSummary }) {
  if (!row.seriesId) {
    // every group now derives a history (outrights, spreads, forwards, vol);
    // this stays only as a defensive fallback.
    return (
      <p className="p-10 text-center text-[15px] opacity-55">
        과거 흐름을 볼 수 없습니다
      </p>
    );
  }

  return (
    <>
      <div className="mb-1 flex items-baseline justify-between">
        <div>
          <h2 className="text-[17px] font-semibold">{row.label}</h2>
          {/* subtitle naming the construct (§ Pass C1) */}
          <p className="mt-0.5 text-[13px] opacity-55">{instrumentSubtitle(row)}</p>
        </div>
        <span className="text-[12px] opacity-45">지난 10년 흐름입니다</span>
      </div>
      <DetailChart id={row.seriesId} unit={row.unit} width={900} height={420} />
      {/* what this instrument IS — static, keyed to kind (§ Pass C1) */}
      <p className="mt-3 max-w-[720px] text-[13px] leading-relaxed opacity-70">
        {instrumentGloss(row)}
      </p>
      <LegWeights seriesId={row.seriesId} />
      <SixBasisReadout summary={summary} seriesId={row.seriesId} />
      <StrategyRegion />
    </>
  );
}

export function EnlargedView({
  row,
  summary,
  onClose,
}: {
  row: Row;
  summary: WallSummary;
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

  return (
    <motion.div
      className="fixed inset-0 z-30 flex items-end justify-center bg-page/70"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="max-h-[92vh] w-full max-w-[1000px] overflow-y-auto rounded-t-[20px] bg-popover p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={SHEET_SPRING}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={onDragEnd}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-edge" />
        <ErrorBoundary fallback={ERROR_SENTENCE}>
          <Body row={row} summary={summary} />
        </ErrorBoundary>
      </motion.div>
    </motion.div>
  );
}
