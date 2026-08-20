'use client';

/* 설정 열의 카드 세 종 — 손잡이를 드는 화면들이 같은 문법을 쓴다.
 *
 * `sim/SimulationPage.tsx` 가 먼저 갖고 있던 것을 옮겨 적었다. Lab 시나리오가 같은
 * 종류의 화면(손잡이 → 결과)이라 같은 골격이 필요했다.
 *
 * ⚠ **지금은 두 벌이다.** 시뮬을 이 모듈로 갈아끼우려 했다가 되돌렸다 — 그 파일의
 * `Field` 바로 뒤에 `NumField` 가 붙어 있어 잘라내다 같이 잘렸다(2026-08-20).
 * 작동하는 1,000줄 화면을 40줄 중복을 없애자고 수술할 이유가 없다. 합치는 날은
 * 시뮬을 손으로 읽으며 옮기는 날이고, 그때까지 **모양이 갈리면 이 주석이 거짓이
 * 된다** — 한쪽을 고치면 다른 쪽도 본다.
 *
 * ── 접힌 채로도 무엇이 설정됐는지 말한다 [v1] ───────────────────────────────
 * `Collapsible` 의 `summary` 가 하중을 진다. 펼쳐야만 알 수 있으면 설정한 값이
 * 조용히 잊히고, 화면은 기본값인 척한다.
 *
 * 몸통은 CDS `Collapsible`(높이 애니메이션·`aria-hidden` 을 그쪽이 진다), 머리는
 * CDS `Pressable`(누름 접근성). 껍데기 CSS(`.sr-simcard`)만 이 리포 것이다.
 */

import { useState } from 'react';

import { Collapsible as CdsCollapsible } from '@coinbase/cds-web/collapsible';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Pressable } from '@coinbase/cds-web/system';
import { Text } from '@coinbase/cds-web/typography';

/** 설정 카드 한 장. v1 의 카드 열과 같은 문법이다. */
export function ControlCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <VStack className="sr-simcard" gap={1} width="100%">
      <HStack alignItems="baseline" gap={1} width="100%">
        <Text as="span" font="label1" noWrap>
          {title}
        </Text>
        {aside ? <Box style={{ marginInlineStart: 'auto' }}>{aside}</Box> : null}
      </HStack>
      {children}
    </VStack>
  );
}

/** 접히는 설정 카드. `summary` 는 장식이 아니라 접힌 상태의 유일한 진술이다. */
export function ControlCollapsible({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  /** 화면의 **주 컨트롤**은 펴 둔다. 접힌 것만 쌓아 두면 설정 열이 위에 뭉치고
   * 아래가 텅 비는데, 이 앱의 다른 설정 열(Simulation)은 꽉 찬다. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <VStack className="sr-simcard" gap={open ? 1 : 0} width="100%">
      <Pressable
        as="button"
        noScaleOnPress
        accessibilityLabel={`${title} — ${summary}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <HStack alignItems="baseline" gap={1} width="100%">
          <Text as="span" font="label1" noWrap>
            {title}
          </Text>
          <HStack gap={0.5} alignItems="baseline" style={{ marginInlineStart: 'auto' }}>
            <Text as="span" font="legal" color="fgMuted" noWrap>
              {summary}
            </Text>
            <span aria-hidden className="sr-simcard-chev" data-open={open || undefined}>
              ⌄
            </span>
          </HStack>
        </HStack>
      </Pressable>
      <CdsCollapsible collapsed={!open}>
        <VStack gap={1} width="100%" paddingTop={open ? 1 : 0}>
          {children}
        </VStack>
      </CdsCollapsible>
    </VStack>
  );
}

/** 라벨 + 컨트롤 한 칸. 라벨은 13/500 muted 고 바닥 정렬 행에서 쓰인다. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <VStack gap={0.25} minWidth={0}>
      <Text as="span" font="legal" color="fgMuted" noWrap>
        {label}
      </Text>
      {children}
    </VStack>
  );
}
