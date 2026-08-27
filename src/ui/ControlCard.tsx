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
import { SegmentedTabs } from '@coinbase/cds-web/tabs';
import { Text } from '@coinbase/cds-web/typography';

import { CONTROL_H } from './controlHeight';

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

/**
 * 라벨 + 컨트롤 한 칸 — **앱에 하나뿐인 그것** [OWNER 2026-08-25 — "전체적인
 * 사이트에서의 «얼라인» 이 없다"].
 *
 * 2026-08-25 까지 이 컴포넌트는 **네 번** 따로 정의돼 있었다(`ControlCard`(이것,
 * 유일하게 export) · `backtest/BacktestWindow` · `sim/SimulationPage` ·
 * `mr/StrategyWindow`). 넷은 서로 라벨 타이포가 달랐다 — `TextCaption` ·
 * `TextLegal` · `Text font="legal"` · `Text font="caption"`. 화면마다 같은 칸이
 * 조금씩 다르게 생겼다는 뜻이고, 그게 오너가 본 「사이트 전체에 얼라인이 없다」의
 * 정체다. 캐논 규칙 1(«새로 만들기 전에 찾는다»)이 정확히 이 경우다.
 *
 * ── `flexGrow` 가 이 수리의 핵심이다 ────────────────────────────────────────
 * 넷 다 `VStack` 에 폭 규약이 없었다. **CDS `Box` 는 `display: flex; row` 다**
 * (실측 2026-08-25). 그래서 `<Box width={128}>` 안의 `Field` 는 주축 위의 flex
 * 아이템이 되어 **내용만큼**만 넓어지고, 안쪽 컨트롤의 `width: 100%` 가 그
 * 좁아진 폭에 걸린다. 실측: 백테스트 진입일 칸이 `Box width={128}` 인데 날짜
 * 입력은 **117** 이었다 — 11px 이 조용히 샜고, 그런 칸이 한 행에 여럿이면
 * 컨트롤 사이 빈틈이 제각각이 된다(그 행의 빈틈은 62·97·12·23px 였다).
 *
 * `width: "100%"` 로도 128 은 나오지만 그건 **틀린 낱말**이다. 폭을 안 준 행에
 * 놓이면 100% 가 «행 전체» 가 되어 칸마다 줄이 바뀐다(전략 실험 창에서 실측 —
 * 컨트롤 여덟이 세로로 늘어섰다). `flexGrow` 는 «준 상자를 채운다» 만 뜻한다.
 *
 * 따라서 규약은 하나다: **`Field` 는 감싸는 `<Box width={N}>` 이 폭을 준다.**
 * 상자 없이 행에 바로 놓지 않는다 — 그러면 그 칸만 자기 내용 폭이 되어 형제와
 * 어긋난다(전략 실험 창이 그랬고, 2026-08-25 에 상자를 둘렀다).
 *
 * `help` 는 `StrategyWindow` 가 갖고 있던 것 — 값의 출처를 라벨이 진다.
 */
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  /** 값의 출처·근거. 라벨의 native title 로 붙는다. */
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <VStack gap={0.25} minWidth={0} flexGrow={1}>
      <Text as="span" font="legal" color="fgMuted" noWrap title={help}>
        {label}
      </Text>
      {children}
    </VStack>
  );
}

/**
 * 배타 선택 한 줄 — **앱에 하나뿐인 그것** [OWNER 2026-08-27].
 *
 * `Field` 와 같은 내력이다. 2026-08-27 까지 이 컴포넌트는 **두 번** 따로
 * 정의돼 있었고(`backtest/BacktestWindow` · `sim/SimulationPage`) 둘 다 CDS
 * 기본값을 그대로 썼다 — 그래서 페이·리시브가 **36px · 16px** 로 서서, 같은
 * 행의 알약(32 · 14)과 어긋났다 [OWNER — "컴포넌트의 사이즈와 그 안에 들어가는
 * 폰트 사이즈가 너무 커서 얼라인이 안 맞는"].
 *
 * 부품은 CDS `SegmentedTabs` 다 [OWNER 2026-08-13 §5.4] — `SegmentedControl` 은
 * deprecated 이고 그 파일 주석이 "Please use Tabs or SegmentedTabs instead"
 * 라고 적고 있다. 여기서 더하는 것은 **이 앱의 치수** 둘뿐이다:
 *
 *   상자  `CONTROL_H`  — 한 행에 서는 것들의 등고(「얼라인」 1)
 *   글자  `.sr-ctlfont` — 캐논 알약과 같은 14/600(그 클래스 주석에 근거)
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const tabs = options.map((o) => ({ id: o.value, label: o.label }));
  return (
    <SegmentedTabs
      accessibilityLabel={label}
      className="sr-ctlfont"
      styles={{ tab: { height: CONTROL_H }, tabContainer: { height: CONTROL_H } }}
      tabs={tabs}
      activeTab={tabs.find((t) => t.id === value) ?? null}
      onChange={(t) => t && onChange(t.id)}
    />
  );
}
