'use client';

/* 기저 충격반응 — **손잡이를 거치지 않은 날것**.
 *
 * ## 왜 이 화면이 있어야 했나
 *
 * 2026-08-21 에 기저를 다시 구웠는데, 앱이 보여주는 것은 손잡이로 만든 편차뿐
 * 이었다. 그래서 화면만 봐서는 **리베이크가 뭘 바꿨는지 알 수가 없었다.**
 * 여기는 기저 그 자체를 그린다.
 *
 * ## 참조선은 `paper_anchors.json` 에서만 온다
 *
 * 논문 본문이 문장으로 적어 둔 최대 반응값이다. Figure 18~20 은 인쇄 해상도에서
 * 디지타이즈가 안 되므로 **그림에서 눈으로 읽은 값은 여기 안 들어간다.**
 * 숫자를 이 파일에 적지 않는 이유가 그것이다 — 적는 순간 출처가 코드가 된다.
 *
 * ## 지평을 맞춰야 한다
 *
 * 논문의 미국 실험은 «+25bp 를 한 분기, 그 뒤 준칙 복귀» 이고, 기저 `us_2q` 는
 * «+100bp 를 두 분기 유지» 다. **다른 실험이다.** 배율로 맞춰 겹치면 부호까지
 * 뒤집힌 대조가 나온다(실측: kr10y −0.18 vs 논문 +0.06). 그래서 미국 기저에는
 * 참조선을 안 긋고, 왜 안 긋는지 화면이 말한다.
 */

import type React from 'react';
import { useMemo, useState } from 'react';

import { Chip } from '@coinbase/cds-web/chips';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { SegmentedTabs } from '@coinbase/cds-web/tabs';
import { Text } from '@coinbase/cds-web/typography';
import {
  CartesianChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from '@coinbase/cds-web/visualizations/chart';

import { anchorProps, ANCHORS } from '../anchors';
import type { PaperAnchors } from '../contracts';
import basisJson from '../artifacts/scenario_basis.json';
import anchorsJson from '../artifacts/paper_anchors.json';

import { Emph } from './emph';
import oldBasisJson from './basis_pre_0821.json';

const ANCHORS_DATA = anchorsJson as unknown as PaperAnchors;

type BasisEntry = Record<string, number[]>;
const BASES = (basisJson as unknown as { bases: Record<string, BasisEntry> }).bases;
const OLD = oldBasisJson as unknown as {
  bases: Record<string, BasisEntry>;
  as_of: string;
  why: string;
  source: string;
};

/** 논문 Figure 18 의 가로축에 맞춘다. 기저는 24 를 들고 있다. */
const QUARTERS = 20;
/** 캐논 여백(`ui/PreviewPane.tsx::CHART_INSET`) — 나란히 서는 차트끼리 여백이
 * 다르면 플롯 상자가 어긋나 보인다. 2026-08-25 감사 전까지 이 파일만 네 변이
 * 전부 달랐다(`{10,10,20,6}`) — 근거 없는 이탈이었다.
 *
 * 바닥만 28 로 캐논(8)에서 벗어난다: 이 차트는 x 눈금에 라벨이 선다(분기).
 * 같은 사정의 `lab/scenario/ModelChart.tsx` 가 이미 그 값을 실측해 뒀다 —
 * 8 로 두면 y 축 맨 아래 눈금이 x 축 라벨과 같은 줄에 겹친다. */
const INSET = { top: 16, right: 12, bottom: 28, left: 8 };

const INK = 'var(--color-fg)';
const AMBER = 'var(--sr-ref-cd)';
const PURPLE = 'var(--sr-ref-policy)';

type Series = { key: string; label: string; color: string };
type Panel = { id: string; title: string; unit: string; lines: Series[]; note?: string };

/* 칸 순서와 이름은 논문 Figure 18 의 것이다. */
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
  },
  {
    id: 'fx',
    title: '원/달러',
    unit: '%',
    lines: [{ key: 's', label: '원/달러', color: INK }],
    note: '논문 칸은 원화 금액이고 이 칸은 퍼센트예요. 같은 것을 다른 자로 재요.',
  },
  { id: 'gap', title: 'GDP 갭', unit: '%p', lines: [{ key: 'y_gap', label: 'GDP 갭', color: INK }] },
  {
    id: 'cpi',
    title: '소비자물가 전년동기',
    unit: '%p',
    lines: [{ key: 'cpi_yoy', label: 'CPI YoY', color: INK }],
  },
  {
    id: 'trade',
    title: '수출과 수입',
    unit: '%',
    lines: [
      { key: 'x', label: '수출', color: INK },
      { key: 'm', label: '수입', color: AMBER },
    ],
  },
  { id: 'hpi', title: '주택가격', unit: '%', lines: [{ key: 'hpi', label: '주택가격', color: INK }] },
  {
    id: 'debt',
    title: '가계부채 / GDP',
    unit: '%p',
    lines: [{ key: 'debt', label: '부채/GDP', color: INK }],
  },
];

