'use client';

/* 「충격반응」 탭 — 논문이 그리는 그림 그대로.
 *
 * ── 왜 이 탭이 생겼나 ──────────────────────────────────────────────────────
 * 이 화면의 나머지 세 탭(결과·모형·성분)은 전부 **금리 한 칸**만 본다. 그런데
 * 우리가 빌려 쓰는 모형이 논문에서 하는 일은 그게 아니다. BOK-LOOK 은 초록에서
 * 스스로를 «전망과 정책분석» 도구라고 부르고, Results 절이 실제로 그리는 것은
 * **Figure 18~20 의 여덟 칸**이다 — 금리·환율·갭·물가·수출입·주택·부채.
 *
 * 그러니까 금리는 그 여덟 중 하나였다. 우리는 나머지 일곱을 계산해 놓고
 * **버리고 있었다**(`combine.ts` 가 매 렌더 다 만들어 두는데 읽는 데가 없었다,
 * 실측 2026-08-21). 이 탭이 그걸 화면에 세운다.
 *
 * ── 칸 여덟 중 일곱 ────────────────────────────────────────────────────────
 * 논문 Figure 18 의 「Nominal HH Debt(조원)」 칸은 **없다**. `debt` 는 eq (44)
 * 라 애초에 **비율**(부채/GDP, %p)이고, 명목 잔액은 편차 공간에 존재하지 않는다.
 * 레벨을 지어내지 않고 칸을 비운 채 이유를 적는다.
 *
 * ── 그리고 이 탭은 대조표다 ────────────────────────────────────────────────
 * 논문 본문(pp.37~38)이 25bp 충격의 최대 반응을 숫자로 적어 두었다. 「논문 실험」
 * 을 고르면 그 숫자가 칸마다 같이 선다. 밴드 검증이 코드 주석에만 살아 있으면
 * 아무도 안 본다 — 화면이 매번 자기를 채점하게 둔다.
 */

