"use client";

/* Carry & roll panel (carry session, Pass C) — the thing the popup lacked:
 * what HOLDING the trade earns over a horizon, from today's curve. Mechanics,
 * not prediction (no scores, no ratings). Replaces the curve heatmap.
 *
 * Headline sentence at hero weight; the carry/roll breakdown beneath as a
 * caption in secondary ink. The NUMBERS carry direction colour; the sentence
 * does not. Sign follows the Pay/Receive toggle (lifted to the popup),
 * exactly as the diagram does. Volatility rows get one line, not zeros. */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchCarry, type CarryHorizon } from "@/lib/api";
import { dirClass } from "@/lib/format";

import { carrySentence, fmtSigned, HORIZON_LABEL } from "./carryCopy";
import type { Side } from "./payReceiveModel";
import type { Row } from "./rows";

const HORIZONS: CarryHorizon[] = ["1M", "3M", "6M", "1Y"];

export function CarryPanel({ row, side }: { row: Row; side: Side }) {
  const [horizon, setHorizon] = useState<CarryHorizon>("3M");
  const isVol = row.group === "vol";
  const { data } = useQuery({
    queryKey: ["carry", row.id],
    queryFn: () => fetchCarry(row.id),
    enabled: !isVol,
    staleTime: 60_000,
  });

  // a ratio has no carry statement — one line, never zeros (§ Pass C)
  if (isVol) {
    return (
      <div className="mt-4 max-w-[720px]">
        <p className="text-[13px] opacity-55">
          변동성 지표는 보유 손익이 없어 캐리를 셈하지 않습니다.
        </p>
      </div>
    );
  }
  if (!data) return null;

  const s = carrySentence(horizon, data.horizons[horizon], side);

  return (
    <div className="mt-4 max-w-[720px]">
      <div className="mb-1.5 flex items-center gap-3">
        <span className="text-[12px] opacity-45">캐리 · 롤</span>
        {/* horizon control — same quiet register as the 페이/리시브 toggle */}
        <div className="flex overflow-hidden rounded-[6px] border border-edge text-[12px]">
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              className={
                h === horizon
                  ? "bg-ink px-2 py-0.5 text-page"
                  : "px-2 py-0.5 opacity-50 hover:opacity-90"
              }
            >
              {HORIZON_LABEL[h]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[17px] font-semibold">{s.headline}</p>
      {s.kind !== "none" && (
        <p className="mt-0.5 text-[13px] opacity-70">
          <span className="opacity-70">캐리 </span>
          <span className={`tabular-nums ${dirClass(s.carry)}`}>{fmtSigned(s.carry)}</span>
          <span className="opacity-45"> · </span>
          <span className="opacity-70">롤 </span>
          <span className={`tabular-nums ${dirClass(s.roll)}`}>{fmtSigned(s.roll)}</span>
          {s.tail && <span className="opacity-45"> · {s.tail}</span>}
        </p>
      )}
    </div>
  );
}
