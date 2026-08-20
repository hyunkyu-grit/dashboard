'use client';

/* 「모형」 탭 — 설명하는 대신 보여준다.
 *
 * 첫 판은 글이 너무 많았다 [OWNER, 2026-08-20 — "모형 개복잡해보이는데 더
 * 단순화해서 그래프랑 같이"]. 여섯 절에 표 두 개였고, 읽어야 알 수 있는 화면은
 * 아무도 안 읽는다.
 *
 * 그래서 뒤집었다: **충격을 하나 고르면 모형이 그 충격에 어떻게 반응하는지를
 * 그린다.** 「금통위 경로는 준칙 eq.35 를 덮어쓰고 CD 를 거쳐 IRS 로 간다」 를
 * 문장으로 읽는 것보다, +25bp 를 넣었을 때 기준금리·물가·갭·국고가 24분기 동안
 * 어떻게 움직이는지를 보는 편이 빠르다.
 *
 * 그림은 새 데이터가 필요 없다 — 결과 탭이 쓰는 **같은 기저와 같은 함수**로
 * 나온다(`combine`). 화면이 자기가 쓰는 모형을 자기 코드로 그리는 셈이라, 그림과
 * 숫자가 갈릴 수 없다.
 *
 * ── 남긴 글 ────────────────────────────────────────────────────────────────
 * 도해 넉 줄(무엇을 빌렸나), 출처 목록, 못 하는 것 네 줄. 그 밖은 전부 걷었다 —
 * 손잡이 표 여섯 줄은 그래프가 대신하고, CD 전이 수치와 검증 통계는 한 줄로 접었다.
 */

import { useMemo, useState } from 'react';

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { SegmentedTabs } from '@coinbase/cds-web/tabs';
import { Text } from '@coinbase/cds-web/typography';
import { CartesianChart, Line, XAxis, YAxis } from '@coinbase/cds-web/visualizations/chart';

import { BASIS, impulse } from './combine';

/* ── 충격 다섯 ──────────────────────────────────────────────────────────────
 *
 * Fed 가 빠져 있다. 미국 기저(`us_*`)가 BIGFOOT 자신의 조건부 산출물과 400배
 * 어긋나 있어서다 — `combine.ts` 의 `US_BASES_USABLE` 주석에 실측이 있다. **이 탭이
 * 응답을 그리기 시작하자마자 드러났다** — 그림이 제 몫을 한 셈이다.
 *
 * 크기는 **기저가 담고 있는 단위 충격 그대로**다(`basis_scales`). 여기서 크기를
 * 새로 정하면 그림이 기저와 다른 것을 보여주게 된다. */
const SHOCKS: {
  id: string;
  /** 기저에 저장된 이름. 그 기저가 곧 이 충격의 단위 응답이다. */
  basis: string;
  label: string;
  size: string;
  enters: string;
}[] = [
  {
    id: 'policy',
    label: '금통위',
    size: '한 분기만 +25bp',
    enters: '준칙(eq.35)을 그 분기 동안 덮어써요. 그 뒤엔 준칙이 도로 가져가요.',
    basis: 'policy_q1',
  },
  {
    id: 'cpi',
    label: '물가',
    size: '네 분기 +0.5pp',
    enters: '필립스(eq.23-24)로 들어가요. 준칙이 반응해서 금리가 따라 올라가요.',
    basis: 'cpi',
  },
  {
    id: 'gap',
    label: 'GDP 갭',
    size: '네 분기 −0.5pp',
    enters: '소비·투자 PAC 방정식의 수요 충격이에요. 주택·가계부채도 같이 움직여요.',
    basis: 'gap',
  },
  {
    id: 'exports',
    label: '수출',
    size: '네 분기 −5%',
    enters: '수출 방정식(eq.17)의 잔차로 들어가요. 갭을 거쳐 물가로 번져요.',
    basis: 'exports',
  },
  {
    id: 'oil',
    label: '유가',
    size: '+10%',
    enters: '수입물가(eq.31)의 원유 항이에요. 물가를 밀어 올려요.',
    basis: 'oil',
  },
];

const SHOCK_TABS = SHOCKS.map((s) => ({ id: s.id, label: s.label }));

/** 그림에 세우는 다섯 줄. 단위가 둘이라 그룹을 나눠 적는다. */
const PANELS: { key: 'i_kr' | 'cpi_yoy' | 'y_gap' | 'kr3y' | 'kr10y'; label: string; bp: boolean }[] =
  [
    { key: 'i_kr', label: '기준금리', bp: true },
    { key: 'kr3y', label: '국고 3년', bp: true },
    { key: 'kr10y', label: '국고 10년', bp: true },
    { key: 'cpi_yoy', label: '물가 (YoY)', bp: false },
    { key: 'y_gap', label: 'GDP 갭', bp: false },
  ];

