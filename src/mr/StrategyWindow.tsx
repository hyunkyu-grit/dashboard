'use client';

/* 전략 실험 창 — 첫 PMS(krw-fi-pms) entry-signals 워크스페이스의 기술적 구성을
 * v2 문법으로 재현한 것 [OWNER 2026-08-25 — "맨처음 만들었던 PMS 에서 볼린저
 * 밴드 활용한 트레이딩 전략 했던 창 참고해서 기술적 구성 구현하기"].
 *
 * ── 원본에서 가져온 것 ──────────────────────────────────────────────────────
 * · 노브 일곱(룩백 프리셋 20/60/120 + 자유값·진입σ·관찰σ·청산σ·손절σ·비용bp·
 *   명목 ₩/bp)과 그 기본값(s16) — 밴드 배수가 곧 진입σ라는 «노브 하나, 뜻 둘»
 *   까지 그대로.
 * · z-문턱 레벨 규칙(진입 |z|≥entryσ 역행·청산 |z|≤exitσ·손절 |z|≥stopσ 우선·
 *   당일 종가 체결·편도 비용) — 산술은 서버가 끝낸다(§16, mrbacktest.py 가
 *   원본과 적합성 벡터로 잠금).
 * · 패널 넷: 가격+SMA+밴드 / z 오실레이터(가이드 5줄 + 진입 마커) / 에쿼티
 *   커브 / KPI 타일+거래 표.
 * · «실행 시점 고정(pinned)» 규율: 노브를 실행 없이 바꾸면 숫자를 조용히
 *   재계산하지 않는다 — stale 문구가 서고 오실레이터 마커가 숨는다.
 * · 실행은 사람이 누른다 — v2 백테스트 창과 원본 staged flow 가 같은 규칙이다.
 *
 * ── v2 로 옮기며 바꾼 것(문법 충돌 자리) ────────────────────────────────────
 * · 차트는 lightweight-charts 가 아니라 CDS CartesianChart — 리드아웃·스크러버
 *   는 이 리포 공용 기구(ReadoutCard)를 쓴다.
 * · 진입/청산 마커는 원형/사각 심볼 대신 ReferenceLine 세로선 — LinkedCharts 의
 *   마커 문법이다. 거래별 정밀값은 거래 표가 진다.
 * · Jade/Berry 방향색 대신 이 리포의 방향색(--sr-up/--sr-down) — 색은 방향만
 *   나른다는 규칙 그대로.
 *
 * **명구 의무**: 이 창은 재현 도구다. 당일 종가 체결 규약은 원본 그대로이며
 * 체결 가능성을 담보하지 않는다(연구 레인의 «즉시체결판은 상한» 실측 — 창이
 * 그 사실을 말한다). 신호 검증(NO-GO)과 딴 물건임도 aside 가 말한다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { TextInput } from '@coinbase/cds-web/controls';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';
import {
  CartesianChart,
  Line,
  ReferenceLine,
  Scrubber,
  XAxis,
  YAxis,
} from '@coinbase/cds-web/visualizations/chart';

import type { Unit } from '@/lib/api';
import { BacktestUnavailable } from '@/lib/api';
import { fmtLevel, unitSuffix } from '@/lib/format';
import { fmtKrw } from '@/lib/krw';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { ReadoutCard, ReadoutLevel, ReadoutMoney, placeReadout } from '@/ui/ReadoutCard';

import {
  MR_STRATEGY_DEFAULTS,
  MR_STRATEGY_LOOKBACKS,
  fetchMrStrategy,
  type MrStrategyParams,
  type MrStrategyRun,
} from './api';

/* 얼라인 규칙 [OWNER 2026-08-25 — CLAUDE.md «얼라인» 절]. 첫 판은 라벨을
 * 컨트롤 **옆**에 붙였고, 라벨 폭이 제각각이라 컨트롤 시작점이 계단이 졌다
 * ("아주 얼라인이 개판이야"). 백테스트·시뮬 창의 Field 문법(라벨 위·바닥 정렬·
 * 등고 32px)으로 다시 세운다. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <VStack gap={0.25} minWidth={0}>
      <Text font="caption" as="span" color="fgMuted" noWrap>
        {label}
      </Text>
      {children}
    </VStack>
  );
}

/** 숫자 칸 — blur/Enter 커밋(시뮬 NumField·rv BpField 의 규율: onChange 즉시
 * 파싱은 "-"·"1." 을 삼킨다). 라벨은 Field 가 진다 — 여기는 32px 상자뿐이다. */
