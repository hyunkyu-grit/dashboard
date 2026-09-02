'use client';

/* BSS 테너 **통합** 장부 창 [OWNER 2026-09-01 — "BSS만을 활용한 전략을 구상한다고
 * 할 때 지금은 각 테너별로 흩어져있는데, BSS 테너 통합 밴드 워치를 하나 만들어서
 * 승률 및 세부사항들을 확인할 수 있게 해줘"].
 *
 * 낱개 창(`StrategyWindow`)은 **한 만기**를 재현한다. 이 창은 같은 규칙을 아홉
 * 만기에 **동시에** 걸었을 때의 한 장부다. 노브는 공용(`KnobBar`)이고 산술은
 * 서버(`backend/app/mrbook.py`)이며, 계열 하나의 준비·시뮬은 낱개 창과 같은
 * 함수(`main._mr_leg`)라 통합의 수는 낱개 아홉의 합과 갈릴 수 없다.
 *
 * ── 이 창이 낱개 창과 **일부러 다른 것** 셋 ──────────────────────────────────
 *
 * ① **승률은 한 통에 모은 거래의 승률이다.** 아홉 승률의 평균이 아니다 —
 *    거래 수가 6건과 58건인 두 만기를 평균 내면 그 수는 아무것도 아니다.
 * ② **걸린 돈을 말한다.** 동일가중 합이라 아홉이 동시에 서면 명목이 아홉 배다.
 *    「최대 동시 다리」와 그 날짜가 없으면 명목 100만원/bp 라고 적힌 화면이
 *    실제로는 900만원/bp 를 움직인다.
 * ③ **묶어서 나아졌는지를 답한다.** 통합 SR 옆에 개별 SR 중앙값·쌍상관·유효
 *    독립 계열 수가 선다. 그게 없으면 통합은 그냥 큰 숫자일 뿐이다.
 *
 * 없는 것도 적어 둔다: **이웃 칸(노브 민감도)이 없다.** 노브 하나를 옮길 때마다
 * 아홉 계열을 다시 돌아야 해서 열두 칸이면 백여덟 번이다. 견고성은 낱개 창에서
 * 계열별로 본다 — 여기서 반쯤 흉내 내면 두 화면이 다른 격자를 말하게 된다.
 *
 * 명구 의무는 낱개 창과 같다: 재현 도구이고 당일 종가 체결 규약이며 국고 다리는
 * 민평이다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { Text } from '@coinbase/cds-web/typography';

import { TimeChart, useStackedScales, type TimeLine } from '@/chart/TimeChart';
import type { ScalePriceLine } from '@/chart/ScaleChart';
import { BacktestUnavailable } from '@/lib/api';
import { fmtKrw } from '@/lib/krw';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { ReadoutCard, ReadoutFact, ReadoutMoney, placeReadout } from '@/ui/ReadoutCard';
import { Stat, StatColumn } from '@/ui/Stat';

import {
  MR_REGIMES,
  MR_STRATEGY_DEFAULTS,
  fetchMrBook,
  type MrBookLeg,
  type MrBookRun,
  type MrStrategyParams,
} from './api';
import { MrKnobBar, mrKnobsStale } from './KnobBar';
import { Panel, WHY_WORD, ym } from './parts';

const CHART_H = 200;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const bp = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}bp`;

/** 만기별 표의 숫자 한 칸 — 손익만 방향색이다(낱개 창 거래 표와 같은 규칙). */
function Num({ v, tone }: { v: string; tone?: 'up' | 'down' }) {
  return (
    <TableCell className="sr-num" justifyContent="flex-end">
      <Text
        font="label2"
        as="span"
        tabularNumbers
        noWrap
        className={tone === 'up' ? 'sr-up' : tone === 'down' ? 'sr-down' : undefined}
      >
        {v}
      </Text>
    </TableCell>
  );
}

/** 만기별 성적 — **만기 순**이다(랭킹 순이 아니다).
 *
 * 순서가 곧 주장이다: 통합 장부에서 알고 싶은 것은 「어느 만기가 1등인가」가
 * 아니라 「커브의 어디가 버는가」라, 6M→10Y 로 세워야 그 모양이 보인다(실측에서
 * 짧은 쪽이 세다 — `docs/MR_LANE_STATE.md` 의 신호일 앞수익 표).
 */