import type React from 'react';
import { useMemo, useState } from 'react';

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';
import {
  CartesianChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from '@coinbase/cds-web/visualizations/chart';

import { SegmentedTabs } from '@coinbase/cds-web/tabs';

import { BASIS, PAPER_IRF_COEFS, combineCoefs, type Diffs, type QuarterlyVar } from './combine';

/** 논문 Figure 18 의 가로축 — 20분기. 기저는 24 를 들고 있지만 그림에 맞춘다. */
const QUARTERS = 20;

const INSET = { top: 10, right: 10, bottom: 20, left: 6 };

/** 선 하나. `key` 는 기저 변수 이름이고, `color` 는 이 앱의 참조선 팔레트다. */
type Series = { key: QuarterlyVar; label: string; color: string };

/** 칸 하나. `paper` 는 논문 본문이 적어 둔 25bp 충격의 최대 반응이다. */
type Panel = {
  id: string;
  title: string;
  unit: string;
  lines: Series[];
  /** 논문 본문 pp.37~38 의 서술값. `null` 이면 논문이 숫자를 안 적었다. */
  paper: { of: QuarterlyVar; text: string; value: number } | null;
  note?: string;
};

const INK = 'var(--color-fg)';
const AMBER = 'var(--sr-ref-cd)';
const PURPLE = 'var(--sr-ref-policy)';

/* 칸 순서와 이름은 논문 Figure 18 의 것이다. 원문 라벨을 괄호로 남긴다 —
   대조하는 사람이 논문을 나란히 놓고 볼 것이므로. */
const PANELS: Panel[] = [
  {
    id: 'rates',
    title: '기준금리와 시장금리',
    unit: '%p',
    lines: [
      { key: 'i_kr', label: '기준금리', color: INK },
      { key: 'kr3y', label: '국고 3년', color: AMBER },
      { key: 'kr10y', label: '국고 10년', color: PURPLE },
    ],
    paper: null,
  },
  {
    id: 'fx',
    title: '원/달러',
    unit: '%',
    lines: [{ key: 's', label: '원/달러', color: INK }],
    /* 논문 칸의 단위는 «Won» 이고 우리 `s` 는 로그×100, 즉 **%** 다. 같은 것을
       다른 자로 잰 것이라 눈금이 다르다 — 환산해서 맞춰 놓으면 그 사실이
       사라지므로 그대로 두고 단위를 적는다. */
    paper: null,
    note: '논문 칸은 원화 금액이고 이 칸은 퍼센트예요. 같은 것을 다른 자로 재요.',
  },
  {
    id: 'gap',
    title: 'GDP 갭',
    unit: '%p',
    lines: [{ key: 'y_gap', label: 'GDP 갭', color: INK }],
    paper: { of: 'y_gap', text: '논문 최대 −0.07%p', value: -0.07 },
  },
  {
    id: 'cpi',
    title: '소비자물가 전년동기',
    unit: '%p',
    lines: [{ key: 'cpi_yoy', label: 'CPI YoY', color: INK }],
    paper: { of: 'cpi_yoy', text: '논문 최대 −0.05%p', value: -0.05 },
  },
  {
    id: 'trade',
    title: '수출과 수입',
    unit: '%',
    lines: [
      { key: 'x', label: '수출', color: INK },
      { key: 'm', label: '수입', color: AMBER },
    ],
    paper: null,
  },
  {
    id: 'hpi',
    title: '주택가격',
    unit: '%',
    lines: [{ key: 'hpi', label: '주택가격', color: INK }],
    paper: { of: 'hpi', text: '논문 최대 −0.4%', value: -0.4 },
  },
  {
    id: 'debt',
    title: '가계부채 / GDP',
    unit: '%p',
    lines: [{ key: 'debt', label: '부채/GDP', color: INK }],
    paper: { of: 'debt', text: '논문 최대 −0.3%p', value: -0.3 },
  },
];

const EXPERIMENTS = [
  { id: 'paper' as const, label: '논문 실험' },
  { id: 'knobs' as const, label: '내 시나리오' },
];

/** 소수 자리를 값의 크기에서 고른다 — 0.0023 을 «0.00» 으로 적으면 죽은 칸이 된다. */
function digits(span: number): number {
  if (span >= 1) return 2;
  if (span >= 0.1) return 3;
  return 4;
}

const fmt = (v: number, d: number) => (v === 0 ? '0' : v.toFixed(d));

function extremum(path: number[]): number {
  let best = 0;
  for (const v of path) if (Math.abs(v) > Math.abs(best)) best = v;
  return best;
}

function IrfPanel({ panel, diffs }: { panel: Panel; diffs: Diffs }) {
  const labels = useMemo(
    () => Array.from({ length: QUARTERS }, (_, i) => (i + 1 === 1 || (i + 1) % 5 === 0 ? String(i + 1) : '')),
    [],
  );

  const data = useMemo(
    () => panel.lines.map((l) => ({ ...l, path: diffs[l.key].slice(0, QUARTERS) })),
    [panel, diffs],
  );

  const span = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const d of data) for (const v of d.path) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return Math.max(hi - lo, 1e-6);
  }, [data]);

  const d = digits(span);
  const peak = panel.paper ? extremum(diffs[panel.paper.of].slice(0, QUARTERS)) : null;

  return (
    <VStack gap={0} className="sr-irf-panel">
      <HStack gap={1} alignItems="baseline" justifyContent="space-between" paddingX={1.5} paddingTop={1.5}>
        <Text as="h4" font="label2" noWrap>
          {panel.title}
        </Text>
        <Text as="span" font="legal" color="fgMuted" noWrap>
          {panel.unit}
        </Text>
      </HStack>

      {/* 논문이 적어 둔 값과 우리 값을 **한 줄에** 놓는다. 따로 놓으면 대조가
          독자의 일이 되고, 그러면 아무도 안 한다. */}
      {panel.paper && peak != null ? (
        <HStack gap={1} paddingX={1.5} paddingTop={0.5} flexWrap="wrap">
          <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
            {panel.paper.text}
          </Text>
          <Text as="span" font="legal" color="fgMuted" noWrap>
            ·
          </Text>
          <Text as="span" font="legal" tabularNumbers noWrap>
            여기 {fmt(peak, d)}
            {panel.unit === '%p' ? '%p' : '%'}
          </Text>
        </HStack>
      ) : null}

      <Box className="sr-plot sr-irf-plot" paddingX={0.5}>
        <CartesianChart
          animate={false}
          height="100%"
          accessibilityLabel={`${panel.title}. ${data
            .map((l) => `${l.label} 최대 ${fmt(extremum(l.path), d)}${panel.unit}`)
            .join('. ')}`}
          inset={INSET}
          series={data.map((l) => ({ id: l.key, data: l.path, color: l.color, yAxisId: panel.id }))}
          xAxis={{ data: labels }}
          yAxis={[{ id: panel.id }]}
        >
          <XAxis showGrid={false} styles={{ tickLabel: { opacity: 0.65 } }} />
          <YAxis
            axisId={panel.id}
            position="right"
            showGrid={false}
            styles={{ tickLabel: { opacity: 0.65 } }}
            tickLabelFormatter={(v) => fmt(Number(v), d)}
          />
          {/* 0 선. 논문 Figure 18 의 모든 칸이 이 선을 깔고 있고, 그럴 만하다 —
              여기 그려지는 것은 전부 **차이**라 0 이 곧 «아무 일도 없음» 이다.
              그 선이 없으면 「−0.09 에서 +0.01 로 올라간 곡선」과 「+0.01 에서
              −0.09 로 내려간 곡선」이 화면에서 똑같이 생겼다. 백테스트 손익
              차트가 같은 이유로 같은 선을 쓴다(`LinkedCharts.tsx:307`). */}
          <ReferenceLine dataY={0} yAxisId={panel.id} />
          {data.map((l) => (
            <Line key={l.key} seriesId={l.key} curve="linear" strokeWidth={1.5} strokeOpacity={0.9} />
          ))}
        </CartesianChart>
      </Box>

      {/* 선이 둘 이상일 때만 범례가 필요하다. 하나짜리 칸에 범례를 달면
          제목을 두 번 적는 셈이다. */}
      {data.length > 1 ? (
        <HStack gap={2} paddingX={1.5} paddingBottom={1} flexWrap="wrap">
          {data.map((l) => (
            <HStack key={l.key} gap={0.75} alignItems="center">
              {/* 색은 CSS 변수로 넘긴다 — 인라인 `background` 는 팔레트가 컴포넌트로
                  새는 통로라 이 리포가 막는다(CLAUDE.md §1). */}
              <Box
                className="sr-irf-swatch"
                style={{ '--sr-irf-swatch-color': l.color } as React.CSSProperties}
              />
              <Text as="span" font="legal" color="fgMuted" noWrap>
                {l.label}
              </Text>
            </HStack>
          ))}
        </HStack>
      ) : null}

      {panel.note ? (
        <Text as="p" font="legal" color="fgMuted" paddingX={1.5} paddingBottom={1}>
          {panel.note}
        </Text>
      ) : null}
    </VStack>
  );
}

