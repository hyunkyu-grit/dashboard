'use client';

/* 정책 경로 시나리오 — Lab 의 두 번째 세입자.
 *
 * BIGFOOT(`project_bigfoot` v1.7-lab)의 시나리오 랩을 v2 어법으로 다시 세운 화면이다.
 * 계산은 `lab/scenario/` 가 이미 지고 있고(구운 선형 기저 + 앵커), 이 파일은 **보여
 * 주는 일만** 한다.
 *
 * ── 이 화면이 답하는 질문 ───────────────────────────────────────────────────
 * "이 금통위 경로가 프라이싱되면 커브는 어디가 정합인가."
 *
 * 확률 진술이 아니다. 팬차트도 확률 가중도 없고, 그래서 «맞을 확률» 을 묻지 않는다.
 *
 * ── 골격은 Simulation 것이다 [재작업 2026-08-20] ────────────────────────────
 * 첫 판은 한 장짜리 세로 스택이었다. 치수(카드 문법·타이포 사다리)는 맞췄는데
 * **형태가 이 앱이 아니었다** — 다른 창들을 나란히 띄워 보고서야 보였다.
 *
 * 이 화면이 하는 일은 시뮬레이션과 같은 종류다(손잡이 → 결과). 그래서 골격도
 * 같다: **좌 설정 열 / 우 결과**, 컨트롤은 작은 상자와 알약, 고급 손잡이는 접이에
 * 넣고 접힌 줄이 설정값을 말한다. 설정 카드 셋(`ui/ControlCard.tsx`)은 시뮬과
 * 같은 것을 쓴다 — 두 벌을 두면 한쪽만 고쳐지는 날이 온다.
 *
 * 결론은 **먼저 크게** 말한다(Strategy 의 히어로 문법). 첫 판은 이 화면의 답인
 * `Δ vs 시장` 이 표 맨 오른쪽 13px 글자에 숨어 있었다.
 *
 * ── 읽는 자리 ──────────────────────────────────────────────────────────────
 *   시나리오 − 현재      전망
 *   모형 Δ − 시장 캐리    **트레이드**
 *
 * 전망이 맞아도 시장이 이미 그만큼 프라이싱했으면 포지션이 없다. 실측 2026-08-19
 * 로 손잡이를 하나도 안 건드린 상태의 3Y 가 −24bp 다 — 시장이 인상 사이클을
 * 프라이싱하고 있어서 «동결» 이 그 자체로 리시브다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Select } from '@coinbase/cds-web/alpha/select';
import { Chip } from '@coinbase/cds-web/chips';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { SegmentedTabs } from '@coinbase/cds-web/tabs';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { Text } from '@coinbase/cds-web/typography';

import type { PolicyStep } from '@/lib/api';
import { fmtBp, fmtLevel } from '@/lib/format';
import { ControlCard, ControlCollapsible, Field } from '@/ui/ControlCard';
import { ErrorState, LoadingState } from '@/ui/DataState';
import { DROPDOWN_STYLES } from '@/ui/window/popup';

import { fetchScenarioAnchors, ScenarioUnavailable, type AnchorsPayload } from './scenario/api';
import { assembleRows, type ScenarioRow } from './scenario/assemble';
import { BASIS, ZERO_KNOBS, combine, outOfDomain, type Knobs } from './scenario/combine';
import { ModelExplainer } from './scenario/ModelExplainer';
import { PRESETS, knobsFromPreset, matchPreset, type PresetId } from './scenario/presets';

/** 8개 점이 덮는 분기 수. 기저가 정한다 — 여기서 늘릴 수 없다. */
const PINNED_Q = 8;

/** 결론을 말하는 테너. 원본의 헤드라인 문장도 IRS 3y 12개월을 읽는다. */
const HEADLINE_TENOR = '3y';

/** 프리셋 탭. **모듈 상수**여야 한다 — `SegmentedTabs` 는 `activeTab` 을 객체
 * 신원으로 비교하므로 렌더마다 새 배열을 만들면 활성 표시가 흔들린다
 * (`sim/CurvePreview.tsx` 가 같은 자리에 같은 주석을 달아 두었다). */
const PRESET_TABS = [
  ...PRESETS.map((p) => ({ id: p.id, label: p.label })),
  { id: 'custom' as const, label: '직접' },
];

/** 결과 카드의 두 얼굴. 모듈 상수인 이유는 프리셋 탭과 같다 — `SegmentedTabs` 는
 * 객체 신원으로 비교한다. */
