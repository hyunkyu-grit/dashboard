'use client';

import { Button } from '@coinbase/cds-web/buttons';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { TextBody, TextTitle3 } from '@coinbase/cds-web/typography';

import { useScheme } from './providers';

/* V1 placeholder. The instrument table lands here in V2; this screen exists so
 * the token bridge is visible in both schemes before anything is built on it. */
export default function Home() {
  const { scheme, toggleScheme } = useScheme();

  return (
    <VStack background="bg" minHeight="100vh" gap={2} padding={3}>
      <HStack alignItems="center" gap={2}>
        <TextTitle3 as="h1">KRW IRS Monitor</TextTitle3>
        <Button size="s" variant="secondary" onClick={toggleScheme}>
          {scheme}
        </Button>
      </HStack>

      <TextBody as="p" color="fgMuted">
        v2 스파이크 — CDS 컴포넌트 층. 방향 두 색은 CDS 가 아니라 이 앱이 가집니다.
      </TextBody>

      <Box background="bgElevation1" bordered padding={2} borderRadius={200}>
        <HStack gap={3} alignItems="baseline">
          <TextBody as="span" className="sr-up" mono>
            +1.75
          </TextBody>
          <TextBody as="span" className="sr-down" mono>
            −1.75
          </TextBody>
          <TextBody as="span" className="sr-flat" mono>
            0.00
          </TextBody>
        </HStack>
      </Box>
    </VStack>
  );
}
