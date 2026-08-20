'use client';

/* 「모형」 탭 — 예상 커브 하나.
 *
 * ── 표준은 백테스트의 종목 차트다 [OWNER, 2026-08-20] ───────────────────────
 * "백테스트 들어가서 아웃라이트에서 9m 그래프 어떻게 생겼는지라도 한 번
 * 보고오셈, 이게 표준이야". 실제로 열어서 재고 그 해부를 그대로 옮겼다
 * (`ui/PreviewPane.tsx`):
 *
 *     머리      작은 muted 이름, 오른쪽에 칩/메타
 *     히어로    **거대한 숫자**(display3) + 작은 단위 + 방향 화살표와 변화
 *     차트      주선에 `showArea areaType="dotted"` 면 채움
 *               참조선은 굵기·불투명도가 주선과 같고 **다른 것은 색 하나**
 *               (`--sr-ref-cd` 호박 / `--sr-ref-policy` 보라 — direction.css)
 *               눈금 라벨은 `opacity 0.65` 로 물러남
 *               `Scrubber` 는 짚을 시리즈를 **명시**한다(기본은 전부라 유령 구슬)
 *     범례      바닥 `RefKey` — 선 견본 + 이름, 이름도 선의 색을 입는다
 *     통계      차트 아래 `.sr-stats` 세 칸, 사이는 여백이 아니라 **헤어라인**
 *
 * 앞선 두 판이 «메인/백테스트랑 그래프는 커녕 디자인 문법조차 안 맞는다» 는
 * 지적을 받은 이유가 정확히 이 목록이었다: 히어로도 면 채움도 색도 통계 블록도
 * 없었고, 머리가 두 층이라 as-of 가 두 번 찍혔고, 범례를 «┈ ── ━» 유니코드로
 * 그렸다.
 *
 * ── 선 셋 ──────────────────────────────────────────────────────────────────
 *     모형 12M   오늘 + 모형 Δ — 이 경로가 맞다면        잉크, 면 채움
 *     시장 12M   오늘 + 시장 캐리 — 이미 프라이싱된 것    호박
 *     오늘       오늘의 스팟 IRS 호가                     보라
 *
 * 앞 둘의 간격이 트레이드고, 히어로가 그 값을 진다.
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

/** 백테스트 종목 차트와 같은 값. 다르면 두 카드의 플롯이 어긋나 보인다.
 *
 * 바닥이 28 인 것은 x 눈금 라벨의 자리다 — 8 로 두었더니 y 축의 맨 아래 눈금
 * («3.40»)이 x 축의 마지막 라벨(«10Y»)과 같은 줄에 겹쳤다(실측 2026-08-20). */
const CHART_INSET = { top: 16, right: 12, bottom: 28, left: 8 };

const AXIS = 'rate';

const MODEL = 'MODEL';
const MARKET = 'MARKET';
const TODAY = 'TODAY';

const TENOR_LABEL: Record<string, string> = {
  '1y': '1Y',
  '2y': '2Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
};

/** 히어로가 서는 테너. 결과 탭의 헤드라인과 같은 자리여야 한다. */
const HEADLINE = '3y';

const lvl = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(4));
const bp = (v: number | null | undefined) =>
  v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

