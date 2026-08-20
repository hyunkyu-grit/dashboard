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
 * 확률 진술이 아니다. 팬차트도 확률 가중도 없고, 그래서 «맞을 확률» 을 묻지
 * 않는다. 원본이 고정 문구로 못 박아 둔 성격을 그대로 승계한다.
 *
 * ── 읽는 자리는 마지막 칸 하나다 ───────────────────────────────────────────
 *   시나리오 − 현재      전망
 *   시나리오 − 시장 캐리  **트레이드**
 *
 * 전망이 맞아도 시장이 이미 그만큼 프라이싱했으면 포지션이 없다. 실측 2026-08-19
 * 로 손잡이를 하나도 안 건드린 상태의 3Y 가 −24bp 다 — 시장이 인상 사이클을
 * 프라이싱하고 있어서 «동결» 이 그 자체로 리시브다. 그래서 표는 모형 Δ 와 시장
 * 캐리를 **나란히** 놓는다: 어느 쪽이 일하고 있는지가 보여야 한다.
 *
 * ── 반드시 같이 그려야 하는 것 ─────────────────────────────────────────────
 * 8개 점은 스텝이 아니라 **레벨**이고, 핀이 끝난 뒤 준칙이 되받아친다. 지속
 * −25bp 인하 경로가 IRS 3y 12개월 **+13.2bp** 를 내는 이유가 그것이다. 표만 두면
 * 도구가 고장 난 것으로 읽히므로 24분기 i_kr 스트립을 옆에 세운다.
 *
 * ── 디자인 얼라인 ──────────────────────────────────────────────────────────
 * 카드 문법·타이포 사다리는 형제 세입자(`ui/Surface3D.tsx`)와 같다: 머리 라벨
 * 14/600 잉크 → 캡션 13/500 muted → 구조 라벨 13/600 muted. 컨트롤 값은 13px,
 * 등고 32(`Select size="s" font="legal"`). 타이포는 신규 문법 `Text font=` 이다
 * (CLAUDE.md — shorthand 는 기존 코드에만 남는다).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Chip } from '@coinbase/cds-web/chips';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Select } from '@coinbase/cds-web/alpha/select';
import { SegmentedTabs } from '@coinbase/cds-web/tabs';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { Text } from '@coinbase/cds-web/typography';

import type { PolicyStep } from '@/lib/api';
import { fmtBp, fmtLevel } from '@/lib/format';
import { DROPDOWN_STYLES } from '@/ui/window/popup';
import { ErrorState, LoadingState } from '@/ui/DataState';

import { fetchScenarioAnchors, ScenarioUnavailable, type AnchorsPayload } from './scenario/api';
import { assembleRows, type ScenarioRow } from './scenario/assemble';
import { BASIS, ZERO_KNOBS, combine, outOfDomain, type Knobs } from './scenario/combine';
import { PRESETS, knobsFromPreset, matchPreset, type PresetId } from './scenario/presets';

/** 읽는 측정폭. 표·스트립·각주가 같은 폭을 쓴다 — 카드가 넓다고 줄까지 넓히면
 * 비교할 숫자가 멀어지고(첫 판 실측 1,500px) 각주는 한 줄에 백 자를 넘긴다.
 * 경로 빌더만 이보다 넓다: 여덟 칸이 실제로 그만큼을 쓴다. */
const MEASURE = 780;

/** 한 분기에 놓을 수 있는 값. 기저의 검증 영역이 ±50 이라 그 밖은 아예 못 고른다. */
const STEP_OPTIONS = [50, 25, 0, -25, -50];

/** 8개 점이 덮는 분기 수. 기저가 정한다 — 여기서 늘릴 수 없다. */
const PINNED_Q = 8;

/** 프리셋 탭. **모듈 상수**여야 한다 — `SegmentedTabs` 는 `activeTab` 을 객체
 * 신원으로 비교하므로 렌더마다 새 배열을 만들면 활성 표시가 흔들린다
 * (`sim/CurvePreview.tsx` 가 같은 자리에 같은 주석을 달아 두었다). */
const PRESET_TABS = [
  ...PRESETS.map((p) => ({ id: p.id, label: p.label })),
  { id: 'custom' as const, label: '직접' },
];

