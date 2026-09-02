'use client';

/* 떠 있는 창 — 백테스트(레인 4)와 시뮬레이션(레인 5)이 **둘 다** 쓸 껍데기.
 *
 * 자유는 하나: **자리**. 크기 조절도, 최소화도, 두 번째 인스턴스도 없다. 각각이
 * 제품이 legible 해야 할 상태를 하나씩 늘리고, v1 이 그 셋 없이 두 창을 굴려
 * 봤다.
 *
 * ── 이 파일이 지고 있는 네 가지 규칙 ───────────────────────────────────────
 *
 * 1. **끌 수 있는 면은 헤더뿐이다.** 본문 어디나 끌리면 차트 위에서 드래그가
 *    스크럽인지 이동인지 모호해진다.
 * 2. **손잡이는 뷰포트를 못 벗어난다**(`clampWindowPos`). 나가면 그 창은 되돌릴
 *    방법이 없다 — 끌 수 있는 면이 헤더뿐이므로.
 * 3. **Esc 는 한 겹만**(`escapeStack`). 맨 위가 아니면 아무것도 안 한다.
 * 4. **닫힘은 애니메이션에 의존하지 않는다.** 이 리포는 "안 닫히는 창" 을 두 번
 *    겪었고 원인은 둘 다 exit 완료 보고를 잃은 것이었다(v1 `AnimatePresence`,
 *    그리고 rAF 기아). 열림은 부모의 상태 하나이고 그 상태가 곧 DOM 이다 —
 *    `open === false` 면 이 컴포넌트는 아예 마운트되지 않는다.
 */

import { useEffect } from 'react';

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TextLabel1 } from '@coinbase/cds-web/typography';

import { WINDOW_W, type WindowKey } from './geometry';
import { isTopLayer, popLayer, pushLayer } from './escapeStack';
import { Z_WINDOW } from './layers';
import { useFloatingWindow } from './useFloatingWindow';
import { WindowDrawer, type DrawerTab } from './WindowDrawer';

export function FloatingWindow({
  windowKey,
  title,
  aside,
  onClose,
  width = WINDOW_W,
  drawer,
  drawerOpen,
  onDrawerOpenChange,
  children,
}: {
  /** 자리를 기억할 열쇠. 창마다 자기 자리로 돌아온다. */
  windowKey: WindowKey;
  title: string;
  /** 제목 오른쪽, 닫기 왼쪽에 놓을 것(부제·컨트롤). */
  aside?: React.ReactNode;
  onClose: () => void;
  width?: number;
  drawer?: DrawerTab[];
  /** 서랍 펼침을 창 밖에서 쥘 때만(제어) — `WindowDrawer` 의 그 prop 을
   *  그대로 지나 보낸다. 안 주면 서랍이 자기 상태를 쥔다. */
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const { pos, dragHandlers } = useFloatingWindow(windowKey, width);

  /* 겹 등록과 Esc. 마운트가 곧 열림이므로 여기서 밀어 넣고 언마운트에서 뺀다 —
   * 닫는 경로가 ×이든 Esc이든 URL 이든 하나로 모인다. */
  useEffect(() => {
    pushLayer(windowKey);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!isTopLayer(windowKey)) return; // 내 위에 뭔가 있으면 그쪽 몫이다
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      popLayer(windowKey);
    };
  }, [windowKey, onClose]);

  return (
    <VStack
      className="sr-window"
      role="dialog"
      aria-label={title}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: `min(${width}px, 100vw)`,
        /* **창은 자기 자리에서 화면 아래를 넘지 않는다** [실측 2026-08-14].
         *
         * 조각마다 상한을 둬도 합은 안 지켜진다: 머리 44 + 몸통 70vh + 서랍
         * (탭 32 + 몸통 38vh) = 108vh + 76px 이다. 백테스트 창에서 일별 대사를
         * 펴자 창이 **1,014px** 이 됐고 화면은 911 이었다 — 표의 아래쪽 175px 이
         * 화면 밖이고, 손잡이 클램프가 top ≥ 0 이라 끌어올릴 수도 없었다.
         * (v1 의 서랍 주석이 예고한 그 실패다: "창이 서랍 때문에 화면 밖으로
         * 자라면 손잡이 클램프가 무의미해진다.")
         *
         * `top` 을 빼는 이유는 창이 **떠 있기** 때문이다 — 아래로 끌어둔 창은
         * 그만큼 남는 높이가 적다. 24px 은 아래 여백. 넘치면 몸통이 줄어든다
         * (`.sr-window-body` 의 `min-height: 0`), 서랍이 아니라 몸통이 주는
         * 이유는 서랍이 방금 사람이 편 것이기 때문이다. */
        maxHeight: `calc(100vh - ${pos.top}px - 24px)`,
        zIndex: Z_WINDOW,
      }}
    >
      {/* 끌기 손잡이 — 유일하게 끌리는 면이고, 클램프가 화면 안에 붙잡아 두는
          띠다. 닫기 버튼은 드래그 시작을 막는다(버튼 위에서 시작한 드래그가
          창을 끌면 닫으려다 창이 따라온다). */}
      <HStack
        className="sr-window-head"
        alignItems="center"
        gap={1}
        width="100%"
        {...dragHandlers}
      >
        <TextLabel1 as="span" noWrap>
          {title}
        </TextLabel1>
        {aside}
        <button
          type="button"
          className="sr-window-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          aria-label="창 닫기"
        >
          ✕
        </button>
      </HStack>

      <VStack className="sr-window-body" width="100%">
        {children}
      </VStack>

      {drawer ? (
        <WindowDrawer tabs={drawer} open={drawerOpen} onOpenChange={onDrawerOpenChange} />
      ) : null}
    </VStack>
  );
}