/** 기저 하나가 논문의 어느 충격에 **정확히** 대응하나. `null` 이면 대응 없음. */
const SHOCK_OF: Record<string, string | null> = {
  policy_q1: 'kr_policy_25bp',
  oil: 'oil_10pct',
};

const BASIS_TABS = [
  { id: 'policy_q1', label: '정책 +25bp' },
  { id: 'oil', label: '유가 +10%' },
  { id: 'us_2q', label: '미국 +100bp×2q' },
  { id: 'cpi', label: 'CPI +0.5pp' },
  { id: 'gap', label: '갭 −0.5pp' },
  { id: 'exports', label: '수출 −5%' },
];

const BASIS_BLURB: Record<string, string> = {
  policy_q1: '그 분기에만 기준금리를 +25bp 얹고, 그 뒤로는 준칙에 맡겨요 — 논문 Figure 18 의 실험 그대로예요.',
  oil: '유가를 +10% 올려요. 유가는 해외 블록마다 산출갭에 음으로 들어가서(식 5), 세계 수요충격처럼 움직여요.',
  us_2q: '미 정책금리를 +100bp 로 두 분기 유지해요. **논문의 미국 실험(+25bp 한 분기)과 다른 실험**이라 참조선을 안 그어요.',
  cpi: 'CPI 를 네 분기 +0.5pp 로 조건 걸어요(필립스 잔차).',
  gap: 'GDP 갭을 네 분기 −0.5pp 로 조건 걸어요(소비 잔차).',
  exports: '수출을 네 분기 −5% 로 조건 걸어요(수출 잔차).',
};

function digits(span: number): number {
  if (span >= 1) return 2;
  if (span >= 0.1) return 3;
  return 4;
}
const fmt = (v: number, d: number) => (v === 0 ? '0' : v.toFixed(d));