const TENOR_LABEL: Record<string, string> = {
  '1y': '1Y',
  '2y': '2Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
};

/** 부호 있는 값의 방향 클래스. `format.dirClass` 는 CSS 에 없는 `text-*` 를
 * 돌려주므로(실측 2026-08-20) 살아 있는 쪽을 쓴다. */
function dirCls(v: number | null): string | undefined {
  if (v == null || v === 0) return undefined;
  return v > 0 ? 'sr-up' : 'sr-down';
}

/* ── 분기 격자 ────────────────────────────────────────────────────────────────
 *
 * **8분기는 2년이고 금통위는 연 8회다.** 점 여덟 개를 그냥 늘어놓으면 읽는 사람이
 * "금통위 여덟 번 = 1년" 으로 세고 기간을 두 배로 잘못 읽는다. 그래서 칸마다 그
 * 분기에 실제로 있는 회의 날짜를 적는다 — 격자의 뜻을 화면이 말하게 한다. */
type Quarter = { label: string; meetings: string[] };

function quarterOf(iso: string): { y: number; q: number } {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return { y, q: Math.floor((m - 1) / 3) + 1 };
}

function buildQuarters(asof: string, upcoming: string[]): Quarter[] {
  const start = quarterOf(asof);
  const out: Quarter[] = [];
  for (let i = 0; i < PINNED_Q; i += 1) {
    const abs = (start.y * 4 + (start.q - 1)) + i;
    const y = Math.floor(abs / 4);
    const q = (abs % 4) + 1;
    const meetings = upcoming
      .filter((d) => {
        const dq = quarterOf(d);
        return dq.y === y && dq.q === q;
      })
      .map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`);
    out.push({ label: `${y}Q${q}`, meetings });
  }
  return out;
}

/* ── 화면 ──────────────────────────────────────────────────────────────────── */

export function ScenarioPage({ policy }: { policy?: PolicyStep }) {
  const [anchors, setAnchors] = useState<AnchorsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [knobs, setKnobs] = useState<Knobs>(ZERO_KNOBS);

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
  const rows = useMemo(
    () => (anchors ? assembleRows(anchors, diffs) : []),
    [anchors, diffs],
  );
  const preset = matchPreset(knobs);
  const outside = outOfDomain(BASIS, knobs);

  const setQuarter = useCallback((i: number, v: number) => {
    setKnobs((k) => {
      const next = [...k.policyBp];
      next[i] = v;
      return { ...k, policyBp: next };
    });
  }, []);

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
    return <ErrorState what="시나리오 앵커" detail={error} onRetry={() => void load()} retrying={retrying} />;
  }
  if (!anchors) return <LoadingState what="시나리오 앵커" />;

  const quarters = buildQuarters(anchors.asof, policy?.upcoming ?? []);

  return (
    <VStack className="sr-card" width="100%" minWidth={0}>
      {/* ── 머리 — 형제 세입자와 같은 사다리 ────────────────────────────── */}
      <VStack gap={1} paddingX={2} paddingTop={2} paddingBottom={1.5}>
        <VStack gap={0}>
          <Text as="h2" font="label1">
            정책 경로 시나리오
          </Text>
          <HStack gap={1} alignItems="center" flexWrap="wrap" minHeight={33}>
            <Text as="span" font="legal" color="fgMuted">
              커브 {anchors.asof} · 기저 {BASIS.as_of} · 기준금리{' '}
              {anchors.base == null ? '—' : `${anchors.base.toFixed(2)}%`} · 8분기 경로를 놓으면
              커브가 어디로 가는지 봐요
            </Text>
            {outside ? (
              <Chip
                size="xs"
                accessibilityLabel="검증 영역 밖 — 커널이 맞춰진 범위를 벗어났어요"
                onClick={() => setKnobs((k) => ({ ...k, policyBp: k.policyBp.map(() => 0) }))}
              >
                검증 영역 밖
              </Chip>
            ) : null}
          </HStack>
        </VStack>

        {/* 프리셋 — 씨앗이지 주장이 아니다. 하나를 골라도 그 순간부터 내 경로다. */}
        <HStack gap={1} alignItems="center" flexWrap="wrap" role="group" aria-label="프리셋">
          <Text as="span" font="caption" color="fgMuted" noWrap>
            프리셋
          </Text>
          <SegmentedTabs
            accessibilityLabel="프리셋"
            tabs={PRESET_TABS}
            activeTab={PRESET_TABS.find((t) => t.id === (preset ?? 'custom')) ?? null}
            onChange={(t) => {
              if (t && t.id !== 'custom') setKnobs(knobsFromPreset(t.id as PresetId));
            }}
          />
          <Text as="span" font="legal" color="fgMuted">
            {preset ? PRESETS.find((p) => p.id === preset)?.blurb : '손으로 고친 경로예요'}
          </Text>
        </HStack>
      </VStack>

      {/* ── 본문 ────────────────────────────────────────────────────────── */}
      <VStack gap={2} paddingX={2} paddingBottom={2} minWidth={0}>
        <PathBuilder quarters={quarters} policyBp={knobs.policyBp} onChange={setQuarter} />
        <PathStrip iKr={diffs.i_kr} />
        <ResultTable rows={rows} curveLastTenorY={anchors.curveLastTenorY} />
        <Ledger anchors={anchors} outside={outside} />
      </VStack>
    </VStack>
  );
}

/* ── 경로 빌더 ──────────────────────────────────────────────────────────────── */

function PathBuilder({
  quarters,
  policyBp,
  onChange,
}: {
  quarters: Quarter[];
  policyBp: number[];
  onChange: (i: number, v: number) => void;
}) {
  return (
    <VStack gap={1} minWidth={0}>
      <Text as="span" font="caption" color="fgMuted">
        기준금리 경로 — 베이스라인 대비 레벨(bp)
      </Text>
      {/* 값이 «그 분기에 얼마나 움직인다» 가 아니라 «그 분기에 어디 있다» 임을
          라벨이 말한다. [-25, 0] 은 인하 후 되돌림이지 두 번의 인하가 아니다. */}
      <HStack gap={1} flexWrap="wrap" alignItems="flex-start">
        {quarters.map((q, i) => (
          <VStack key={q.label} gap={0.5} width={116}>
            <Select
              size="s"
              font="legal"
              styles={DROPDOWN_STYLES}
              accessibilityLabel={`${q.label} 기준금리 레벨`}
              value={String(policyBp[i] ?? 0)}
              onChange={(v) => v != null && onChange(i, Number(v))}
              options={STEP_OPTIONS.map((v) => ({
                value: String(v),
                label: v === 0 ? '0' : fmtBp(v).replace('.0', ''),
              }))}
            />
            <VStack gap={0}>
              <Text as="span" font="legal" color="fgMuted" noWrap>
                {q.label}
              </Text>
              {/* 그 분기의 실제 금통위. 없으면 그 사실도 정보다 — 이 분기에는
                  결정할 자리가 없다는 뜻이라 칸을 비우지 않고 그렇게 적는다. */}
              {/* noWrap 을 걸면 «금통위 10/22 · 11/26» 이 옆 칸을 덮는다(실측).
                  두 줄이 되는 편이 겹치는 것보다 낫다. */}
              <Text as="span" font="legal" color="fgMuted">
                {q.meetings.length > 0 ? `금통위 ${q.meetings.join(' · ')}` : '금통위 없음'}
              </Text>
            </VStack>
          </VStack>
        ))}
      </HStack>
    </VStack>
  );
}

/* ── 24분기 스트립 ──────────────────────────────────────────────────────────── */

function PathStrip({ iKr }: { iKr: number[] }) {
  const max = Math.max(0.05, ...iKr.map((v) => Math.abs(v)));
  return (
    <VStack gap={1} minWidth={0}>
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
          첫 판이 정확히 그렇게 무너졌다(실측: 24칸이 8칸 폭으로 뭉쳤다). 격자
          자체가 이 요소의 전부라 CDS 로 표현할 것이 남지 않는다. */}
      {/* 래퍼는 **열 플렉스**여야 한다. `Box` 는 행 플렉스라 격자가 내용 폭으로
          접혀 통째로 사라졌다(실측 2026-08-20). 열 플렉스에서는 블록 자식이
          가로를 채운다. */}
      <VStack maxWidth={MEASURE} width="100%">
        <div className="sr-scn-strip" aria-hidden>
        {iKr.map((v, i) => {
          const dir = v > 1e-9 ? 'up' : v < -1e-9 ? 'down' : 'flat';
          const h = `${Math.min(100, (Math.abs(v) / max) * 100)}%`;
          return (
            <div key={i} className={`sr-scn-col${i < PINNED_Q ? ' sr-scn-pinned' : ''}`}>
              <div>
                {dir === 'up' ? (
                  <div className="sr-scn-bar" data-dir="up" style={{ '--h': h } as React.CSSProperties} />
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
      </VStack>
      {/* 스크린리더는 막대를 못 읽는다 — 되받아침의 크기를 문장으로 준다. */}
      <Text as="span" font="legal" color="fgMuted">
        고정 구간 평균 {fmtBp(avg(iKr.slice(0, PINNED_Q)) * 100)}bp · 그 뒤 평균{' '}
        {fmtBp(avg(iKr.slice(PINNED_Q)) * 100)}bp
      </Text>
    </VStack>
  );
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/* ── 결과 표 ────────────────────────────────────────────────────────────────── */

function ResultTable({
  rows,
  curveLastTenorY,
}: {
  rows: ScenarioRow[];
  curveLastTenorY: number;
}) {
  const anyMissing = rows.some((r) => r.marketCarryBp === null);
  return (
    <VStack gap={1} minWidth={0}>
      {/* 비교할 숫자가 1,500px 떨어져 있으면 표가 아니다(첫 판 실측). 여섯 칸이
          쓰는 만큼만 쓰고 남는 폭은 카드에 돌려준다. */}
      <Box overflow="auto" maxWidth={MEASURE}>
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
                <TableCell>
                  <HStack gap={0.5} alignItems="center">
                    <Text as="span" font="legal" noWrap>
                      {TENOR_LABEL[r.tenor] ?? r.tenor}
                    </Text>
                    {/* 포워드의 끝점이 호가 노드가 아니면 같은 자릿수라도 같은
                        확신이 아니다. 포워드 행렬의 규칙을 그대로 나른다. */}
                    {r.marketCarryBp !== null && !r.live ? (
                      <Text as="span" font="legal" color="fgMuted" noWrap>
                        보간
                      </Text>
                    ) : null}
                  </HStack>
                </TableCell>
                <TableCell justifyContent="flex-end">
                  <Text as="span" font="legal" tabularNumbers noWrap>
                    {fmtLevel(r.spot, '%')}
                  </Text>
                </TableCell>
                <TableCell justifyContent="flex-end">
                  <Text as="span" font="legal" tabularNumbers noWrap>
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
                {/* 이 화면의 결론. 색이 여기 하나에만 붙는 이유는 앞의 둘이
                    입력이고 이것이 답이기 때문이다. */}
                <TableCell justifyContent="flex-end">
                  <Text
                    as="span"
                    font="label2"
                    tabularNumbers
                    noWrap
                    className={dirCls(r.vsMarketBp)}
                  >
                    {fmtBp(r.vsMarketBp)}
                  </Text>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Text as="span" font="legal" color="fgMuted" maxWidth={MEASURE}>
        Δ 전망은 오늘 대비, Δ vs 시장은 시장이 이미 프라이싱한 12개월 이동 대비예요.
        전망이 맞아도 시장이 그만큼 프라이싱했으면 자리가 없어요.
        {anyMissing
          ? ` 10Y는 커브가 ${curveLastTenorY}년에서 끝나 12개월 포워드를 못 만들어요 — 비운 자리는 0이 아니에요.`
          : ''}
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
    <VStack gap={0.5} minWidth={0} maxWidth={MEASURE}>
      <Text as="span" font="legal" color="fgMuted">
        확률이 아니라 가격결정 질문이에요 — 이 경로가 프라이싱되면 커브는 어디가 정합인가.
      </Text>
      <Text as="span" font="legal" color="fgMuted">
        {outside
          ? '지금 손잡이는 커널이 맞춰진 범위 밖이라 결과가 선형 외삽이에요. '
          : ''}
        {anchors.caveats.map(caveatText).join(' · ')}
      </Text>
    </VStack>
  );
}
