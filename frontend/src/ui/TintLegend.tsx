"use client";

/* Tint legend (§9/§J; closing session part 2, Pass E2). The matrix has 168
 * tinted cells and the popup heatmap shares the exact same scale, yet nothing
 * said what the intensity meant — a reader could not tell a dark cell was a big
 * MOVE (not a high level), nor that the intensity is measured against each
 * series' OWN history. This is that key: a diverging swatch strip from 하락
 * through an untinted middle to 상승, plus one line naming what intensity
 * encodes. It is deliberately small and quiet — a key, not a feature — and the
 * SAME component renders under both the forward matrix and the curve heatmap so
 * the scale is explained identically in both places. Swatch alphas are the real
 * scale endpoints (MATRIX_FLOOR..MATRIX_FULL) so the legend can't drift from
 * tint.ts. Hue flips with the theme via the tokens, like every tinted cell. */

import { MATRIX_FLOOR, MATRIX_FULL } from "@/ui/tint";

// strong → faint, matching the graded wash (pct97 ceiling → pct70 floor)
const STEPS = [MATRIX_FULL, (MATRIX_FLOOR + MATRIX_FULL) / 2, MATRIX_FLOOR];

function swatch(alpha: number, up: boolean) {
  const hue = up ? "var(--bw-up)" : "var(--bw-down)";
  return {
    backgroundColor: `color-mix(in srgb, ${hue} ${(alpha * 100).toFixed(0)}%, transparent)`,
  };
}

export function TintLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-2 text-[11px] opacity-55">
        <span>하락</span>
        <div className="flex overflow-hidden rounded-[3px] border border-edge">
          {STEPS.map((a, i) => (
            <div key={`d${i}`} className="h-3 w-4" style={swatch(a, false)} />
          ))}
          {/* untinted middle: a small move reads as no wash */}
          <div className="h-3 w-4 bg-tile" />
          {[...STEPS].reverse().map((a, i) => (
            <div key={`u${i}`} className="h-3 w-4" style={swatch(a, true)} />
          ))}
        </div>
        <span>상승</span>
      </div>
      <p className="text-[11px] opacity-45">
        칸이 진할수록 그 종목의 10년 일간 변동 대비 오늘 움직임이 큽니다.
      </p>
    </div>
  );
}
