"use client";

/* 떠 있는 창의 **기계** — 자리와 끌기 [2026-08-07].
 *
 * 백테스트 창 안에 인라인으로 있던 것을 꺼냈다. 시뮬레이션 결과가 같은 종류의
 * 창이 되면서 두 벌이 될 참이었고, 끌기 로직이 두 벌이면 한쪽만 클램프를
 * 고치는 날이 온다 — 그러면 그 창은 끌어서 되돌릴 수 없는 곳으로 나간다.
 *
 * 이벤트 시점 스냅샷을 쓴다(컴파일러 규칙): 포인터 다운이 시작점과 그때의 창
 * 위치를 적어 두고, 모든 이동은 그 스냅샷에서 계산해 **이벤트 시점의** 뷰포트로
 * 클램프한다. 렌더 중에 ref 를 읽지 않고 이펙트도 없다. 포인터 캡처는 커서가
 * 헤더보다 빨라도 이동이 계속 오게 한다. */

import { useRef, useState, type PointerEvent } from "react";

import {
  WINDOW_W,
  clampWindowPos,
  initialWindowPos,
  rememberWindowPos,
  type WindowKey,
  type WinPos,
} from "./floatingWindow";

export function useFloatingWindow(key: WindowKey, winW: number = WINDOW_W) {
  const [pos, setPos] = useState<WinPos>(() =>
    typeof window === "undefined"
      ? { left: 0, top: 56 }
      : initialWindowPos({ w: window.innerWidth, h: window.innerHeight }, key, winW),
  );
  const drag = useRef<{ px: number; py: number; base: WinPos } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, base: pos };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
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
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  /** 헤더에 그대로 펼쳐 넣는다 — 끌 수 있는 면은 헤더 하나뿐이다. */
  return { pos, dragHandlers: { onPointerDown, onPointerMove, onPointerUp } };
}
