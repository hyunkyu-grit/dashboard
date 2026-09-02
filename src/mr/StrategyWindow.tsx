'use client';

/* 전략 실험 창 — 첫 PMS(krw-fi-pms) entry-signals 워크스페이스의 기술적 구성을
 * v2 문법으로 재현한 것 [OWNER 2026-08-25 — "맨처음 만들었던 PMS 에서 볼린저
 * 밴드 활용한 트레이딩 전략 했던 창 참고해서 기술적 구성 구현하기"].
 *
 * ── 원본에서 가져온 것 ──────────────────────────────────────────────────────
 * · 노브 일곱(룩백 프리셋 20/60/120 + 자유값·진입σ·관찰σ·청산σ·손절σ·비용bp·
 *   명목 원/bp)과 그 기본값(s16) — 밴드 배수가 곧 진입σ라는 «노브 하나, 뜻 둘»
 *   까지 그대로. **예외 하나: 비용 기본값은 0.05 가 아니라 0.5 다**
 *   [OWNER 2026-08-28]. 0.05 는 PMS 의 값이지 이 데스크의 실측이 아니고, 싸게
 *   잡은 비용은 결론을 통째로 뒤집는다. 규칙은 재현이고 **비용만 실측**이다.
 * · z-문턱 레벨 규칙(진입 |z|≥entryσ 역행·청산 |z|≤exitσ·손절 |z|≥stopσ 우선·
 *   당일 종가 체결·편도 비용) — 산술은 서버가 끝낸다(§16, mrbacktest.py 가
 *   원본과 적합성 벡터로 잠금).
 * · 패널 넷: 가격+SMA+밴드 / z 오실레이터(가이드 5줄 + 진입 마커) / 에쿼티
 *   커브 / KPI 타일+거래 표. **원본은 2×2 격자였고 이 창은 세로 스택**이다
 *   [OWNER 2026-09-02] — 12년 시계열이 반폭에서 안 읽히고, Backtest 창의
 *   세로 결과 같아진다.
 * · «실행 시점 고정(pinned)» 규율: 노브를 실행 없이 바꾸면 숫자를 조용히
 *   재계산하지 않는다 — stale 문구가 서고 오실레이터 마커가 숨는다.
 * · 실행은 사람이 누른다 — v2 백테스트 창과 원본 staged flow 가 같은 규칙이다.
 *
 * ── v2 로 옮기며 바꾼 것(문법 충돌 자리) ────────────────────────────────────
 * · 차트는 공용 `TimeChart`(lightweight-charts) 다 — 원본의 그 라이브러리가
 *   아니고, 이 리포의 15차트가 전부 그것이다(CLAUDE.md 규칙 7). 리드아웃은
 *   공용 기구(`ReadoutCard`)를 쓴다. ⚠ 종전 주석은 「CDS CartesianChart」라고
 *   적혀 있었다 — 2026-08-26 이관 뒤로 거짓이었고 2026-09-02 감사가 잡았다.
 * · 진입/청산은 **점(markers)과 세로선(markLines)을 같이** 쓴다 — 점이 방향색
 *   으로 «무엇을 샀나»를 말하고 세로선이 «언제»를 말한다. 거래별 정밀값은
 *   거래 표가 진다.
 * · 배치는 **세로 스택**이고 차트 셋이 Backtest LINKED PAIR 의 문법을 쓴다
 *   (같은 dates·`useStackedScales`·x 라벨은 맨 위만·십자선 `syncIndex` 동기).
 *   일별 대사는 창 바닥 **서랍**이 진다(Backtest 의 그 자리).
 * · Jade/Berry 방향색 대신 이 리포의 방향색(--sr-up/--sr-down) — 색은 방향만
 *   나른다는 규칙 그대로.
 *
 * **명구 의무**: 이 창은 재현 도구다. 당일 종가 체결 규약은 원본 그대로이며
 * 체결 가능성을 담보하지 않는다(연구 레인의 «즉시체결판은 상한» 실측 — 창이
 * 그 사실을 말한다). 신호 검증(NO-GO)과 딴 물건임도 aside 가 말한다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { Text } from '@coinbase/cds-web/typography';
import { PeriodSelector } from '@coinbase/cds-web/visualizations/chart';

import { TimeChart, useStackedScales, type TimeLine, type TimeMarker } from '@/chart/TimeChart';
import type { ScalePriceLine } from '@/chart/ScaleChart';
import type { Unit } from '@/lib/api';
import { BacktestUnavailable } from '@/lib/api';
import { fmtBp, fmtLevel, unitSuffix } from '@/lib/format';
import { fmtKrw } from '@/lib/krw';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { ReadoutCard, ReadoutFact, ReadoutLevel, ReadoutMoney, placeReadout } from '@/ui/ReadoutCard';
import { Stat, StatColumn } from '@/ui/Stat';

import {
  MR_ENTRY_MODES,
  MR_REGIMES,
  MR_STRATEGY_DEFAULTS,
  MR_STRATEGY_PRESETS,
  fetchMrStrategy,
  fmtSigma,
  type MrStrategyParams,
  type MrStrategyRun,
  type MrStrategyTrade,
} from './api';
import { MrKnobBar, mrKnobsStale } from './KnobBar';
import { Panel, WHY_WORD, headFont, ym } from './parts';

/* 얼라인 규칙 [OWNER 2026-08-25 — CLAUDE.md «얼라인» 절]. 첫 판은 라벨을
 * 컨트롤 **옆**에 붙였고, 라벨 폭이 제각각이라 컨트롤 시작점이 계단이 졌다
 * ("아주 얼라인이 개판이야"). 백테스트·시뮬 창의 Field 문법(라벨 위·바닥 정렬·
 * 등고 32px)으로 다시 세운다. */
/* `Field` 는 여기서 정의하지 않는다 — 앱에 하나뿐인 것을 임포트한다
   (`ui/ControlCard`). 이 파일이 갖고 있던 `help`(값의 출처를 라벨이 진다)는
   그 공용 것으로 올라갔다 [OWNER 2026-08-25]. */

/* σ 알약·값 고르개·숫자 칸은 **공용 노브 바**로 옮겼다(`KnobBar.tsx`,
 * 2026-09-01) — 통합 장부 창이 같은 노브를 쓰기 때문이다. 이 파일에 남은
 * `InlineSigma` 는 설정 줄의 것이 아니라 **패널 안 손잡이**라 성격이 다르다
 * (그 함수 주석이 왜 일부러 다른 물건인지 적어 둔다). */


/** 패널 머리에 눕는 알약 한 줄 — 라벨이 옆에 붙는 납작한 형태다.
 *
 *  설정 줄의 `SigmaPick`(라벨 위·32px 등고·상자 폭 고정)과 **일부러 다른 물건**
 *  이다. 저기는 「실행」을 기다리는 노브들의 격자고, 여기는 지금 이 그림에만
 *  듣는 손잡이다. 같은 모양으로 만들면 둘이 같은 규율을 따른다고 거짓말을 한다. */
function InlineSigma({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: number;
  options: readonly number[];
  onPick: (v: number) => void;
}) {
  return (
    <HStack gap={0.5} alignItems="center">
      <Text font="legal" as="span" color="fgMuted" noWrap>
        {label}
      </Text>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className="sr-pillbtn"
          data-on={value === o || undefined}
          aria-pressed={value === o}
          aria-label={`${label} ${fmtSigma(o)}`}
          onClick={() => onPick(o)}
        >
          {Number(o.toFixed(1))}
        </button>
      ))}
    </HStack>
  );
}



/** 진단 — 성과가 **어디서 왔는지**를 화면이 스스로 말한다
 *  [OWNER 2026-08-28 — "저렇게 단순한 전략이 승률이 이렇게 높을 수 있다는게
 *  이해가 잘 안간다" · "과거에 Overfitting 된거 아닌가"].
 *
 * 종전에는 성과 카드가 승률 93% 를 내걸고 그것으로 끝이었다. 그 숫자가 진입의
 * 공로인지 청산 규칙의 산물인지, 최근에도 유지되는지를 화면이 말하지 않아서
 * 두 의심 다 화면 밖에서만 답할 수 있었다. 세 칸이 그 답이다.
 *
 *   신호가 한 일  청산 규칙을 **떼고** 신호일의 고정 보유 수익을 잰다. 승률이
 *                 청산이 만든 것이라면 신호일과 비신호일이 안 갈린다.
 *   승률의 출처   사유별로 쪼갠다. 익절만 세면 90%대가 나오고 손절·타임스탑을
 *                 같이 세면 내려간다. 손익비가 없으면 승률은 거짓말을 한다.
 *   구간별        과거적합이면 최근이 무너지고, 엣지 소멸이면 크기만 단조로
 *                 줄어든다 — **모양이 다르다**.
 */
/** 신호일의 조건을 **정확히** 적는다.
 *
 * `|z| ≥ 2σ` 라고 쓰면 안 된다 — 이 데스크는 한 방향만 실행할 수 있어서 반대쪽
 * 문턱 돌파는 신호가 아니고, 서버도 실행 가능한 쪽만 센다. 방향을 빼먹고 절대값으로
 * 읽으면 못 하는 거래의 수익이 섞여 답이 뒤집힌다(실측 2026-08-28: 절대값으로
 * 세면 신호일 −0.37bp·적중 47%, 방향을 넣으면 +1.84bp·적중 72%였다). */
function signalCond(run: MrStrategyRun): string {
  const z = run.params.entryZ;
  if (run.params.entryMode === 'touch') return `밴드 복귀 · ±${z}σ`;
  const a = run.dirs.allowed;
  if (a.length !== 1) return `|z| ≥ ${z}σ`;
  /* 엔진 부호 −1 = 값이 내리면 버는 쪽 → z 가 **위로** 벌어졌을 때 신호다. */
  return a[0]! < 0 ? `z ≥ +${z}σ` : `z ≤ −${z}σ`;
}

