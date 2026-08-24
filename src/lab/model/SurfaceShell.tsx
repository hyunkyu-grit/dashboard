'use client';

/* Lab 「모형」 의 Model·Method 면이 같이 쓰는 골격.
 *
 * ## 왜 생겼나 — 두 면이 앱의 문법을 어기고 있었다 [OWNER 2026-08-24]
 *
 * 이 앱의 공간 문법은 Main/Backtest 가 정한다. 실측하면 넷이다:
 *
 *     1. 내용은 **카드 안에** 산다. 맨살 텍스트가 페이지에 흐르지 않는다
 *     2. 페이지는 **안 스크롤한다**(`.sr-page` 는 100vh · overflow hidden).
 *        스크롤은 카드가 진다
 *     3. **좌우 2단** — 왼쪽은 손잡이, 오른쪽은 내용
 *     4. 카드 머리는 **작은 회색 라벨** 한 층이다. 큰 것은 제목이 아니라 숫자다
 *
 * 「전략」 면은 이미 그 문법이다(`sr-strat-controls` + `sr-card sr-strat-note`).
 * 그런데 「모형」·「방법」 은 카드 없이 면 전체에 흘러내렸고, 면 자신이
 * 6,064px / 5,585px 스크롤러였다. 같은 탭 줄에서 옆으로 한 칸 옮겼을 뿐인데
 * 공간의 규칙이 바뀌던 셈이다.
 *
 * ## 왼쪽은 차례다
 *
 * 「전략」 의 왼쪽은 **경로를 놓는 손잡이**다. 「모형」·「방법」 은 읽기 전용이라
 * 놓을 손잡이가 없다. 대신 그 자리에 **차례**가 선다 — 문법(왼쪽 = 옮겨 다니는
 * 곳)은 같고, 옮기는 대상이 값에서 자리로 바뀐다.
 *
 * 차례는 새 상태를 안 만든다. `anchors.ts` 가 이미 모든 블록에 `id` 를 심어
 * 뒀고(`anchorProps`), 여기서는 그 id 로 스크롤만 시킨다. 활성 표시는
 * `IntersectionObserver` 가 읽는 **유도값**이다.
 *
 * ## 읽기 폭은 한 벌이다
 *
 * 실측 2026-08-24: `<p>` 103개 중 **101개가 900px 초과**였고 최댓값이 1,851px
 * (13px 기준 한 줄 ~140자)였다. 같은 면 안에서 어떤 블록은 760px 에 갇히고
 * 어떤 블록은 폭을 다 써서, 눈이 블록마다 줄 폭을 다시 잡아야 했다.
 * `.sr-read` 가 글에만 상한을 건다 — 표와 그래프는 그 상한 밖이다.
 */

import { useEffect, useRef, useState } from 'react';

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { Pressable } from '@coinbase/cds-web/system';
import { Text } from '@coinbase/cds-web/typography';

import statusJson from './artifacts/engine_status.json';
import type { EngineStatus } from './contracts';
import { STALENESS_LABEL } from './strategy/assumptions';

const ST = statusJson as unknown as EngineStatus;

/** 「지금 읽는 자리」를 가르는 줄, 카드 위에서 몇 px 인가. */
const READ_LINE = 12;

export type TocItem = {
  /** `anchors.ts` 가 심은 id. 손으로 조립하지 말고 `ANCHORS`·`eq()` 를 쓸 것. */
  id: string;
  label: string;
};

/** 스크롤러 안에서 앵커 하나를 찾는다.
 *
 * `querySelector` 를 안 쓴다 — 앵커 id 에 `:` 가 들어가서(`method:ledger:…`)
 * 선택자로 쓰려면 `CSS.escape` 가 필요한데, **jsdom 에 `CSS` 가 없다.**
 * 2026-08-24 에 렌더 가드 여섯 개가 그 자리에서 한꺼번에 죽었다.
 * `getElementById` 는 이스케이프가 아예 필요 없고, 담긴 곳만 확인하면 된다. */
function anchorIn(root: HTMLElement, id: string): HTMLElement | null {
  const el = root.ownerDocument.getElementById(id);
  return el && root.contains(el) ? el : null;
}

