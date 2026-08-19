'use client';

/* 떠 있는 창의 **하단 서랍** [v1 트레이더 피드백 5, 2026-08-07].
 *
 * > "일자별 PnL과 KRD는 백테스트와 시뮬레이션 결과창 둘 다에 존재해야 하며,
 * >  위치는 팝업창 하단에 열었다 닫았다 하는 탭에서 조절할 수 있으면 좋겠다."
 *
 * 실제 트레이딩 시스템과 **대사**하려고 보는 숫자다. 늘 펼쳐져 있으면 창이 그만큼
 * 길어지고, 없으면 대사할 때마다 다른 화면을 찾아가야 한다. 접히는 서랍이 그 둘
 * 사이의 답이고, **접힌 상태가 기본**이다 — 대사는 매번 하는 일이 아니다.
 *
 * ── 왜 창마다 만들지 않는가 ────────────────────────────────────────────────
 * 두 창이 같은 것을 보여줘야 한다는 것이 요청의 절반이다. 서랍이 두 벌이면 한쪽
 * 에만 탭이 붙거나 접힘 규칙이 갈리고, 그러면 "둘 다에 존재한다" 가 곧 거짓이
 * 된다. **내용만 창이 정하고 껍데기는 하나다.**
 *
 * ── 애니메이션 없음 ────────────────────────────────────────────────────────
 * v1 은 `AnimatePresence` 로 폈다 접었다 했다. v2 는 안 쓴다 — 이 리포가 이미
 * "안 닫히는 창" 을 두 번 겪었고, 원인은 둘 다 **exit 완료 보고를 잃어버린
 * 것**이었다. 열림은 상태 하나이고 그 상태가 곧 DOM 이어야 한다.
 */

import { useState, type ReactNode } from 'react';

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TextCaption } from '@coinbase/cds-web/typography';

export interface DrawerTab {
  id: string;
  label: string;
  /** 이 탭이 그릴 것. `null` 이면 라벨이 흐려지지만 **누를 수는 있다** — 숨기지
   * 않는 이유가 그것이다: 없다는 사실이 보여야 하고, 왜 없는지는 열어 봐야
   * 읽힌다. 못 누르게 막으면 흐린 라벨만 남는다. */
  content: ReactNode | null;
  /** 비었을 때 그 자리에 쓸 이유. 읽는 사람이 "왜 비었지" 를 물을 곳이다. */
  unavailable?: string;
}

export function WindowDrawer({ tabs }: { tabs: DrawerTab[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];

  if (tabs.length === 0) return null;

  return (
    <VStack className="sr-drawer" width="100%">
      {/* 탭 바는 **접혀 있을 때도 보인다** — 무엇을 펼칠 수 있는지가 접힌
          상태에서 읽혀야 서랍이 발견된다. */}
      <HStack className="sr-drawer-tabs" gap={0.5} alignItems="center" width="100%">
        {tabs.map((t) => {
          const on = open && t.id === tab?.id;
          return (
            <button
              key={t.id}
              type="button"
              className="sr-drawer-tab"
              data-active={on || undefined}
              data-empty={t.content == null || undefined}
              onClick={() => {
                // 같은 탭을 다시 누르면 접는다. 다른 탭이면 그 탭으로 펼친다.
                if (open && t.id === active) setOpen(false);
                else {
                  setActive(t.id);
                  setOpen(true);
                }
              }}
              aria-expanded={on}
            >
              {t.label}
            </button>
          );
        })}
      </HStack>

      {open && tab ? (
        <VStack className="sr-drawer-body" width="100%">
          {tab.content ?? (
            <TextCaption as="span" color="fgMuted">
              {tab.unavailable ?? '아직 없어요.'}
            </TextCaption>
          )}
        </VStack>
      ) : null}
    </VStack>
  );
}
