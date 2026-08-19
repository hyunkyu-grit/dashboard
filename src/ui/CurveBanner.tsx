'use client';

import { HStack } from '@coinbase/cds-web/layout';
import { TextLabel2 } from '@coinbase/cds-web/typography';

import type { CurveBanner as CurveBannerDto } from '@/lib/api';

/**
 * 커브 전 구간이 한쪽 끝에 몰려 있을 때, 표 위에 한 줄 (§I).
 *
 * ── 왜 행이 아니라 한 줄인가 ────────────────────────────────────────────────
 * 아웃라이트의 60% 이상이 52주 상위 10%(또는 하위 10%) 안에 있으면
 * (`derive.py::curve_banner`, `CURVE_REGIME_FRAC = 0.6`) "이 만기가 52주
 * 고점권" 이라는 건 그 행의 사실이 아니라 **커브의 사실**이다. 행마다 반복하면
 * 열두 번 같은 말을 하고, 정작 커브 전체가 움직였다는 건 아무 데서도 안 보인다.
 * 그래서 백엔드가 판정하고(§16) 프론트는 그걸 한국어로 말한다 — DESIGN §16 의
 * "프론트가 문구를 만드는" 두 예외 중 하나가 이것이다.
 *
 * ── 왜 아웃라이트 탭에서만 ──────────────────────────────────────────────────
 * 판정 입력이 `summary.outrights` 뿐이다. 스프레드·버터플라이는 레벨이 다른
 * 양이고, 국고·크레딧·선물은 아예 **다른 커브**다. 거기에 이 줄을 띄우면 읽는
 * 사람은 눈앞의 표에 대한 말로 읽는다. v1 은 고정 머리에 항상 띄웠는데, v1 은
 * 유니버스가 스왑뿐이라 그 구분이 필요 없었다.
 *
 * ── 색 ──────────────────────────────────────────────────────────────────────
 * 고점권 = 상승색, 저점권 = 하락색. v1 은 둘 다 상승색으로 그렸다(`text-up`
 * 하드코딩) — 저점권 문장이 빨갛게 나오는 상태였다. 방향색은 **카드 위에서만**
 * 4.5:1 을 넘으므로(DESIGN §3.2) 이 줄은 반드시 `--sr-card` 위, 즉 표와 같은
 * 카드 안에 산다. 페이지 바탕(`--sr-page`)에 올리면 라이트에서 4.19/4.31 로
 * 떨어진다.
 */
export function CurveBanner({ banner }: { banner?: CurveBannerDto }) {
  if (!banner?.kind) return null;
  const high = banner.kind === 'curve_high';
  return (
    <HStack paddingX={2} paddingTop={2} paddingBottom={0.5}>
      <TextLabel2 as="p" className={high ? 'sr-up' : 'sr-down'}>
        {high ? '커브 전 구간이 52주 고점권이에요' : '커브 전 구간이 52주 저점권이에요'}
      </TextLabel2>
    </HStack>
  );
}
