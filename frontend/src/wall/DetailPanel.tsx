"use client";

/* Detail overlay content (design spec §2/§12 step 9).
 *
 * tile target lives in the URL (§10). "curve" shows the enlarged curve
 * cross-section plus a series picker; "series:<id>" shows that series'
 * full-resolution 10y history (stage-2) in the detail chart. Esc/click-out
 * close is handled by the enclosing DetailOverlay.
 */

import { useRouter } from "next/navigation";

import type { WallSummary } from "@/lib/api";

import { CurveOverlayTile } from "./CurveOverlayTile";
import { DetailChart } from "./DetailChart";

const SPREAD_PICKS = ["1Y-2Y", "2Y-3Y", "3Y-5Y", "5Y-10Y", "2Y-5Y-10Y"];

export function DetailPanel({
  target,
  summary,
}: {
  target: string;
  summary: WallSummary;
}) {
  const router = useRouter();
  const open = (t: string) => router.push(`/?tile=${t}`, { scroll: false });

  if (target.startsWith("series:")) {
    const id = target.slice("series:".length);
    return (
      <div className="w-[1000px]">
        <button
          type="button"
          onClick={() => open("curve")}
          className="mb-2 text-[13px] opacity-60 hover:opacity-100"
        >
          ← curve
        </button>
        <DetailChart id={id} label={id.replace(/-/g, "/")} width={1000} height={560} />
      </div>
    );
  }

  // Default "curve": enlarged cross-section + series picker into stage-2.
  const outrights = summary.outrights.map((o) => o.id);
  return (
    <div className="w-[1200px]">
      <CurveOverlayTile summary={summary} width={1200} height={560} />
      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-edge pt-3 text-[13px]">
        <span className="mr-1 opacity-60">full history:</span>
        {[...outrights, ...SPREAD_PICKS].map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => open(`series:${id}`)}
            className="rounded-sm border border-edge px-2 py-0.5 hover:bg-tile"
          >
            {id.replace(/-/g, "/")}
          </button>
        ))}
      </div>
    </div>
  );
}
