'use client';

/* 남는 세로를 **재서** 준다.
 *
 * 왜 CSS 로 안 되나: 표와 차트가 픽셀 숫자를 요구한다. `InstrumentTable` 은 가상화
 * 스크롤러라 컨테이너 높이를 알아야 몇 행을 그릴지 정하고(`TableProps.height` 는
 * `--table-height` 로 내려간다), CDS 차트도 `height` 가 숫자다. `height: 100%` 로는
 * 둘 다 자기 크기를 못 정한다.
 *
 * ── 이게 없을 때 어땠나 (실측 2026-08-14, 2560×1140) ────────────────────────
 * 표 높이가 상수 560 이었다. 화면이 1,140 인데 카드가 712 에서 끝나 **428px 이
 * 빈 채** 남았고, 그 안에서 표는 1,022px 짜리 내용을 8행만 보여주며 자체 스크롤을
 * 했다. 화면은 남는데 내용은 갇혀 있는 상태다.
 *
 * ── 왜 **콜백 ref** 인가 (실측으로 걸린 함정) ──────────────────────────────
 * 처음에는 `useRef` + `useLayoutEffect([ref])` 였고 **한 번도 안 쟀다.** 이 페이지는
 * 데이터가 오기 전에 먼저 마운트되므로 그 시점에 카드가 아직 없다 → `ref.current`
 * 가 null → 효과는 그냥 빠져나온다. 그리고 카드가 나중에 생겨도 **의존성이 안 바뀌어
 * 효과가 다시 돌지 않는다.** 그래서 화면에는 상수 560 이 계속 쓰였고, 카드는 flex 로
 * 늘어나 있는데 그 안의 표만 작은 — "카드 안에 빈 칸" 상태가 됐다.
 *
 * 콜백 ref 는 노드가 **붙는 그 순간** 불린다. 늦게 생기는 요소를 재려면 이쪽이다.
 *
 * ── 왜 즉시 한 번 재나 ─────────────────────────────────────────────────────
 * `ResizeObserver` 의 첫 콜백에만 기대면 안 된다(실측 2026-08-14): 렌더링이 멈춘
 * 탭에서는 그 콜백이 **한 번도 안 온다** — 관찰자 전달이 렌더 생애주기에 묶여 있어서
 * 다. 이 리포가 rAF 에서 이미 겪은 자리이고, 그때도 "레이아웃 버그처럼 보이는
 * 인공산물" 이었다. `clientHeight` 는 동기 측정이라 그 사정을 안 탄다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useFillHeight(fallback: number): [(node: HTMLElement | null) => void, number] {
  const [h, setH] = useState(0);
  const cleanup = useRef<(() => void) | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!node) {
      setH(0);
      return;
    }

    const measure = () => {
      const next = Math.round(node.clientHeight);
      setH((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    };
    measure();

    /* 관찰 대상이 창이 아니라 **그 상자**인 이유: 사이드 카드가 접히거나 배너 한
     * 줄이 생기는 것처럼 창 크기와 무관하게 남는 높이가 바뀌는 경우가 있다. */
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    window.addEventListener('resize', measure);
    cleanup.current = () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => () => cleanup.current?.(), []);

  return [ref, h > 0 ? h : fallback];
}
