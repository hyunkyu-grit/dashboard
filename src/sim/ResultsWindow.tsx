'use client';

/* 시뮬레이션 결과 — "이 경로면 얼마 벌었을까".
 *
 * 실행을 누르면 뜨는 **떠 있는 창**이다(v1 실물 그대로). 떠 있어야 하는 이유는
 * 뒤의 설정을 다시 만질 수 있어야 하기 때문이다 — 결과를 읽는 일의 절반은
 * "그럼 30bp 말고 50bp면?" 이고, 그건 설정으로 돌아가는 일이다.
 *
 * ── 읽는 순서가 곧 배치다 ──────────────────────────────────────────────────
 *  1. **케이스 넷의 총손익** — 한 줄. 이 화면의 첫 질문은 "얼마" 가 아니라
 *     "네 경로에서 각각 얼마" 다.
 *  2. **무엇을 물었나** — 기간·목표·총손익 칩. 결과 창은 자기가 답한 질문을
 *     다시 적는다(창이 떠 있는 동안 설정이 바뀌었을 수 있다).
 *  3. **케이스 비교** — 성분 × 케이스 표.
 *  4. **성분 누적 경로** — 평가·캐리·롤다운이 날마다 어떻게 쌓이는지.
 *  5. **워터폴** — 그 셋이 총손익으로 합쳐지는 그림.
 *  6. **일별 대사** — 트레이딩 시스템과 줄 단위로 맞춰 보는 표.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { Button } from '@coinbase/cds-web/buttons';
import { Chip } from '@coinbase/cds-web/chips';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { TextLabel1, TextLabel2, TextLegal } from '@coinbase/cds-web/typography';
import {
  CartesianChart,
  Line,
  Scrubber,
  XAxis,
  YAxis,
} from '@coinbase/cds-web/visualizations/chart';

import { fmtKrw, fmtKrwFromMan, manUnits } from '@/lib/krw';
import { directionVar } from '@/theme/tint';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { ReconStack, type ReconStackDay } from '@/ui/window/ReconStack';
import { ReadoutCard, ReadoutMoney, readoutLeft } from '@/ui/ReadoutCard';

import type { CaseRuns } from './SimulationPage';
import {
  activeCase,
  SIM_CASES,
  type CaseId,
  type Scenario,
  type SimReconRow,
  type SimResponse,
} from './scenario';

const AXIS = 'krw';

/** 성분. 순서가 곧 워터폴의 순서이고 표의 행 순서다.
 *
 * 채권 셋은 **북에 채권이 있을 때만** 선다 [OWNER, 2026-08-14 — 시뮬 포지션에
 * 현금채권·자산스왑]. 라벨은 v1 `sim/lib/components.ts` 의 그 이름들이다 —
 * 상수 0 을 줄로 그리면 "조달이 0이었다" 가 아니라 "조달이라는 게 있고 마침
 * 0이다" 로 읽히는데, 둘은 다른 주장이다(그쪽 주석 그대로). */
const SWAP_PARTS = [
  { key: 'val', label: '스왑평가' },
  { key: 'carry', label: '스왑캐리' },
  { key: 'roll', label: '스왑롤다운' },
] as const;
const BOND_PARTS = [
  { key: 'bondMtm', label: '채권평가' },
  { key: 'bondCarry', label: '채권캐리' },
  { key: 'fund', label: '조달비용' },
] as const;

/** 커서 카드가 그리는 줄들 — 워터폴·표와 **같은 순서, 같은 이름**이다.
 * 세 곳이 각자 목록을 들면 하나만 고쳐지는 날이 온다. */
const PATH_ROWS = [...SWAP_PARTS, ...BOND_PARTS] as readonly {
  key: 'val' | 'carry' | 'roll' | 'bondMtm' | 'bondCarry' | 'fund';
  label: string;
}[];
const PATH_SERIES: string[] = PATH_ROWS.map((r) => r.key);
/** 북에 채권이 없으면 서지 않는 셋. */
const BOND_SERIES = new Set<string>(BOND_PARTS.map((r) => r.key));