/** 차례 한 벌. 눌러서 그 자리로 가고, 지금 보는 자리는 스스로 켜진다. */
function Toc({ items, scroller }: { items: TocItem[]; scroller: React.RefObject<HTMLDivElement | null> }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  /* **스크롤을 직접 듣는다.** `IntersectionObserver` 로 시작했다가 되돌렸다 —
     IO 는 «걸침이 바뀔 때» 만 부르므로, 2,140px 짜리 원장 안에서 굴러도 아무
     것도 안 바뀌어 표시가 그 블록 안에서 얼어붙는다. 어차피 자리는
     `getBoundingClientRect` 로 재야 해서, 스크롤을 듣는 편이 짧고 정확하다.
     rAF 로 한 프레임에 한 번만 잰다. */
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const rootTop = root.getBoundingClientRect().top;
      let best: string | null = null;
      let bestGap = Infinity;
      for (const it of items) {
        const el = anchorIn(root, it.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top - rootTop;
        /* **읽는 줄은 카드 위쪽 가까이 둔다**(READ_LINE). 그 줄을 지난 것 중
           가장 아래가 지금 읽는 자리다. 줄이 깊으면(1/3 로 뒀다가 실측) 맨
           위에서도 둘째 항이 이미 그 줄 위라 첫 항이 한 번도 안 켜진다 —
           2026-08-24 에 그랬다. */
        if (top <= READ_LINE && READ_LINE - top < bestGap) {
          bestGap = READ_LINE - top;
          best = it.id;
        }
      }
      setActive(best ?? items[0]?.id ?? null);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items, scroller]);

  const go = (id: string) => {
    const root = scroller.current;
    const el = root ? anchorIn(root, id) : null;
    if (!root || !el) return;
    /* `scrollIntoView` 를 안 쓴다 — 이 앱은 조상 중에 100vh 기둥이 있어서
       브라우저가 그 기둥까지 같이 밀어 상단 내비가 잘린 적이 있다. 카드의
       스크롤만 직접 옮긴다. */
    root.scrollTo({
      top: root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - 8,
      behavior: 'smooth',
    });
  };

  return (
    <VStack className="sr-simcard sr-model-toc" gap={0.75} width="100%">
      <Text as="span" font="legal" color="fgMuted">
        차례
      </Text>
      <VStack gap={0} width="100%">
        {items.map((it) => (
          <Pressable
            key={it.id}
            as="button"
            noScaleOnPress
            accessibilityLabel={`${it.label} 로 가요`}
            onClick={() => go(it.id)}
          >
            <Text
              as="span"
              font="legal"
              className="sr-toc-item"
              data-on={active === it.id ? 'true' : 'false'}
            >
              {it.label}
            </Text>
          </Pressable>
        ))}
      </VStack>
    </VStack>
  );
}

/**
 * 읽기 전용 면 한 장 — 왼쪽 차례 + 오른쪽 카드.
 *
 * `blurb` 는 카드 머리의 **한 층**이다. 예전에는 면마다 `h2`(title3)로 「모형」
 * 「방법」 을 또 찍었는데, 바로 위 페이지 제목이 이미 「모형」 이라 같은 낱말이
 * 두 번 서고 카드 머리가 Main/Backtest 보다 두 배 컸다.
 */
export function SurfaceShell({
  items,
  blurb,
  className,
  children,
}: {
  items: TocItem[];
  blurb: string;
  className: string;
  children: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  return (
    <HStack gap={2} width="100%" flexGrow={1} minHeight={0} alignItems="stretch">
      <VStack className="sr-strat-controls" gap={1}>
        <Toc items={items} scroller={scroller} />
      </VStack>

      <VStack className={`sr-card ${className}`} flexGrow={1} minWidth={0} minHeight={0}>
        {/* 카드 머리 한 층 — 왼쪽에 이 면이 답하는 것, 오른쪽에 as-of.
            「전략」 카드가 같은 자리에 같은 문법을 쓴다. */}
        <HStack gap={1.5} alignItems="center" flexWrap="wrap" paddingX={2} paddingTop={2}>
          <Text as="span" font="legal" color="fgMuted">
            {blurb}
          </Text>
          <Text as="span" font="legal" color="fgMuted" style={{ marginInlineStart: 'auto' }}>
            모형 기저 {ST.basis_as_of} · {STALENESS_LABEL[ST.staleness.state]}
          </Text>
        </HStack>

        <VStack
          ref={scroller}
          className="sr-surface-scroll sr-read"
          gap={3}
          paddingX={2}
          paddingY={2}
        >
          {children}
        </VStack>
      </VStack>
    </HStack>
  );
}
