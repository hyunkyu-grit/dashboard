"use client";

/* Measure an element's content width so the hand-rolled charts fit the pane on
 * any viewport. A callback ref measures synchronously on mount (more reliable
 * than useRef + useEffect here) and a ResizeObserver keeps it current. */

import { useCallback, useRef, useState } from "react";

export function useMeasure<T extends HTMLElement>(): [
  (node: T | null) => void,
  number,
] {
  const [width, setWidth] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const refCb = useCallback((node: T | null) => {
    ro.current?.disconnect();
    if (node) {
      setWidth(node.clientWidth);
      ro.current = new ResizeObserver(() => setWidth(node.clientWidth));
      ro.current.observe(node);
    }
  }, []);
  return [refCb, width];
}
