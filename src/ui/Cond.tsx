'use client';

/* 조건 바 한 칸 — 「무엇 기준으로 보고 있나」를 키·값 한 쌍으로 적는다.
 * **앱에 하나뿐인 그것** [OWNER 2026-09-02 — "공용 부품은 한 벌로 승격"].
 *
 * 2026-09-02 까지 rv(RvPage)와 MR(MrPage)에 두 벌이었고 타이포 문법까지 갈려
 * 있었다 — rv 는 구 shorthand(`TextCaption`/`TextLegal`), MR 은 새 문법
 * (`Text font=…`). 시각은 같다: shorthand 는 CDS 소스가 `Text` 에
 * `font="caption|legal"` 을 위임하는 deprecated 껍데기일 뿐이다(node_modules
 * `TextCaption.js`/`TextLegal.js` 확인 2026-09-02). 한 벌은 새 문법으로 선다
 * (CLAUDE.md cds-code §5 — 새 코드에서 shorthand 추가 금지).
 *
 * `.sr-rv-asof-split` 은 rv 에서 태어난 클래스지만 앱 공용이다 — 클래스 이름은
 * 소유권이 아니다(캐논 규칙 2). */

import { HStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';

export function Cond({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <HStack gap={0.5} alignItems="baseline">
      <Text font="caption" as="span" color="fgMuted" noWrap>
        {k}
      </Text>
      {/* 강조는 굵기+밑줄 — 색이 아니다(rv 의 as-of 대비·겸직 측정). */}
      <Text
        font="legal"
        as="span"
        tabularNumbers
        noWrap
        className={strong ? 'sr-rv-asof-split' : undefined}
      >
        {v}
      </Text>
    </HStack>
  );
}
