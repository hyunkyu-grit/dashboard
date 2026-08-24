'use client';

/* 통계 스트립 — 이 앱이 «여러 사실을 한 줄에 눕히는» 유일한 문법.
 *
 * ## 어디서 왔나
 *
 * `lab/scenario/ModelChart.tsx` 가 갖고 있던 것을 그대로 옮겼다. 그 면은 화면에서
 * 내려갔는데 문법은 남았고, 「모형」 레인이 같은 것을 다시 만들려던 참이었다.
 * 두 벌이 되면 한쪽만 낡는다.
 *
 * ## 이 모양이 왜 이 모양인가 — 실측 2026-08-24
 *
 * 이 앱의 백테스트 카드 아래(「이 구간 · 변화 · 52주」), 코인베이스 가격 페이지의
 * (Trading Insights · Market Stats · Performance), 토스증권 종목 머리의
 * (1일 범위 · 거래대금 · 외국인 순매수 …) 셋이 **같은 것**을 한다:
 *
 *     작은 회색 키   ← 무엇인가
 *     굵은 잉크 값   ← 얼마인가            ...가 가로로 나란히, 칸 사이는 헤어라인
 *
 * 셋 다 산문을 안 쓴다. 밀도가 높은데 읽히는 이유는 여백이 아니라 **키와 값의
 * 대비 + 정렬 + 구분선** 셋이다. 「모형」·「방법」 면이 같은 사실을 문장으로 내서
 * 13px 회색이 화면의 대부분이던 것이 이 레인이 고치는 것이다.
 */

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';

/** 스트립의 칸 하나. 옆 칸과의 사이는 여백이 아니라 헤어라인이다(`.sr-statcol`). */
export function StatColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <VStack gap={1} paddingX={2} paddingY={1.5} flexGrow={1} minWidth={0} className="sr-statcol">
      <Text as="h4" font="label2">
        {title}
      </Text>
      <HStack gap={3} flexWrap="wrap">
        {children}
      </HStack>
    </VStack>
  );
}

/** 키 하나와 값 하나. **값은 tabular** — 두 줄을 위아래로 비교하려면 소수점이
 *  서로 아래에 와야 한다. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}) {
  return (
    <VStack gap={0.25} minWidth={0}>
      <Text as="span" font="caption" color="fgMuted" noWrap>
        {label}
      </Text>
      <Text
        as="span"
        font="body"
        tabularNumbers
        noWrap
        className={tone === 'up' ? 'sr-up' : tone === 'down' ? 'sr-down' : undefined}
      >
        {value}
      </Text>
    </VStack>
  );
}
