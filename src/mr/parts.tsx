'use client';

/* MR 두 창이 같이 쓰는 조각들 — 패널 상자·청산 사유의 우리말·짧은 날짜
 * [2026-09-01, 통합 밴드 워치].
 *
 * 낱개 창(`StrategyWindow`)과 통합 장부 창(`BookWindow`)이 같은 사건을 같은
 * 낱말로 불러야 한다. 「손절」을 한 창은 「손절」, 다른 창은 「스톱」이라 적으면
 * 두 표를 나란히 놓고 읽을 수 없다 — CLAUDE.md 얼라인 8(«같은 것은 한 번만
 * 만든다»)의 어휘 판이다.
 */

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';

import type { MrStrategyTrade } from './api';

/** 청산 사유의 우리말 — 서버의 어휘를 화면에서 **한 번만** 옮긴다.
 *  우선순위가 곧 이름이다: 손절 > 청산 > 역신호 > 타임스탑. `미청산` 은 판정이
 *  아니라 상태다(팔지 않았고, 그래서 청산 비용도 안 물었다). */
export const WHY_WORD: Record<MrStrategyTrade['why'], string> = {
  stop: '손절',
  exit: '청산',
  reverse: '역신호',
  time: '타임스탑',
  open: '미청산',
};

/** 표 머리의 활자를 고른다 — **소문자가 들어 있으면 `legal`, 아니면 `caption`**.
 *
 *  이 리포가 이미 정해 둔 기준이다(`StrategyWindow` 대사표 머리 주석·
 *  `BookWindow` 만기별 표 주석): CDS 기본 테마의 `textTransform.caption =
 *  'uppercase'` 가 「z」를 「Z」로, 「bp」를 「BP」로 만든다. 둘은 크기가 같고
 *  (0.8125rem) 중량·대문자화만 다르므로, **기호와 단위가 든 머리**만 `legal` 이다.
 *
 *  기준이 사람의 눈대중에 걸리지 않게 함수로 둔다 — 2026-09-02 감사에서 거래 표
 *  머리 넷(`#`·`진입 IRS`·`진입 CD`·`이탈 최대`)이 소문자가 없는데도 `legal` 로
 *  서 있었다. 대문자화가 망칠 글자가 없으니 화면은 안 틀렸지만, 같은 행의 머리가
 *  두 중량으로 갈렸다. */
export const headFont = (label: string): 'caption' | 'legal' =>
  /[a-z]/.test(label) ? 'legal' : 'caption';

/** 짧은 날짜 — 구간 라벨용. `2020-01-02` → `20-01`. 칸이 좁아 연·월만 남긴다. */
export const ym = (iso: string): string => `${iso.slice(2, 4)}-${iso.slice(5, 7)}`;

export function Panel({
  title,
  sub,
  aside,
  children,
}: {
  title: string;
  sub?: string;
  /** 그 패널**만** 바꾸는 컨트롤이 서는 자리. 결과를 바꾸는 노브는 여기 오면
   *  안 된다 — 설정 줄에 있어야 「실행」이 그것을 삼킨다. 반대로 그림만 바꾸는
   *  것을 설정 줄에 두면 실행을 기다리게 만들고 stale 을 거짓으로 세운다. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  /* **한 줄에 하나** [OWNER 2026-09-02 — 「세로 스택 정본화」]. 종전 값은
     `flexBasis: 50%` 였는데 gap 을 더하면 한 줄에 둘이 안 들어가 실제로는
     세로로 섰다 — 화면은 세로였고 주석만 「2×2 격자」라고 말하고 있었다
     (2026-09-02 디자인 감사가 그 어긋남을 잡았다). 정본을 화면 쪽으로
     맞춘다: Backtest 창의 세로 결(북 → 답 → 차트 쌍 → 서랍)과 같은 흐름이고,
     12년 시계열은 풀폭이 아니면 못 읽는다. */
  return (
    <VStack gap={0.5} width="100%" minWidth={0}>
      <HStack gap={1} alignItems="center" justifyContent="space-between" minHeight={24}>
        <Text font="label2" as="h3" noWrap>
          {title}
        </Text>
        <HStack gap={1} alignItems="center" minWidth={0}>
          {sub ? (
            <Text font="legal" as="span" color="fgMuted" noWrap>
              {sub}
            </Text>
          ) : null}
          {aside}
        </HStack>
      </HStack>
      {children}
    </VStack>
  );
}