function Diagnostics({ run }: { run: MrStrategyRun }) {
  const { exits, payoff, forward, periods } = run.diag;
  const on = forward.onSignal;
  const off = forward.offSignal;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const bp = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}bp`;
  return (
    <VStack gap={0.5} width="100%">
      <HStack gap={1} alignItems="baseline" justifyContent="space-between">
        <Text font="label2" as="h3" noWrap>
          진단
        </Text>
        <Text font="legal" as="span" color="fgMuted">
          승률이 어디서 왔는지 · 최근에도 유지되는지 — 노브를 바꾸면 같이 바뀌어요
        </Text>
      </HStack>
      <HStack className="sr-stats" width="100%" flexWrap="wrap">
        <StatColumn title="신호가 한 일">
          {on ? (
            <>
              <Stat label="신호일" value={`${on.n}일`} note={signalCond(run)} />
              <Stat
                label={`${forward.bars}일 앞 평균`}
                value={bp(on.meanBp)}
                tone={on.meanBp > 0 ? 'up' : on.meanBp < 0 ? 'down' : undefined}
                note={`적중 ${pct(on.hitRate)}`}
              />
            </>
          ) : (
            <Stat label="신호일" value="—" note="신호가 없어요" />
          )}
          {/* 대조군이 옆에 없으면 「적중 71%」가 높은 건지 알 수 없다. */}
          {off ? (
            <Stat label="비신호일" value={bp(off.meanBp)} note={`적중 ${pct(off.hitRate)} · ${off.n}일`} />
          ) : null}
        </StatColumn>

        <StatColumn title="승률의 출처">
          {exits.map((e) => (
            <Stat
              key={e.why}
              label={WHY_WORD[e.why]}
              value={`${e.n}건 · ${pct(e.winRate)}`}
              note={`평균 ${bp(e.avgBp)} · ${e.avgBars.toFixed(1)}일`}
            />
          ))}
          {payoff ? (
            <Stat
              label="손익비"
              value={payoff.payoff == null ? '—' : payoff.payoff.toFixed(2)}
              /* 프로핏팩터가 1 아래면 승률이 아무리 높아도 돈을 잃는다. */
              tone={payoff.profitFactor != null && payoff.profitFactor < 1 ? 'down' : undefined}
              note={payoff.profitFactor == null
                ? `이긴 ${payoff.wins} / 진 ${payoff.losses}`
                : `프로핏팩터 ${payoff.profitFactor.toFixed(2)}`}
            />
          ) : null}
        </StatColumn>

        {periods.length ? (
          <StatColumn title="구간별">
            {periods.map((p) => (
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
  );
}

/** 이웃 칸 — 노브를 프리셋 안에서 옮겼을 때 결과가 얼마나 달라지는가.
 *
 * ## 왜 이게 성과 카드 바로 밑에 서는가 [OWNER 2026-08-26]
 *
 * 창은 고른 칸 하나만 보여 줬다. 그래서 손절 3.5 의 **+2,605만·승률 80%** 는
 * 보이고 손절 3.0 의 **+1,120만·승률 57%** 는 노브를 눌러 보기 전까지 안
 * 보였다. 한 칸 차이가 결과를 절반으로 만드는데 화면은 그 사실을 감췄고, 감춘
 * 채로 보여 준 80% 는 발견처럼 읽혔다.
 *
 * 실측으로 그 차이는 2022-12 거래 **한 짝**이었다: 손절 3.0 이면 z 3.22 에
 * 들어간 다리가 다음 봉에 −139만으로 잘리고, 3.5 면 살아남아 +1,005만 = 표본
 * 최대 승리가 된다. 「어느 칸이 옳은가」 를 화면이 답할 수는 없다. 답할 수 있는
 * 것은 **이 결과가 칸 하나에 얼마나 매달려 있는가** 뿐이고, 재현 도구가 그것을
 * 감추면 재현이 아니라 주장이 된다.
 *
 * ## 부품
 *
 * 바로 위 성과 스트립과 **같은 것**을 쓴다(`ui/Stat` 의 StatColumn·Stat, 칸
 * 사이는 여백이 아니라 헤어라인). 이 창이 제 표를 또 만들면 두 벌이 되고 한쪽만
 * 낡는다 — 형제의 부품을 임포트하는 것이 이 리포의 규칙이다. 칸을 누르면 그
 * 노브가 옮겨 가되 숫자는 안 바뀐다(pinned 규율: 핀은 「실행」이 옮긴다). */
function Sensitivity({
  run,
  onPick,
}: {
  run: MrStrategyRun;
  onPick: (patch: Partial<MrStrategyParams>) => void;
}) {
  if (run.neighbors.length === 0) return null;
  return (
    <VStack gap={0.5} width="100%">
      <HStack gap={1} alignItems="baseline" justifyContent="space-between">
        <Text font="label2" as="h3" noWrap>
          이웃 칸
        </Text>
        {/* 이 줄이 늘어난 이유 [OWNER 2026-08-28 — "전체 기간 Grid Search(이웃 칸
            최적화)를 폐기하십시오"]. 이 표는 **견고성 보기**이지 파라미터를
            고르는 도구가 아니다. 전진분석으로 실측했더니(BSS-3Y·훈련 3년 →
            시험 1년 · 27칸) 훈련 창 Sharpe 순위와 다음 해 순위의 상관이
            +0.85 / −0.10 / −0.21 / +0.17 로 **넷 중 셋이 0 근처거나 음수**였고,
            규칙대로 고른 칸의 다음 해 순위는 4/15 · 16/21 · 13/21 · **24/24**
            였다. 즉 「제일 좋은 칸」을 고르는 행위 자체가 값을 안 더한다 —
            화면이 그 사실을 말하지 않으면 이 표가 최적화를 권하는 것으로 읽힌다.
            근거와 재현: `backend/scripts/mr_live_report.py`. */}
        <Text font="legal" as="span" color="fgMuted">
          노브 하나만 옮기고 나머지는 지금 값 고정 · 누르면 그 값으로 바뀌어요(숫자는 실행해야 바뀌어요) ·
          견고성을 보는 표예요 — 제일 좋은 칸을 고르는 데는 쓰지 마세요(전진분석에서 그 선택은 다음 해를 못 맞혔어요)
        </Text>
      </HStack>
      <HStack className="sr-stats" width="100%" flexWrap="wrap">
        {run.neighbors.map((row) => (
          <StatColumn key={row.knob} title={row.label}>
            {row.cells.map((c) => (
              <button
                key={c.v}
                type="button"
                /* 알약(`.sr-pillbtn`)이 아니다 — 그건 32px 단행이고 선택 시 잉크
                   반전이라 방향색 손익이 그 위에서 안 읽힌다. 여기서 필요한 것은
                   누를 수 있는 «Stat 한 칸» 뿐이라 버튼의 기본 껍데기만 벗긴다. */
                style={{ background: 'none', border: 0, padding: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                aria-label={`${row.label} ${c.v}${row.suffix} — 총손익 ${fmtKrw(c.totalPnl)}`}
                aria-pressed={c.current}
                onClick={() => onPick({ [row.knob]: c.v } as Partial<MrStrategyParams>)}
              >
                <Stat
                  /* 단위는 열 제목이 진다 — 여기 붙이면 caption 의 대문자 변환이
                     σ 를 Σ 로 만든다(실측). 칸에는 숫자와 「지금」만 남는다. */
                  label={`${Number(c.v.toFixed(1))}${c.current ? ' · 지금' : ''}`}
                  value={fmtKrw(c.totalPnl)}
                  tone={c.totalPnl > 0 ? 'up' : c.totalPnl < 0 ? 'down' : undefined}
                  note={`SR ${c.sharpe == null ? '—' : c.sharpe.toFixed(2)} · ${c.numTrades}거래`}
                />
              </button>
            ))}
          </StatColumn>
        ))}
      </HStack>
    </VStack>
  );
}

/* 차트 높이 두 급 — Backtest 의 LINKED PAIR 치수 그대로다(`LinkedCharts.tsx`:
   위 종목 200 · 아래 누적손익 140). 주선이 사는 차트가 크고 파생(z·누적)이
   작다 — 세로로 쌓았을 때 «무엇이 주인공인가»를 높이가 말한다. */
const CHART_H = 200;
const CHART_H_SUB = 140;
/* 거래 표 상자 — 차트 둘을 합친 높이. 표는 스크롤이라 높이가 곧 «한 번에 몇
   줄 보이나»이고, 풀폭이 된 뒤에도 200 이면 38거래에서 세 줄만 보인다. */
const TABLE_H = CHART_H + CHART_H_SUB;

/* ── 표시 구간 [OWNER 2026-09-02 — "백테스트 기간을 항상 전체로 설정하다보니
 * 시인성과 목적의식이 불분명"] ─────────────────────────────────────────────
 * 백테스트는 **늘 전체 기간**이고 이 손잡이는 차트와 거래 표의 «표시»만
 * 자른다 — warnZ 와 같은 성격이라 stale 을 안 세우고 성과 카드도 안 바꾼다
 * [OWNER 2026-09-02 — 재실행이 아니라 표시 창]. 누적 손익은 구간 시작을 0 으로
 * 다시 그어 「이 구간에서 얼마를 벌었나」가 바로 보이게 하고, 구간 순손익과
 * 걸친 거래 수를 패널 머리에 병기한다 — 전체와 딴 수가 아니라 같은 곡선의 한
 * 조각이다(구간 순 = 구간 끝 누적 − 구간 직전 누적). */
const MR_SPANS = [
  { v: 'all', label: '전체', months: null },
  { v: '1y', label: '지난 1년', months: 12 },
  { v: '1q', label: '지난 1분기', months: 3 },
  { v: '1m', label: '지난 1개월', months: 1 },
] as const;
type MrSpan = (typeof MR_SPANS)[number]['v'];

/** `PeriodSelector` 는 `{id,label}` 탭을 받는다 — 두 번 적지 않고 MR_SPANS 에서
 *  유도한다(PreviewPane 의 그 규율: 한 목록에만 있는 구간이 생길 수 없게). */
const MR_SPAN_TABS = MR_SPANS.map((s) => ({ id: s.v as string, label: s.label }));

/** ISO 날짜에서 n개월 전 — 달력으로 센다(봉 수가 아니다). UTC 산술이라 시간대에
 *  안 밀리고, 말일 넘침(5-31 − 3개월)은 Date.UTC 가 다음 달로 굴린다 — 경계
 *  하루의 차이는 표시 창에서 값이 아니다. */
function monthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 - months, d!)).toISOString().slice(0, 10);
}

/** 액면을 데스크 말로 — «35.7억». `fmtKrw` 는 부호를 앞세우는 **손익** 표기라
 *  명목에 쓰면 「+35억 7,000만원」이 된다 — 명목은 방향이 없는 양이다. */
const fmtEok = (krw: number): string => `${(krw / 1e8).toFixed(1)}억`;

/** 대사 열의 레벨 — bp 계열은 **2자리**다(캐논 `fmtLevel` 의 1자리에서 일부러
 *  이탈). 이 표들은 「청산 레벨 − 진입 레벨 = Δ」를 주장하는데 Δ 가 2자리
 *  (`fmtBp(v, 2)`)라, 레벨을 1자리로 적으면 실측 3.50→1.75 가 «3.5→1.8 인데
 *  Δ −1.75» 로 서서 표시 정밀도에서 항등이 깨진다 — 각자 반올림한 항이 표시된
 *  합과 모순되는 그 사고다(`lib/krw.ts` 머리의 1만원 판례). %·가격 계열은
 *  `fmtLevel` 그대로 — Δ 는 늘 bp 라 어차피 단위가 달라 눈으로 못 닫고, 그
 *  사실은 거래 표 머리 주석이 진다. */
const fmtReconLevel = (v: number | null, unit: Unit): string =>
  v == null ? '—' : unit === 'bp' ? v.toFixed(2) : fmtLevel(v, unit);

/* ── 사건 어휘 ──────────────────────────────────────────────────────────────
 * 거래 하나를 가리키는 열쇠는 «진입-청산» 이다 — 실행이 바뀌면 자연히 안 맞고,
 * 그때 화면은 목록으로 돌아간다(펴 놓은 대사가 딴 실행의 숫자를 이고 있는
 * 것보다 낫다). 문자열을 두 곳에서 짓지 않으려고 함수로 둔다. */
export const tradeKey = (t: { entryT: string; exitT: string }): string =>
  `${t.entryT}-${t.exitT}`;

type MrEvent = {
  kind: 'entry' | 'exit' | 'stop';
  /** 나간 사유 원본 — 진입 사건에서는 없다. */
  why?: MrStrategyTrade['why'];
  /** 엔진 부호. 미청산 다리는 0 으로 두어 방향색을 안 갖는다. */
  dir: number;
  /** 거래 순번(1부터) — 세로선의 라벨이 이걸 적는다. */
  n: number;
  key: string;
};

/** 미청산 다리의 열쇠 — 청산일이 없으므로 거래와 같은 모양을 쓸 수 없다. */
const OPEN_KEY = 'open';


/** 그날 사건의 한 마디 — 판독과 대사표의 「구분」 칸이 같은 말을 쓴다. */
function eventWord(e: MrEvent | undefined, holding: boolean): string {
  if (!e) return holding ? '보유' : '—';
  return e.kind === 'entry' ? '진입' : (e.why ? WHY_WORD[e.why] : '청산');
}

/** 진입 사건의 수 — 거래 + (아직 목록에 없는) 미청산 다리.
 *
 * `countOpen` 이 켜져 있으면 미청산이 **이미 거래로 들어와 있으므로** 또 세면
 * 안 된다. 종전에는 무조건 더해서 「진입 15 · 거래 14」가 화면에 같이 서 있었다
 * (실측 2026-08-28). */
function entryCount(run: MrStrategyRun): number {
  return run.trades.length + (run.open && !run.params.countOpen ? 1 : 0);
}

/** 나간 사유의 집계 한 마디 — **0 인 사유는 안 적는다**.
 *
 * 종전에는 청산과 손절만 셌다. 나가는 문이 넷으로 늘어난 뒤에도 그대로 두었더니
 * 「청산 10 · 손절 0」이 서 있는데 거래는 14였다 — 타임스탑 2·역신호 1·미청산 1이
 * 화면에서 사라져 있었다. 사유를 하나라도 빠뜨리면 그 줄은 거짓이 된다. */
function exitTally(run: MrStrategyRun): string {
  const order: MrStrategyTrade['why'][] = ['exit', 'stop', 'time', 'reverse', 'open'];
  const n = (w: MrStrategyTrade['why']) => run.trades.filter((t) => t.why === w).length;
  const parts = order.filter((w) => n(w) > 0).map((w) => `${WHY_WORD[w]} ${n(w)}`);
  return parts.length ? parts.join(' · ') : '거래 없음';
}

/** 진입 규칙의 이름 — 목록이 어휘의 주인이라 여기서 다시 짓지 않는다. */
const entryWord = (mode: string): string =>
  MR_ENTRY_MODES.find((m) => m.v === mode)?.label ?? mode;

/** 그 봉의 포지션 한 마디 — 「보유 6봉째 · 거래 3」 또는 「무포지션」.
 *
 * `hold`(그 봉을 통과해서 들고 있던 것)로 판정한다. 청산 봉은 `pos` 가 이미 0
 * 이지만 그날 하루는 들고 있었으므로 무포지션이라고 말하면 거짓이다. */
function posWord(run: MrStrategyRun, i: number): string {
  const p = run.points[i];
  if (!p) return '—';
  const t = run.trades.find((q) => q.entryT <= p.t && p.t <= q.exitT);
  const open = !t && run.open && p.t >= run.open.entryT ? run.open : null;
  const from = t?.entryT ?? open?.entryT;
  if (from == null) return p.hold === 0 && p.pos === 0 ? '무포지션' : '보유';
  const e = run.points.findIndex((q) => q.t === from);
  const day = e < 0 ? null : i - e;
  const who = t ? `거래 ${run.trades.indexOf(t) + 1}` : '미청산';
  return day === 0 ? `진입일 · ${who}` : `보유 ${day}봉째 · ${who}`;
}

/** 대사표의 숫자 열 — 머리와 몸통이 **같은 목록**을 읽는다. 두 벌이면 열이
 * 어긋나고, 어긋난 대사표는 대사표가 아니다. */
const RECON_COLS = [
  /* 레벨이 첫 숫자 열이다 [OWNER 2026-09-02 — "직접 대사가 가능하므로"] —
     Δ 가 어느 값에서 어느 값으로의 변화인지를 표가 스스로 보인다(이웃 두 줄의
     레벨 차 = Δ). 밖의 장부와 맞출 때 붙잡는 것도 z 가 아니라 이 값이다. */
  { k: '레벨' }, { k: 'z' }, { k: 'Δ (bp)' }, { k: '감도' },
  { k: '평가' }, { k: '캐리' }, { k: '비용' }, { k: '그날' }, { k: '누적' },
] as const;

/* 다리 레벨 세 열 [OWNER 2026-09-02 — "스왑 파 커브 상의 레벨, 채권 커브 상의
   레벨, CD금리 레벨"] — 레벨(스프레드) **앞**에 서서 «국고 − IRS = 레벨» 이
   왼쪽에서 오른쪽으로 읽힌다. BSS 에만 있고(캐리와 같은 출처), 선물·퓨처스왑·
   구 백엔드에는 없어 열이 통째로 접힌다 — 빈 열 셋을 세워 두면 표가 없는
   데이터를 있는 척한다(「이탈 최대」 열의 그 조건부 문법). */
const RECON_LEG_COLS = [{ k: '국고' }, { k: 'IRS' }, { k: 'CD' }] as const;

/** 합계 줄의 다리 레벨 — 더할 수 있는 양이 아니라 **진입 → 청산**이다(레벨·z
 *  의 그 규칙). 한쪽이라도 없으면 지어내지 않고 '—' 다. */
function LegArrow({ a, b }: { a?: number | null; b?: number | null }) {
  const t = a == null || b == null
    ? '—'
    : `${fmtReconLevel(a, '%' as Unit)}→${fmtReconLevel(b, '%' as Unit)}`;
  return (
    <TableCell className="sr-num" justifyContent="flex-end">
      <Text font="label1" as="span" tabularNumbers noWrap color={t === '—' ? 'fgMuted' : undefined}>
        {t}
      </Text>
    </TableCell>
  );
}

/** 대사표의 숫자 한 칸.
 *
 * `tone` 은 **손익 두 열에만** 준다 — 방향색은 「번 돈인가 잃은 돈인가」를
 * 나르는 채널이라, 감도·Δ 처럼 부호가 방향을 뜻하는 열에 같은 색을 쓰면 색이
 * 두 가지 뜻을 갖게 된다(`theme/tint.ts` 의 「한 셀 한 채널」).
 * 0 은 `—` 로 적는다: 「그날 그 항이 없었다」와 「0원이었다」는 같은 말이고,
 * 그 자리에 0 을 찍으면 눈이 자릿수를 세게 된다. */
function ReconNum({
  v,
  kind,
  tone,
  head,
  unit,
}: {
  v: number | null;
  kind: 'sigma' | 'bp' | 'won' | 'level';
  tone?: boolean;
  /** 합계 줄 — 굵기가 한 단계 올라간다. */
  head?: boolean;
  /** `level` 에만 — 계열의 자기 단위로 적는다(`fmtLevel`). 0 은 '—' 가 아니라
   *  0 이다: 스프레드가 0 인 날은 「없던 날」이 아니라 그 값이었던 날이다. */
  unit?: Unit;
}) {
  const text =
    v == null ? '—'
    : kind === 'sigma' ? `${v.toFixed(2)}σ`
    : kind === 'bp' ? fmtBp(v, 2)
    : kind === 'level' ? fmtReconLevel(v, unit ?? ('bp' as Unit))
    : v === 0 ? '—'
    : fmtKrw(v);
  return (
    <TableCell className="sr-num" justifyContent="flex-end">
      <Text
        font={head ? 'label1' : 'label2'}
        as="span"
        tabularNumbers
        noWrap
        color={text === '—' ? 'fgMuted' : undefined}
        className={tone && v ? (v > 0 ? 'sr-up' : 'sr-down') : undefined}
      >
        {text}
      </Text>
    </TableCell>
  );
}

/** 대사표 머리의 한 줄 — 「무엇을 보고 들어가 어떻게 나왔나」.
 *
 * 이탈 구간을 여기서 말하는 이유: 「밴드 복귀」 판에서는 진입 z 가 밴드 선
 * 언저리라, 그 수만 보면 4σ 까지 갔다 온 거래와 살짝 넘었다 온 거래가 같은
 * 줄이다. 무엇을 보고 들어갔는지는 진입 z 가 아니라 **그 구간**이 진다. */
function reconSub(t: MrStrategyTrade, run: MrStrategyRun): string {
  const legs = (t.dir > 0 ? run.dirs.plus : run.dirs.minus).legs;
  const out =
    t.outFrom == null || t.outDays == null
      ? ''
      : ` · ${t.outFrom}부터 밖 ${t.outDays}일` +
        (t.peakZ == null ? '' : `(최대 ${t.peakZ.toFixed(2)}σ)`);
  /* 명목·액면이 대사표 머리에 선다 [OWNER 2026-09-02] — 감도 열이 곱하는 바로
     그 수라, 이 표만 떼어 봐도 검산이 서게. 액면은 pv01 근사(거래 표의 그 각주). */
  const size = ` · 명목 ${run.params.notional.toLocaleString()}원/bp` +
    (run.principal ? `(액면 약 ${fmtEok(run.principal.krw)})` : '');
  return `${t.entryT} → ${t.exitT} · ${t.bars}봉 · ${legs}${out} · ${WHY_WORD[t.why]}${size}`;
}

/** 밴드 상태 한 마디 — 측정 보드의 어휘(`MrState`)와 같은 말이다. */
function bandWord(out: number, run: number): string {
  if (out === 0) return '밴드 안';
  return `밴드 ${out > 0 ? '위' : '아래'} 밖 ${run}일째`;
}

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
  /* 눌러서 편 거래 — 그 구간의 **일별 대사**를 연다 [OWNER 2026-08-27 — "개별
     거래 눌러보면 대사도 가능하게 해주고,, 원래 우리가 그렇게 해왔듯이"].
     백테스트 창의 「일별 대사」와 같은 문법이다: 하루씩 펴 놓고, 가로합이
     그날 손익이 되고, 세로합이 거래 손익이 된다. 실행할 때마다 닫는다 —
     다른 실행의 거래를 펴 놓고 있으면 그 표가 거짓이 된다. */
  const [openTrade, setOpenTrade] = useState<string | null>(null);
  /* 표시 구간 — 실행·종목이 바뀌어도 남는다(보기 취향이지 실행의 일부가
     아니다). 판정 규율은 MR_SPANS 머리 주석에. */
  const [span, setSpan] = useState<MrSpan>('all');
  /* 서랍 펼침을 창이 쥔다 — 거래 줄을 누르면 그 자리에서 대사가 펴져야 한다
     (안 쥐면 「눌렀는데 아무 일도 안 일어난」 화면이 된다). 접는 손잡이는
     여전히 서랍 탭이다. */
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* 종목이 바뀌면 지난 실행은 딴 종목의 숫자다 — 남겨 두지 않는다. */
  useEffect(() => {
    setRun(undefined);
    setError(undefined);
  }, [id]);

  const exec = useCallback(() => {
    /* 다른 실행의 거래를 펴 놓고 있으면 그 대사가 거짓이 된다. */
    setOpenTrade(null);
    setDrawerOpen(false);
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

  /* pinned 규율 — 실행 시점 파라미터와 지금 노브가 갈리면 stale.
   *
   * **`warnZ` 는 여기 없다** [2026-08-26]. 그 값은 엔진에 안 들어간다
   * (`main.py::mr_strategy` 가 시뮬에 안 넘긴다 — 오실레이터 가이드선 전용).
   * 그런데도 stale 을 세우고 있었으므로, 결과를 바꾸지 못하는 노브가 결과를
   * 무효로 만들고 재실행을 요구했다. 이제 가이드선은 `knobs.warnZ` 를 바로
   * 읽고(핀 안 걸림), 성과 숫자는 그 값과 무관하다는 사실이 화면에서 참이 된다. */
  /* pinned 규율 — 실행 시점 파라미터와 지금 노브가 갈리면 stale. 판정은
     **공용**이다(`KnobBar.mrKnobsStale`) — 통합 장부 창과 같은 조건을 써야
     같은 노브를 돌렸을 때 한 창만 낡은 숫자를 들고 있는 일이 없다. */
  const stale = useMemo(() => (run ? mrKnobsStale(run.params, knobs) : false), [run, knobs]);

  const dates = useMemo(() => run?.points.map((p) => p.t) ?? [], [run]);

  /* 구간의 첫 인덱스 — **날짜로** 자른다(인덱스가 아니다 — 통합 장부의 그
     규율). 마지막 두 점은 남긴다: 한 점짜리 차트는 선이 못 된다. */
  const w0 = useMemo(() => {
    if (!run || run.points.length < 2) return 0;
    const months = MR_SPANS.find((s) => s.v === span)?.months ?? null;
    if (months == null) return 0;
    const cut = monthsBefore(run.points[run.points.length - 1]!.t, months);
    const i = run.points.findIndex((p) => p.t >= cut);
    return Math.min(i < 0 ? 0 : i, run.points.length - 2);
  }, [run, span]);
  const winPoints = useMemo(() => (run ? run.points.slice(w0) : []), [run, w0]);
  const winDates = useMemo(() => winPoints.map((p) => p.t), [winPoints]);
  /* 누적의 재기준점 = 구간 **직전** 봉의 누적. 구간 순손익 = 구간 끝 누적 − 이
     값이라, 재기준한 곡선의 마지막 점이 곧 구간 순손익이다 — 전체 곡선을 자른
     것과 같은 수임이 구성상 보장된다. */
  const baseCum = run && w0 > 0 ? run.points[w0 - 1]!.cum : 0;
  const winPnl = winPoints.length ? winPoints[winPoints.length - 1]!.cum - baseCum : 0;
  /* 구간에 «걸친» 거래 — 청산이 구간 시작 뒤인 것 전부(진입은 표본 끝보다 늘
     앞이다). 구간 안 진입만 세면 걸쳐 들어온 거래의 손익이 구간 순손익에는
     있는데 표에는 없어, 표와 곡선이 딴말을 하게 된다. */
  const winFrom = winPoints[0]?.t ?? '';
  const shownTrades = useMemo(
    () =>
      !run ? [] : run.trades
        .map((t, k) => ({ t, n: k + 1 }))
        .filter(({ t }) => span === 'all' || t.exitT >= winFrom),
    [run, span, winFrom],
  );

  /* 세 패널(값·z·누적)이 **같은 값-축 폭**을 쓴다 — 라벨이 `2.55`·`-1.85`·
     `+1.2억` 으로 제각각이라 그냥 두면 셋의 플롯이 서로 다른 폭이 되고, 같은
     날짜가 세 패널에서 다른 가로 자리에 선다(CLAUDE.md 「얼라인」 7). */
  const stack = useStackedScales();
  /* 봉마다의 **사건** — 마커·세로선·판독이 이 하나를 같이 읽는다
     [OWNER 2026-08-28 — "언제 진입했고 그런걸 알 수 있게"].
     종전에는 진입 순번만 있었고(세로선 하나) 그래서 화면이 「들어갔다」만
     말하고 「어떻게 나왔다」는 안 말했다 — 청산과 손절이 같은 그림이었다.
     청산 봉 재진입 금지 규약 덕에 한 봉에 사건이 둘일 수 없으므로 Map 이다. */
  const events = useMemo(() => {
    const m = new Map<number, MrEvent>();
    if (!run) return m;
    const at = new Map(dates.map((t, i) => [t, i]));
    run.trades.forEach((t, k) => {
      const key = tradeKey(t);
      const e = at.get(t.entryT);
      const x = at.get(t.exitT);
      if (e != null) m.set(e, { kind: 'entry', dir: t.dir, n: k + 1, key });
      /* 손절만 하락색으로 갈라 세운다 — 나머지 셋(청산·역신호·타임스탑)은
         「계획대로 나왔다」는 같은 종류라 같은 뮤트다. 정확한 사유는 표가 진다. */
      if (x != null)
        m.set(x, { kind: t.why === 'stop' ? 'stop' : 'exit', why: t.why,
                   dir: t.dir, n: k + 1, key });
    });
    /* 미청산 다리도 사건이다 — 표본 끝에 열려 있는 포지션이 차트에서만
       사라지면, 승률 옆의 「미청산 1건」이 어디 것인지 화면이 못 가리킨다. */
    if (run.open) {
      const e = at.get(run.open.entryT);
      if (e != null && !m.has(e))
        m.set(e, { kind: 'entry', dir: run.open.dir, n: run.trades.length + 1, key: OPEN_KEY });
    }
    return m;
  }, [run, dates]);

  const unit = (run?.unit ?? 'bp') as Unit;
  const set = (patch: Partial<MrStrategyParams>) => setKnobs((k) => ({ ...k, ...patch }));

  /* 이 계열에서 실제로 할 수 있는 거래 [OWNER 2026-08-25 — "BSS에서 숏은 없는거야,,
     현물대차매도는 안할거거든"]. 한 방향뿐이면 그 사실을 숫자 옆에서 말한다 —
     노브가 아니므로 설정 줄이 아니라 「조건」과 거래 표의 머리에 선다. */
  const only = run && run.dirs.allowed.length === 1
    ? (run.dirs.allowed[0]! > 0 ? run.dirs.plus : run.dirs.minus)
    : null;
  const dirSub = only ? `${only.legs} 한 방향이에요` : undefined;

  /* 펴 놓은 거래와 그 구간의 봉들 — 대사표의 재료. 키는 «진입-청산» 이라
     실행이 바뀌면 자연히 안 맞고, 그때는 목록으로 돌아간다. */
  const sel = run?.trades.find((t) => tradeKey(t) === openTrade) ?? null;
  const reconRows = useMemo(
    () =>
      sel && run
        ? run.points
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => p.t >= sel.entryT && p.t <= sel.exitT)
        : [],
    [sel, run],
  );
  const dirStat = !run ? '—' : only ? only.legs : '양방향';

  /* 다리 레벨 유무 — BSS 만 있다(캐리와 같은 출처 — api.ts `govt` 주석).
     선물·퓨처스왑·구 백엔드는 없고, 그때 열은 조용히 접힌다. */
  const hasLegs = useMemo(() => !!run && run.points.some((p) => p.govt != null), [run]);
  /* 날짜 → 점 — 거래 표가 진입 시점 다리 레벨을 여기서 찾는다(서버가 점마다
     실었으므로 거래에 또 싣지 않는다 — 같은 수를 두 자리에 두면 갈릴 수 있다). */
  const pointAt = useMemo(() => new Map((run?.points ?? []).map((p) => [p.t, p])), [run]);

  /* 거래 표 머리 — 총 건수·명목·액면 [OWNER 2026-09-02 — "진입 레벨과 기준
     노셔널과 같은 것들이 전부 나와야 직접 대사가 가능"]. 명목·액면은 모든
     거래에 **같은 수**라 열이 아니라 머리에 선다 — 같은 수 서른여덟 줄은 표가
     없는 정보를 있는 척하는 것이다. 액면은 pv01 근사(api.ts `principal` 주석). */
  const tradeSub = !run ? undefined
    : run.trades.length === 0 ? '이 창에 거래가 없어요'
    : [
        dirSub,
        span === 'all'
          ? `${run.trades.length}건`
          : `구간에 걸친 ${shownTrades.length}건 / 전체 ${run.trades.length}건`,
        `명목 ${run.params.notional.toLocaleString()}원/bp`,
        run.principal ? `액면 약 ${fmtEok(run.principal.krw)}(pv01 근사)` : null,
      ].filter((x): x is string => x != null).join(' · ');

  /* 켜져 있는 실전 규칙의 이름들 — 바닥 각주가 읽는다. */
  const liveOn = !run ? [] : [
    run.params.timeStop ? `타임스탑 ${run.params.timeStop}일` : null,
    run.params.regime !== 'none'
      ? `레짐필터(${MR_REGIMES.find((r) => r.v === run.params.regime)?.label})` : null,
    run.params.costModel === 'dynamic' ? '동적비용' : null,
    run.params.reverseExit ? '역신호청산' : null,
    run.params.countOpen ? '미청산 계상' : null,
  ].filter((x): x is string => x !== null);

  /* 가격 주선 색 = 구간 순변화 방향(Main 미리보기의 규칙) — 「구간」은 **보이는
     구간**이다. 표시 창을 잘랐는데 색이 12년 순변화를 말하면 색과 그림이
     딴말을 한다. */
  const priceHue = useMemo(() => {
    if (winPoints.length < 2) return 'var(--color-fgMuted)';
    const net = winPoints[winPoints.length - 1]!.v - winPoints[0]!.v;
    return net === 0 ? 'var(--color-fgMuted)' : net > 0 ? 'var(--sr-up)' : 'var(--sr-down)';
  }, [winPoints]);

  /* 주선 = 구간 방향색 + 점선 면(Main 미리보기·MR 상세 카드와 같은 문법 — 같은
     값+밴드 그림이 두 결이면 안 된다), 보조선 뮤트. **밴드가 먼저** = 아래에 깔린다.
     캔버스에는 불투명도 손잡이가 없어 색 자체를 흐리게 만든다(`palette.dim`). */
  const priceLines: TimeLine[] = !run ? [] : [
    { id: 'up', values: winPoints.map((p) => p.up), color: (pa) => pa.dim('var(--color-fgMuted)', 45), width: 1 },
    { id: 'lo', values: winPoints.map((p) => p.lo), color: (pa) => pa.dim('var(--color-fgMuted)', 45), width: 1 },
    { id: 'ma', values: winPoints.map((p) => p.ma), color: (pa) => pa.dim('var(--color-fgMuted)', 70), width: 1 },
    {
      id: 'v',
      values: winPoints.map((p) => p.v),
      color: (pa) => pa.resolve(priceHue),
      area: 'dots',
      format: (v: number) => fmtLevel(v, unit),
    },
  ];

  /* 사건의 **점**(오실레이터·손익 곡선)과 **세로선**(세 패널 공통).
     stale 이면 둘 다 숨는다 — 노브가 실행과 갈린 판에서 마커만 옛 자리에 남으면
     화면이 「이 설정으로 여기서 들어갔다」고 거짓말한다(원본 규율). */
  /* 사건 인덱스는 전체 기준이다(`events` 가 전체 날짜로 만든다) — 표시 창을
     자르면 `w0` 만큼 옮겨 세운다. 구간 앞의 사건은 화면 밖이라 버린다. */
  const evList = stale ? [] : [...events.entries()].filter(([i]) => i >= w0);
  const evMarkers: TimeMarker[] = evList.map(([i, e]) => ({
    index: i - w0,
    /* 진입은 **방향색**(그 다리가 무엇을 사는지), 청산은 뮤트, 손절은 하락색.
       청산과 손절이 같은 점이면 「어떻게 끝났나」를 표에서만 알 수 있다. */
    color: (pa) =>
      e.kind === 'stop' ? pa.down
      : e.kind === 'exit' ? pa.fgMuted
      : e.dir === 0 ? pa.fgMuted
      : e.dir > 0 ? pa.up : pa.down,
  }));
  /* 세로선은 **진입**만 긋는다 — 거래마다 둘씩 그으면 15거래에 30줄이라 200px
     패널이 빗금이 된다. 펴 놓은 거래 하나만 청산선까지 잉크로 세운다.
     라벨도 그 하나에만 붙인다: 겹침 회피는 호출부의 몫인데(verticalLines 머리),
     열다섯 개를 다 적으면 회피할 수 없는 밀도가 된다. */
  const evLines = evList
    .filter(([, e]) => e.kind === 'entry' || e.key === openTrade)
    .map(([i, e]) => ({
      index: i - w0,
      label: e.key === openTrade ? (e.kind === 'entry' ? '진입' : eventWord(e, false)) : undefined,
      tone: e.key === openTrade ? ('ink' as const) : ('muted' as const),
    }));

  const zLines: TimeLine[] = !run ? [] : [
    {
      id: 'z',
      values: winPoints.map((p) => p.z),
      color: (pa) => pa.fg,
      format: (v: number) => `${v.toFixed(1)}σ`,
    },
  ];

  /* 0선·진입 문턱·경고 문턱. 경고는 **핀이 아니라 지금 값**이다 — 이 선은
     실행과 무관하다. */
  const zBands: ScalePriceLine[] = !run ? [] : [
    { value: 0, color: (pa) => pa.line },
    { value: run.params.entryZ, color: (pa) => pa.lineHeavy },
    { value: -run.params.entryZ, color: (pa) => pa.lineHeavy },
    { value: knobs.warnZ, color: (pa) => pa.line, dash: true },
    { value: -knobs.warnZ, color: (pa) => pa.line, dash: true },
  ];

  /* 손익 곡선은 부호가 색을 정한다 — LinkedCharts 누적 손익의 그 문법. 표시
     창을 잘랐으면 부호도 **구간 순손익**의 것이다(곡선이 재기준돼 있으므로
     마지막 점의 부호가 곧 그것이다). */
  const eqHue = winPnl >= 0 ? 'var(--sr-up)' : 'var(--sr-down)';
  const eqLines: TimeLine[] = !run ? [] : [
    {
      id: 'cum',
      /* 구간 시작 = 0 재기준 [OWNER 2026-09-02]. 전체 표시(`w0 = 0`)에서는
         `baseCum = 0` 이라 원래 곡선 그대로다 — 두 판이 딴 산술이 아니다. */
      values: winPoints.map((p) => p.cum - baseCum),
      color: (pa) => pa.resolve(eqHue),
      area: 'solid',
      areaColor: (pa) => pa.dim(eqHue, 14),
      format: (v: number) => fmtKrw(v),
    },
  ];
  const zeroLine: ScalePriceLine[] = [{ value: 0, color: (pa) => pa.line }];

  /* 캔버스가 못 하는 말 — 짚은 봉의 한 문장 [CLAUDE.md 규칙 7: «읽을 DOM 이
     없다 → hoverLabel → .sr-a11y-only 의 aria-live 줄이 진다»]. 차트마다
     주인공이 다르므로 문장도 다르다(값·z·누적) — Main 미리보기 `scrubLabel`
     이 날짜+값을 읽는 그 자리다. */
  const scrubWord = (i: number, chart: 'price' | 'z' | 'eq'): string => {
    const p = winPoints[i];
    if (!p) return '';
    if (chart === 'price') return `${p.t} ${fmtLevel(p.v, unit)}${unitSuffix(unit)}`;
    if (chart === 'z') return `${p.t} z ${p.z == null ? '—' : `${p.z.toFixed(2)}σ`}`;
    return `${p.t} 누적 ${fmtKrw(p.cum - baseCum)}`;
  };

  /* 일별 대사는 **창 바닥 서랍**이 진다 [2026-09-02, Backtest 창의 그 문법].
     백테스트가 대사를 서랍에 둔 근거가 트레이더 피드백 5(«팝업창 하단에
     열었다 닫았다 하는 탭» — `WindowDrawer.tsx` 머리)이고, 이 창도 같은
     물건을 같은 자리에 둔다. 종전에는 거래 패널의 «내용이 바뀌는» 판이라
     목록과 대사를 같이 볼 수 없었다. */
  const reconPane = sel && run ? (
    <VStack gap={0.5} width="100%">
      {/* 무엇을 펴 놓았는지 — 서랍은 제목이 없으므로 이 줄이 그 일을 한다. */}
      <Text font="caption" as="span" color="fgMuted">
        {reconSub(sel, run)}
      </Text>
      {/* 서랍 안이라 높이 상한은 **30vh**(`ReconStack` 기본과 같은 값 —
          백테스트 서랍이 표 하나일 때 쓰는 그것). `position: relative` 는
          sticky 머리의 기준이고 `overflow` 는 Box prop 이 없어 style 에 남는다. */}
      <Box style={{ position: 'relative', maxHeight: '30vh', overflow: 'auto' }} width="100%">
                <Table bordered={false}>
                  <TableHeader sticky>
                    <TableRow>
                      <TableCell as="th" scope="col">
                        <Text font="caption" as="span" color="fgMuted">날짜</Text>
                      </TableCell>
                      <TableCell as="th" scope="col">
                        <Text font="caption" as="span" color="fgMuted">구분</Text>
                      </TableCell>
                      {(hasLegs ? [...RECON_LEG_COLS, ...RECON_COLS] : [...RECON_COLS]).map((c) => (
                        <TableCell key={c.k} as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          {/* `caption` 이 아니라 `legal` 이다 — CDS 기본 테마의
                              `textTransform.caption = 'uppercase'` 가 「z」를 「Z」로,
                              「bp」를 「BP」로 만든다(실측 2026-08-28). 둘은 크기가
                              같고(0.8125rem) 중량·대문자화만 다르므로, **기호와
                              단위가 든 머리**는 `legal` 이 맞다 — `rv/SectorLane`
                              이 같은 근거로 정한 판례다. 이 표는 단위가 곧 검산의
                              전제라(감도 ₩/bp × Δbp) 대문자 BP 는 오식이다. */}
                          <Text font={headFont(c.k)} as="span" color="fgMuted" noWrap>{c.k}</Text>
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconRows.map(({ p, i }) => (
                      <TableRow key={p.t}>
                        <TableCell>
                          <Text font="label2" as="span" tabularNumbers noWrap>{p.t}</Text>
                        </TableCell>
                        <TableCell>
                          <Text font="label2" as="span" color="fgMuted" noWrap>
                            {eventWord(events.get(i), p.hold !== 0)}
                          </Text>
                        </TableCell>
                        {/* 다리 셋(%) → 스프레드(bp) — (국고 − IRS) × 100
                            = 레벨이 왼쪽에서 오른쪽으로 닫힌다. */}
                        {hasLegs ? (
                          <>
                            <ReconNum v={p.govt ?? null} kind="level" unit={'%' as Unit} />
                            <ReconNum v={p.irs ?? null} kind="level" unit={'%' as Unit} />
                            <ReconNum v={p.cd ?? null} kind="level" unit={'%' as Unit} />
                          </>
                        ) : null}
                        <ReconNum v={p.v} kind="level" unit={unit} />
                        <ReconNum v={p.z} kind="sigma" />
                        <ReconNum v={p.dv} kind="bp" />
                        {/* 감도 — 이 줄의 곱셈이 곱한 바로 그 수. 무포지션
                            봉(진입일)은 0 이라 평가도 0 이다. */}
                        <ReconNum v={p.hold * run.params.notional} kind="won" />
                        <ReconNum v={p.mtm} kind="won" />
                        <ReconNum v={p.carry} kind="won" />
                        <ReconNum v={p.cost} kind="won" />
                        <ReconNum v={p.pnl} kind="won" tone />
                        <ReconNum v={p.tradePnl} kind="won" tone />
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell>
                        <Text font="label1" as="span" noWrap>합계</Text>
                      </TableCell>
                      <TableCell>
                        <Text font="label1" as="span" color="fgMuted" noWrap>{sel.bars}봉</Text>
                      </TableCell>
                      {/* 다리 셋도 진입 → 청산 — 값은 대사표 첫/끝 줄이
                          원천이라 거래에 따로 싣지 않는다. */}
                      {hasLegs ? (
                        <>
                          <LegArrow a={reconRows[0]?.p.govt} b={reconRows.at(-1)?.p.govt} />
                          <LegArrow a={reconRows[0]?.p.irs} b={reconRows.at(-1)?.p.irs} />
                          <LegArrow a={reconRows[0]?.p.cd} b={reconRows.at(-1)?.p.cd} />
                        </>
                      ) : null}
                      {/* 레벨·z 는 더할 수 있는 양이 아니다 — 진입 → 청산으로
                          적는다. 레벨 두 끝의 차가 곧 Δ 합계 칸이다(bp 계열
                          에서 — 선물은 % 라 100배 갈리고, 그 사실은 거래 표
                          머리의 주석이 진다). */}
                      <TableCell className="sr-num" justifyContent="flex-end">
                        <Text font="label1" as="span" tabularNumbers noWrap>
                          {`${fmtReconLevel(sel.entryV, unit)}→${fmtReconLevel(sel.exitV, unit)}`}
                        </Text>
                      </TableCell>
                      <TableCell className="sr-num" justifyContent="flex-end">
                        <Text font="label1" as="span" tabularNumbers noWrap>
                          {`${sel.entryZ.toFixed(2)}→${sel.exitZ == null ? '—' : sel.exitZ.toFixed(2)}`}
                        </Text>
                      </TableCell>
                      <ReconNum v={sel.dv} kind="bp" head />
                      <ReconNum v={null} kind="won" head />
                      <ReconNum v={sel.mtm} kind="won" head />
                      <ReconNum v={sel.carry} kind="won" head />
                      <ReconNum v={sel.cost} kind="won" head />
                      <ReconNum v={sel.pnl} kind="won" tone head />
                      <ReconNum v={sel.pnl} kind="won" tone head />
                    </TableRow>
                  </TableBody>
                </Table>
              </Box>
    </VStack>
  ) : null;


  return (
    <FloatingWindow
      windowKey="mrstrategy"
      title="전략 실험"
      width={1120}
      /* 창 머리 부제는 **caption**(Backtest 창의 「{asOf} 종가까지」와 같은 급).
         종전 `legal` 은 크기는 같고 중량만 낮아, 두 창을 나란히 놓으면 같은
         자리의 같은 성격 문장이 다른 굵기로 섰다. */
      aside={
        <Text font="caption" as="span" color="fgMuted" noWrap>
          첫 PMS 의 z-스코어 규칙 재현이에요 — 투자판단이 아니에요.
        </Text>
      }
      onClose={onClose}
      drawerOpen={drawerOpen}
      onDrawerOpenChange={setDrawerOpen}
      drawer={[
        {
          id: 'recon',
          label: '일별 대사',
          content: reconPane,
          /* 왜 비었는지를 그 자리에서 말한다(서랍의 규율) — 그리고 여는
             방법까지 적는다: 이 창에서 대사는 «거래 하나»의 것이라 고르는
             동작이 먼저다. */
          unavailable: run
            ? '거래 줄을 누르면 하루씩 대사가 서요 — 감도 × Δ = 평가예요.'
            : '실행하면 거래가 서고, 거래 줄을 누르면 하루씩 대사가 열려요.',
        },
      ]}
    >
      {/* 창 몸통 리듬은 **Backtest 창과 한 값**이다(`BacktestWindow.tsx`
          `<VStack gap={2} padding={2}>`) — 떠 있는 창 둘이 같은 위계인데 안쪽
          여백이 다르면 나란히 놓았을 때 그 사실이 먼저 보인다(얼라인 5). */}
      <VStack gap={2} padding={2} width="100%">
        {/* 노브 두 줄은 **공용**이다(`KnobBar.tsx`) — 통합 장부 창과 같은 것을
            쓴다. 갈라 낸 근거는 그 파일 머리에 있다. */}
        <MrKnobBar lead={label} knobs={knobs} onChange={set} onRun={exec} running={running} />
        {/* 상태 문구의 활자는 **Backtest 와 한 벌**이다 — 안내·빈 상태는
            `body` 뮤트, 오류는 `body` + `.sr-up`(앱 공통 오류 문법: 백테스트·
            Main 미리보기가 같은 것을 쓴다). 종전에는 셋 다 `legal` 맨 잉크라
            «실행하지 못했어요» 가 각주처럼 조용히 서 있었다. */}
        {stale ? (
          /* 조용한 재계산 금지 — 원본의 stale 배너 + 마커 숨김 규율 그대로. */
          <Text font="body" as="p" color="fgMuted">
            설정이 실행과 달라요 — 실행을 눌러야 아래 숫자에 반영돼요. 진입 마커는 숨겼어요.
          </Text>
        ) : null}
        {error ? (
          <Text font="body" as="p" className="sr-up">
            실행하지 못했어요 — {error}
          </Text>
        ) : null}

        {!run ? (
          <Text font="body" as="p" color="fgMuted">
            {/* 표본 구간을 **박아 두지 않는다** — 2026-08-28 에 출처를 옮기며
                2020~ 이 2014~ 가 됐고, 그때 이 문장만 옛 구간을 말하고 있었다.
                구간은 실행 결과가 진다(아래 「종가」·차트 축). */}
            실행을 누르면 이 종목의 과거 전체를 원본 규칙으로 재현해요. 당일 종가
            체결 규약이라 체결 가능성은 담보하지 않아요.
          </Text>
        ) : (
          <>
            {/* ── 성과 — 원본 KPI 다섯, 부품은 이 앱의 스트립(`ui/Stat.tsx`).
                   첫 판은 같은 모양을 손으로 다시 만들었다(중복). 표기는 이 리포
                   문법(억/만), 방향색은 손익에만 — 낙폭은 늘 음수라 색이 정보를
                   더하지 않는다. */}
            <HStack className="sr-stats" width="100%" flexWrap="wrap">
              <StatColumn title="성과">
                <Stat
                  label="총손익"
                  value={fmtKrw(run.summary.totalPnl)}
                  tone={
                    run.summary.totalPnl > 0 ? 'up' : run.summary.totalPnl < 0 ? 'down' : undefined
                  }
                />
                <Stat label="최대 낙폭" value={fmtKrw(-run.summary.maxDrawdown)} />
                <Stat
                  label="승률"
                  value={run.summary.winRate == null ? '—' : `${Math.round(run.summary.winRate * 100)}%`}
                  /* 분모를 여기서 말한다 [OWNER 2026-08-26]. 미청산 다리는 원본
                     규약대로 거래·승률에 안 들어가는데(총손익에는 들어간다),
                     카드가 그 사실을 안 적으면 열려 있는 손실 포지션이 승률에서
                     조용히 사라진다 — 실측 80% 는 15건 중 12건이었고 빠진 한
                     건은 표본 두 번째로 나쁜 −600만이었다. */
                  /* 분모가 무엇인지 한 줄로. 「포함」이면 그 다리가 승패를
                     이미 갈랐다는 뜻이고, 「제외」면 열린 손실이 승률에서 빠져
                     있다는 뜻이다 — 둘 다 말해야 숫자가 읽힌다. */
                  note={!run.open ? undefined
                    : run.params.countOpen ? '미청산 1건 포함' : '미청산 1건 제외'}
                />
                <Stat
                  label="Sharpe"
                  value={run.summary.sharpe == null ? '—' : run.summary.sharpe.toFixed(2)}
                  note="전 봉 기준"
                />
                <Stat label="거래" value={String(run.summary.numTrades)} />
                {run.open ? (
                  <Stat
                    label="미청산"
                    value={fmtKrw(run.open.pnl)}
                    tone={run.open.pnl > 0 ? 'up' : run.open.pnl < 0 ? 'down' : undefined}
                    note={`${run.open.entryT} 진입`}
                  />
                ) : null}
              </StatColumn>
              <StatColumn title="조건">
                {/* 비용이 봉마다 다르면 「편도 몇 bp」가 한 숫자로 안 나온다 —
                    실제로 문 범위와 중앙값을 적는다. 상수 하나로 뭉개면 화면이
                    실제로 낸 비용을 감추게 된다. */}
                <Stat
                  label="비용"
                  value={run.cost.model === 'flat'
                    ? `편도 ${run.cost.bp}bp`
                    : `편도 ${run.cost.lo}~${run.cost.hi}bp`}
                  note={run.cost.model === 'dynamic' ? `동적 · 중앙 ${run.cost.mid}bp` : undefined}
                />
                {/* 손익분기 — 노브를 돌려 0 을 찾는 대신 닫힌형으로 답한다
                    (`mrbacktest.breakeven_cost_bp`). 「이 구성이 얼마짜리
                    호가폭까지 견디는가」 는 비용 노브의 값보다 먼저 알아야 하는
                    사실이고, 그걸 모르면 비용 기본값이 곧 결론이 된다. */}
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
                  /* 동적 비용 판 — 「몇 bp」가 아니라 «이 경로의 몇 배» 다.
                     여기가 비어 있으면 비용 모델을 바꾸는 순간 손익분기가
                     화면에서 사라진다(실측 2026-08-28). */
                  <Stat
                    label="손익분기 비용"
                    value={`지금 경로의 ${run.summary.breakevenCostMult.toFixed(1)}배`}
                    tone={run.summary.breakevenCostMult <= 1 ? 'down' : undefined}
                    note={run.summary.breakevenCostMult <= 1
                      ? '지금 비용에서 이미 손실'
                      : `편도 ${(run.cost.model === 'dynamic'
                          ? run.cost.mid * run.summary.breakevenCostMult
                          : run.params.costBp * run.summary.breakevenCostMult).toFixed(2)}bp 중앙 기준`}
                  />
                ) : null}
                {/* 액면 병기 [OWNER 2026-09-02] — 명목 노브는 DV01 이고 주문
                    단위는 억이다. 환산은 서버(`principal` — 지금 커브 pv01 하나의
                    근사)가 하고, 화면은 근사임을 같이 적는다. 선물은 원금이
                    없어(증거금·일일정산) note 가 그 사실을 말한다. */}
                <Stat
                  label="명목"
                  value={`${run.params.notional.toLocaleString()}원/bp`}
                  /* `null` 은 「선물이라 원금이 없다」는 서버의 답이고,
                     `undefined` 는 이 필드를 모르는 **구 백엔드**다(§6 ⑥ 의 그
                     배포 순서 함정) — 후자에 「선물은…」을 적으면 BSS 창이
                     거짓말을 한다. 모르면 조용히 비운다. */
                  note={run.principal
                    ? `액면 약 ${fmtEok(run.principal.krw)} (pv01 근사)`
                    : run.principal === null ? '선물은 액면 환산이 없어요' : undefined}
                />
                <Stat label="종가" value={run.asof ?? '—'} />
                {/* 방향은 노브가 아니라 사실이라 「조건」에 선다 — 이 데스크가
                    실제로 할 수 있는 거래가 무엇인지가 성과의 전제다. */}
                <Stat label="방향" value={dirStat} />
                {run.dirs.why ? (
                  <Stat label="막힌 진입" value={`${run.dirs.blocked.spells}회`} />
                ) : null}
                {/* 필터가 지운 신호는 **따로** 센다 — 방향은 데스크의 제약이고
                    필터는 우리가 고른 것이라, 한 숫자로 합치면 선택의 대가가
                    제약 뒤에 숨는다. 필터를 켰는데 0 이면 그것도 사실이다
                    (실측: 변동성 상위 10% 는 검증 창에서 한 건도 안 막았다). */}
                {run.params.regime !== 'none' ? (
                  <Stat
                    label="필터가 지운 진입"
                    value={`${run.gated.spells}회`}
                    note={run.gated.spells === 0 ? '한 건도 안 막았어요' : `${run.gated.days}일`}
                  />
                ) : null}
              </StatColumn>
            </HStack>

            {/* 성과를 읽은 **직후**가 「그게 진짜냐」가 나오는 자리다. 진단이
                먼저 서고 이웃 칸(노브 견고성)이 그다음이다 — 둘 다 같은 질문의
                다른 축이지만, 「승률이 어디서 왔는가」가 「한 칸 옆은 어떤가」보다
                앞선 질문이다. */}
            <Diagnostics run={run} />

            {/* 견고성은 고른 칸이 아니라 이웃과의 차이다 — 성과 숫자를 읽은
                바로 그 자리에서 말한다. */}
            <Sensitivity run={run} onPick={set} />

            {/* ── 표시 구간 [OWNER 2026-09-02 — "지난 한달, 지난 한분기, 지난
                1년칸을 신설"] — 네 패널(값·z·누적·거래 표)을 같이 자른다. 한
                패널의 aside 에 두면 「그 패널만 자른다」고 거짓말하므로 그리드
                위에 제 줄로 선다. 부품은 Main 미리보기의 그 캐논(`PeriodSelector`)
                이고, 이 고르개의 선택은 데이터 부호가 아니므로 `.sr-tabs-neutral`
                이다(`theme/type.css` 그 주석). 백테스트는 전체 기간 그대로라
                stale 을 안 세운다 — 그 사실을 고르개 옆이 말한다. */}
            <HStack gap={1} alignItems="center" width="100%">
              <Box className="sr-tabs-neutral">
                <PeriodSelector
                  tabs={MR_SPAN_TABS}
                  activeTab={MR_SPAN_TABS.find((t) => t.id === span) ?? null}
                  onChange={(t) => t && setSpan(t.id as MrSpan)}
                />
              </Box>
              {span !== 'all' && winPoints[0] ? (
                <Text font="legal" as="span" color="fgMuted" noWrap>
                  {winPoints[0]!.t} 부터 표시만 잘라요 — 성과·진단은 전체 기간 그대로예요.
                </Text>
              ) : null}
            </HStack>

            {/* ── 차트 셋 = **LINKED PAIR 의 세로 결**(Backtest `LinkedCharts`).
                   같은 `dates` 배열과 `useStackedScales`(값축 폭이 형제 최광폭
                   으로 수렴)로 픽셀이 맞고, **x 라벨은 맨 위가 지고 나머지는
                   숨긴다** — 같은 눈금을 세 번 그리면 그게 다른 축인 줄 읽힌다.
                   십자선은 `syncIndex` 로 반대쪽 차트에 건네, 한 차트를 짚으면
                   나머지 둘의 같은 날에 선이 선다(Backtest 의 그 문법). */}
            <VStack gap={2} width="100%">
              <Panel title="가격 · SMA · 밴드" sub={`밴드 = 평균 ±${run.params.entryZ}σ`}>
                <Box
                  className="sr-plot"
                  width="100%"
                  onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => placeReadout(e.currentTarget, e.clientX)}
                  onMouseLeave={() => setIdx(null)}
                >
                  <TimeChart
                    height={CHART_H}
                    accessibilityLabel={`${label} 가격과 밴드`}
                    dates={winDates}
                    lines={priceLines}
                    markLines={evLines}
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'price', i })}
                    /* 캔버스에는 읽을 DOM 이 없다 — 짚은 봉을 문장으로 만들어
                       `.sr-a11y-only` 의 aria-live 줄에 보낸다(CLAUDE.md 규칙 7·
                       Main 미리보기 `scrubLabel` 의 그 자리). 종전에는 세 차트
                       전부 이 문장이 없어 스크린리더에 아무 말도 안 했다. */
                    hoverLabel={(i) => scrubWord(i, 'price')}
                    syncIndex={idx && idx.chart !== 'price' ? idx.i : null}
                    {...stack}
                  />
                  {idx?.chart === 'price' && winPoints[idx.i] ? (
                    <ReadoutCard title={winPoints[idx.i]!.t}>
                      <ReadoutLevel k="값" v={winPoints[idx.i]!.v} unit={unit} />
                      <ReadoutLevel k="중심선" v={winPoints[idx.i]!.ma} unit={unit} />
                      <ReadoutLevel k="상단" v={winPoints[idx.i]!.up} unit={unit} />
                      <ReadoutLevel k="하단" v={winPoints[idx.i]!.lo} unit={unit} />
                      {/* 밴드에 대해 지금 어디인지 — 진입 규칙이 보는 바로 그 사실.
                          「밴드 복귀」 판에서는 이 줄이 신호의 전제다. */}
                      <ReadoutFact
                        k="상태"
                        v={bandWord(winPoints[idx.i]!.out, winPoints[idx.i]!.outRun)}
                      />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>

              <Panel
                title="z 오실레이터"
                sub={
                  stale
                    ? `진입 ±${run.params.entryZ}σ · 마커 숨김`
                    : `진입 ±${run.params.entryZ}σ · ${entryWord(run.params.entryMode)}` +
                      ` · 진입 ${entryCount(run)} · ${exitTally(run)}`
                }
                /* 관찰 σ 는 설정 줄에서 여기로 내려왔다 [OWNER 2026-08-26]. 이
                   값은 엔진에 안 들어가고 이 패널의 가이드선만 옮긴다 — 성과
                   숫자를 못 바꾸는 노브가 성과 카드 옆에 서 있으면 화면이
                   «이것도 결과를 바꾼다» 고 거짓말한다. 노브의 자리가 곧 그
                   노브가 무엇인지에 대한 주장이다. */
                aside={
                  <InlineSigma
                    label="관찰"
                    value={knobs.warnZ}
                    options={MR_STRATEGY_PRESETS.warnZ}
                    onPick={(v) => set({ warnZ: v })}
                  />
                }
              >
                <Box
                  className="sr-plot"
                  width="100%"
                  onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => placeReadout(e.currentTarget, e.clientX)}
                  onMouseLeave={() => setIdx(null)}
                >
                  <TimeChart
                    height={CHART_H_SUB}
                    accessibilityLabel={`${label} z-스코어`}
                    dates={winDates}
                    lines={zLines}
                    priceLines={zBands}
                    markers={evMarkers}
                    markLines={evLines}
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'z', i })}
                    hoverLabel={(i) => scrubWord(i, 'z')}
                    syncIndex={idx && idx.chart !== 'z' ? idx.i : null}
                    hideTimeAxis
                    {...stack}
                  />
                  {idx?.chart === 'z' && winPoints[idx.i] ? (
                    /* 종전에는 z 한 줄뿐이었다 — 「이 봉에 무슨 일이 있었나」를
                       차트가 말하지 못해 거래 표와 눈으로 대조해야 했다. */
                    <ReadoutCard title={winPoints[idx.i]!.t}>
                      <ReadoutLevel k="z" v={winPoints[idx.i]!.z} unit={'ratio' as Unit} />
                      <ReadoutFact
                        k="상태"
                        v={bandWord(winPoints[idx.i]!.out, winPoints[idx.i]!.outRun)}
                      />
                      {/* posWord 는 전체 인덱스를 받는다 — 거래·미청산 탐색이
                          전체 목록 위라서다. 표시 창만큼 옮겨 되돌린다. */}
                      <ReadoutFact k="포지션" v={posWord(run, idx.i + w0)} />
                      <ReadoutMoney k="그날" v={winPoints[idx.i]!.pnl} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>

              <Panel
                title="누적 손익"
                /* 구간 표시면 머리도 구간을 말한다 — 곡선이 구간 시작 0 재기준
                   인데 머리가 12년 합을 적으면 둘이 딴 그림이 된다. 「걸친」은
                   청산이 구간 안인 거래다(winFrom 주석 — 곡선의 구간 순손익에
                   든 거래가 표에도 있어야 한다). 전체 순은 옆에 남긴다: 조각과
                   전체가 같은 곡선임을 머리가 잇는다. */
                sub={span === 'all'
                  ? `${run.summary.numTrades} 거래 · 순 ${fmtKrw(run.summary.totalPnl)}`
                  : `구간 순 ${fmtKrw(winPnl)} · 걸친 거래 ${shownTrades.length}건 · 전체 순 ${fmtKrw(run.summary.totalPnl)}`}
              >
                <Box
                  className="sr-plot"
                  width="100%"
                  onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => placeReadout(e.currentTarget, e.clientX)}
                  onMouseLeave={() => setIdx(null)}
                >
                  <TimeChart
                    height={CHART_H_SUB}
                    accessibilityLabel={`${label} 누적 손익`}
                    dates={winDates}
                    lines={eqLines}
                    priceLines={zeroLine}
                    markers={evMarkers}
                    markLines={evLines}
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'eq', i })}
                    hoverLabel={(i) => scrubWord(i, 'eq')}
                    syncIndex={idx && idx.chart !== 'eq' ? idx.i : null}
                    hideTimeAxis
                    {...stack}
                  />
                  {idx?.chart === 'eq' && winPoints[idx.i] ? (
                    <ReadoutCard title={winPoints[idx.i]!.t}>
                      {/* 구간 표시면 곡선의 수(재기준)와 전체 누적을 **둘 다**
                          적는다 — 하나만 적으면 곡선과 판독이, 또는 판독과 성과
                          카드가 딴말을 한다. 전체 표시에서는 같은 수라 한 줄이다. */}
                      <ReadoutMoney
                        k={span === 'all' ? '누적' : '구간 누적'}
                        v={winPoints[idx.i]!.cum - baseCum}
                      />
                      {span !== 'all' ? (
                        <ReadoutMoney k="전체 누적" v={winPoints[idx.i]!.cum} />
                      ) : null}
                      <ReadoutMoney k="그날" v={winPoints[idx.i]!.pnl} />
                      <ReadoutFact k="포지션" v={posWord(run, idx.i + w0)} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>

              {/* 거래 표 — Main/Backtest 방언(CDS Table, 숫자는 label2 tabular
                  우측, 손익만 방향색 글자 [OWNER 2026-08-25 «기준을 Backtest 에»]).
                  **일별 대사는 이 패널이 아니라 창 바닥 서랍이 진다**(아래
                  `drawer` — Backtest 창의 그 문법). 종전에는 거래 줄을 누르면
                  이 패널의 내용이 대사표로 «바뀌었고», 그래서 목록과 대사를
                  동시에 볼 수 없었다. */}
              <Panel title="거래" sub={tradeSub}>
                {/* 표 높이는 차트 둘을 합친 값 — 풀폭이 된 뒤에도 200 이면 38거래에서
                    세 줄만 보인다. `overflow`·`position` 은 Box prop 이 없어 style 에 남는다. */}
                <Box style={{ position: 'relative', height: TABLE_H, overflow: 'auto' }} width="100%">
                  <Table bordered={false}>
                    {/* 거래가 수십 줄이라 머리가 따라와야 한다(Main 규칙). */}
                    <TableHeader sticky>
                      <TableRow>
                        {/* 일련번호 [OWNER 2026-09-02 — "건수"] — 실제 블로터와
                            줄 단위로 대사할 때 「몇 번째 거래」가 열쇠다. 번호는
                            **전체 실행 기준**이라 표시 구간을 잘라도 안 바뀐다 —
                            같은 거래가 구간마다 딴 번호면 번호가 아니다. */}
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font={headFont('#')} as="span" color="fgMuted">#</Text>
                        </TableCell>
                        <TableCell as="th" scope="col">
                          <Text font="caption" as="span" color="fgMuted">진입</Text>
                        </TableCell>
                        <TableCell as="th" scope="col">
                          <Text font="caption" as="span" color="fgMuted">청산</Text>
                        </TableCell>
                        <TableCell as="th" scope="col">
                          <Text font="caption" as="span" color="fgMuted">방향</Text>
                        </TableCell>
                        {/* 진입 시점 다리 레벨 [OWNER 2026-09-02] — 그날 데스크가
                            봤을 국고 커브·IRS 파·CD 91일(%). 값의 원천은 점
                            (서버 조인)이고 여기는 진입일을 찾아 적을 뿐이다.
                            BSS 에만 서는 조건부 열(「이탈 최대」의 그 문법). */}
                        {hasLegs ? (
                          <>
                            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                              <Text font="caption" as="span" color="fgMuted" noWrap>진입 국고</Text>
                            </TableCell>
                            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                              <Text font={headFont('진입 IRS')} as="span" color="fgMuted" noWrap>진입 IRS</Text>
                            </TableCell>
                            <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                              <Text font={headFont('진입 CD')} as="span" color="fgMuted" noWrap>진입 CD</Text>
                            </TableCell>
                          </>
                        ) : null}
                        {/* 이탈 구간은 **「밴드 복귀」 판에서만** 열이 선다.
                            「이탈 즉시」 판에서는 진입 봉이 곧 이탈 첫 봉이라
                            최대 z 가 진입 z 와 같은 수다 — 같은 수를 두 열에
                            적으면 표가 없는 정보를 있는 척한다. */}
                        {run.params.entryMode === 'touch' ? (
                          <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                            <Text font={headFont('이탈 최대')} as="span" color="fgMuted" noWrap>이탈 최대</Text>
                          </TableCell>
                        ) : null}
                        {/* z 는 소문자다 — `caption` 은 대문자로 세운다(위 판례). */}
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font={headFont('진입 z')} as="span" color="fgMuted">진입 z</Text>
                        </TableCell>
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font={headFont('청산 z')} as="span" color="fgMuted">청산 z</Text>
                        </TableCell>
                        {/* 레벨·Δ [OWNER 2026-09-02 — "진입 레벨과 기준 노셔널과
                            같은 것들이 전부 나올 수 있게"] — 한 줄이 스스로
                            검산이 되는 열들이다: 청산 레벨 − 진입 레벨 ≈ Δ,
                            방향 × Δ × 명목(머리) ≈ 평가(대사표). Δ 는 늘 **bp**
                            다 — 선물 계열은 레벨이 % 라 둘이 100배 갈리는 그
                            단위 함정을 머리가 막는다. */}
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font="caption" as="span" color="fgMuted" noWrap>진입 레벨</Text>
                        </TableCell>
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font="caption" as="span" color="fgMuted" noWrap>청산 레벨</Text>
                        </TableCell>
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font={headFont('Δ (bp)')} as="span" color="fgMuted" noWrap>Δ (bp)</Text>
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
                      {shownTrades.map(({ t, n }) => (
                        /* 줄을 누르면 그 거래의 일별 대사가 열린다 — rv 랭킹 표의
                           그 문법(«줄을 누르면 이력이 열려요»)이다. */
                        <TableRow
                          key={tradeKey(t)}
                          onClick={() => {
                            setOpenTrade(tradeKey(t));
                            setDrawerOpen(true);
                          }}
                          style={{ cursor: 'pointer' }}>
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text font="label2" as="span" tabularNumbers color="fgMuted" noWrap>{n}</Text>
                          </TableCell>
                          <TableCell>
                            <Text font="label2" as="span" tabularNumbers noWrap>{t.entryT}</Text>
                          </TableCell>
                          <TableCell>
                            <Text font="label2" as="span" tabularNumbers noWrap>{t.exitT}</Text>
                          </TableCell>
                          <TableCell>
                            {/* 「롱/숏」이 아니라 **다리를 적는다** — BSS 에서 스프레드
                                롱은 국고 매도라 부호말은 정확히 반대로 읽힌다(북의
                                `directionLabel` 이 플라이에서 내린 그 판단). 이름은
                                서버가 계열마다 짓는다(§16). */}
                            <Text font="label2" as="span" noWrap>
                              {(t.dir > 0 ? run.dirs.plus : run.dirs.minus).short}
                            </Text>
                          </TableCell>
                          {hasLegs ? (
                            <>
                              <TableCell className="sr-num" justifyContent="flex-end">
                                <Text font="label2" as="span" tabularNumbers noWrap>
                                  {fmtReconLevel(pointAt.get(t.entryT)?.govt ?? null, '%' as Unit)}
                                </Text>
                              </TableCell>
                              <TableCell className="sr-num" justifyContent="flex-end">
                                <Text font="label2" as="span" tabularNumbers noWrap>
                                  {fmtReconLevel(pointAt.get(t.entryT)?.irs ?? null, '%' as Unit)}
                                </Text>
                              </TableCell>
                              <TableCell className="sr-num" justifyContent="flex-end">
                                <Text font="label2" as="span" tabularNumbers noWrap>
                                  {fmtReconLevel(pointAt.get(t.entryT)?.cd ?? null, '%' as Unit)}
                                </Text>
                              </TableCell>
                            </>
                          ) : null}
                          {run.params.entryMode === 'touch' ? (
                            <TableCell className="sr-num" justifyContent="flex-end">
                              <Text font="label2" as="span" tabularNumbers noWrap>
                                {t.peakZ == null ? '—' : `${t.peakZ.toFixed(2)}σ`}
                                {t.outDays == null ? '' : ` · ${t.outDays}일`}
                              </Text>
                            </TableCell>
                          ) : null}
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text font="label2" as="span" tabularNumbers noWrap>{t.entryZ.toFixed(2)}σ</Text>
                          </TableCell>
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text font="label2" as="span" tabularNumbers noWrap>
                              {/* 타임스탑 청산은 z=null 봉에 앉을 수 있다(api.ts). */}
                              {t.exitZ == null ? '—' : `${t.exitZ.toFixed(2)}σ`}
                            </Text>
                          </TableCell>
                          {/* 레벨은 계열의 자기 단위(각주의 「기준」), Δ 는 bp —
                              머리의 그 주석. 색은 손익에만(한 셀 한 채널). */}
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text font="label2" as="span" tabularNumbers noWrap>{fmtReconLevel(t.entryV, unit)}</Text>
                          </TableCell>
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text font="label2" as="span" tabularNumbers noWrap>{fmtReconLevel(t.exitV, unit)}</Text>
                          </TableCell>
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text font="label2" as="span" tabularNumbers noWrap>{fmtBp(t.dv, 2)}</Text>
                          </TableCell>
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text
                              font="label2"
                              as="span"
                              tabularNumbers
                              noWrap
                              className={t.pnl > 0 ? 'sr-up' : t.pnl < 0 ? 'sr-down' : undefined}
                            >
                              {fmtKrw(t.pnl)}
                            </Text>
                          </TableCell>
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
              </Panel>
            </VStack>

            <Text font="legal" as="span" color="fgMuted">
              {fmtLevel(run.points.at(-1)?.v ?? null, unit)}
              {unitSuffix(unit)} 기준 ·{' '}
              {run.params.entryMode === 'touch'
                ? '밖에 있다가 밴드 선으로 돌아오는 봉에 들어가요 — 방향은 나갔던 쪽이 정해요.'
                : '|z|가 진입σ를 넘는 봉에 들어가요 — 밴드를 뚫는 그 봉이에요.'}{' '}
              거래 줄을 누르면 일별 대사가 열려요(감도 × Δ = 평가 · 가로합 = 그날 ·
              세로합 = 거래 손익). 표본 끝의 미청산 포지션은 누적에는 있고 거래 수에는
              없어요(원본 규약).
              {run.dirs.why
                ? ` ${run.dirs.why} 그래서 못 들어간 진입 신호가 ${run.dirs.blocked.spells}회(${run.dirs.blocked.days}일) 있어요.`
                : ''}
              {/* 캐리가 무엇인지 화면이 말한다 — 부호 기준이 한 방향이라 정의가
                  없으면 읽는 사람이 자기 방향으로 읽는다. 원본 PMS 산술에는 이
                  항이 없었다는 사실도 같이 적는다(재현 도구의 명구 의무). */}
              {run.carry.on && run.carry.defn
                ? ` 캐리는 ${run.carry.defn}이고 조달은 ${run.carry.funding} 이에요 — 원본 PMS 산술에는 없던 항이에요.`
                : ''}
              {/* 실전 규칙이 켜져 있으면 화면이 그것을 말한다 — 안 적으면 같은
                  종목의 두 숫자가 왜 다른지 화면만 보고는 알 수 없다. */}
              {liveOn.length
                ? ` 실전 규칙 ${liveOn.join(' · ')}이 켜져 있어요 — 끄면 원본 PMS 재현 그대로예요.`
                : ''}
              {run.principal
                ? ` 액면 환산(약 ${fmtEok(run.principal.krw)})은 지금 커브의 pv01 하나로 나눈 근사예요 — 크기만 좌우하고 부호·시점은 안 건드려요.`
                : ''}
              {/* 다리 레벨의 출처와 항등 — 안 적으면 이 세 열이 어디서 온
                  값인지, 스프레드와 무슨 관계인지 화면만 보고는 알 수 없다. */}
              {hasLegs
                ? ' 다리 레벨(국고 커브·IRS 파·CD 91일)은 캐리와 같은 출처예요 — (국고 − IRS) × 100 = 레벨(bp)이 줄마다 그대로 닫혀요.'
                : ''}
              {' '}국고 다리는 민평(평가사 고시) 기준이에요 — 체결가로 재면 성과가 낮아질 수 있어요.
            </Text>
          </>
        )}
      </VStack>
    </FloatingWindow>
  );
}