function IrfPanel({
  panel,
  now,
  old,
  refs,
}: {
  panel: Panel;
  now: BasisEntry;
  old: BasisEntry | null;
  refs: { value: number; unit: string; panel: string }[];
}) {
  const labels = useMemo(
    () =>
      Array.from({ length: QUARTERS }, (_, i) =>
        i + 1 === 1 || (i + 1) % 5 === 0 ? String(i + 1) : '',
      ),
    [],
  );

  const data = useMemo(
    () =>
      panel.lines
        .filter((l) => Array.isArray(now[l.key]))
        .map((l) => ({ ...l, path: now[l.key].slice(0, QUARTERS) })),
    [panel, now],
  );

  const oldData = useMemo(
    () =>
      old
        ? panel.lines
            .filter((l) => Array.isArray(old[l.key]))
            .map((l) => ({ ...l, path: old[l.key].slice(0, QUARTERS) }))
        : [],
    [panel, old],
  );

  const span = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const d of [...data, ...oldData]) {
      for (const v of d.path) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    for (const r of refs) {
      if (r.value < lo) lo = r.value;
      if (r.value > hi) hi = r.value;
    }
    return Math.max(hi - lo, 1e-6);
  }, [data, oldData, refs]);

  const d = digits(span);

  const series = [
    ...data.map((l) => ({ id: l.key, data: l.path, color: l.color, yAxisId: panel.id })),
    ...oldData.map((l) => ({
      id: `old_${l.key}`,
      data: l.path,
      color: l.color,
      yAxisId: panel.id,
    })),
  ];

  return (
    <VStack gap={0} className="sr-irf-panel">
      <HStack
        gap={1}
        alignItems="baseline"
        justifyContent="space-between"
        paddingX={1.5}
        paddingTop={1.5}
      >
        <Text as="h4" font="label2" noWrap>
          {panel.title}
        </Text>
        <Text as="span" font="legal" color="fgMuted" noWrap>
          {panel.unit}
        </Text>
      </HStack>

      {refs.map((r) => (
        <Text
          key={r.panel}
          as="span"
          font="legal"
          color="fgMuted"
          tabularNumbers
          paddingX={1.5}
          paddingTop={0.5}
        >
          논문 {r.value > 0 ? '+' : ''}
          {r.value}
          {r.unit}
        </Text>
      ))}

      <Box className="sr-plot sr-irf-plot" paddingX={0.5}>
        <CartesianChart
          animate={false}
          height="100%"
          accessibilityLabel={`${panel.title}. ${data
            .map((l) => {
              let best = 0;
              for (const v of l.path) if (Math.abs(v) > Math.abs(best)) best = v;
              return `${l.label} 최대 ${fmt(best, d)}${panel.unit}`;
            })
            .join('. ')}`}
          inset={INSET}
          series={series}
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
          <ReferenceLine dataY={0} yAxisId={panel.id} />
          {refs.map((r) => (
            <ReferenceLine key={r.panel} dataY={r.value} yAxisId={panel.id} />
          ))}
          {oldData.map((l) => (
            <Line
              key={`old_${l.key}`}
              seriesId={`old_${l.key}`}
              curve="linear"
              type="dotted"
              strokeWidth={1}
              strokeOpacity={0.35}
            />
          ))}
          {data.map((l) => (
            <Line key={l.key} seriesId={l.key} curve="linear" strokeWidth={1.5} strokeOpacity={0.9} />
          ))}
        </CartesianChart>
      </Box>

      {data.length > 1 ? (
        <HStack gap={2} paddingX={1.5} paddingBottom={1} flexWrap="wrap">
          {data.map((l) => (
            <HStack key={l.key} gap={0.75} alignItems="center">
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

/** 그 칸이 받을 참조선. **`paper_anchors.json` 이 유일한 출처다.** */
export function referenceLinesFor(
  basisId: string,
  panelId: string,
): { value: number; unit: string; panel: string; page: string }[] {
  const shockId = SHOCK_OF[basisId];
  if (!shockId) return [];
  const shock = ANCHORS_DATA.shocks.find((s) => s.id === shockId);
  if (!shock) return [];
  const VAR_OF: Record<string, string> = {
    gap: 'y_gap',
    cpi: 'cpi_yoy',
    hpi: 'hpi',
    debt: 'debt',
  };
  const want = VAR_OF[panelId];
  if (!want) return [];
  return shock.anchors
    .filter((a) => a.var === want && a.value != null)
    .map((a) => ({
      value: a.value as number,
      unit: a.unit,
      panel: a.panel,
      page: shock.page,
    }));
}

export function BasisIrf() {
  const [basisId, setBasisId] = useState('policy_q1');
  const [showOld, setShowOld] = useState(false);

  const now = BASES[basisId];
  const old = showOld ? (OLD.bases[basisId] ?? null) : null;
  const oldMissing = showOld && !OLD.bases[basisId];
  const shockId = SHOCK_OF[basisId];

  return (
    <VStack gap={1.5} width="100%" {...anchorProps(ANCHORS.model.basisIrf)}>
      <VStack gap={0.5}>
        <Text as="h3" font="label1">
          기저 충격반응 — 손잡이를 안 거친 날것
        </Text>
        <Text as="p" font="legal" color="fgMuted">
          시나리오를 조립하기 전의 단위 충격 그 자체예요. 세로축은 전부{' '}
          <b>아무 일도 없었을 때 대비</b>한 차이고, 레벨이 아니에요.
        </Text>
      </VStack>

      <HStack gap={1.5} alignItems="center" flexWrap="wrap">
        <SegmentedTabs
          accessibilityLabel="기저 고르기"
          tabs={BASIS_TABS}
          activeTab={BASIS_TABS.find((t) => t.id === basisId) ?? null}
          onChange={(t) => t && setBasisId(t.id)}
        />
        <Chip
          size="xs"
          className="sr-chip-toggle"
          aria-pressed={showOld}
          onClick={() => setShowOld(!showOld)}
          accessibilityLabel="8월 21일 이전 기저를 겹쳐 보기"
        >
          순열 과적합(구)
        </Chip>
      </HStack>

      <Text as="p" font="legal" color="fgMuted">
        <Emph t={BASIS_BLURB[basisId]} />
      </Text>

      {showOld ? (
        <Text as="p" font="legal" color="fgMuted">
          <b>흐린 점선이 {OLD.as_of} 판이에요.</b> <Emph t={OLD.why} />
          {oldMissing ? ' 이 기저는 옛 판에 안 담겨 있어요.' : ''}
        </Text>
      ) : null}

      {!shockId ? (
        <Text as="p" font="legal" color="fgMuted">
          이 기저에는 <b>논문 참조선을 안 그어요.</b> 논문의 미국 실험은 «+25bp 를 한
          분기, 그 뒤 준칙 복귀» 인데 이 기저는 «+100bp 를 두 분기 유지» 라 다른
          실험이거든요. 배율로 맞춰 겹치면 부호까지 뒤집힌 대조가 나와요.
        </Text>
      ) : null}

      <Box className="sr-irf-grid">
        {PANELS.map((p) => (
          <IrfPanel
            key={p.id}
            panel={p}
            now={now}
            old={old}
            refs={referenceLinesFor(basisId, p.id)}
          />
        ))}

        <VStack
          gap={1}
          className="sr-irf-panel sr-irf-absent"
          justifyContent="center"
          padding={1.5}
        >
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
        참조선은 논문 본문이 <b>문장으로</b> 적어 둔 최대 반응값이에요
        {shockId
          ? ` (${ANCHORS_DATA.shocks.find((s) => s.id === shockId)?.page})`
          : ''}
        . <Emph t={ANCHORS_DATA.why_text_only} />
      </Text>
    </VStack>
  );
}
