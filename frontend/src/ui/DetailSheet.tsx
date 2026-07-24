"use client";

/* Level 3 — detail sheet sliding up from the bottom (DESIGN §2). Three kinds:
 *   series:<id>  → full 10y history (lightweight-charts, assertDomainRendered)
 *                  + a six-basis segmented readout (the full ramp lives here).
 *   curve        → enlarged curve overlay, all six bases.
 *   fwd:<tenor>  → enlarged forward tile, all six bases.
 * Dismiss on Esc / backdrop; downward-drag is added in Pass 4. Content is
 * wrapped in an error boundary so a thrown guard shows a message, not a blank
 * region (the detail-open fix). */

import { useEffect, useMemo, useState } from "react";

import type { ForwardsPayload, WallSummary } from "@/lib/api";
import { dirClass, fmtBp, fmtRate } from "@/lib/format";
import { BASIS_LABELS, TIME_BASES, type TimeBasis } from "@/theme/ramp";

import { CurveOverlayTile } from "@/wall/CurveOverlayTile";
import { DetailChart } from "@/wall/DetailChart";
import { ForwardTile } from "@/wall/ForwardTile";

import { ERROR_SENTENCE } from "./copy";
import { ErrorBoundary } from "./ErrorBoundary";

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
                ? "flex-1 bg-brand px-2 py-1 text-center text-page"
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

function SheetBody({
  target,
  summary,
  forwards,
}: {
  target: string;
  summary: WallSummary;
  forwards?: ForwardsPayload;
}) {
  if (target === "curve") {
    return (
      <>
        <h2 className="mb-2 text-[17px] font-semibold">커브 · 6개 기준선</h2>
        <CurveOverlayTile summary={summary} width={880} height={460} />
      </>
    );
  }
  if (target.startsWith("fwd:")) {
    const tenor = target.slice(4);
    if (!forwards) return <p className="p-6">{ERROR_SENTENCE}</p>;
    return (
      <>
        <h2 className="mb-2 text-[17px] font-semibold">{tenor} · 6개 기준선</h2>
        <ForwardTile tenor={tenor} payload={forwards} width={880} height={420} />
      </>
    );
  }
  // series:<id>
  const id = target.slice("series:".length);
  return (
    <>
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-[17px] font-semibold">{id.replace(/-/g, "/")}</h2>
        <span className="text-[12px] opacity-45">지난 10년 흐름이에요</span>
      </div>
      <DetailChart id={id} label={id.replace(/-/g, "/")} width={880} height={440} />
      <SixBasisReadout summary={summary} seriesId={id} />
    </>
  );
}

export function DetailSheet({
  target,
  summary,
  forwards,
  onClose,
}: {
  target: string;
  summary: WallSummary;
  forwards?: ForwardsPayload;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-page/70"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-[960px] overflow-y-auto rounded-t-[20px] bg-popover p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* grab handle (drag-to-dismiss wired in Pass 4) */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-edge" />
        <ErrorBoundary fallback={ERROR_SENTENCE}>
          <SheetBody target={target} summary={summary} forwards={forwards} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
