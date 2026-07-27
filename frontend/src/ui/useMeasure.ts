"use client";

/* Measure an element's content box so the hand-rolled charts fit the pane on
 * any viewport. A callback ref measures synchronously on mount (more reliable
 * than useRef + useEffect here) and a ResizeObserver keeps it current.
 * Returns [ref, width, height]. */

import { useCallback, useRef, useState } from "react";

export function useMeasure<T extends HTMLElement>(): [
  (node: T | null) => void,
  number,
  number,
] {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ro = useRef<ResizeObserver | null>(null);
  const refCb = useCallback((node: T | null) => {
    ro.current?.disconnect();
    if (node) {
      const read = () => setSize({ w: node.clientWidth, h: node.clientHeight });
      read();
      ro.current = new ResizeObserver(read);
      ro.current.observe(node);
    }
  }, []);
  return [refCb, size.w, size.h];
}