function LegTable({ run, onPick }: { run: MrBookRun; onPick?: (id: string) => void }) {
  return (
    <Box style={{ position: 'relative', height: CHART_H, overflow: 'auto' }} width="100%">
      <Table bordered={false}>
        <TableHeader sticky>
          <TableRow>
            <TableCell as="th" scope="col">
              <Text font="caption" as="span" color="fgMuted">만기</Text>
            </TableCell>
            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
              <Text font="caption" as="span" color="fgMuted">거래</Text>
            </TableCell>
            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
              <Text font="caption" as="span" color="fgMuted">승률</Text>
            </TableCell>
            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
              <Text font="caption" as="span" color="fgMuted">손익</Text>
            </TableCell>
            {/* `caption` 은 대문자로 세운다 — 「SR」은 원래 대문자라 무해하지만
                「bp」·「z」가 든 머리는 `legal` 이다(낱개 창 대사표의 판례). */}
            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
              <Text font="caption" as="span" color="fgMuted">SR</Text>
            </TableCell>
            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
              <Text font="caption" as="span" color="fgMuted">최대 낙폭</Text>
            </TableCell>
            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
              <Text font="caption" as="span" color="fgMuted">평균 보유</Text>
            </TableCell>
            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
              <Text font="caption" as="span" color="fgMuted">몫</Text>
            </TableCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {run.legs.map((g: MrBookLeg) => (
            <TableRow
              key={g.id}
              tabIndex={onPick ? 0 : undefined}
              style={onPick ? { cursor: 'pointer' } : undefined}
              onClick={onPick ? () => onPick(g.id) : undefined}
              onKeyDown={
                onPick
                  ? (e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onPick(g.id);
                      }
                    }
                  : undefined
              }
            >
              <TableCell>
                <Text font="label2" as="span" noWrap>
                  {g.tenor}
                </Text>
              </TableCell>
              <Num v={String(g.numTrades)} />
              <Num v={g.winRate == null ? '—' : pct(g.winRate)} />
              <Num
                v={fmtKrw(g.totalPnl)}
                tone={g.totalPnl > 0 ? 'up' : g.totalPnl < 0 ? 'down' : undefined}
              />
              <Num v={g.sharpe == null ? '—' : g.sharpe.toFixed(2)} />
              <Num v={fmtKrw(-g.maxDrawdown)} />
              <Num v={g.avgBars == null ? '—' : `${g.avgBars.toFixed(1)}봉`} />
              {/* 몫은 **양수 다리에만** 있다 — 총합이 0 이하이거나 이 다리가
                  음수면 서버가 null 을 준다(120% 같은 수를 안 적는다). */}
              <Num v={g.share == null ? '—' : pct(g.share)} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

/** 한 통에 모은 거래 — 첫 칸이 **어느 만기**다. */
function TradeTable({ run }: { run: MrBookRun }) {
  return (
    <Box style={{ position: 'relative', height: CHART_H, overflow: 'auto' }} width="100%">
      <Table bordered={false}>
        <TableHeader sticky>
          <TableRow>
            <TableCell as="th" scope="col">
              <Text font="caption" as="span" color="fgMuted">만기</Text>
            </TableCell>
            <TableCell as="th" scope="col">
              <Text font="caption" as="span" color="fgMuted">진입</Text>
            </TableCell>
            <TableCell as="th" scope="col">
              <Text font="caption" as="span" color="fgMuted">청산</Text>
            </TableCell>
            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
              <Text font="legal" as="span" color="fgMuted">진입 z</Text>
            </TableCell>
            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
              <Text font="legal" as="span" color="fgMuted">청산 z</Text>
            </TableCell>
            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
              <Text font="caption" as="span" color="fgMuted">손익</Text>
            </TableCell>
            <TableCell as="th" scope="col">
              <Text font="caption" as="span" color="fgMuted">사유</Text>
            </TableCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {run.trades.map((t) => (
            <TableRow key={`${t.sid}-${t.entryT}-${t.exitT}`}>
              <TableCell>
                <Text font="label2" as="span" noWrap>
                  {t.tenor}
                </Text>
              </TableCell>
              <TableCell>
                <Text font="label2" as="span" tabularNumbers noWrap>{t.entryT}</Text>
              </TableCell>
              <TableCell>
                <Text font="label2" as="span" tabularNumbers noWrap>{t.exitT}</Text>
              </TableCell>
              <Num v={`${t.entryZ.toFixed(2)}σ`} />
              {/* 타임스탑 청산은 z=null 봉에 앉을 수 있다(api.ts `exitZ`). */}
              <Num v={t.exitZ == null ? '—' : `${t.exitZ.toFixed(2)}σ`} />
              <Num
                v={fmtKrw(t.pnl)}
                tone={t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : undefined}
              />
              <TableCell>
                <Text font="label2" as="span" color="fgMuted" noWrap>
                  {WHY_WORD[t.why]}
                </Text>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

export function BookWindow({
  onClose,
  onPickLeg,
}: {
  onClose: () => void;
  /** 만기 줄을 누르면 보드의 그 계열로 옮겨 간다 — 통합에서 낱개로 내려가는 문. */
  onPickLeg?: (id: string) => void;
}) {
  const [knobs, setKnobs] = useState<MrStrategyParams>(MR_STRATEGY_DEFAULTS);
  const [run, setRun] = useState<MrBookRun>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [idx, setIdx] = useState<{ chart: 'eq' | 'legs'; i: number } | null>(null);
  /* 아래쪽 패널이 만기별 성적과 거래 목록 중 무엇을 드는가. 표 둘을 세로로
     쌓으면 창이 두 배가 되고, 나란히 두면 열이 열넷이라 어느 쪽도 안 읽힌다. */
  const [tab, setTab] = useState<'legs' | 'trades'>('legs');

  const exec = useCallback(() => {
    setError(undefined);
    setRunning(true);
    fetchMrBook(knobs)
      .then(setRun)
      .catch((e: unknown) => {
        if (e instanceof BacktestUnavailable) setError('실행 중인 백엔드(:8200)가 필요해요.');
        else setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setRunning(false));
  }, [knobs]);

  /* 창을 열면 한 번 돌린다 — 낱개 창과 **다른 판단**이다. 저기는 종목을 고른
     뒤 여는 창이라 「무엇을 재현할지」가 이미 정해져 있고, 여기는 종목이 없어
     첫 화면이 빈 채로 서면 이 창이 무엇인지 자체가 안 보인다. 그 뒤로는 노브를
     바꿔도 **사람이 실행을 눌러야** 숫자가 바뀐다(원본의 pinned 규율 그대로). */
  useEffect(() => {
    exec();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stale = useMemo(() => (run ? mrKnobsStale(run.params, knobs) : false), [run, knobs]);
  const dates = useMemo(() => run?.points.map((p) => p.t) ?? [], [run]);
  const stack = useStackedScales();

  const only = run && run.dirs.allowed.length === 1
    ? (run.dirs.allowed[0]! > 0 ? run.dirs.plus : run.dirs.minus)
    : null;

  /* 켜져 있는 실전 규칙 — 낱개 창과 같은 문장을 쓴다. */
  const liveOn = !run ? [] : [
    run.params.timeStop ? `타임스탑 ${run.params.timeStop}일` : null,
    run.params.regime !== 'none'
      ? `레짐필터(${MR_REGIMES.find((r) => r.v === run.params.regime)?.label})` : null,
    run.params.costModel === 'dynamic' ? '동적비용' : null,
    run.params.reverseExit ? '역신호청산' : null,
    run.params.countOpen ? '미청산 계상' : null,
  ].filter((x): x is string => x !== null);

  /* 손익 곡선은 부호가 색을 정한다 — LinkedCharts 누적 손익의 그 문법. */
  const eqHue = (run?.summary.totalPnl ?? 0) >= 0 ? 'var(--sr-up)' : 'var(--sr-down)';
  const eqLines: TimeLine[] = !run ? [] : [
    {
      id: 'cum',
      values: run.points.map((p) => p.cum),
      color: (pa) => pa.resolve(eqHue),
      area: 'solid',
      areaColor: (pa) => pa.dim(eqHue, 14),
      format: (v: number) => fmtKrw(v),
    },
  ];
  /* 동시 다리 수 — **계단**이다. 하루 사이에 0.4다리 같은 것은 없고, 부드러운
     선으로 그리면 없는 중간값을 그림이 지어낸다(기준금리 선의 그 규칙). */
  const legLines: TimeLine[] = !run ? [] : [
    {
      id: 'legs',
      values: run.points.map((p) => p.legs),
      color: (pa) => pa.fg,
      step: true,
      area: 'solid',
      areaColor: (pa) => pa.dim('var(--color-fg)', 10),
      format: (v: number) => `${v}다리`,
    },
  ];
  const zeroLine: ScalePriceLine[] = [{ value: 0, color: (pa) => pa.line }];
  /* 아홉이 다 선 자리 — 「여기가 명목의 천장」을 그림이 스스로 말한다. */
  const capLine: ScalePriceLine[] = !run ? [] : [
    { value: 0, color: (pa) => pa.line },
    { value: run.legs.length, color: (pa) => pa.lineHeavy, dash: true },
  ];

  return (
    <FloatingWindow
      windowKey="mrbook"
      title="BSS 통합 장부"
      width={1120}
      aside={
        <Text font="legal" as="span" color="fgMuted" noWrap>
          아홉 만기를 같은 규칙으로 동시에 — 재현 도구예요, 투자판단이 아니에요.
        </Text>
      }
      onClose={onClose}
    >
      <VStack gap={1.5} paddingX={2} paddingY={1.5} width="100%">
        <MrKnobBar
          lead={run ? `BSS 만기 ${run.legs.length}개` : 'BSS 전 만기'}
          leadLabel="장부"
          knobs={knobs}
          onChange={(patch) => setKnobs((k) => ({ ...k, ...patch }))}
          onRun={exec}
          running={running}
        />
        {stale ? (
          <Text font="legal" as="span" color="fgMuted">
            설정이 실행과 달라요 — 실행을 눌러야 아래 숫자에 반영돼요.
          </Text>
        ) : null}
        {error ? (
          <Text font="legal" as="span">
            실행하지 못했어요 — {error}
          </Text>
        ) : null}
        {run && run.excluded.length ? (
          /* 못 선 만기는 조용히 빠지지 않는다 — 여덟의 합을 「아홉 만기 통합」
             이라 부르면 화면이 거짓말을 한다(보드의 exclusions 문법). */
          <Text font="legal" as="span" color="fgMuted">
            {run.excluded.map((x) => `${x.label}: ${x.reason}`).join(' · ')}
          </Text>
        ) : null}

        {!run ? (
          <Text font="legal" as="span" color="fgMuted">
            {running ? '아홉 만기를 돌리는 중이에요…' : '실행을 누르면 아홉 만기를 같은 규칙으로 동시에 재현해요.'}
          </Text>
        ) : (
          <>
            <HStack className="sr-stats" alignItems="stretch" width="100%">
              <StatColumn title="성과">
                <Stat
                  label="총손익"
                  value={fmtKrw(run.summary.totalPnl)}
                  tone={
                    run.summary.totalPnl > 0 ? 'up' : run.summary.totalPnl < 0 ? 'down' : undefined
                  }
                  note={`${run.bars.toLocaleString()}봉 · ${run.from}~${run.to}`}
                />
                <Stat label="최대 낙폭" value={fmtKrw(-run.summary.maxDrawdown)} />
                <Stat
                  label="승률"
                  value={run.summary.winRate == null ? '—' : pct(run.summary.winRate)}
                  /* **분모를 말한다.** 아홉 승률의 평균이 아니라 모은 거래의
                     승률이고, 미청산 다리는 원본 규약대로 여기 안 든다. */
                  note={
                    run.summary.openLegs === 0
                      ? `${run.summary.numTrades}거래를 한 통에`
                      : run.params.countOpen
                        ? `미청산 ${run.summary.openLegs}다리 포함`
                        : `미청산 ${run.summary.openLegs}다리 제외`
                  }
                />
                <Stat
                  label="Sharpe"
                  value={run.summary.sharpe == null ? '—' : run.summary.sharpe.toFixed(2)}
                  note="전 봉 기준"
                />
                <Stat label="거래" value={String(run.summary.numTrades)} />
                {run.summary.openPnl != null ? (
                  <Stat
                    label="미청산"
                    value={fmtKrw(run.summary.openPnl)}
                    tone={run.summary.openPnl > 0 ? 'up' : run.summary.openPnl < 0 ? 'down' : undefined}
                    note={`${run.summary.openLegs}다리`}
                  />
                ) : null}
              </StatColumn>

              {/* 걸린 돈 — 동일가중 합의 **대가**다. 이 칸이 없으면 「명목
                  100만원/bp」가 실제로 움직인 돈을 최대 아홉 배 작게 말한다. */}
              <StatColumn title="장부">
                <Stat
                  label="최대 동시"
                  value={`${run.book.maxLegs}다리`}
                  note={run.book.peakT ?? undefined}
                />
                <Stat
                  label="그때 명목"
                  value={`${run.book.peakNotional.toLocaleString()}원/bp`}
                  note={`명목 ${run.params.notional.toLocaleString()} × ${run.book.maxLegs}`}
                />
                <Stat
                  label="평균 동시"
                  value={run.book.meanLegs == null ? '—' : `${run.book.meanLegs.toFixed(2)}다리`}
                />
                <Stat
                  label="무포지션"
                  value={run.book.idleShare == null ? '—' : pct(run.book.idleShare)}
                  note="다리가 하나도 없던 날"
                />
              </StatColumn>

              <StatColumn title="조건">
                <Stat
                  label="비용"
                  value={run.cost.model === 'flat'
                    ? `편도 ${run.cost.bp}bp`
                    : `편도 ${run.cost.lo}~${run.cost.hi}bp`}
                  note={run.cost.model === 'dynamic' ? `동적 · 중앙 ${run.cost.mid}bp` : undefined}
                />
                {run.summary.breakevenCostBp != null ? (
                  <Stat
                    label="손익분기 비용"
                    value={`편도 ${run.summary.breakevenCostBp.toFixed(2)}bp`}
                    tone={run.summary.breakevenCostBp <= run.params.costBp ? 'down' : undefined}
                    note={
                      run.summary.breakevenCostBp <= run.params.costBp
                        ? '지금 비용에서 이미 손실'
                        : `여유 ${(run.summary.breakevenCostBp - run.params.costBp).toFixed(2)}bp`
                    }
                  />
                ) : run.summary.breakevenCostMult != null ? (
                  <Stat
                    label="손익분기 비용"
                    value={`지금 경로의 ${run.summary.breakevenCostMult.toFixed(1)}배`}
                    tone={run.summary.breakevenCostMult <= 1 ? 'down' : undefined}
                    note={run.summary.breakevenCostMult <= 1 ? '지금 비용에서 이미 손실' : undefined}
                  />
                ) : null}
                <Stat label="종가" value={run.asof ?? '—'} />
                <Stat label="방향" value={only ? only.legs : '양방향'} />
                {run.dirs.why ? (
                  <Stat
                    label="막힌 진입"
                    value={`${run.dirs.blocked.spells}회`}
                    note={`만기 ${run.legs.length}개 합계`}
                  />
                ) : null}
                {run.params.regime !== 'none' ? (
                  <Stat
                    label="필터가 지운 진입"
                    value={`${run.gated.spells}회`}
                    note={run.gated.spells === 0 ? '한 건도 안 막았어요' : `${run.gated.days}일`}
                  />
                ) : null}
              </StatColumn>
            </HStack>

            {/* ── 묶어서 나아졌나 — 이 창의 존재 이유를 한 줄이 답한다 ─────── */}
            <VStack gap={0.5} width="100%">
              <HStack gap={1} alignItems="baseline" justifyContent="space-between">
                <Text font="label2" as="h3" noWrap>
                  묶어서 나아졌나
                </Text>
                <Text font="legal" as="span" color="fgMuted">
                  분산 효과는 쌍상관이 정해요 — 아홉이 같이 움직이면 아홉이 아니에요
                </Text>
              </HStack>
              <HStack className="sr-stats" alignItems="stretch" width="100%">
                <StatColumn title="통합 대 개별">
                  <Stat
                    label="통합 SR"
                    value={run.summary.sharpe == null ? '—' : run.summary.sharpe.toFixed(2)}
                  />
                  <Stat
                    label="개별 SR 중앙"
                    value={run.diag.legSharpe.median == null ? '—' : run.diag.legSharpe.median.toFixed(2)}
                    note={
                      run.diag.legSharpe.min == null || run.diag.legSharpe.max == null
                        ? undefined
                        : `${run.diag.legSharpe.min.toFixed(2)} ~ ${run.diag.legSharpe.max.toFixed(2)}`
                    }
                  />
                  <Stat
                    label="양수 만기"
                    value={`${run.diag.legSharpe.positive}/${run.diag.legSharpe.n}`}
                    note="SR 기준"
                  />
                </StatColumn>
                <StatColumn title="분산">
                  <Stat
                    label="평균 쌍상관"
                    value={
                      run.diag.diversification.meanPairCorr == null
                        ? '—'
                        : run.diag.diversification.meanPairCorr.toFixed(3)
                    }
                    note="일별 손익끼리"
                  />
                  <Stat
                    label="유효 독립"
                    value={
                      run.diag.diversification.effectiveN == null
                        ? '—'
                        : `${run.diag.diversification.effectiveN.toFixed(1)}/${run.diag.diversification.n}`
                    }
                    note="N / (1 + (N−1)·상관)"
                  />
                </StatColumn>
                <StatColumn title="승률의 출처">
                  {run.diag.exits.map((e) => (
                    <Stat
                      key={e.why}
                      label={WHY_WORD[e.why]}
                      value={`${e.n}건 · ${pct(e.winRate)}`}
                      note={`평균 ${bp(e.avgBp)} · ${e.avgBars.toFixed(1)}일`}
                    />
                  ))}
                  {run.diag.payoff ? (
                    <Stat
                      label="손익비"
                      value={run.diag.payoff.payoff == null ? '—' : run.diag.payoff.payoff.toFixed(2)}
                      /* 프로핏팩터가 1 아래면 승률이 아무리 높아도 돈을 잃는다. */
                      tone={
                        run.diag.payoff.profitFactor != null && run.diag.payoff.profitFactor < 1
                          ? 'down'
                          : undefined
                      }
                      note={
                        run.diag.payoff.profitFactor == null
                          ? `이긴 ${run.diag.payoff.wins} / 진 ${run.diag.payoff.losses}`
                          : `프로핏팩터 ${run.diag.payoff.profitFactor.toFixed(2)}`
                      }
                    />
                  ) : null}
                </StatColumn>
                {run.diag.periods.length ? (
                  <StatColumn title="구간별">
                    {run.diag.periods.map((p) => (
                      <Stat
                        key={p.from}
                        label={`${ym(p.from)}~${ym(p.to)}`}
                        value={p.sharpe == null ? '—' : `SR ${p.sharpe.toFixed(2)}`}
                        note={fmtKrw(p.totalPnl)}
                      />
                    ))}
                  </StatColumn>
                ) : null}
              </HStack>
            </VStack>

            {/* ── 곡선 둘, 표 하나 ─────────────────────────────────────────────
                `Panel` 은 낱개 창과 공용이고 `flexBasis: 50%` 인데, 간격까지 더하면
                한 줄에 둘이 안 들어가 실제로는 **한 줄에 하나씩** 선다(실측
                2026-09-01 — 낱개 창도 같다). 여기서 고치면 두 창의 배치가 갈리므로
                그대로 둔다: 이 장부의 주인공은 누적 곡선이라 폭이 넓은 쪽이 낫다. */}
            <HStack gap={2} width="100%" alignItems="stretch" flexWrap="wrap">
              <Panel
                title="누적 손익"
                sub={`${run.summary.numTrades} 거래 · 순 ${fmtKrw(run.summary.totalPnl)}`}
              >
                <Box
                  className="sr-plot"
                  width="100%"
                  onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => placeReadout(e.currentTarget, e.clientX)}
                  onMouseLeave={() => setIdx(null)}
                >
                  <TimeChart
                    height={CHART_H}
                    accessibilityLabel="BSS 통합 누적 손익"
                    dates={dates}
                    lines={eqLines}
                    priceLines={zeroLine}
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'eq', i })}
                    {...stack}
                  />
                  {idx?.chart === 'eq' && run.points[idx.i] ? (
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutMoney k="누적" v={run.points[idx.i]!.cum} />
                      <ReadoutMoney k="그날" v={run.points[idx.i]!.pnl} />
                      <ReadoutFact k="다리" v={`${run.points[idx.i]!.legs}개`} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>

              <Panel
                title="동시 보유 다리"
                sub={`최대 ${run.book.maxLegs} · 평균 ${run.book.meanLegs?.toFixed(2) ?? '—'} · 무포지션 ${
                  run.book.idleShare == null ? '—' : pct(run.book.idleShare)
                }`}
              >
                <Box
                  className="sr-plot"
                  width="100%"
                  onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => placeReadout(e.currentTarget, e.clientX)}
                  onMouseLeave={() => setIdx(null)}
                >
                  <TimeChart
                    height={CHART_H}
                    accessibilityLabel="BSS 통합 동시 보유 다리 수"
                    dates={dates}
                    lines={legLines}
                    priceLines={capLine}
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'legs', i })}
                    {...stack}
                  />
                  {idx?.chart === 'legs' && run.points[idx.i] ? (
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutFact k="다리" v={`${run.points[idx.i]!.legs}개`} />
                      <ReadoutFact
                        k="걸린 명목"
                        v={`${(run.points[idx.i]!.legs * run.params.notional).toLocaleString()}원/bp`}
                      />
                      <ReadoutMoney k="그날" v={run.points[idx.i]!.pnl} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>
            </HStack>

            <HStack gap={2} width="100%" alignItems="stretch">
              <Panel
                title={tab === 'legs' ? '만기별 성적' : '거래'}
                sub={
                  tab === 'legs'
                    ? onPickLeg
                      /* 누르면 창이 바뀐다 — 그 사실을 안 적으면 눌러 보고 나서야
                         안다(랭킹 표의 «줄을 누르면 이력이 열려요» 와 같은 규율). */
                      ? '만기 순이에요 — 줄을 누르면 그 만기의 낱개 창으로 바뀌어요'
                      : '만기 순이에요 — 커브의 어디가 벌었는지가 순위로는 안 보여요'
                    : `${run.summary.numTrades}건을 한 통에${only ? ` · ${only.legs}` : ''}`
                }
                aside={
                  <HStack gap={0.5} alignItems="center">
                    <button
                      type="button"
                      className="sr-pillbtn"
                      data-on={tab === 'legs' || undefined}
                      aria-pressed={tab === 'legs'}
                      onClick={() => setTab('legs')}
                    >
                      만기별
                    </button>
                    <button
                      type="button"
                      className="sr-pillbtn"
                      data-on={tab === 'trades' || undefined}
                      aria-pressed={tab === 'trades'}
                      onClick={() => setTab('trades')}
                    >
                      거래
                    </button>
                  </HStack>
                }
              >
                {tab === 'legs' ? <LegTable run={run} onPick={onPickLeg} /> : <TradeTable run={run} />}
              </Panel>
            </HStack>

            <Text font="legal" as="span" color="fgMuted">
              만기 {run.legs.length}개에 각각 명목 {run.params.notional.toLocaleString()}원/bp 를
              걸고 일별 손익을 더한 장부예요 — 승률·손익비는 아홉 목록을 한 통에 모아서
              셌어요(아홉 승률의 평균이 아니에요). 동시에 선 다리가 최대 {run.book.maxLegs}개라
              그날 걸린 돈은 {run.book.peakNotional.toLocaleString()}원/bp 예요.{' '}
              {run.dirs.why
                ? `${run.dirs.why} 그래서 못 들어간 진입 신호가 만기 ${run.legs.length}개 합계 ${run.dirs.blocked.spells}회(${run.dirs.blocked.days}일) 있어요. `
                : ''}
              {run.carry.on && run.carry.defn
                ? `캐리는 ${run.carry.defn}이고 조달은 ${run.carry.funding} 이에요. `
                : ''}
              {liveOn.length
                ? `실전 규칙 ${liveOn.join(' · ')}이 켜져 있어요 — 끄면 원본 PMS 재현 그대로예요. `
                : ''}
              노브 민감도(이웃 칸)는 여기 없어요 — 한 칸마다 만기 {run.legs.length}개를 다시
              돌아야 해서, 견고성은 낱개 계열 창에서 봐요. 국고 다리는 민평(평가사 고시) 기준이고 당일
              종가 체결 규약이에요.
            </Text>
          </>
        )}
      </VStack>
    </FloatingWindow>
  );
}