const VIEW_TABS = [
  { id: 'result' as const, label: '결과' },
  { id: 'model' as const, label: '모형' },
];

const TENOR_LABEL: Record<string, string> = {
  '1y': '1Y',
  '2y': '2Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
};

/* 손잡이 눈금. 전부 기저의 `domain` 안이다 — 밖을 고를 수 있게 두면 화면이
 * «여기부터 외삽» 이라고 말하기 전에 사용자가 이미 밖에 나가 있다. */
const STEP_BP = [50, 25, 0, -25, -50];
const CPI_PP = [1, 0.75, 0.5, 0.25, 0, -0.25, -0.5, -0.75, -1];
const GAP_PP = CPI_PP;
const EXPORTS_PCT = [0, -2.5, -5, -7.5, -10];
const OIL_PCT = [20, 15, 10, 5, 0, -5, -10, -15, -20];

/** 부호 있는 값의 방향 클래스. `format.dirClass` 는 CSS 에 없는 `text-*` 를
 * 돌려주므로(실측 2026-08-20) 살아 있는 쪽을 쓴다. */
function dirCls(v: number | null): string | undefined {
  if (v == null || v === 0) return undefined;
  return v > 0 ? 'sr-up' : 'sr-down';
}

function dirAttr(v: number | null): 'up' | 'down' | undefined {
  if (v == null || v === 0) return undefined;
  return v > 0 ? 'up' : 'down';
}

const bpLabel = (v: number) => (v === 0 ? '0' : fmtBp(v).replace('.0', ''));
const ppLabel = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v)}pp`);
const pctLabel = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`);

/** 눈금 하나를 고르는 작은 상자. 컨트롤 값 13px·등고 32 규칙을 여기서 한 번 진다. */
function StepSelect({
  label,
  value,
  options,
  format,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <Select
      size="s"
      font="legal"
      styles={DROPDOWN_STYLES}
      accessibilityLabel={label}
      value={String(value)}
      onChange={(v) => v != null && onChange(Number(v))}
      options={options.map((o) => ({ value: String(o), label: format(o) }))}
    />
  );
}

/* ── 분기 격자 ────────────────────────────────────────────────────────────────
 *
 * **8분기는 2년이고 금통위는 연 8회다.** 점 여덟 개를 그냥 늘어놓으면 읽는 사람이
 * "금통위 여덟 번 = 1년" 으로 세고 기간을 두 배로 잘못 읽는다. 그래서 칸마다 그
 * 분기에 실제로 있는 회의 날짜를 적는다 — 격자의 뜻을 화면이 말하게 한다. */
type Quarter = { label: string; meetings: string[] };

function quarterOf(iso: string): { y: number; q: number } {
  return { y: Number(iso.slice(0, 4)), q: Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1 };
}

