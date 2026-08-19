'use client';

/* 떠 있는 창의 **기계** — 자리와 끌기. v1 `ui/useFloatingWindow.ts` 의 이식.
 *
 * 창마다 인라인으로 두지 않는 이유는 v1 이 이미 겪었다: 끌기 로직이 두 벌이면
 * 한쪽만 클램프를 고치는 날이 오고, **그 창은 끌어서 되돌릴 수 없는 곳으로
 * 나간다.**
 *
 * 이벤트 시점 스냅샷을 쓴다: 포인터 다운이 시작점과 그때의 창 위치를 적어 두고,
 * 모든 이동은 그 스냅샷에서 계산해 **이벤트 시점의** 뷰포트로 클램프한다. 렌더
 * 중에 ref 를 읽지 않고 이펙트도 없다. 포인터 캡처는 커서가 헤더보다 빨라도
 * 이동 이벤트가 계속 오게 한다 — 이게 없으면 빠르게 끌 때 창이 커서를 놓친다.
 */

import { useCallback, useRef, useState, type PointerEvent } from 'react';

import {
  clampWindowPos,
  initialWindowPos,
  rememberWindowPos,
  WINDOW_W,
  type WindowKey,
  type WinPos,
} from './geometry';

export function useFloatingWindow(key: WindowKey, winW: number = WINDOW_W) {
  const [pos, setPos] = useState<WinPos>(() =>
    typeof window === 'undefined'
      ? { left: 0, top: 72 }
      : initialWindowPos({ w: window.innerWidth, h: window.innerHeight }, key, winW),
  );
  const drag = useRef<{ px: number; py: number; base: WinPos } | null>(null);

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, base: pos };
  }, [pos]);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      setPos(
        rememberWindowPos(
          clampWindowPos(
            { left: d.base.left + e.clientX - d.px, top: d.base.top + e.clientY - d.py },
            { w: window.innerWidth, h: window.innerHeight },
            winW,
          ),
          key,
        ),
      );
    },
    [key, winW],
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  /** 헤더에 그대로 펼쳐 넣는다 — **끌 수 있는 면은 헤더 하나뿐이다.** */
  return { pos, dragHandlers: { onPointerDown, onPointerMove, onPointerUp } };
}
