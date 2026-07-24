/* Domain-render guard — same family as assertNoCssVars().
 *
 * Both defects this project has hit (per-element var() stalling SVG paint,
 * and fitContent silently dropping 2016–2019) share one shape: a library
 * degrading QUIETLY instead of throwing. minBarSpacing:0.05 lets the full
 * history fit at the current container width, but that is width-dependent and
 * will clip again on a narrower viewport. This guard is the durable
 * protection: after the chart renders, it compares the actually-visible time
 * domain against the requested one and throws if the render is narrower by
 * more than one bar — a loud failure the next narrow viewport cannot hide.
 *
 * Kept pure (visible range in, throw or not) so it is unit-testable without a
 * canvas: lightweight-charts needs a real 2D context that jsdom lacks, so the
 * test feeds the clipped logical range a narrow container would produce.
 */

export interface LogicalRange {
  from: number;
  to: number;
}

export interface RequestedDomain {
  first: string; // ISO date of the first requested point
  last: string; // ISO date of the last requested point
}

// Slack: up to one bar may be off each edge (half-bar padding on each side is
// normal for fitContent); more than that is a real clip.
const BAR_SLACK = 1;

/**
 * Throw if the chart's visible logical range (bar indices, 0..barCount-1) is
 * narrower than the requested full domain by more than one bar at either end.
 * `visible` may be null before the first layout pass — that is not a failure,
 * the caller retries on the next frame.
 */
export function assertDomainRendered(
  visible: LogicalRange | null,
  barCount: number,
  requested: RequestedDomain,
): void {
  if (!visible || barCount <= 1) return;

  const clippedStart = visible.from > BAR_SLACK;
  const clippedEnd = visible.to < barCount - 1 - BAR_SLACK;
  if (clippedStart || clippedEnd) {
    throw new Error(
      `history chart clipped the requested domain: requested ` +
        `${requested.first}…${requested.last} (${barCount} bars), but only ` +
        `bars [${visible.from.toFixed(1)}, ${visible.to.toFixed(1)}] render ` +
        `— minBarSpacing is too large for this container width.`,
    );
  }
}
