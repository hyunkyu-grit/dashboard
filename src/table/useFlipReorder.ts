'use client';

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

import { EASE_OUT, instant, MOTION } from '@/theme/motion';

/** The attribute every body row carries. One constant so the delegated
 * listeners, the FLIP query and the guards cannot drift apart. */
export const ROW_ATTR = 'data-sr-row';
export const ROW_SELECTOR = `tr[${ROW_ATTR}]`;

/**
 * FLIP the rows that moved, from CONTAINER SCOPE.
 *
 * ── Why container scope and not a ref per row ────────────────────────────────
 * CDS `TableRow` is a memo'd function component with no `forwardRef`, so no
 * supported API hands back the `<tr>`. Rather than fork or wrap a CDS
 * primitive, v2 queries rows out of the container [OWNER ruling]. At 1,000 rows
 * that is also the better architecture on its own terms: one query beats a
 * thousand ref callbacks and a thousand map writes per render.
 *
 * ── Why library-free ────────────────────────────────────────────────────────
 * v1 uses `motion/react`'s `layout="position"`, which is motion@12 surface
 * area; §3 pins framer-motion v10 as the only animation runtime here. Porting
 * to v10 would need a `motion.tr` this app does not own (CDS renders the `<tr>`).
 * A `<tr>` accepts `transform`, which is all a FLIP needs — so no runtime at all
 * is the smaller port.
 *
 * ── The two defects carried over from v1's version, fixed here ──────────────
 * 1. **`getBoundingClientRect`, not `offsetTop`.** `offsetTop` is relative to
 *    the offset parent, and inside a scrolled, sticky-headed table it changes
 *    meaning the moment a positioned ancestor appears. The rect is what the eye
 *    sees.
 * 2. **Cull to rows that MOVED.** v1 read every shown row (140 on the forwards
 *    tab) and then windowed the list to bound the cost. The honest bound is the
 *    delta: an unmoved row gets no transform and no transition, so a sort that
 *    moves three rows costs three writes.
 */

export type FlipHandle = {
  /** Call immediately BEFORE the state change that reorders. */
  snapshot: () => void;
};

/* 시간과 곡선은 이 파일 것이 아니다 — 예전엔 여기 `220ms` 와 곡선 문자열이 직접
 * 적혀 있었고, 그래서 제품의 시간이 다섯 군데에 흩어져 있었다(`theme/motion.css`).
 * `instant()` 를 한 번 더 지나는 이유: 아래는 `transition` 을 **인라인 문자열로**
 * 만드는 자리라 감속 블랭킷과 별개로 값 자체가 0 이 돼야 한다. */
const EASE = EASE_OUT;

function rowsIn(container: HTMLElement | null): HTMLTableRowElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLTableRowElement>(ROW_SELECTOR));
}

export function useFlipReorder(
  containerRef: RefObject<HTMLElement | null>,
  enabled = true,
): FlipHandle {
  const prev = useRef<Map<string, number> | null>(null);

  const snapshot = useCallback(() => {
    if (!enabled) return;
    const m = new Map<string, number>();
    for (const el of rowsIn(containerRef.current)) {
      const id = el.getAttribute(ROW_ATTR);
      if (id) m.set(id, el.getBoundingClientRect().top);
    }
    prev.current = m;
  }, [containerRef, enabled]);

  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = null;
    if (!enabled || !before) return;

    // Read every rect first, write after. Interleaving forces a layout per row,
    // which is the cost this hook exists to avoid.
    const moved: { el: HTMLTableRowElement; dy: number }[] = [];
    for (const el of rowsIn(containerRef.current)) {
      const id = el.getAttribute(ROW_ATTR);
      if (!id) continue;
      const was = before.get(id);
      if (was == null) continue; // a new row fades in; it does not fly
      const dy = was - el.getBoundingClientRect().top;
      if (dy !== 0) moved.push({ el, dy });
    }
    if (moved.length === 0) return;

    for (const { el, dy } of moved) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
    }

    // One frame to let the inverted position paint, then release together so
    // the rows travel as one movement rather than a ripple.
    const raf = requestAnimationFrame(() => {
      for (const { el } of moved) {
        el.style.transition = `transform ${instant(MOTION.base)}ms ${EASE}`;
        el.style.transform = '';
      }
    });

    return () => cancelAnimationFrame(raf);
  });

  return { snapshot };
}
