/**
 * The change-cell tint ramp, carried from v1 unchanged.
 *
 * It is NOT re-derived from CDS colours and must not be: the ramp is an opacity
 * over the direction hue, and the direction hue is frozen (V1). CDS has no
 * opinion about it and should not acquire one.
 *
 * Two rules from v1 §4 that the ramp exists to serve:
 *   - only signed numbers take colour; a level stays ink;
 *   - below the floor there is NO tint at all. A 0.2bp move is not a faint
 *     version of a move, it is noise, and tinting it teaches the eye to read
 *     noise as signal.
 */

/** bp below which a change carries no tint at all. */
export const TINT_FLOOR = 0.5;

/** bp at which the tint reaches full strength. */
export const TINT_CEIL = 10;

/** Alpha for a change, 0 when below the floor. Monotone in |v| between. */
export function tintAlpha(v: number | null | undefined): number {
  if (v == null) return 0;
  const a = Math.abs(v);
  if (a < TINT_FLOOR) return 0;
  const t = Math.min(1, (a - TINT_FLOOR) / (TINT_CEIL - TINT_FLOOR));
  return Number((0.06 + t * 0.14).toFixed(3));
}

/** The class that colours the number itself. Levels never call this. */
export function directionClass(v: number | null | undefined): string {
  if (v == null || v === 0) return 'sr-flat';
  return v > 0 ? 'sr-up' : 'sr-down';
}

/** Background wash for a change cell, as an inline style. Uses the same two
 * custom properties the text does, so a tint can never disagree with its
 * number about which way the market went. */
export function tintStyle(v: number | null | undefined): React.CSSProperties | undefined {
  const alpha = tintAlpha(v);
  if (alpha === 0) return undefined;
  const hue = v! > 0 ? 'var(--sr-up)' : 'var(--sr-down)';
  return {
    backgroundColor: `color-mix(in srgb, ${hue} ${Math.round(alpha * 100)}%, transparent)`,
  };
}
