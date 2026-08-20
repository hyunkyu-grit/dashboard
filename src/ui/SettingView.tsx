'use client';

/* Setting — 다른 화면이 읽는 값을 정하는 자리 [OWNER, 2026-08-14].
 *
 * 지금은 조달금리 하나뿐이다. 데이터 화면이 아니라 **계산 규약**을 정하는
 * 자리라 최상위 섹션이고, 여기서 고른 값은 `state/funding.ts` 에 남아 Cash
 * Bond 백테스트 요청에 실려 간다.
 *
 * 화면이 값을 저장하지 서버가 저장하지 않는다. 서버 쪽 `/api/settings/funding`
 * 은 "그 스펙이 유효한가, 지금 몇 %인가" 만 답한다 — 그래서 이 화면은 고르는
 * 즉시 그 답을 다시 물어 **출처를 보여 준다**. 조달금리는 손익을 직접 움직이는
 * 숫자라, 어느 시계열의 어느 구간을 쓰는지가 화면에 없으면 안 된다.
 *
 * ── V2 — 기준금리는 실패 상태일 수 있다 ────────────────────────────────────
 * v2 의 base 는 SQL `infomax.기준금리` 이고 그 테이블은 2026-03-21 에 멈춰
 * 있다(`backend/app/funding.py` 의 V2 절). 그걸 고르면 서버가 422 로 이유를
 * 말하고, 이 화면은 그 문장을 **그대로** 보여준다 — 폴백 없이 실패 상태를
 * 보여주는 것이 데이터 소스 규칙이다 [OWNER 2026-08-18].
 */

import { useEffect, useState } from 'react';

import { Button } from '@coinbase/cds-web/buttons';
import { TextInput } from '@coinbase/cds-web/controls';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { SegmentedTabs } from '@coinbase/cds-web/tabs';
import { TextBody, TextCaption, TextHeadline, TextLabel2, TextTitle3 } from '@coinbase/cds-web/typography';

import { fetchFundingSettings, type FundingSettings } from '@/lib/api';
import { fmtLevel } from '@/lib/format';
import {
  FUNDING_DEFAULT,
  SPREAD_MAX,
  SPREAD_MIN,
  useFunding,
  type FundingBasis,
} from '@/state/funding';

const BASIS_TABS: { id: FundingBasis; label: string }[] = [
  { id: 'base', label: '기준금리' },
  { id: 'call', label: '콜금리' },
];

const BASIS_NOTE: Record<FundingBasis, string> = {
  base: '한국은행이 정한 기준금리예요. 금통위가 바꾼 날에만 계단으로 움직여요.',
  call: '시장에서 실제로 거래된 하루짜리 금리예요. 매일 조금씩 움직여요.',
};

/** 스프레드 칸 — 시뮬레이션의 `NumField` 와 같은 커밋 규율(blur/Enter). 부호
 * 있는 칸이라 `onChange` 즉시 파싱은 `-` 를 0 으로 만든다(그쪽 실측). */
function SpreadField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const shown = String(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  if (!editing && text !== shown) setText(shown);

  const commit = () => {
    setEditing(false);
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) onCommit(n);
    else setText(shown);
  };

  return (
    <Box width={96}>
      {/* fontSize legal(13) — 컨트롤 값 13px 규칙(popup.ts 의 근거).
          height 36 — **이 행의** 등고. 다른 행들은 32(Select·date·알약)이지만
          이 칸의 이웃은 기준 SegmentedTabs 이고 그건 36 이다(실측). 32 로 내리면
          중심선이 2px 벌어지고, CDS 기본값 38 로 두면 1px 벌어진다 — 36 만이
          0 이다. 등고는 앱 전역 상수가 아니라 **행의 성질**이라는 실측 사례다
          (`guards/control-parity.test.ts` 의 예외 목록에 이 사유가 있다). */}
      <TextInput
        size="s"
        fontSize="legal"
        height={36}
        accessibilityLabel="조달 스프레드 (bp)"
        suffix="bp"
        value={text}
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </Box>
  );
}