export function ModelChart({ rows, asof }: { rows: ScenarioRow[]; asof: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | undefined>(undefined);

  /* 자리는 상자의 CSS 변수에 적는다 — 상태가 아니다. 픽셀마다 이 탭 전체를 다시
     그리지 않는다(백테스트 차트가 쓰는 그 규약). */
  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    placeReadout(e.currentTarget, e.clientX);
  }, []);
  const onLeave = useCallback(() => setHoverIdx(undefined), []);

  const s = useMemo(
    () => ({
      today: rows.map((r) => r.spot),
      /* 캐리가 없는 테너에서 시장 선은 **끊긴다**. 스팟으로 메우면 «시장은 10년이
         안 움직인다고 본다» 는 없는 사실이 그려진다 — 빈칸은 0 이 아니다. */
      market: rows.map((r) => r.market12m),
      model: rows.map((r) => r.scenario12m),
      labels: rows.map((r) => TENOR_LABEL[r.tenor] ?? r.tenor),
    }),
    [rows],
  );

  const hasMarket = s.market.some((v) => v != null);
  const head = rows.find((r) => r.tenor === HEADLINE) ?? rows[0];
  const dir = head?.vsMarketBp == null ? 'flat' : head.vsMarketBp > 0 ? 'up' : head.vsMarketBp < 0 ? 'down' : 'flat';

  const idx = hoverIdx != null && hoverIdx >= 0 && hoverIdx < rows.length ? hoverIdx : null;
  const hit = idx == null ? null : rows[idx];

  if (!head) return null;

  return (
    <VStack gap={0} width="100%" flexGrow={1} minHeight={0}>
      {/* ── 머리 + 히어로 ─────────────────────────────────────────────────
          백테스트가 «9M» 을 작게 얹고 그 아래 3.2850 을 크게 세우는 그 자리다.
          이름 옆의 오른쪽 자리는 카드 머리(탭·as-of)가 이미 지므로 비운다. */}
      <VStack gap={1.5} paddingX={2} paddingTop={2} paddingBottom={1.5}>
        <Text as="h3" font="label1" color="fgMuted" noWrap>
          12개월 뒤 IRS 커브
        </Text>
        <HStack gap={1.5} alignItems="baseline" flexWrap="wrap">
          <Text as="span" font="display3" tabularNumbers noWrap>
            {lvl(head.scenario12m)}
            <Box as="span" className="sr-hero-unit">
              %
            </Box>
          </Text>
          <Text
            as="span"
            font="body"
            tabularNumbers
            noWrap
            className={dir === 'up' ? 'sr-up' : dir === 'down' ? 'sr-down' : 'sr-flat'}
          >
            {dir === 'up' ? '↗' : dir === 'down' ? '↘' : '→'} {bp(head.vsMarketBp)}bp{' '}
            <Box as="span" className="sr-hero-span">
              {TENOR_LABEL[head.tenor]} · 시장 대비
            </Box>
          </Text>
        </HStack>
      </VStack>

      {/* ── 차트 ──────────────────────────────────────────────────────────
          `flexBasis={0}` 이 없으면 상자가 자기 내용에서 높이를 얻으려 하고,
          내용은 상자에서 높이를 얻으려 해서 되먹임이 생긴다. */}
      <Box
        className="sr-plot"
        paddingX={1}
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
          accessibilityLabel={`12개월 뒤 IRS 커브. ${rows
            .map(
              (r) =>
                `${TENOR_LABEL[r.tenor]} 모형 ${lvl(r.scenario12m)}%` +
                (r.vsMarketBp == null ? ', 시장 캐리 없음' : `, 시장 대비 ${bp(r.vsMarketBp)}bp`),
            )
            .join('. ')}`}
          inset={CHART_INSET}
          series={[
            /* 먼저 선언한 것이 아래에 깔린다. 잉크(모형)가 맨 위여야 한다. */
            { id: TODAY, data: s.today, color: 'var(--sr-ref-policy)', yAxisId: AXIS },
            ...(hasMarket
              ? [{ id: MARKET, data: s.market, color: 'var(--sr-ref-cd)', yAxisId: AXIS }]
              : []),
            { id: MODEL, data: s.model, color: 'var(--color-fg)', yAxisId: AXIS },
          ]}
          xAxis={{ data: s.labels }}
          yAxis={[{ id: AXIS }]}
        >
          <XAxis showGrid={false} styles={{ tickLabel: { opacity: 0.65 } }} />
          <YAxis
            axisId={AXIS}
            position="right"
            showGrid={false}
            styles={{ tickLabel: { opacity: 0.65 } }}
            tickLabelFormatter={(v) => Number(v).toFixed(2)}
          />
          {/* 참조선 둘은 **똑같이 그려진다** — 같은 굵기, 같은 불투명도. 다른 것은
              색 하나다(direction.css 의 호박/보라, 같은 지각적 무게). */}
          <Line seriesId={TODAY} curve="linear" strokeWidth={1.5} strokeOpacity={0.9} />
          {hasMarket ? (
            <Line
              seriesId={MARKET}
              curve="linear"
              strokeWidth={1.5}
              strokeOpacity={0.9}
              connectNulls={false}
            />
          ) : null}
          {/* `curve="linear"` — CDS 기본 `bump` 는 노드 사이를 **지어낸다**. 우리가
              아는 것은 다섯 테너의 값뿐이다(백테스트 커브와 같은 규율). */}
          <Line seriesId={MODEL} curve="linear" showArea areaType="dotted" />
          {/* 짚을 시리즈를 명시한다 — 기본값은 `series` 전부라, 안 그려진 자리에도
              구슬이 찍힌다(`Scrubber.js`). */}
          <Scrubber
            accessibilityLabel="테너를 훑어 값 보기"
            seriesIds={[MODEL, ...(hasMarket ? [MARKET] : []), TODAY]}
          />
        </CartesianChart>

        {hit ? (
          <ReadoutCard title={TENOR_LABEL[hit.tenor] ?? hit.tenor}>
            <ReadoutLevel k="모형 12M" v={hit.scenario12m} unit="%" />
            <ReadoutLevel k="시장 12M" v={hit.market12m} unit="%" />
            <ReadoutLevel k="오늘" v={hit.spot} unit="%" />
            <ReadoutChange k="시장 캐리" v={hit.marketCarryBp} unit="bp" />
            <ReadoutChange k="차이" v={hit.vsMarketBp} unit="bp" />
          </ReadoutCard>
        ) : null}
      </Box>

      {/* ── 범례 ──────────────────────────────────────────────────────────
          **실제로 그려진 것만** 이름을 얻는다. 이름도 선의 색을 입는다. */}
      <HStack gap={2} paddingX={2} paddingBottom={1} flexWrap="wrap">
        <RefKey label="모형 12M" opacity={1} />
        {hasMarket ? <RefKey label="시장 12M" opacity={0.9} color="var(--sr-ref-cd)" /> : null}
        <RefKey label={`오늘 ${asof}`} opacity={0.9} color="var(--sr-ref-policy)" />
      </HStack>

      {/* ── 통계 셋 ───────────────────────────────────────────────────────
          사이가 여백이 아니라 헤어라인이라 세 목록이 **한 덩어리**로 읽힌다. */}
      <HStack className="sr-stats" flexWrap="wrap">
        <StatColumn title="오늘">
          {rows.map((r) => (
            <Stat key={r.tenor} label={TENOR_LABEL[r.tenor]} value={`${lvl(r.spot)}%`} />
          ))}
        </StatColumn>
        <StatColumn title="모형 12M">
          {rows.map((r) => (
            <Stat key={r.tenor} label={TENOR_LABEL[r.tenor]} value={`${lvl(r.scenario12m)}%`} />
          ))}
        </StatColumn>
        <StatColumn title="시장 대비">
          {rows.map((r) => (
            <Stat
              key={r.tenor}
              label={TENOR_LABEL[r.tenor]}
              value={`${bp(r.vsMarketBp)}${r.vsMarketBp == null ? '' : 'bp'}`}
              tone={r.vsMarketBp == null ? undefined : r.vsMarketBp > 0 ? 'up' : 'down'}
            />
          ))}
        </StatColumn>
      </HStack>
    </VStack>
  );
}

function StatColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack gap={1.5} paddingX={2} paddingY={2} flexGrow={1} minWidth={0} className="sr-statcol">
      <Text as="h4" font="title3">
        {title}
      </Text>
      <HStack gap={3} flexWrap="wrap">
        {children}
      </HStack>
    </VStack>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
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
