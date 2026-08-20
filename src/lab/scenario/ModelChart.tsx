'use client';

/* 「모형」 탭 — 예상 커브 하나. 그림만 있다.
 *
 * ── 어디서 베꼈나 [OWNER, 2026-08-20 — "메인이나 백테스트처럼 예쁘게"] ───────
 * Main 의 「IRS 커브」 카드(`ui/PreviewPane.tsx`)를 **문법 그대로** 옮겼다. 그
 * 카드가 이 앱에서 커브를 그리는 방식이고, 시나리오가 다른 방식을 발명할 이유가
 * 없다:
 *
 *     제목·메타     카드 머리에 쌓임, 둘 다 muted (16/16/12 패딩, gap 4)
 *     플롯          `.sr-plot` 로 감싸 `flexGrow` 로 남는 높이를 전부 먹음
 *     inset         `{ top: 16, right: 12, bottom: 8, left: 8 }`
 *     선            `curve="linear"` — CDS 기본 `bump` 는 노드 사이를 **지어낸다**
 *     흐린 계열     `strokeOpacity` (색이 아니라 불투명도로 뒤로 보낸다)
 *     hover         `enableScrubbing` + `<Scrubber>` + `ReadoutCard`
 *     범례          `RefKey` — 선 조각과 이름. 글자로 «┈ ── ━» 를 그리지 않는다
 *
 * 첫 판이 못생겼던 이유가 정확히 이 목록이었다: 격자도 스크러버도 리드아웃도
 * 없고, 범례를 유니코드 글리프로 찍었고, 플롯이 카드 높이를 안 받아 위쪽 1/3 에
 * 눌려 있었다.
 *
 * ── 선 셋 ──────────────────────────────────────────────────────────────────
 *     오늘        오늘의 스팟 IRS 호가                        (가장 흐림)
 *     시장 12M    오늘 + 시장 캐리 — 시장이 이미 프라이싱한 것
 *     모형 12M    오늘 + 모형 Δ — 이 경로가 맞다면            (잉크)
 *
 * 뒤 둘의 간격이 트레이드다. 성분과 근거는 「성분」 탭이 진다 — 이 탭은 그림
 * 하나다.
 */

import { useCallback, useMemo, useState } from 'react';

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';
import {
  CartesianChart,
  Line,
  Scrubber,
  XAxis,
  YAxis,
} from '@coinbase/cds-web/visualizations/chart';

import { ReadoutCard, ReadoutChange, ReadoutLevel, placeReadout } from '@/ui/ReadoutCard';
import { RefKey } from '@/ui/PreviewPane';

import type { ScenarioRow } from './assemble';

/** Main 의 커브 카드와 같은 값. 다르게 두면 두 카드의 플롯이 어긋나 보인다. */
const CHART_INSET = { top: 16, right: 12, bottom: 8, left: 8 };

const AXIS = 'rate';

