"use client";

/* True when the viewport can hold both panes at their content needs (§ layout,
 * Session 15): the table pane (TABLE_W) plus the preview floor (PREVIEW_MIN)
 * plus the surface margin. Below this the shell falls back to a single column
 * with the preview as a bottom sheet, rather than squeezing two panes into a
 * space that cannot hold them. */

import { useEffect, useState } from "react";

// table 880 + preview floor 600 + surface margin/border ≈ 40 → ~1520.
// (The spec's "about 1440" assumed a narrower table; 1520 is where the preview
// actually reaches its 600px floor — recorded under DESIGN ## Provisional.)
export const TWO_PANE_MIN = 1520;

export function useIsWide(min: number = TWO_PANE_MIN): boolean {
  // start wide so SSR/first paint favours the desk layout; corrected on mount.
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${min}px)`);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [min]);
  return wide;
}
