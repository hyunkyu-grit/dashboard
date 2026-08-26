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
  note,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
  /** 값의 **모집단**을 좁히는 한 마디 — 「미청산 1건 제외」 같은 것.
   *
   *  왜 값이 아니라 따로인가: 값에 붙여 적으면 tabular 열이 깨지고 noWrap 이
   *  칸을 늘린다. 왜 각주가 아니라 여기인가: 승률 80% 가 무엇의 80% 인지는
   *  숫자를 읽는 그 자리에서 말해야 한다 — 창 바닥 각주는 그 숫자를 이미 읽고
   *  난 뒤에 온다(실측 2026-08-26: 미청산 손실 포지션이 승률에서 조용히 빠져
   *  있었고, 바닥 각주는 그 사실을 적고 있었는데도 카드는 80% 만 말했다). */
  note?: string;
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
      {note ? (
        <Text as="span" font="legal" color="fgMuted" noWrap>
          {note}
        </Text>
      ) : null}
    </VStack>
  );
}
