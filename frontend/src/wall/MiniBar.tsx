"use client";

/* Center-zero mini-bar — the change channel (DESIGN §5/§8/§9). Length =
 * magnitude, direction = sign (right = up, left = down). It is a DIRECTIONAL
 * mark, so it is filled red for up / blue for down (§9) via a text-up/
 * text-down color class + currentColor — no per-element var(). The bar
 * direction keeps sign legible in grayscale. */

import { dirClass } from "@/lib/format";

export function MiniBar({
  delta,
  scale,
}: {
  /** delta in bp (null renders an empty track) */
  delta: number | null;
  /** max |delta| that maps to a full half-track */
  scale: number;
}) {
  const frac =
    delta == null || scale <= 0 ? 0 : Math.min(1, Math.abs(delta) / scale);
  const half = frac * 50;
  return (
    <div className={`relative h-[3px] w-full ${dirClass(delta)}`}>
      {/* center tick stays ink-grey regardless of direction */}
      <div className="absolute inset-y-0 left-1/2 w-px bg-ink opacity-15" />
      {delta != null && frac > 0 && (
        <div
          className="absolute inset-y-0 bg-current opacity-80"
          style={
            delta >= 0
              ? { left: "50%", width: `${half}%` }
              : { right: "50%", width: `${half}%` }
          }
        />
      )}
    </div>
  );
}