export function SettingView() {
  const [spec, { setBasis, setSpreadBp, reset }] = useFunding();

  const [data, setData] = useState<FundingSettings>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    setData(undefined);
    setError(undefined);
    fetchFundingSettings(spec)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [spec]);

  const isDefault =
    spec.basis === FUNDING_DEFAULT.basis && spec.spreadBp === FUNDING_DEFAULT.spreadBp;

  return (
    <VStack gap={2} paddingY={1} maxWidth={640}>
      <VStack className="sr-card" gap={1.5} padding={3}>
        <TextTitle3 as="h2">조달금리</TextTitle3>
        <TextBody as="p" color="fgMuted">
          현금채권은 원금을 빌려서 사요. 그 이자를 빼야 손익이 실제로 번 돈이
          돼요. 여기서 정한 값은 <b>Cash Bond 백테스트</b>와 <b>Strategy</b>가
          같이 써요. IRS 백테스트는 안 써요.
        </TextBody>

        <HStack gap={2} alignItems="flex-end" flexWrap="wrap">
          <VStack gap={0.25}>
            <TextCaption as="span" color="fgMuted">
              기준
            </TextCaption>
            <SegmentedTabs
              accessibilityLabel="조달 기준"
              tabs={BASIS_TABS}
              activeTab={BASIS_TABS.find((t) => t.id === spec.basis) ?? null}
              onChange={(t) => t && setBasis(t.id)}
            />
          </VStack>
          <VStack gap={0.25}>
            <TextCaption as="span" color="fgMuted">
              스프레드
            </TextCaption>
            <SpreadField
              value={spec.spreadBp}
              onCommit={(v) => setSpreadBp(Math.min(SPREAD_MAX, Math.max(SPREAD_MIN, v)))}
            />
          </VStack>
          {!isDefault ? (
            <Button variant="secondary" size="s" onClick={reset}>
              기본값으로
            </Button>
          ) : null}
        </HStack>

        <TextCaption as="p" color="fgMuted">
          {BASIS_NOTE[spec.basis]}
        </TextCaption>

        {/* 출처. 이 숫자가 어느 시계열의 어느 구간에서 왔는지를 화면이 말한다 —
            조달은 손익을 직접 움직이므로 근거가 보이지 않으면 안 된다. */}
        <VStack gap={0.75} className="sr-setting-prov">
          {error ? (
            <TextBody as="p" color="fgMuted">
              이 기준은 지금 쓸 수 없어요 — 서버가 이렇게 말해요:{' '}
              <TextBody as="span">{error}</TextBody>
            </TextBody>
          ) : !data ? (
            <TextCaption as="span" color="fgMuted">
              불러오는 중이에요…
            </TextCaption>
          ) : (
            <>
              <HStack gap={1} alignItems="baseline">
                <TextCaption as="span" color="fgMuted">
                  지금 조달금리
                </TextCaption>
                <TextHeadline as="span" tabularNumbers>
                  {fmtLevel(data.latest, '%')}%
                </TextHeadline>
                <TextLabel2 as="span" color="fgMuted">
                  = {data.label}
                </TextLabel2>
              </HStack>
              <HStack gap={1} alignItems="baseline">
                <TextCaption as="span" color="fgMuted">
                  시계열 구간
                </TextCaption>
                <TextLabel2 as="span" tabularNumbers>
                  {data.from} ~ {data.to}
                </TextLabel2>
              </HStack>
              <HStack gap={1} alignItems="baseline">
                <TextCaption as="span" color="fgMuted">
                  구간 밖
                </TextCaption>
                <TextLabel2 as="span">가장 가까운 끝값을 그대로 이어써요.</TextLabel2>
              </HStack>
            </>
          )}
        </VStack>
      </VStack>

      <TextCaption as="p" color="fgMuted">
        조달비용은 <b>초기 투자금액</b>에 실경과일수 ÷ 365 로 붙어요. 이표를
        받아도 줄지 않아요 — 매수금액을 텀 레포로 통째로 조달한다고 봐요. 매도
        포지션에는 붙지 않아요: 공매도는 돈이 아니라 채권을 빌리는 것이고, 그
        비용은 이 화면이 아는 값이 아니에요.
      </TextCaption>
    </VStack>
  );
}