function buildQuarters(asof: string, upcoming: string[]): Quarter[] {
  const start = quarterOf(asof);
  const out: Quarter[] = [];
  for (let i = 0; i < PINNED_Q; i += 1) {
    const abs = start.y * 4 + (start.q - 1) + i;
    const y = Math.floor(abs / 4);
    const q = (abs % 4) + 1;
    out.push({
      label: `${y}Q${q}`,
      meetings: upcoming
        .filter((d) => {
          const dq = quarterOf(d);
          return dq.y === y && dq.q === q;
        })
        .map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`),
    });
  }
  return out;
}

const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/* ── 화면 ──────────────────────────────────────────────────────────────────── */

export function ScenarioPage({ policy }: { policy?: PolicyStep }) {
  const [anchors, setAnchors] = useState<AnchorsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [knobs, setKnobs] = useState<Knobs>(ZERO_KNOBS);
  /* 「모형」 탭이 있는 이유 [OWNER, 2026-08-20]: 이 숫자는 우리가 만든 모형이
     아니라 경제학자들이 세워 둔 것을 빌려 쓴 결과다. 무엇을 빌렸는지 말할 수
     없으면 화면은 트레이더에게 «믿거나 말거나» 를 요구하는 셈이다. */
  const [view, setView] = useState<'result' | 'model'>('result');

  const load = useCallback(async () => {
    setRetrying(true);
    try {
      setAnchors(await fetchScenarioAnchors());
      setError(null);
      setUnavailable(false);
    } catch (e) {
      if (e instanceof ScenarioUnavailable) setUnavailable(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const diffs = useMemo(() => combine(BASIS, knobs), [knobs]);
  const rows = useMemo(() => (anchors ? assembleRows(anchors, diffs) : []), [anchors, diffs]);
  const preset = matchPreset(knobs);
  const outside = outOfDomain(BASIS, knobs);

  const patch = useCallback((p: Partial<Knobs>) => setKnobs((k) => ({ ...k, ...p })), []);
  const setQuarter = useCallback(
    (i: number, v: number) =>
      setKnobs((k) => {
        const next = [...k.policyBp];
        next[i] = v;
        return { ...k, policyBp: next };
      }),
    [],
  );

  if (unavailable) {
    return (
      <VStack className="sr-card" width="100%" padding={2} gap={0.5}>
        <Text as="h2" font="label1">
          정책 경로 시나리오
        </Text>
        <Text as="p" font="legal" color="fgMuted">
          이 화면은 오늘의 커브가 있어야 서요. 백엔드가 떠 있는지 확인해 주세요.
        </Text>
      </VStack>
    );
  }
  if (error) {
    return (
      <ErrorState
        what="시나리오 앵커"
        detail={error}
        onRetry={() => void load()}
        retrying={retrying}
      />
    );
  }
  if (!anchors) return <LoadingState what="시나리오 앵커" />;

  const quarters = buildQuarters(anchors.asof, policy?.upcoming ?? []);
  const pathSummary = knobs.policyBp.map((v) => (v === 0 ? '0' : bpLabel(v))).join('·');
  const domesticOn = knobs.cpiPp !== 0 || knobs.gapPp !== 0 || knobs.exportsPct !== 0;
  const foreignOn = knobs.oilPct !== 0;

  return (
    <HStack gap={2} width="100%" alignItems="stretch" flexGrow={1} minHeight={0}>
      {/* ── 설정 열 ────────────────────────────────────────────────────────
          시뮬과 같은 clamp 다. 넓어져야 하는 것은 결과 쪽이지 손잡이가 아니다. */}
      <VStack
        gap={1.5}
        flexShrink={0}
        style={{ width: 'clamp(320px, 22vw, 420px)', overflowY: 'auto', minHeight: 0 }}
      >
        <ControlCard
          title="시나리오"
          aside={
            <Text as="span" font="legal" color="fgMuted" noWrap>
              {preset ? (PRESETS.find((p) => p.id === preset)?.label ?? '') : '직접'}
            </Text>
          }
        >
          <SegmentedTabs
            accessibilityLabel="프리셋"
            tabs={PRESET_TABS}
            activeTab={PRESET_TABS.find((t) => t.id === (preset ?? 'custom')) ?? null}
            onChange={(t) => {
              if (t && t.id !== 'custom') setKnobs(knobsFromPreset(t.id as PresetId));
            }}
          />
          {/* 씨앗이지 주장이 아니다 — 하나를 골라도 그 순간부터 내 경로다. */}
          <Text as="p" font="legal" color="fgMuted">
            {preset
              ? PRESETS.find((p) => p.id === preset)?.blurb
              : '손으로 고친 경로예요. 프리셋을 누르면 그 씨앗으로 돌아가요.'}
          </Text>
        </ControlCard>

        {/* 접힌 줄이 여덟 분기를 다 말한다 — 펼쳐야만 알 수 있으면 설정한 경로가
            조용히 잊힌다. */}
        <ControlCollapsible title="기준금리 경로" summary={pathSummary}>
          <Text as="p" font="legal" color="fgMuted">
            그 분기에 기준금리가 어디 있는지를 놓아요. 0은 동결이고, 값을 그대로 두면
            그 수준을 유지한다는 뜻이에요.
          </Text>
          {quarters.map((q, i) => (
            <HStack key={q.label} gap={1} alignItems="center" width="100%">
              <VStack gap={0} minWidth={0} flexGrow={1}>
                <Text as="span" font="legal" noWrap>
                  {q.label}
                </Text>
                <Text as="span" font="legal" color="fgMuted" noWrap>
                  {q.meetings.length > 0 ? `금통위 ${q.meetings.join(' · ')}` : '금통위 없음'}
                </Text>
              </VStack>
              <Box width={96} flexShrink={0}>
                <StepSelect
                  label={`${q.label} 기준금리 레벨`}
                  value={knobs.policyBp[i] ?? 0}
                  options={STEP_BP}
                  format={bpLabel}
                  onChange={(v) => setQuarter(i, v)}
                />
              </Box>
            </HStack>
          ))}
        </ControlCollapsible>

        <ControlCollapsible
          title="국내 지표"
          summary={
            domesticOn
              ? [
                  knobs.cpiPp !== 0 ? `CPI ${ppLabel(knobs.cpiPp)}` : '',
                  knobs.gapPp !== 0 ? `갭 ${ppLabel(knobs.gapPp)}` : '',
                  knobs.exportsPct !== 0 ? `수출 ${pctLabel(knobs.exportsPct)}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '없음'
          }
        >
          <Text as="p" font="legal" color="fgMuted">
            네 분기에 걸친 충격이에요. 켜면 준칙이 반응하는데, 8분기 경로는 내가 놓은
            자리에 그대로 있어요.
          </Text>
          <HStack gap={1.5} alignItems="flex-end" flexWrap="wrap">
            <Box width={104}>
              <Field label="CPI">
                <StepSelect
                  label="CPI 충격"
                  value={knobs.cpiPp}
                  options={CPI_PP}
                  format={ppLabel}
                  onChange={(v) => patch({ cpiPp: v })}
                />
              </Field>
            </Box>
            <Box width={104}>
              <Field label="GDP 갭">
                <StepSelect
                  label="GDP 갭 충격"
                  value={knobs.gapPp}
                  options={GAP_PP}
                  format={ppLabel}
                  onChange={(v) => patch({ gapPp: v })}
                />
              </Field>
            </Box>
            <Box width={104}>
              <Field label="수출">
                <StepSelect
                  label="수출 충격"
                  value={knobs.exportsPct}
                  options={EXPORTS_PCT}
                  format={pctLabel}
                  onChange={(v) => patch({ exportsPct: v })}
                />
              </Field>
            </Box>
          </HStack>
        </ControlCollapsible>

        <ControlCollapsible
          title="대외"
          summary={
            foreignOn
              ? `유가 ${pctLabel(knobs.oilPct)}`
              : '없음'
          }
        >
          {/* Fed 손잡이는 내려 두었다 — 미국 기저가 400배 어긋나 있다
              (`scenario/combine.ts` 의 `US_BASES_USABLE`). 400배 틀린 숫자를 내는
              손잡이는 없는 것보다 나쁘다. */}
          <Text as="p" font="legal" color="fgMuted">
            Fed 손잡이는 지금 내려 뒀어요. 미국 쪽 기저가 엔진의 다른 산출물과 크게
            어긋나 있어서, 고치고 다시 구운 뒤에 올릴게요.
          </Text>
          <HStack gap={1.5} alignItems="flex-end" flexWrap="wrap">
            <Box width={104}>
              <Field label="유가">
                <StepSelect
                  label="유가 충격"
                  value={knobs.oilPct}
                  options={OIL_PCT}
                  format={pctLabel}
                  onChange={(v) => patch({ oilPct: v })}
                />
              </Field>
            </Box>
          </HStack>
        </ControlCollapsible>
      </VStack>

      {/* ── 결과 ──────────────────────────────────────────────────────────── */}
      <VStack className="sr-card" flexGrow={1} minWidth={0} minHeight={0}>
        <VStack gap={1} paddingX={2} paddingTop={2} paddingBottom={1.5}>
          <HStack gap={1.5} alignItems="center" width="100%" flexWrap="wrap">
            <Text as="h2" font="label1" noWrap>
              정책 경로 시나리오
            </Text>
            <SegmentedTabs
              accessibilityLabel="결과 또는 모형"
              tabs={VIEW_TABS}
              activeTab={VIEW_TABS.find((t) => t.id === view) ?? null}
              onChange={(t) => t && setView(t.id)}
            />
            <HStack gap={1} alignItems="baseline" style={{ marginInlineStart: 'auto' }}>
              {outside ? (
                <Chip size="xs" accessibilityLabel="검증 영역 밖 — 결과가 선형 외삽이에요">
                  검증 영역 밖
                </Chip>
              ) : null}
              <Text as="span" font="legal" color="fgMuted" noWrap>
                커브 {anchors.asof} · 기저 {BASIS.as_of} ·{' '}
                {anchors.base == null ? '기준금리 —' : `기준금리 ${anchors.base.toFixed(2)}%`}
              </Text>
            </HStack>
          </HStack>

          {view === 'result' ? <Verdict rows={rows} /> : null}
        </VStack>

        <VStack
          gap={2}
          paddingX={2}
          paddingBottom={2}
          minWidth={0}
          flexGrow={1}
          minHeight={0}
          style={{ overflowY: 'auto' }}
        >
          {view === 'result' ? (
            <>
              <ResultTable rows={rows} curveLastTenorY={anchors.curveLastTenorY} />
              <PathStrip iKr={diffs.i_kr} />
              <Ledger anchors={anchors} outside={outside} />
            </>
          ) : (
            <ModelExplainer />
          )}
        </VStack>
      </VStack>
    </HStack>
  );
}

/* ── 결론 ───────────────────────────────────────────────────────────────────
 *
 * 이 화면의 답이 표 맨 오른쪽 13px 글자에 숨어 있었다(첫 판). Strategy 가 랭킹
 * 1등을 히어로로 먼저 말하는 것과 같은 이유로, 여기서도 답이 먼저 선다. */
function Verdict({ rows }: { rows: ScenarioRow[] }) {
  const r = rows.find((x) => x.tenor === HEADLINE_TENOR) ?? rows[0];
  if (!r) return null;
  const vs = r.vsMarketBp;
  const label = TENOR_LABEL[r.tenor] ?? r.tenor;

  return (
    <VStack gap={0} width="100%">
      <Text as="span" font="label1" color="fgMuted" noWrap>
        {vs == null
          ? '이 경로면'
          : Math.abs(vs) < 1
            ? '이 경로면 시장과 거의 같아요'
            : '이 경로면 시장과 이만큼 달라요'}
      </Text>
      <HStack gap={1.5} alignItems="baseline" flexWrap="wrap">
        <Text as="span" font="display3" noWrap>
          {label} <span className={dirCls(vs)}>{vs == null ? '—' : `${fmtBp(vs)}bp`}</span>
        </Text>
        <Text as="span" font="legal" color="fgMuted" noWrap>
          모형 {fmtBp(r.deltaBp)}bp · 시장 캐리 {fmtBp(r.marketCarryBp)}bp
          {vs != null ? ` · ${vs < 0 ? '리시브 쪽' : '페이 쪽'}` : ''}
        </Text>
      </HStack>
    </VStack>
  );
}

/* ── 결과 표 ────────────────────────────────────────────────────────────────
 *
 * 표는 **카드를 꽉 채운다** — Main·Strategy 가 그렇다. 첫 판은 780px 로 묶어
 * 오른쪽이 텅 비었는데, 그건 이 앱의 표가 아니라 문서의 표였다. */
function ResultTable({
  rows,
  curveLastTenorY,
}: {
  rows: ScenarioRow[];
  curveLastTenorY: number;
}) {
  const anyMissing = rows.some((r) => r.marketCarryBp === null);
  return (
    <VStack gap={1} minWidth={0} width="100%">
      <Box overflow="auto" width="100%">
        <Table tableLayout="auto">
          <TableHeader>
            <TableRow>
              <TableCell as="th" scope="col">
                <Text as="span" font="legal" color="fgMuted">
                  테너
                </Text>
              </TableCell>
              {['현재', '시나리오 12M', 'Δ 전망', '시장 캐리', 'Δ vs 시장'].map((h) => (
                <TableCell as="th" scope="col" key={h} justifyContent="flex-end">
                  <Text as="span" font="legal" color="fgMuted" noWrap>
                    {h}
                  </Text>
                </TableCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.tenor}>
                {/* 행이 두 줄이다 — 주값 아래 보조값. Main·Strategy 의 행 문법. */}
                <TableCell>
                  <VStack gap={0} minWidth={0}>
                    <Text as="span" font="label2" noWrap>
                      {TENOR_LABEL[r.tenor] ?? r.tenor}
                    </Text>
                    <Text as="span" font="legal" color="fgMuted" noWrap>
                      {r.marketCarryBp === null
                        ? '포워드 없음'
                        : r.live
                          ? '호가 노드'
                          : '보간 노드'}
                    </Text>
                  </VStack>
                </TableCell>
                <TableCell justifyContent="flex-end">
                  <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
                    {fmtLevel(r.spot, '%')}
                  </Text>
                </TableCell>
                <TableCell justifyContent="flex-end">
                  <Text as="span" font="label2" tabularNumbers noWrap>
                    {fmtLevel(r.scenario12m, '%')}
                  </Text>
                </TableCell>
                <TableCell justifyContent="flex-end">
                  <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
                    {fmtBp(r.deltaBp)}
                  </Text>
                </TableCell>
                <TableCell justifyContent="flex-end">
                  <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
                    {fmtBp(r.marketCarryBp)}
                  </Text>
                </TableCell>
                {/* 판정이 실린 칸은 칠한다 — Main 의 변화 칸, Strategy 의 Score 와
                    같은 문법. 잉크 색만으로는 «여기가 답» 이라고 못 말한다. */}
                <TableCell justifyContent="flex-end">
                  <span className="sr-scn-vs" data-dir={dirAttr(r.vsMarketBp)}>
                    <Text
                      as="span"
                      font="label2"
                      tabularNumbers
                      noWrap
                      className={dirCls(r.vsMarketBp)}
                    >
                      {fmtBp(r.vsMarketBp)}
                    </Text>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Text as="span" font="legal" color="fgMuted">
        Δ 전망은 오늘 대비, Δ vs 시장은 시장이 이미 프라이싱한 12개월 이동 대비예요.
        전망이 맞아도 시장이 그만큼 프라이싱했으면 자리가 없어요.
        {anyMissing
          ? ` 10Y는 커브가 ${curveLastTenorY}년에서 끝나 12개월 포워드를 못 만들어요 — 비운 자리는 0이 아니에요.`
          : ''}
      </Text>
    </VStack>
  );
}

/* ── 24분기 스트립 ──────────────────────────────────────────────────────────── */

function PathStrip({ iKr }: { iKr: number[] }) {
  const max = Math.max(0.05, ...iKr.map((v) => Math.abs(v)));
  return (
    <VStack gap={1} minWidth={0} width="100%">
      <HStack gap={1} alignItems="baseline" flexWrap="wrap">
        <Text as="span" font="caption" color="fgMuted">
          모형이 보는 기준금리 24분기
        </Text>
        <Text as="span" font="legal" color="fgMuted">
          앞 여덟 칸은 내가 고정한 자리고, 그 뒤는 준칙이 도로 가져가는 자리예요
        </Text>
      </HStack>
      {/* 네이티브 `div` 다. CDS `Box` 는 아토믹 클래스로 `display:flex` 를 심는데
          런타임 주입이라 소스 순서에서 이 파일의 `display:grid` 를 덮는다 —
          첫 판이 정확히 그렇게 무너졌다(실측: 격자가 통째로 접혔다). */}
      <div className="sr-scn-strip" aria-hidden>
        {iKr.map((v, i) => {
          const dir = v > 1e-9 ? 'up' : v < -1e-9 ? 'down' : 'flat';
          const h = `${Math.min(100, (Math.abs(v) / max) * 100)}%`;
          return (
            <div key={i} className={`sr-scn-col${i < PINNED_Q ? ' sr-scn-pinned' : ''}`}>
              <div>
                {dir === 'up' ? (
                  <div
                    className="sr-scn-bar"
                    data-dir="up"
                    style={{ '--h': h } as React.CSSProperties}
                  />
                ) : null}
              </div>
              <div>
                {dir !== 'up' ? (
                  <div
                    className="sr-scn-bar"
                    data-dir={dir}
                    style={{ '--h': dir === 'flat' ? '2px' : h } as React.CSSProperties}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* 스크린리더는 막대를 못 읽는다 — 되받아침의 크기를 문장으로 준다. */}
      <Text as="span" font="legal" color="fgMuted">
        고정 구간 평균 {fmtBp(avg(iKr.slice(0, PINNED_Q)) * 100)}bp · 그 뒤 평균{' '}
        {fmtBp(avg(iKr.slice(PINNED_Q)) * 100)}bp
      </Text>
    </VStack>
  );
}

/* ── 원장 줄 ────────────────────────────────────────────────────────────────── */

/** `FLAG_NAME: 문장` 에서 문장만. 플래그는 페이로드의 이름이지 사람이 읽을 말이
 * 아니다 — 화면에 그대로 나가면 서버 내부 어휘가 트레이더 앞에 선다. */
function caveatText(c: string): string {
  const i = c.indexOf(': ');
  return i > 0 && /^[A-Z0-9_]+$/.test(c.slice(0, i)) ? c.slice(i + 2) : c;
}

function Ledger({ anchors, outside }: { anchors: AnchorsPayload; outside: boolean }) {
  return (
    <VStack gap={0.5} minWidth={0} width="100%">
      <Text as="span" font="legal" color="fgMuted">
        확률이 아니라 가격결정 질문이에요 — 이 경로가 프라이싱되면 커브는 어디가 정합인가.
      </Text>
      <Text as="span" font="legal" color="fgMuted">
        {outside ? '지금 손잡이는 커널이 맞춰진 범위 밖이라 결과가 선형 외삽이에요. ' : ''}
        {anchors.caveats.map(caveatText).join(' · ')}
      </Text>
    </VStack>
  );
}
