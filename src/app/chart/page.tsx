'use client';

import { useMemo } from 'react';

import { Button } from '@coinbase/cds-web/buttons';
import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TextCaption, TextTitle3 } from '@coinbase/cds-web/typography';

import { useScheme } from '@/app/providers';

import { CurveChart, type CurveLine } from '@/chart/CurveChart';

/**
 * 이관 벤치 [2026-08-26].
 *
 * 종전의 PASS B(A/B 후보 비교) 하니스를 대체한다 — 그 판정은 끝났고, 후보
 * 파일 둘(`CandidateB`·`CandleLayerA`)은 v4 API 라 타입체크도 깨고 있었다.
 *
 * 여기서 재는 것은 셋이고, 셋 다 **프로덕션 15개를 고치기 전에** 확인해야
 * 하는 것들이다:
 *
 *   ① 커브 축이 정말 만기 축인가 — 3M·1Y·10Y·30Y 가 **선형 월수** 자리에
 *      서고 눈금 글자가 「120」이 아니라 「10Y」인가.
 *   ② 점무늬 면 프리미티브가 주선 아래에 그려지는가(캐논의 `areaType="dotted"`).
 *   ③ 스킴을 토글하면 **캔버스 색이 따라오는가** — 종전 후보 B 가 마운트 때
 *      한 번 읽고 얼어붙었던 그 자리다.
 *
 * 커브 값은 **합성**이다. 이 화면은 렌더 확인용이지 시세가 아니다.
 */

const TENORS = ['3M', '6M', '9M', '1Y', '18M', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'];
/** 합성 파 커브(%) — 우상향에 10Y 뒤로 평평해지는 흔한 모양. */
const PAR = [2.61, 2.58, 2.55, 2.54, 2.56, 2.6, 2.68, 2.79, 2.87, 2.95, 3.02, 3.0];

function CurveBench() {
  const lines = useMemo<CurveLine[]>(
    () => [{ id: 'PAR', values: PAR, color: (p) => p.up }],
    [],
  );
  return (
    <CurveChart
      height={260}
      accessibilityLabel="합성 파 커브"
      nodes={TENORS}
      lines={lines}
      hoverLabel={(i) => `${TENORS[i]} ${PAR[i].toFixed(2)}%`}
    />
  );
}

function SchemeToggle() {
  const { scheme, toggleScheme } = useScheme();
  return (
    <Button compact variant="secondary" onClick={toggleScheme}>
      {scheme === 'light' ? '다크로' : '라이트로'}
    </Button>
  );
}

export default function ChartBenchPage() {
  return (
    <VStack gap={3} padding={3}>
      <VStack gap={0.5}>
        <TextTitle3 as="h1">이관 벤치 — 커브 축</TextTitle3>
        <TextCaption as="p" color="fgMuted">
          가로축은 날짜가 아니라 만기 월수예요. 눈금이 3M·1Y·10Y·30Y 로 서고, 자리는 월수에
          비례해요. 값은 합성이에요.
        </TextCaption>
      </VStack>
      <CurveBench />
      <HStack gap={2} alignItems="center">
        <SchemeToggle />
        <TextCaption as="p" color="fgMuted">
          누르면 선·면·눈금 색이 **그 자리에서** 바뀌어야 해요. 안 바뀌면 색 다리가 마운트
          때 한 번 읽고 얼어붙은 거예요 — 종전 후보 B 의 그 고장이에요.
        </TextCaption>
      </HStack>
    </VStack>
  );
}
