"use client";

/* Center-zero mini-bar — the table delta channel (design spec §5/§8).
 * Length = magnitude, direction = sign (right = +, left = −). Never color.
 *
 * Colors come from currentColor, not var() lookups: hundreds of these
 * paint at once in the matrix, and per-element variable resolution stalls
 * rasterization (see ForwardTile).
 */

export function MiniBar({
  delta,
  scale,
}: {
  /** delta in bp (null renders an empty track, e.g. basis = Now) */
  delta: number | null;
  /** max |delta| that maps to a full half-track */
  scale: number;
}) {
  const frac =
    delta == null || scale <= 0 ? 0 : Math.min(1, Math.abs(delta) / scale);
  const half = frac * 50;
  return (
    <div className="relative h-[3px] w-full">
      <div className="absolute inset-y-0 left-1/2 w-px bg-current opacity-15" />
      {delta != null && frac > 0 && (
        <div
          className="absolute inset-y-0 bg-current opacity-65"
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