/** 도해 넉 줄. ②와 ③이 남의 모형이라는 사실이 이 도해의 요점이다. */
const FLOW = [
  { head: '① 내가 놓는 것', line: '금통위 경로 · CPI · GDP 갭 · 수출 · 유가' },
  { head: '② 한국 블록', line: '한국은행 WP 2025-3 — 준칙 · 필립스 · UIP · 기간구조' },
  { head: '③ 미국 블록', line: 'IMF QPM 2008 + 연준 FRB/US 기간프리미엄 (손잡이는 내려 둠)' },
  { head: '④ 시장으로', line: '정책 → CD 전이 → 기대 CD 평균 → IRS' },
];

const SOURCES = [
  ['한국 방정식', '한국은행 WP 2025-3 (BOK-LOOK) eq.7~44 · 기대는 Appendix A 위성 VAR'],
  ['조정 동학', '연준 FRB/US 의 PAC(다항조정비용) — 기계만 빌려 한국 방정식에 씌웠어요'],
  ['미국 블록', 'IMF WP/08/278 (Carabenciov 외) 소형 NK 3방정식'],
  ['미국 기간프리미엄', 'pyfrbus 1.1.1 — 연준 FRB/US 의 10년물에 맞춘 12탭 커널'],
  ['정책 → CD', '기준금리 변경 33건(2010-07~2025-05) 이벤트스터디 — 발표일에 55.8%, 나머지는 τ 78.8영업일'],
  ['데이터', '한국은행 ECOS · FRED'],
];

const CANNOT = [
  '확률이 아니에요. «이 경로가 프라이싱되면 커브는 어디가 정합인가» 라는 가격결정 질문이에요.',
  '스왑스프레드에 수급·헤지 플로우가 없어요. 평균회귀만 봐요.',
  '기간프리미엄이 IRS 다리에 안 실려 있어서 장기 테너 예측이 보수적이에요.',
  '기저는 구운 것이라 계수가 그날의 추정이에요. 오늘의 커브만 라이브고요.',
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack gap={1} minWidth={0} width="100%">
      <Text as="h3" font="caption" color="fgMuted">
        {title}
      </Text>
      {children}
    </VStack>
  );
}

/** 응답 한 칸. 선 하나뿐이라 색이 필요 없다 — 잉크로 그리고 진폭을 숫자로 적는다.
 *
 * 여러 변수를 한 축에 겹치면 단위가 섞이고(bp 와 pp), 색을 다섯 개 지어내야 한다.
 * 작은 그림 다섯 장이 그 둘을 다 피한다. */
function Panel({ label, path, bp }: { label: string; path: number[]; bp: boolean }) {
  const scale = bp ? 100 : 1;
  const vals = path.map((v) => v * scale);
  const ext = vals.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const unit = bp ? 'bp' : 'pp';
  return (
    <VStack gap={0.5} minWidth={168} flexGrow={1} flexBasis={0}>
      <HStack gap={1} alignItems="baseline" width="100%">
        <Text as="span" font="legal" color="fgMuted" noWrap>
          {label}
        </Text>
        <Box style={{ marginInlineStart: 'auto' }}>
          <Text as="span" font="legal" tabularNumbers noWrap>
            {ext >= 0 ? '+' : '−'}
            {Math.abs(ext).toFixed(bp ? 1 : 3)}
            {unit}
          </Text>
        </Box>
      </HStack>
      <CartesianChart
        animate={false}
        height={72}
        accessibilityLabel={`${label} 24분기 반응, 최대 ${ext.toFixed(bp ? 1 : 3)}${unit}`}
        inset={{ top: 6, right: 4, bottom: 4, left: 4 }}
        series={[{ id: 'r', data: vals, color: 'var(--color-fg)', yAxisId: 'y' }]}
        xAxis={{ data: vals.map((_, i) => i) }}
        yAxis={[{ id: 'y' }]}
      >
        {/* 눈금 라벨을 끄는 prop 이 없다(`showTickLabels` 는 CDS 에 없음, 실측
            2026-08-20) — 포맷터가 빈 문자열을 돌려주는 것이 그 자리다. */}
        <XAxis showGrid={false} showLine={false} showTickMarks={false} tickLabelFormatter={() => ''} />
        <YAxis
          axisId="y"
          position="right"
          showGrid={false}
          showLine={false}
          showTickMarks={false}
          tickLabelFormatter={() => ''}
        />
        <Line seriesId="r" curve="linear" strokeWidth={1.5} />
      </CartesianChart>
    </VStack>
  );
}

