'use client';

/* 열 머리 뜻풀이 — CDS `Tooltip`(hover 와 **키보드 포커스** 둘 다 연다).
 * **앱에 하나뿐인 그것** [OWNER 2026-09-02 — "공용 부품은 한 벌로 승격"] —
 * 종전에는 rv(RankingTable)와 MR(MrPage)에 두 벌이었다.
 *
 * 열 머리 몇 개뿐이라 팝오버 비용 문제가 없다 — 셀 148개에 팝오버 기계를 하나씩
 * 달지 않던 그 판단(rv RankingTable 머리 주석)의 반대편. 점선 밑줄(cursor: help)
 * 이 "설명 있음"의 관례 표식이다. `.sr-rv-thhelp` 는 rv 에서 태어난 클래스지만
 * 앱 공용이다 — 클래스 이름은 소유권이 아니다(캐논 규칙 2). */

import { Tooltip } from '@coinbase/cds-web/overlays';
import { Text } from '@coinbase/cds-web/typography';

export function ThHelp({ label, help }: { label: string; help: string }) {
  return (
    <Tooltip
      content={
        /* 폭은 **`maxWidth` prop 이 진다** — 여기 클래스로 적지 않는다.
           2026-08-19 에 이 자리에 `.sr-rv-tiptext`(max-width 236 + white-space
           normal + keep-all)가 붙어 있었다. 툴팁이 `<th>` 안에 렌더돼 그 칸의
           nowrap 을 상속했고 긴 문장이 패널 밖으로 흘렀기 때문이다
           [OWNER — "패널 밖으로 글씨가 빠져나가"]. **그건 증상이었다**: 뿌리는
           루트에 `PortalProvider` 가 없어 CDS `Portal` 이 포털을 포기하고
           인라인 Fragment 로 떨어진 것이었다(`app/providers.tsx` 의 주석).
           프로바이더가 서면서 툴팁은 `#tooltipContainer` 로 나가고, 줄바꿈은
           body 의 `keep-all` 을 상속한다 — 실측(2026-08-26): inPortal true ·
           inTh false · white-space normal · word-break keep-all. 남은 것은
           폭뿐이고 그건 이미 아래 prop 이 말하고 있었다(클래스의 236 이 그
           prop 의 280 을 덮고 있었다). */
        <Text font="legal" as="span">
          {help}
        </Text>
      }
      maxWidth={280}
      placement="bottom"
    >
      <span className="sr-rv-thhelp" tabIndex={0}>
        {label}
      </span>
    </Tooltip>
  );
}
