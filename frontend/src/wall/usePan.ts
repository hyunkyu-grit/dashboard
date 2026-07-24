"use client";

/* Vertical-only wall pan — design spec §2.
 *
 * ABSOLUTE RULE: pointermove never triggers a React re-render. All drag
 * session state lives in refs; the transform is applied imperatively to the
 * wall container; nothing is committed to React state (there is nothing to
 * commit — offset itself is a ref).
 */

import { useCallback, useEffect, useRef } from "react";

import { DRAG_THRESHOLD_PX } from "./constants";

export interface WallPan {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onWheel: (e: React.WheelEvent) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
  /** Pan to an absolute offset (clamped). */
  panTo: (y: number) => void;
  /** Pan so `el` sits just below the pinned header (change log / cmd bar). */
  panToElement: (el: HTMLElement) => void;
  /** Home: back to wall origin. */
  home: () => void;
}

interface DragSession {
  pointerId: number;
  startClientY: number;
  startOffset: number;
  moved: boolean;
}

export function useWallPan(): WallPan {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const offsetY = useRef(0);
  const drag = useRef<DragSession | null>(null);
  const suppressClick = useRef(false);

  const clamp = useCallback((y: number) => {
    const v = viewportRef.current;
    const c = contentRef.current;
    if (!v || !c) return 0;
    const min = Math.min(0, v.clientHeight - c.scrollHeight);
    return Math.max(min, Math.min(0, y));
  }, []);

  const apply = useCallback(() => {
    const c = contentRef.current;
    if (c) c.style.transform = `translate3d(0, ${offsetY.current}px, 0)`;
  }, []);

  const panTo = useCallback(
    (y: number) => {
      offsetY.current = clamp(y);
      apply();
    },
    [apply, clamp],
  );

  const home = useCallback(() => panTo(0), [panTo]);

  const panToElement = useCallback(
    (el: HTMLElement) => {
      const c = contentRef.current;
      if (!c) return;
      // el and content translate together, so their rect delta is invariant
      // of the current transform — the element's fixed offset within content.
      // Target translate places that offset 16px below the content origin.
      const withinContent =
        el.getBoundingClientRect().top - c.getBoundingClientRect().top;
      panTo(16 - withinContent);
    },
    [panTo],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Home") {
        e.preventDefault();
        home();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [home]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = {
      pointerId: e.pointerId,
      startClientY: e.clientY,
      startOffset: offsetY.current,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const dy = e.clientY - d.startClientY;
      if (!d.moved && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      offsetY.current = clamp(d.startOffset + dy);
      apply();
    },
    [apply, clamp],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.moved) suppressClick.current = true;
    drag.current = null;
  }, []);

  // A drag must not fire the tile click underneath on release.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => panTo(offsetY.current - e.deltaY),
    [panTo],
  );

  return {
    viewportRef,
    contentRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onWheel,
      onClickCapture,
    },
    panTo,
    panToElement,
    home,
  };
}