function NumInput({
  label,
  value,
  onCommit,
}: {
  /** 접근성 이름 — 같은 모양의 칸이 일곱 개 서므로 각자 이름이 있어야 한다. */
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const shown = String(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  if (!editing && text !== shown) setText(shown);
  const commit = () => {
    setEditing(false);
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n) && n >= 0) onCommit(n);
    else setText(shown);
  };
  return (
    <TextInput
      size="s"
      fontSize="legal"
      height={32}
      accessibilityLabel={label}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

/** KPI 타일 — 작은 회색 라벨 + 굵은 숫자(공간문법). */
function Kpi({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <VStack gap={0.25}>
      <Text font="caption" as="span" color="fgMuted" noWrap>
        {k}
      </Text>
      <Text font="headline" as="span" tabularNumbers noWrap className={cls}>
        {v}
      </Text>
    </VStack>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <VStack gap={0.5} flexBasis="50%" flexGrow={1} minWidth={0}>
      <HStack gap={1} alignItems="baseline" justifyContent="space-between">
        <Text font="label2" as="h3" noWrap>
          {title}
        </Text>
        {sub ? (
          <Text font="legal" as="span" color="fgMuted" noWrap>
            {sub}
          </Text>
        ) : null}
      </HStack>
      {children}
    </VStack>
  );
}

const CHART_H = 200;

export function StrategyWindow({
  id,
  label,
  onClose,
}: {
  id: string;
  label: string;
  onClose: () => void;
}) {
  const [knobs, setKnobs] = useState<MrStrategyParams>(MR_STRATEGY_DEFAULTS);
  const [run, setRun] = useState<MrStrategyRun>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [idx, setIdx] = useState<{ chart: 'price' | 'z' | 'eq'; i: number } | null>(null);

  /* 종목이 바뀌면 지난 실행은 딴 종목의 숫자다 — 남겨 두지 않는다. */
  useEffect(() => {
    setRun(undefined);
    setError(undefined);
  }, [id]);

  const exec = useCallback(() => {
    setError(undefined);
    setRunning(true);
    fetchMrStrategy(id, knobs)
      .then(setRun)
      .catch((e: unknown) => {
        if (e instanceof BacktestUnavailable) setError('실행 중인 백엔드(:8200)가 필요해요.');
        else setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setRunning(false));
  }, [id, knobs]);

  /* pinned 규율 — 실행 시점 파라미터와 지금 노브가 갈리면 stale. */
  const stale = useMemo(() => {
    if (!run) return false;
    const p = run.params;
    return (
      p.lookback !== knobs.lookback ||
      p.entryZ !== knobs.entryZ ||
      p.warnZ !== knobs.warnZ ||
      p.exitZ !== knobs.exitZ ||
      p.stopZ !== knobs.stopZ ||
      p.costBp !== knobs.costBp ||
      p.notional !== knobs.notional
    );
  }, [run, knobs]);

  const dates = useMemo(() => run?.points.map((p) => p.t) ?? [], [run]);
  const entryIdx = useMemo(() => {
    if (!run) return [];
    const at = new Map(dates.map((t, i) => [t, i]));
    return run.trades
      .map((t) => ({ i: at.get(t.entryT) ?? -1, dir: t.dir }))
      .filter((m) => m.i >= 0);
  }, [run, dates]);

  const unit = (run?.unit ?? 'bp') as Unit;
  const set = (patch: Partial<MrStrategyParams>) => setKnobs((k) => ({ ...k, ...patch }));

  return (
    <FloatingWindow
      windowKey="mrstrategy"
      title="전략 실험"
      width={1120}
      aside={
        <Text font="legal" as="span" color="fgMuted" noWrap>
          첫 PMS 의 z-스코어 규칙 재현이에요 — 투자판단이 아니에요.
        </Text>
      }
      onClose={onClose}
    >
      <VStack gap={1.5} paddingX={2} paddingY={1.5} width="100%">
        {/* ── 설정 줄 — 원본 노브 일곱 + 실행. 실행은 사람이 누른다.
            바닥 정렬 행: 블록 높이가 곧 라벨 높이(2026-08-19 얼라인 레인),
            한 행의 컨트롤은 전부 32px 등고(control-parity 의 그 등고)라
            실행도 알약이다(rv 「상세 분석」 자리의 그 컨트롤). */}
        <HStack gap={1.5} alignItems="flex-end" flexWrap="wrap">
          <Field label="종목">
            {/* 컨트롤이 아닌 값도 같은 32px 상자에 담는다 — 백테스트 「진입
                레벨」 칸의 판례(안 담으면 이 블록만 바닥에서 어긋난다). */}
            <HStack height={32} alignItems="center">
              <Text font="label2" as="span" noWrap>
                {label}
              </Text>
            </HStack>
          </Field>
          <Field label="룩백 (일)">
            <HStack gap={0.5} alignItems="center">
              {MR_STRATEGY_LOOKBACKS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className="sr-rv-pillbtn"
                  data-on={knobs.lookback === w || undefined}
                  aria-pressed={knobs.lookback === w}
                  onClick={() => set({ lookback: w })}
                >
                  {w}
                </button>
              ))}
              <Box width={56}>
                <NumInput label="룩백(일)" value={knobs.lookback}
                  onCommit={(v) => set({ lookback: Math.max(2, Math.round(v)) })} />
              </Box>
            </HStack>
          </Field>
          <Box width={64}>
            <Field label="진입 σ">
              <NumInput label="진입 σ" value={knobs.entryZ} onCommit={(v) => set({ entryZ: v })} />
            </Field>
          </Box>
          <Box width={64}>
            <Field label="관찰 σ">
              <NumInput label="관찰 σ" value={knobs.warnZ} onCommit={(v) => set({ warnZ: v })} />
            </Field>
          </Box>
          <Box width={64}>
            <Field label="청산 σ">
              <NumInput label="청산 σ" value={knobs.exitZ} onCommit={(v) => set({ exitZ: v })} />
            </Field>
          </Box>
          <Box width={64}>
            <Field label="손절 σ">
              <NumInput label="손절 σ" value={knobs.stopZ} onCommit={(v) => set({ stopZ: v })} />
            </Field>
          </Box>
          <Box width={64}>
            <Field label="비용 (bp)">
              <NumInput label="비용(bp)" value={knobs.costBp} onCommit={(v) => set({ costBp: v })} />
            </Field>
          </Box>
          <Box width={96}>
            <Field label="명목 (₩/bp)">
              <NumInput label="명목(₩/bp)" value={knobs.notional}
                onCommit={(v) => set({ notional: v })} />
            </Field>
          </Box>
          <button
            type="button"
            className="sr-rv-pillbtn"
            disabled={running}
            onClick={exec}
          >
            {running ? '계산 중…' : '실행'}
          </button>
        </HStack>
        {stale ? (
          /* 조용한 재계산 금지 — 원본의 stale 배너 + 마커 숨김 규율 그대로. */
          <Text font="legal" as="span" color="fgMuted">
            설정이 실행과 달라요 — 실행을 눌러야 아래 숫자에 반영돼요. 진입 마커는 숨겼어요.
          </Text>
        ) : null}
        {error ? (
          <Text font="legal" as="span">
            실행하지 못했어요 — {error}
          </Text>
        ) : null}

        {!run ? (
          <Text font="legal" as="span" color="fgMuted">
            실행을 누르면 이 종목의 과거 전체(2020~)를 원본 규칙으로 재현해요. 당일 종가
            체결 규약이라 체결 가능성은 담보하지 않아요.
          </Text>
        ) : (
          <>
            {/* ── KPI 타일 — 원본 다섯 그대로, 표기는 이 리포 문법(억/만). ── */}
            <HStack gap={4} alignItems="flex-end" flexWrap="wrap">
              <Kpi
                k="총손익"
                v={fmtKrw(run.summary.totalPnl)}
                cls={run.summary.totalPnl > 0 ? 'sr-up' : run.summary.totalPnl < 0 ? 'sr-down' : undefined}
              />
              <Kpi k="최대 낙폭" v={fmtKrw(-run.summary.maxDrawdown)} />
              <Kpi
                k="승률"
                v={run.summary.winRate == null ? '—' : `${Math.round(run.summary.winRate * 100)}%`}
              />
              <Kpi k="Sharpe" v={run.summary.sharpe == null ? '—' : run.summary.sharpe.toFixed(2)} />
              <Kpi k="거래" v={String(run.summary.numTrades)} />
              <Text font="legal" as="span" color="fgMuted" noWrap>
                {run.asof} 까지 · 비용 편도 {run.params.costBp}bp · 명목 ₩{run.params.notional.toLocaleString()}/bp
              </Text>
            </HStack>

            {/* ── 2×2 패널 — 원본 결과 그리드의 배치. ───────────────────── */}
            <HStack gap={2} width="100%" alignItems="stretch" flexWrap="wrap">
              <Panel title="가격 · SMA · 밴드" sub={`밴드 = 평균 ±${run.params.entryZ}σ`}>
                <Box
                  className="sr-plot"
                  width="100%"
                  onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => placeReadout(e.currentTarget, e.clientX)}
                  onMouseLeave={() => setIdx(null)}
                >
                  <CartesianChart
                    enableScrubbing
                    onScrubberPositionChange={(i) => setIdx(i == null ? null : { chart: 'price', i })}
                    animate={false}
                    height={CHART_H}
                    accessibilityLabel={`${label} 가격과 밴드`}
                    inset={{ top: 12, right: 12, bottom: 8, left: 8 }}
                    /* 색·축은 Main/Backtest 문법 [OWNER 2026-08-25]: 주선 잉크·
                       보조선 뮤트·축 라벨은 fmtLevel. */
                    series={[
                      { id: 'v', data: run.points.map((p) => p.v), color: 'var(--color-fg)', yAxisId: 'y' },
                      { id: 'ma', data: run.points.map((p) => p.ma), color: 'var(--color-fgMuted)', yAxisId: 'y' },
                      { id: 'up', data: run.points.map((p) => p.up), color: 'var(--color-fgMuted)', yAxisId: 'y' },
                      { id: 'lo', data: run.points.map((p) => p.lo), color: 'var(--color-fgMuted)', yAxisId: 'y' },
                    ]}
                    xAxis={{ data: dates }}
                    yAxis={[{ id: 'y' }]}
                  >
                    <XAxis showGrid={false} />
                    <YAxis
                      axisId="y"
                      position="right"
                      showGrid={false}
                      tickLabelFormatter={(v: number) => fmtLevel(v, unit)}
                    />
                    <Line seriesId="up" strokeWidth={1} strokeOpacity={0.45} connectNulls={false} />
                    <Line seriesId="lo" strokeWidth={1} strokeOpacity={0.45} connectNulls={false} />
                    <Line seriesId="ma" strokeWidth={1.5} strokeOpacity={0.7} connectNulls={false} />
                    <Line seriesId="v" curve="linear" connectNulls={false} />
                    <Scrubber accessibilityLabel="가격 짚기" seriesIds={['v']} />
                  </CartesianChart>
                  {idx?.chart === 'price' && run.points[idx.i] ? (
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutLevel k="값" v={run.points[idx.i]!.v} unit={unit} />
                      <ReadoutLevel k="중심선" v={run.points[idx.i]!.ma} unit={unit} />
                      <ReadoutLevel k="상단" v={run.points[idx.i]!.up} unit={unit} />
                      <ReadoutLevel k="하단" v={run.points[idx.i]!.lo} unit={unit} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>

              <Panel
                title="z 오실레이터"
                sub={`진입 ±${run.params.entryZ}σ · 관찰 ±${run.params.warnZ}σ · 진입 마커 ${stale ? '숨김' : `${entryIdx.length}`}`}
              >
                <Box
                  className="sr-plot"
                  width="100%"
                  onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => placeReadout(e.currentTarget, e.clientX)}
                  onMouseLeave={() => setIdx(null)}
                >
                  <CartesianChart
                    enableScrubbing
                    onScrubberPositionChange={(i) => setIdx(i == null ? null : { chart: 'z', i })}
                    animate={false}
                    height={CHART_H}
                    accessibilityLabel={`${label} z-스코어`}
                    inset={{ top: 12, right: 12, bottom: 8, left: 8 }}
                    series={[{ id: 'z', data: run.points.map((p) => p.z), color: 'var(--color-fg)', yAxisId: 'y' }]}
                    xAxis={{ data: dates }}
                    yAxis={[{ id: 'y' }]}
                  >
                    <XAxis showGrid={false} />
                    <YAxis
                      axisId="y"
                      position="right"
                      showGrid={false}
                      tickLabelFormatter={(v: number) => `${v.toFixed(1)}σ`}
                    />
                    <ReferenceLine dataY={0} yAxisId="y" />
                    <ReferenceLine dataY={run.params.entryZ} yAxisId="y" />
                    <ReferenceLine dataY={-run.params.entryZ} yAxisId="y" />
                    <ReferenceLine dataY={run.params.warnZ} yAxisId="y" />
                    <ReferenceLine dataY={-run.params.warnZ} yAxisId="y" />
                    {/* 마커는 거래 목록에서만 나온다 — 병렬 유도는 원본이 시험으로
                        금지한 결함(s19). stale 이면 숨긴다. */}
                    {stale
                      ? null
                      : entryIdx.map((m) => <ReferenceLine key={m.i} dataX={m.i} />)}
                    <Line seriesId="z" curve="linear" connectNulls={false} />
                    <Scrubber accessibilityLabel="z 짚기" seriesIds={['z']} />
                  </CartesianChart>
                  {idx?.chart === 'z' && run.points[idx.i] ? (
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutLevel k="z" v={run.points[idx.i]!.z} unit={'ratio' as Unit} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>
            </HStack>

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
                  <CartesianChart
                    enableScrubbing
                    onScrubberPositionChange={(i) => setIdx(i == null ? null : { chart: 'eq', i })}
                    animate={false}
                    height={CHART_H}
                    accessibilityLabel={`${label} 누적 손익`}
                    inset={{ top: 12, right: 12, bottom: 8, left: 8 }}
                    /* 손익 곡선은 부호가 색을 정한다 — LinkedCharts 누적 손익의
                       그 문법(`--sr-up`/`--sr-down`). */
                    series={[{
                      id: 'cum',
                      data: run.points.map((p) => p.cum),
                      color: run.summary.totalPnl >= 0 ? 'var(--sr-up)' : 'var(--sr-down)',
                      yAxisId: 'y',
                    }]}
                    xAxis={{ data: dates }}
                    yAxis={[{ id: 'y' }]}
                  >
                    <XAxis showGrid={false} />
                    <YAxis
                      axisId="y"
                      position="right"
                      showGrid={false}
                      tickLabelFormatter={(v: number) => fmtKrw(v)}
                    />
                    <ReferenceLine dataY={0} yAxisId="y" />
                    <Line seriesId="cum" curve="linear" showArea connectNulls={false} />
                    <Scrubber accessibilityLabel="누적 손익 짚기" seriesIds={['cum']} />
                  </CartesianChart>
                  {idx?.chart === 'eq' && run.points[idx.i] ? (
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutMoney k="누적" v={run.points[idx.i]!.cum} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>

              <Panel title="거래" sub={run.trades.length === 0 ? '이 창에 거래가 없어요' : undefined}>
                <Box style={{ position: 'relative', height: CHART_H, overflow: 'auto' }} width="100%">
                  <table className="sr-rv-table sr-rv-divided">
                    <thead>
                      <tr>
                        <th className="sr-rv-th sr-rv-left">진입</th>
                        <th className="sr-rv-th sr-rv-left">청산</th>
                        <th className="sr-rv-th sr-rv-left">방향</th>
                        <th className="sr-rv-th">진입 z</th>
                        <th className="sr-rv-th">청산 z</th>
                        <th className="sr-rv-th">손익</th>
                        <th className="sr-rv-th sr-rv-left">사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.trades.map((t) => (
                        <tr key={`${t.entryT}-${t.exitT}`}>
                          <td className="sr-rv-td sr-rv-left">{t.entryT}</td>
                          <td className="sr-rv-td sr-rv-left">{t.exitT}</td>
                          <td className="sr-rv-td sr-rv-left">{t.dir > 0 ? '롱' : '숏'}</td>
                          <td className="sr-rv-td">{t.entryZ.toFixed(2)}σ</td>
                          <td className="sr-rv-td">{t.exitZ.toFixed(2)}σ</td>
                          <td className="sr-rv-td">
                            <span className={t.pnl > 0 ? 'sr-up' : t.pnl < 0 ? 'sr-down' : undefined}>
                              {fmtKrw(t.pnl)}
                            </span>
                          </td>
                          <td className="sr-rv-td sr-rv-left">{t.why === 'stop' ? '손절' : '청산'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Panel>
            </HStack>

            <Text font="legal" as="span" color="fgMuted">
              {fmtLevel(run.points.at(-1)?.v ?? null, unit)}
              {unitSuffix(unit)} 기준 · 표본 끝의 미청산 포지션은 누적에는 있고 거래 수에는
              없어요(원본 규약).
            </Text>
          </>
        )}
      </VStack>
    </FloatingWindow>
  );
}
