"use client";

/* Bottom change log (design spec §3). Outlier events append as single
 * lines; clicking a line pans the viewport to that tile — this is how
 * off-screen anomalies are surfaced. Also the future entry point for
 * scenario / trade-log features. */

import { useMemo } from "react";

import type { WallSummary } from "@/lib/api";
import { fmtBp, fmtRate } from "@/lib/format";
import { BASIS_LABELS } from "@/theme/ramp";
import { useUiStore } from "@/state/ui";

import { detectOutliers, OUTLIER_PCT } from "./outliers";
import { getTile } from "./tileRegistry";

export function ChangeLog({
  summary,
  onJump,
}: {
  summary?: WallSummary;
  onJump: (el: HTMLElement) => void;
}) {
  const basis = useUiStore((s) => s.basis);
  const events = useMemo(
    () => (summary ? detectOutliers(summary, basis) : []),
    [summary, basis],
  );

  return (
    <footer className="flex h-24 shrink-0 flex-col border-t border-edge bg-page">
      <div className="flex items-center gap-2 px-3 py-1 text-[12px] opacity-60">
        <span className="font-semibold opacity-100">change log</span>
        <span>
          {events.length} outlier{events.length === 1 ? "" : "s"} · percentile
          ≥{OUTLIER_PCT} / ≤{100 - OUTLIER_PCT} or large Δ vs{" "}
          {BASIS_LABELS[basis]}
        </span>
      </div>
      <ul className="flex-1 overflow-y-auto px-3 text-[13px]">
        {events.length === 0 && (
          <li className="opacity-50">no outliers at current basis</li>
        )}
        {events.map((e) => {
          const tile = getTile(e.anchor);
          return (
            <li key={e.id}>
              <button
                type="button"
                disabled={!tile}
                onClick={() => tile && onJump(tile.el)}
                className="flex w-full items-baseline gap-2 py-0.5 text-left enabled:hover:bg-tile disabled:opacity-60"
              >
                <span className="w-24 shrink-0 truncate">{e.label}</span>
                {/* weight-600 = outlier channel (§5) */}
                <span className="w-16 shrink-0 font-semibold tabular-nums">
                  {e.unit === "%" ? fmtRate(e.now) : fmtBp(e.now)}
                </span>
                <span className="w-14 shrink-0 opacity-70">
                  {e.pct != null ? `${e.pct}pct` : "–"}
                </span>
                <span className="w-16 shrink-0 opacity-70">
                  {e.delta != null ? fmtBp(e.delta) : "–"}
                </span>
                <span className="opacity-50">
                  {e.reasons.join(" + ")}
                  {tile ? "" : " · no tile"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </footer>
  );
}