export function IrfPanels({ diffs }: { diffs: Diffs }) {
  const [experiment, setExperiment] = useState<'paper' | 'knobs'>('paper');
  const paperDiffs = useMemo(() => combineCoefs(BASIS, PAPER_IRF_COEFS), []);
  const shown = experiment === 'paper' ? paperDiffs : diffs;

  return (
    <VStack gap={2} width="100%">
      <HStack gap={2} alignItems="baseline" justifyContent="space-between" flexWrap="wrap">
        <VStack gap={0.5}>
          <Text as="h3" font="label1" color="fgMuted" noWrap>
            충격이 무엇을 건드리나
          </Text>
          <Text as="span" font="legal" color="fgMuted">
            {experiment === 'paper'
              ? '논문 Figure 18 의 실험이에요 — 기준금리를 한 분기만 +25bp 올리고, 그 뒤로는 준칙에 맡겨요.'
              : '왼쪽에 놓은 손잡이 그대로예요. 기준금리 여덟 분기는 못 박은 값이라 준칙이 안 움직여요.'}
          </Text>
        </VStack>
        <SegmentedTabs
          accessibilityLabel="논문 실험 · 내 시나리오"
          tabs={EXPERIMENTS}
          activeTab={EXPERIMENTS.find((t) => t.id === experiment) ?? null}
          onChange={(t) => t && setExperiment(t.id)}
        />
      </HStack>

      <Box className="sr-irf-grid">
        {PANELS.map((p) => (
          <IrfPanel key={p.id} panel={p} diffs={shown} />
        ))}

        {/* 여덟 번째 칸. 비어 있는 이유를 칸 자리에서 말한다 — 각주로 내리면
            «논문에는 여덟 칸인데 왜 일곱이지» 가 답 없이 남는다. */}
        <VStack gap={1} className="sr-irf-panel sr-irf-absent" justifyContent="center" padding={1.5}>
          <Text as="h4" font="label2" color="fgMuted" noWrap>
            명목 가계부채
          </Text>
          <Text as="p" font="legal" color="fgMuted">
            논문에는 조원 단위로 있는 칸이에요. 여기서는 못 그려요 — 이 모형이 푸는 건
            <b> 부채와 GDP 의 비율</b>이라(식 44), 잔액 자체는 편차로 존재하지 않아요.
            레벨을 지어내는 대신 비워 둬요.
          </Text>
        </VStack>
      </Box>

      <Text as="p" font="legal" color="fgMuted">
        가로축은 분기예요. 세로축은 전부 <b>아무 일도 없었을 때 대비</b>한 차이고, 레벨이 아니에요.
        논문 값은 본문 37~38쪽이 서술한 최대 반응이에요.
      </Text>
    </VStack>
  );
}
