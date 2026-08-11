"use client";

/* 가로 드래그 팬 [OWNER, 2026-08-12 — "좌우로 드래그하는 부분을 만들어서
 * 잘리는 부분도 볼 수 있게"].
 *
 * overflow-x 컨테이너는 스크롤바와 휠로만 움직였다 — Windows 11 의 오버레이
 * 스크롤바는 올려놓기 전까지 보이지 않으니, 잘린 열이 있다는 사실 자체가
 * 읽히지 않는다. 이 훅을 단 표면은 차트를 끌듯 마우스로 잡아 가로로 팬 된다.
 *
 * 규칙 셋:
 *   - 마우스 전용. 터치는 브라우저가 원래 끌고(관성까지), 휠·스크롤바도
 *     그대로 산다 — 이 훅은 마우스에 같은 자유를 하나 더 줄 뿐이다.
 *   - 4px 문턱 전에는 클릭을 가로채지 않는다 — 클릭(날짜 정렬 토글)은
 *     클릭으로 남는다. 문턱을 넘으면 그 제스처의 클릭 하나를 삼킨다: 팬을
 *     끝낸 손이 정렬을 뒤집으면 안 된다.
 *   - pointerdown 에서 기본 동작을 끈다 — 끌리는 표면에서 텍스트 선택이
 *     같이 자라면 팬이 아니라 선택으로 읽힌다. click 은 기본 동작이 아니라
 *     그대로 살고, 키보드 접근도 영향이 없다. */

import { useCallback, useMemo, useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

/** 이 거리(px)까지는 클릭이고, 넘어서면 팬이다. */
const DRAG_THRESHOLD = 4;

interface DragOrigin {
  x: number;
  scrollLeft: number;
  dragging: boolean;
}

export function useDragScroll<T extends HTMLElement>() {
  // 콜백 ref — useMeasure 의 전례. 컴파일러 린트(react-hooks/refs)는 훅
  // 반환 객체를 렌더 중에 점 접근(drag.ref)하면 ref 접근으로 읽는다 —
  // 사용부는 구조분해로 받아야 한다(useFloatingWindow 문법). ref 가 객체가
  // 아니라 함수인 것도 같은 이유다; 핸들러들은 elRef 로 요소를 찾는다.
  const elRef = useRef<T | null>(null);
  const ref = useCallback((el: T | null) => {
    elRef.current = el;
  }, []);
  const origin = useRef<DragOrigin | null>(null);
  const swallowClick = useRef(false);

  const handlers = useMemo(() => {
    const end = (e: ReactPointerEvent<T>) => {
      if (origin.current?.dragging) {
        swallowClick.current = true;
        const el = elRef.current;
        if (el) {
          el.style.cursor = "";
          try {
            el.releasePointerCapture?.(e.pointerId);
          } catch {
            /* 캡처가 없던 포인터 — 무해 */
          }
        }
      }
      origin.current = null;
    };

    return {
      onPointerDown: (e: ReactPointerEvent<T>) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        const el = elRef.current;
        if (!el) return;
        origin.current = { x: e.clientX, scrollLeft: el.scrollLeft, dragging: false };
        e.preventDefault(); // 텍스트 선택만 죽는다 — click 은 기본 동작이 아니다
      },
      onPointerMove: (e: ReactPointerEvent<T>) => {
        const el = elRef.current;
        const o = origin.current;
        if (!el || !o) return;
        if ((e.buttons & 1) === 0) {
          // 버튼이 컨테이너 밖에서 풀렸다(캡처 전) — 죽은 제스처를 지운다.
          origin.current = null;
          return;
        }
        const dx = e.clientX - o.x;
        if (!o.dragging) {
          if (Math.abs(dx) < DRAG_THRESHOLD) return;
          o.dragging = true;
          el.style.cursor = "grabbing";
          try {
            el.setPointerCapture?.(e.pointerId);
          } catch {
            /* jsdom 등 캡처 미구현 환경 — 팬 자체는 성립한다 */
          }
        }
        el.scrollLeft = o.scrollLeft - dx;
      },
      onPointerUp: end,
      onPointerCancel: end,
      onClickCapture: (e: ReactMouseEvent<T>) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    };
  }, []);

  return { ref, handlers };
}