const TENOR_LABEL: Record<string, string> = {
  '1y': '1Y',
  '2y': '2Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
};

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(4)}%`);

export function ModelChart({ rows, asof }: { rows: ScenarioRow[]; asof: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | undefined>(undefined);

  /* 자리는 상자의 CSS 변수에 적는다 — 상태가 아니다. 픽셀마다 이 탭 전체를 다시
     그리지 않는다(Main 이 쓰는 그 규약). */
  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    placeReadout(e.currentTarget, e.clientX);
  }, []);
  const onLeave = useCallback(() => setHoverIdx(undefined), []);

  const series = useMemo(() => {
    const today = rows.map((r) => r.spot);
    /* 캐리가 없는 테너에서 시장 선은 **끊긴다**. 스팟으로 메우면 «시장은 10년이
       안 움직인다고 본다» 는 없는 사실이 그려진다 — 빈칸은 0 이 아니다. */
    const market = rows.map((r) => r.market12m);
    const model = rows.map((r) => r.scenario12m);
    return { today, market, model, labels: rows.map((r) => TENOR_LABEL[r.tenor] ?? r.tenor) };
  }, [rows]);

  const hasMarket = series.market.some((v) => v != null);
  const idx =
    hoverIdx != null && hoverIdx >= 0 && hoverIdx < rows.length ? hoverIdx : null;
  const hit = idx == null ? null : rows[idx];

  return (
    <VStack gap={0} width="100%" flexGrow={1} minHeight={0}>
      <VStack gap={0.5} paddingBottom={1.5}>
        <Text as="h3" font="label1" color="fgMuted" noWrap>
          12개월 뒤 IRS 커브
        </Text>
        <Text as="span" font="caption" color="fgMuted" tabularNumbers noWrap>
          커브 {asof} · 모형과 시장의 간격이 트레이드예요
        </Text>
      </VStack>

      <Box
        className="sr-plot"
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <CartesianChart
          enableScrubbing
          onScrubberPositionChange={setHoverIdx}
          animate={false}
          height="100%"
          accessibilityLabel={`12개월 뒤 IRS 커브, 노드 ${rows.length}개. ${rows
            .map(
              (r) =>
                `${TENOR_LABEL[r.tenor]} 오늘 ${r.spot.toFixed(4)}, 모형 ${r.scenario12m.toFixed(4)}` +
                (r.vsMarketBp == null
                  ? ', 시장 캐리 없음'
                  : `, 시장 대비 ${r.vsMarketBp >= 0 ? '+' : '−'}${Math.abs(r.vsMarketBp).toFixed(1)}bp`),
            )
            .join('. ')}`}
          inset={CHART_INSET}
          series={[
            /* 먼저 선언한 것이 아래에 깔린다. 잉크(모형)가 맨 위여야 한다. */
            { id: 'TODAY', data: series.today, color: 'var(--color-fgMuted)', yAxisId: AXIS },
            ...(hasMarket
              ? [{ id: 'MARKET', data: series.market, color: 'var(--color-fgMuted)', yAxisId: AXIS }]
              : []),
            { id: 'MODEL', data: series.model, color: 'var(--color-fg)', yAxisId: AXIS },
          ]}
          xAxis={{ data: series.labels }}
          yAxis={[{ id: AXIS }]}
        >
          <XAxis showGrid={false} />
          <YAxis
            axisId={AXIS}
            position="right"
            showGrid={false}
            tickLabelFormatter={(v) => Number(v).toFixed(2)}
          />
          {/* `curve="linear"` — CDS 기본은 `bump` 스플라인이고 그건 노드 사이를
              지어낸다. 우리가 아는 것은 다섯 테너의 값뿐이다(Main 과 같은 규율). */}
          <Line seriesId="TODAY" curve="linear" strokeWidth={1} strokeOpacity={0.4} />
          {hasMarket ? (
            <Line
              seriesId="MARKET"
              curve="linear"
              strokeWidth={1.5}
              strokeOpacity={0.85}
              connectNulls={false}
            />
          ) : null}
          <Line seriesId="MODEL" curve="linear" strokeWidth={2} />
          <Scrubber accessibilityLabel="테너를 훑어 값 보기" />
        </CartesianChart>

        {hit ? (
          <ReadoutCard title={TENOR_LABEL[hit.tenor] ?? hit.tenor}>
            <ReadoutLevel k="오늘" v={hit.spot} unit="%" />
            <ReadoutLevel k="시장 12M" v={hit.market12m} unit="%" />
            <ReadoutLevel k="모형 12M" v={hit.scenario12m} unit="%" />
            <ReadoutChange k="시장 캐리" v={hit.marketCarryBp} unit="bp" />
            <ReadoutChange k="차이" v={hit.vsMarketBp} unit="bp" />
          </ReadoutCard>
        ) : null}
      </Box>

      <HStack gap={2} paddingTop={1} flexWrap="wrap" alignItems="center">
        <RefKey label="모형 12M" opacity={1} />
        {hasMarket ? <RefKey label="시장 12M" opacity={0.85} /> : null}
        <RefKey label="오늘" opacity={0.4} />
        <Box style={{ marginInlineStart: 'auto' }}>
          <Text as="span" font="legal" color="fgMuted" noWrap>
            {hit ? `${TENOR_LABEL[hit.tenor]} ${pct(hit.spot)} → ${pct(hit.scenario12m)}` : '커브를 훑어 보세요'}
          </Text>
        </Box>
      </HStack>
    </VStack>
  );
}