/** 케이스 선의 색.
 *
 * ⚠ 첫 판은 `--color-chart1`…`4` 를 썼다. **그런 토큰은 없다** — CDS 가 심는
 * `--color-*` 43개를 실측으로 세어 보니 chart 계열이 하나도 없었고, 무효값이라
 * 브라우저가 상속색으로 떨어뜨려 **네 선이 전부 같은 회색**이 됐다. 아무것도 안
 * 깨져 보이는 그 결함이다(이 리포가 폰트·면 토큰에서 이미 세 번 밟았다).
 *
 * 지금 쓰는 것은 실재하는 토큰뿐이고, **케이스의 뜻과 색을 맞춘다**:
 * Bull 은 금리 하락이라 파랑, Bear 는 상승이라 빨강 — 원화 관례와 싸우지 않는
 * 유일한 배치다. Base 는 잉크(지금 편집 중인 것), Crisis 는 더 센 상승이지만
 * Bear 와 구별돼야 해서 보라다.
 *
 * 한계를 적어 둔다: 사용자가 Bull 의 목표를 +100 으로 고치면 색이 이름과 어긋난다.
 * 색은 **씨앗의 뜻**을 말하고, 실제 방향은 칩 옆의 숫자가 말한다. 그리고 회색조에서
 * 넷을 구별할 수 없으므로 칩이 항상 이름을 같이 싣는다(DESIGN §5 의 단서). */
const CASE_COLOR: Record<CaseId, string> = {
  base: 'var(--color-fg)',
  bull: 'var(--sr-down)',
  bear: 'var(--sr-up)',
  crisis: 'var(--color-accentBoldPurple)',
};

/** 한 케이스의 3분해 — **표시 정밀도에서 총손익과 맞도록**. 셋을 각자 반올림하면
 * 1만원이 어긋난다(백테스트에서 실측으로 걸린 그 결함). */
function partsOf(run: SimResponse) {
  const d = run.totalReturnDecomposition;
  /* splitKrw 의 수법 그대로, 성분이 여섯으로 늘었을 뿐이다: 합계와 다섯 성분이
     각각 한 번씩 반올림하고 **스왑캐리가 잔차**를 진다. 북에 채권이 없으면
     채권 셋은 정확히 0 이라 예전의 3분해와 같은 숫자다. */
  const uPnl = manUnits(d.total);
  const val = manUnits(d.swapMtm);
  const roll = manUnits(d.swapRolldown ?? 0);
  const bondMtm = manUnits(d.bondMtm);
  const bondCarry = manUnits(d.bondCarry);
  const fund = manUnits(d.fundingCost);
  const carry = uPnl - val - roll - bondMtm - bondCarry - fund;
  const hasBond = bondMtm !== 0 || bondCarry !== 0 || fund !== 0;
  return { uPnl, val, carry, roll, bondMtm, bondCarry, fund, hasBond };
}

/** 엔진의 일별 대사 → 대사 스택. **시간순이 기본**(D+0 이 위) — 미래 경로에는
 * "최신" 이랄 게 없다. 여기서 계산하는 것은 없다. */
function simDays(rows: SimReconRow[]): ReconStackDay[] {
  return rows.map((r) => ({
    date: r.date,
    title: r.carryover
      ? `${r.date} · D+${r.day} · 다음 영업일로 들고 가는 이월 리스크`
      : `${r.date} · D+${r.day}`,
    krd: r.pvbp,
    dbp: r.dailyDbp,
    est: r.pnl,
    estTotal: r.totalEstPnl,
    valuation: r.valuationPnl,
    carry: r.carryPnl ?? null,
    rolldown: r.rolldownPnl ?? null,
    actual: r.totalActual,
  }));
}