export function ModelExplainer() {
  const [shockId, setShockId] = useState(SHOCKS[0].id);
  const shock = SHOCKS.find((s) => s.id === shockId) ?? SHOCKS[0];
  /* `combine` 이 아니라 `impulse` 다 — 그쪽은 8분기를 내가 놓은 자리에 고정하려고
     정책 계수를 푸는데, 충격반응에서 그러면 «Fed 가 올리는데 한은은 2년간 꿈쩍도
     안 한다» 를 푸는 셈이 된다(실측: 기준금리 +520bp). 기저에 저장된 것은 애초에
     «그 충격에 준칙이 반응한 결과» 라 읽기만 하면 된다. */
  const resp = useMemo(() => impulse(BASIS, shock.basis), [shock]);

  return (
    <VStack gap={3} minWidth={0} width="100%">
      <Section title="충격 하나를 넣으면 모형이 이렇게 반응해요">
        <HStack gap={1.5} alignItems="center" flexWrap="wrap">
          <SegmentedTabs
            accessibilityLabel="충격 종류"
            tabs={SHOCK_TABS}
            activeTab={SHOCK_TABS.find((t) => t.id === shockId) ?? null}
            onChange={(t) => t && setShockId(t.id)}
          />
          <Text as="span" font="legal" color="fgMuted">
            {shock.size}
          </Text>
        </HStack>
        <Text as="p" font="legal" color="fgMuted">
          {shock.enters}
        </Text>
        {/* 가로 24분기. 축 눈금은 안 그린다 — 여기서 읽을 것은 값이 아니라 모양
            이고, 크기는 칸마다 오른쪽 위에 숫자로 적혀 있다. */}
        <HStack gap={2} width="100%" flexWrap="wrap" alignItems="flex-start">
          {PANELS.map((p) => (
            <Panel key={p.key} label={p.label} path={resp[p.key]} bp={p.bp} />
          ))}
        </HStack>
        <Text as="span" font="legal" color="fgMuted">
          가로는 24분기(6년)예요. 크기는 기저에 저장된 단위 충격 그대로고, 금통위는
          준칙이 반응한 결과까지 포함한 값이에요 — 여기서는 경로를 고정하지 않아요.
        </Text>
      </Section>

      <Section title="숫자가 지나오는 길">
        <VStack gap={0} width="100%" className="sr-scn-deftable">
          {FLOW.map((f) => (
            <HStack key={f.head} gap={1.5} width="100%" alignItems="baseline" paddingY={1}>
              <Box width={104} flexShrink={0}>
                <Text as="span" font="label2" noWrap>
                  {f.head}
                </Text>
              </Box>
              <Text as="span" font="legal" color="fgMuted">
                {f.line}
              </Text>
            </HStack>
          ))}
        </VStack>
        <Text as="p" font="legal" color="fgMuted">
          ②와 ③은 우리가 만든 게 아니라 경제학자들이 이미 세워 둔 모형이에요. 우리가
          한 일은 그 둘을 원화 커브에 닿게 이은 거예요.
        </Text>
      </Section>

      <Section title="어디서 빌렸나">
        <VStack gap={0} width="100%" className="sr-scn-deftable">
          {SOURCES.map(([k, v]) => (
            <HStack key={k} gap={1.5} width="100%" alignItems="baseline" paddingY={1}>
              <Box width={104} flexShrink={0}>
                <Text as="span" font="label2" noWrap>
                  {k}
                </Text>
              </Box>
              <Text as="span" font="legal" color="fgMuted">
                {v}
              </Text>
            </HStack>
          ))}
        </VStack>
      </Section>

      <Section title="얼마나 믿나">
        <Text as="p" font="legal" color="fgMuted">
          논문이 보고한 충격반응을 우리 구현이 다시 그리는지로 검사해요 — 한국 준칙
          +25bp · 미국 준칙 +25bp · 유가 +10% 를 넣고 갭·물가·주택·가계부채·소비의
          저점과 고점이 논문 밴드에 드는지 봐요. <b>13개 중 12개 통과</b>, 하나는
          면제로 기록했어요(물가 저점 −0.079pp, 밴드 하한 −0.07 을 살짝 벗어남).
          미국 커널은 100bp × 4분기까지 맞춰졌고 그 밖은 선형 외삽이에요. 기저
          as-of 는 {BASIS.as_of} 예요.
        </Text>
        <Text as="p" font="legal" color="fgMuted">
          논문 표에서 자리가 유일하게 정해지지 않는 계수는 추측하지 않고 비워 둬요 —
          그런 슬롯으로 세운 방정식은 아예 만들어지지 않아요. 위 그림의 금통위
          물가 저점이 −0.079pp 인데, 그게 바로 면제로 기록된 그 값이에요.
        </Text>
        <Text as="p" font="legal" color="fgMuted">
          Fed 손잡이는 내려 뒀어요. 미국 기저가 엔진의 조건부 산출물과 크게 어긋나
          있어요 — 같은 충격에 대해 그쪽은 기준금리 −1.3bp 를 적는데 기저는
          +537bp 를 담고 있어요. 고쳐서 다시 구운 뒤에 올릴게요.
        </Text>
      </Section>

      <Section title="이 화면이 말하지 않는 것">
        <VStack gap={0.5} width="100%">
          {CANNOT.map((t) => (
            <Text key={t} as="span" font="legal" color="fgMuted">
              · {t}
            </Text>
          ))}
        </VStack>
      </Section>
    </VStack>
  );
}
