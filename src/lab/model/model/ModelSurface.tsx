'use client';

/* Lab 「모형」 의 둘째 면 — «이 숫자 어디서 왔어» 에 답한다.
 *
 * 읽는 사람은 전략가와 궁금한 트레이더다. 그래서 순서가 **배선 → 반응 → 식 →
 * 계수** 다. 지도를 먼저 주고, 그 지도가 내는 그림을 보이고, 그다음에 글자로
 * 내려간다. 반대로 놓으면(식 44개부터) 아무도 두 번째 화면까지 안 온다.
 *
 * 읽기 전용이다 — 입력이 없고 엔진을 import 하지 않는다. 정적 JSON 만 읽는다.
 */

import { VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';

import { BasisIrf } from './BasisIrf';
import { Census, CoefficientTable, EquationRegister } from './Registers';
import { WiringGraph } from './WiringGraph';

export function ModelSurface() {
  return (
    <VStack
      gap={3}
      width="100%"
      paddingBottom={3}
      paddingEnd={1}
      minHeight={0}
      flexGrow={1}
      className="sr-model-surface"
    >
      <VStack gap={0.5} maxWidth={720}>
        <Text as="h2" font="title3">
          모형
        </Text>
        <Text as="p" font="body" color="fgMuted">
          BOK-LOOK(한국은행 BOK WP 2025-3)을 구현한 거예요. 여기 있는 건 전부 그
          논문에서 왔고, 논문에 없는 자리는 그렇다고 적어 뒀어요.
        </Text>
      </VStack>

      <WiringGraph />
      <BasisIrf />
      <EquationRegister />
      <CoefficientTable />
      <Census />
    </VStack>
  );
}