/** 조건 칩 — 이 창이 답한 질문.
 *
 * CDS `Chip` 은 `Pressable` 이라 언제나 `<button>` 이다(`as` 가 'button' 하나만
 * 받는다). 이 칩들은 누르는 것이 아니므로 `disabled` 로 탭 순서에서 뺀다 — 안 누르는
 * 것이 탭 순서에 끼면 키보드 이동이 그만큼 길어진다. */
function CondChip({ label, value }: { label: string; value: string }) {
  return (
    <Chip
      disabled
      size="xs"
      start={
        <TextLegal as="span" color="fgMuted" noWrap>
          {label}
        </TextLegal>
      }
    >
      <TextLabel2 as="span" tabularNumbers noWrap>
        {value}
      </TextLabel2>
    </Chip>
  );
}

export function ResultsWindow({
  runs,
  scenario,
  asOf,
  onClose,
}: {
  runs: CaseRuns;
  scenario: Scenario;
  asOf: string;
  onClose: () => void;
}) {
  /* 성분 경로 차트의 커서. 백테스트와 같은 문법(`LinkedCharts`). */
  const [pathIdx, setPathIdx] = useState<number>();
  const [pathX, setPathX] = useState(0);
  const pathBoxRef = useRef<HTMLDivElement>(null);
  const onPathMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const box = pathBoxRef.current?.getBoundingClientRect();
    if (box) setPathX(readoutLeft(e.clientX - box.left, box.width));
  }, []);

  const [shown, setShown] = useState<CaseId>(scenario.activeCase);
  const run = runs[shown];
  const cur = activeCase(scenario);

  const ran = SIM_CASES.filter((c) => runs[c.id]);

  /** 케이스 비교 — 성분 × 케이스. 각 칸은 그 케이스의 3분해다. */
  const grid = useMemo(
    () =>
      ran.map((c) => {
        const r = runs[c.id];
        return { id: c.id, label: c.label, parts: r ? partsOf(r) : null };
      }),
    [ran, runs],
  );

  /* 성분 누적 경로 — 평가·캐리·롤다운이 날마다 어떻게 쌓이는지. 서버가
     `decompositionDaily` 로 **누적값**을 주므로 여기서 차분하지 않는다. */
  const paths = useMemo(() => {
    const daily = run?.decompositionDaily ?? [];
    if (daily.length === 0) return null;
    return {
      days: daily.map((d) => `D+${d.day}`),
      val: daily.map((d) => d.swapMtm ?? null),
      carry: daily.map((d) => d.swapCarry ?? null),
      roll: daily.map((d) => d.swapRolldown ?? null),
      /* 채권 셋 — 북에 채권이 있을 때만 선이 선다. 없는 북에서는 전부 0 이라
         상수 0 선 셋이 범례만 늘리므로 그린 것에만 이름을 준다(범례 규칙). */
      bondMtm: daily.map((d) => d.bondMtm ?? null),
      bondCarry: daily.map((d) => d.bondCarry ?? null),
      fund: daily.map((d) => d.fundingCost ?? null),
      hasBond: daily.some(
        (d) => (d.bondMtm ?? 0) !== 0 || (d.bondCarry ?? 0) !== 0 || (d.fundingCost ?? 0) !== 0,
      ),
    };
  }, [run]);

  /** 스크러버가 스크린리더에 읽어 줄 한 줄. 카드는 눈, 이건 귀 — 둘 다 있어야 한다. */
  const pathScrubLabel = useCallback(
    (i: number) => {
      if (!paths || paths.days[i] == null) return '';
      const rows = PATH_ROWS.filter((r) => paths.hasBond || !BOND_SERIES.has(r.key))
        .map((r) => `${r.label} ${fmtKrw((paths[r.key] as (number | null)[])[i] ?? 0)}`);
      return [paths.days[i], ...rows].join(', ');
    },
    [paths],
  );

  const p = run ? partsOf(run) : null;
  const recon = run?.irsDailyReconciliation ?? [];

  return (
    <FloatingWindow
      windowKey="simulation"
      title="시뮬레이션 결과"
      width={1120}
      aside={
        <TextLegal as="span" color="fgMuted" noWrap>
          이 경로면 얼마 벌었을까
        </TextLegal>
      }
      onClose={onClose}
    >
      <VStack gap={2} padding={2} width="100%">
        {/* ── 1. 케이스 넷 ─────────────────────────────────────────────────── */}
        <HStack gap={0.5} flexWrap="wrap">
          {ran.map((c) => {
            const r = runs[c.id];
            const u = r ? manUnits(r.totalReturnDecomposition.total) : 0;
            return (
              <Chip
                key={c.id}
                size="s"
                accessibilityLabel={`${c.label} 케이스`}
                start={<span className="sr-casedash" style={{ background: CASE_COLOR[c.id] }} />}
                end={
                  <TextLabel2 as="span" tabularNumbers noWrap style={{ color: directionVar(u) }}>
                    {fmtKrwFromMan(u)}
                  </TextLabel2>
                }
                onClick={() => setShown(c.id)}
                invertColorScheme={c.id === shown}
              >
                {c.label}
              </Chip>
            );
          })}
        </HStack>

        {/* ── 2. 무엇을 물었나 ─────────────────────────────────────────────── */}
        <HStack gap={0.5} alignItems="center" flexWrap="wrap" width="100%">
          <CondChip label="기간" value={`D+${scenario.days}`} />
          <CondChip
            label={`국고 ${scenario.anchorTenor} 목표`}
            value={`${cur.shockBp >= 0 ? '+' : '−'}${Math.abs(cur.shockBp)}bp`}
          />
          {cur.events.length ? (
            <CondChip label="기준금리 이벤트" value={`${cur.events.length}건`} />
          ) : null}
          {p ? <CondChip label="Total Return" value={fmtKrwFromMan(p.uPnl)} /> : null}
          <Box style={{ marginInlineStart: 'auto' }}>
            <Button variant="secondary" size="s" onClick={onClose}>
              조건 수정
            </Button>
          </Box>
        </HStack>

        {/* ── 3. 케이스 비교 ───────────────────────────────────────────────── */}
        <VStack gap={0.5} width="100%">
          <TextLabel1 as="span">케이스 비교</TextLabel1>
          <TextLegal as="span" color="fgMuted">
            같은 포지션이 네 경로에서 각각 어디에 도착하는지예요.
          </TextLegal>
          {/* CDS `Table` — 이 표는 `<colgroup>`·sticky 오프셋이 필요 없다(대사
              스택과 다른 점). 그래서 §5.4 의 예외가 아니라 그냥 CDS 것을 쓴다. */}
          <Table tableLayout="auto">
            <TableHeader>
              <TableRow>
                <TableCell as="th" scope="col">
                  <TextLegal as="span" color="fgMuted">
                    성분
                  </TextLegal>
                </TableCell>
                {grid.map((g) => (
                  <TableCell as="th" scope="col" key={g.id} justifyContent="flex-end">
                    <HStack gap={0.5} alignItems="center">
                      <span className="sr-casedash" style={{ background: CASE_COLOR[g.id] }} />
                      <TextLegal as="span" color="fgMuted" noWrap>
                        {g.label}
                      </TextLegal>
                    </HStack>
                  </TableCell>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...SWAP_PARTS, ...(grid.some((g) => g.parts?.hasBond) ? BOND_PARTS : [])].map((part) => (
                <TableRow key={part.key}>
                  <TableCell>
                    <TextLegal as="span" color="fgMuted" noWrap>
                      {part.label}
                    </TextLegal>
                  </TableCell>
                  {grid.map((g) => (
                    <TableCell key={g.id} justifyContent="flex-end">
                      <TextLabel2
                        as="span"
                        tabularNumbers
                        noWrap
                        style={{ color: g.parts ? directionVar(g.parts[part.key]) : undefined }}
                      >
                        {g.parts ? fmtKrwFromMan(g.parts[part.key]) : '—'}
                      </TextLabel2>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {/* 토탈만 굵다 — 나머지는 그 합의 구성이다. */}
              <TableRow>
                <TableCell>
                  <TextLabel1 as="span" noWrap>
                    토탈
                  </TextLabel1>
                </TableCell>
                {grid.map((g) => (
                  <TableCell key={g.id} justifyContent="flex-end">
                    <TextLabel1
                      as="span"
                      tabularNumbers
                      noWrap
                      style={{ color: g.parts ? directionVar(g.parts.uPnl) : undefined }}
                    >
                      {g.parts ? fmtKrwFromMan(g.parts.uPnl) : '—'}
                    </TextLabel1>
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </VStack>

        {/* ── 4. 성분 누적 경로 ────────────────────────────────────────────── */}
        {paths ? (
          <VStack gap={0.5} width="100%">
            <TextLabel1 as="span">성분 누적 경로</TextLabel1>
            <TextLegal as="span" color="fgMuted">
              설계한 금리 경로대로 갔을 때 손익이 어떻게 쌓이는지예요. 평가는 커브가 움직여
              생기는 몫, 캐리는 실제 주고받는 이자의 몫, 롤다운은 커브가 멈춰도 잔존만기가
              줄어 생기는 몫이에요.
            </TextLegal>
            {/* 카드가 기준으로 삼는 상자(`.sr-plot` = position:relative). */}
            <Box className="sr-plot" width="100%" ref={pathBoxRef} onMouseMove={onPathMove}>
              <CartesianChart
                animate={false}
                enableScrubbing
                onScrubberPositionChange={setPathIdx}
                height={260}
                accessibilityLabel="성분 누적 경로"
                inset={{ top: 12, right: 8, bottom: 0, left: 8 }}
                series={[
                  { id: 'val', data: paths.val, color: 'var(--sr-up)', yAxisId: AXIS },
                  { id: 'carry', data: paths.carry, color: 'var(--sr-down)', yAxisId: AXIS },
                  { id: 'roll', data: paths.roll, color: 'var(--color-fgMuted)', yAxisId: AXIS },
                  ...(paths.hasBond
                    ? [
                        { id: 'bondMtm', data: paths.bondMtm, color: 'var(--sr-ref-cd)', yAxisId: AXIS },
                        { id: 'bondCarry', data: paths.bondCarry, color: 'var(--sr-ref-policy)', yAxisId: AXIS },
                        { id: 'fund', data: paths.fund, color: 'var(--color-fg)', yAxisId: AXIS },
                      ]
                    : []),
                ]}
                xAxis={{ data: paths.days }}
                yAxis={[{ id: AXIS }]}
              >
                <XAxis showGrid={false} />
                <YAxis
                  axisId={AXIS}
                  position="right"
                  showGrid={false}
                  tickLabelFormatter={(v) => fmtKrw(v)}
                />
                <Line seriesId="val" curve="linear" connectNulls={false} />
                <Line seriesId="carry" curve="linear" connectNulls={false} />
                <Line seriesId="roll" curve="linear" connectNulls={false} />
                {paths.hasBond ? (
                  <>
                    <Line seriesId="bondMtm" curve="linear" connectNulls={false} />
                    <Line seriesId="bondCarry" curve="linear" connectNulls={false} />
                    <Line seriesId="fund" curve="linear" connectNulls={false} />
                  </>
                ) : null}
                <Scrubber
                  accessibilityLabel={pathScrubLabel}
                  seriesIds={PATH_SERIES.filter((k) => paths.hasBond || !BOND_SERIES.has(k))}
                />
              </CartesianChart>
              {/* 커서가 짚은 날의 성분 — 레인 P1-2. 이 화면은 손익이 어떻게
                  쌓이는지를 보는 자리인데, 특정 날의 숫자를 읽을 길이 없었다. */}
              {pathIdx != null && pathIdx >= 0 && paths.days[pathIdx] != null ? (
                <ReadoutCard title={`D+${paths.days[pathIdx]}`} left={pathX}>
                  {PATH_ROWS.filter((r) => paths.hasBond || !BOND_SERIES.has(r.key)).map((r) => (
                    <ReadoutMoney
                      key={r.key}
                      k={r.label}
                      v={(paths[r.key] as (number | null)[])[pathIdx] ?? null}
                    />
                  ))}
                </ReadoutCard>
              ) : null}
            </Box>
            {p ? (
              <HStack gap={1.5} flexWrap="wrap">
                {(
                  [
                    ['스왑평가', p.val, 'var(--sr-up)'],
                    ['스왑캐리', p.carry, 'var(--sr-down)'],
                    ['스왑롤다운', p.roll, 'var(--color-fgMuted)'],
                    ...(p.hasBond
                      ? ([
                          ['채권평가', p.bondMtm, 'var(--sr-ref-cd)'],
                          ['채권캐리', p.bondCarry, 'var(--sr-ref-policy)'],
                          ['조달비용', p.fund, 'var(--color-fg)'],
                        ] as const)
                      : []),
                  ] as readonly (readonly [string, number, string])[]
                ).map(([label, u, colour]) => (
                  <HStack key={label} gap={0.5} alignItems="baseline">
                    <span className="sr-casedash" style={{ background: colour }} />
                    <TextLegal as="span" color="fgMuted" noWrap>
                      {label}
                    </TextLegal>
                    <TextLabel2 as="span" tabularNumbers noWrap style={{ color: directionVar(u) }}>
                      {fmtKrwFromMan(u)}
                    </TextLabel2>
                  </HStack>
                ))}
              </HStack>
            ) : null}
          </VStack>
        ) : null}

        {/* ── 5. 워터폴 ───────────────────────────────────────────────────── */}
        {p ? (
          <VStack gap={0.5} width="100%">
            <TextLabel1 as="span">Total Return</TextLabel1>
            <TextLegal as="span" color="fgMuted">
              기간이 끝났을 때의 도착점이에요. 위 커브의 마지막 값과 같은 숫자예요.
            </TextLegal>
            <Waterfall parts={p} />
            {p.hasBond ? (
              <TextLegal as="span" color="fgMuted">
                채권평가·채권캐리·조달비용은 북의 채권 다리 몫이에요 — 조달은 평가금액을
                조달한 비용이라 채권이 있을 때만 서요.
              </TextLegal>
            ) : null}
          </VStack>
        ) : null}

        {/* ── 6. 일별 대사 ─────────────────────────────────────────────────── */}
        <VStack gap={0.5} width="100%">
          <TextLabel1 as="span">일별 대사</TextLabel1>
          <TextLegal as="span" color="fgMuted">
            하루가 세 줄이에요 — KRD(전일 종가 감도), Δbp(그날 변화), 손익(KRD × Δbp 추정).
            같은 블록의 KRD와 Δbp를 곱하면 손익 줄이 나와요. 추정 합계와 평가의 차가 선형화
            잔차이고, 평가·캐리·롤다운을 더하면 그날 손익이에요. 마지막 블록은 다음 영업일로
            들고 가는 이월 리스크예요.
          </TextLegal>
          {recon.length ? (
            <ReconStack
              days={simDays(recon)}
              tenors={Object.keys(recon[0].pvbp)}
              defaultOrder="asc"
              maxHeight="34vh"
            />
          ) : (
            <TextLegal as="span" color="fgMuted">
              이 실행에는 일별 KRD가 없어요 — 스왑이 제외됐거나 par 커브가 없는 실행이에요.
            </TextLegal>
          )}
        </VStack>

        {run?.exclusions?.length ? (
          <TextLegal as="span" color="fgMuted">
            제외됨: {run.exclusions.map((e) => e.reason ?? e.assetClass).join(' · ')}
          </TextLegal>
        ) : null}
        <TextLegal as="span" color="fgMuted">
          {asOf} 커브에서 시작했어요.
        </TextLegal>
      </VStack>
    </FloatingWindow>
  );
}

/** 워터폴 — 성분 셋이 총손익으로 합쳐지는 그림. 막대 넷(평가·캐리·롤다운·토탈)이고,
 * 앞의 셋은 **떠 있는 막대**(누적 위에서 시작)라 합쳐지는 것이 눈에 보인다.
 *
 * 크기는 만-단위 정수로 잰다 — 화면의 숫자와 막대가 같은 값에서 나와야 한다. */
function Waterfall({ parts }: { parts: ReturnType<typeof partsOf> }) {
  const steps = [
    { label: '스왑평가', u: parts.val },
    { label: '스왑캐리', u: parts.carry },
    { label: '스왑롤다운', u: parts.roll },
    ...(parts.hasBond
      ? [
          { label: '채권평가', u: parts.bondMtm },
          { label: '채권캐리', u: parts.bondCarry },
          { label: '조달비용', u: parts.fund },
        ]
      : []),
  ];
  // 누적 경계 — 각 막대의 아래/위 끝.
  let acc = 0;
  const bars = steps.map((s) => {
    const from = acc;
    acc += s.u;
    return { ...s, from, to: acc };
  });
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
  const hi = Math.max(0, ...bars.map((b) => Math.max(b.from, b.to)));
  const span = hi - lo || 1;
  const H = 140;
  const y = (v: number) => ((hi - v) / span) * H;

  return (
    <HStack gap={2} alignItems="flex-start" flexWrap="wrap" width="100%">
      <Box className="sr-waterfall" style={{ height: H + 48 }}>
        {bars.map((b) => (
          <div key={b.label} className="sr-wf-col">
            <div
              className="sr-wf-bar"
              style={{
                top: y(Math.max(b.from, b.to)),
                height: Math.max(1, Math.abs(y(b.to) - y(b.from))),
                background: `color-mix(in srgb, ${directionVar(b.u)} 28%, var(--sr-card))`,
              }}
            />
            <span className="sr-wf-val" style={{ top: y(Math.max(b.from, b.to)) - 16 }}>
              {fmtKrwFromMan(b.u)}
            </span>
            <span className="sr-wf-label">{b.label}</span>
          </div>
        ))}
        <div className="sr-wf-col">
          <div
            className="sr-wf-bar"
            style={{
              top: y(Math.max(0, parts.uPnl)),
              height: Math.max(1, Math.abs(y(parts.uPnl) - y(0))),
              background: `color-mix(in srgb, ${directionVar(parts.uPnl)} 28%, var(--sr-card))`,
            }}
          />
          <span className="sr-wf-val" style={{ top: y(Math.max(0, parts.uPnl)) - 16 }}>
            {fmtKrwFromMan(parts.uPnl)}
          </span>
          <span className="sr-wf-label sr-wf-total">토탈</span>
        </div>
      </Box>
      <VStack gap={0.25} minWidth={220}>
        {steps.map((s) => (
          <HStack key={s.label} gap={1} alignItems="baseline" width="100%">
            <TextLegal as="span" color="fgMuted" noWrap>
              {s.label}
            </TextLegal>
            <TextLabel2
              as="span"
              tabularNumbers
              noWrap
              style={{ marginInlineStart: 'auto', color: directionVar(s.u) }}
            >
              {fmtKrwFromMan(s.u)}
            </TextLabel2>
          </HStack>
        ))}
        <HStack gap={1} alignItems="baseline" width="100%" className="sr-wf-sum">
          <TextLabel1 as="span" noWrap>
            토탈
          </TextLabel1>
          <TextLabel1
            as="span"
            tabularNumbers
            noWrap
            style={{ marginInlineStart: 'auto', color: directionVar(parts.uPnl) }}
          >
            {fmtKrwFromMan(parts.uPnl)}
          </TextLabel1>
        </HStack>
      </VStack>
    </HStack>
  );
}
