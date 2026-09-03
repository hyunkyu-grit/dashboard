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
import { Tooltip } from '@coinbase/cds-web/overlays';
import { Text } from '@coinbase/cds-web/typography';
import { PeriodSelector } from '@coinbase/cds-web/visualizations/chart';

import { TimeChart, useStackedScales, type TimeLine, type TimeMarker } from '@/chart/TimeChart';
import type { ScalePriceLine } from '@/chart/ScaleChart';
import type { Unit } from '@/lib/api';
import { BacktestUnavailable } from '@/lib/api';
import { fmtBp, fmtLevel, unitSuffix } from '@/lib/format';
import { fmtKrw, fmtKrwFromMan, manUnits } from '@/lib/krw';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { ReadoutCard, ReadoutFact, ReadoutLevel, ReadoutMoney, placeReadout } from '@/ui/ReadoutCard';
import { Stat, StatColumn } from '@/ui/Stat';

import {
  MR_ENTRY_MODES,
  MR_STRATEGY_DEFAULTS,
  fetchMrStrategy,
  type MrStrategyParams,
  type MrStrategyRun,
  type MrStrategyTrade,
  type MrReconLeg,
  type MrStrategyPoint,
  fetchMrRecon,
  type MrRecon,
} from './api';
import { backtestDays, reconNote } from '@/backtest/recon';
import { ReconStack } from '@/ui/window/ReconStack';
import { MrKnobBar, mrKnobsStale } from './KnobBar';
import { Panel, WHY_WORD, headFont } from './parts';

/* 얼라인 규칙 [OWNER 2026-08-25 — CLAUDE.md «얼라인» 절]. 첫 판은 라벨을
 * 컨트롤 **옆**에 붙였고, 라벨 폭이 제각각이라 컨트롤 시작점이 계단이 졌다
 * ("아주 얼라인이 개판이야"). 백테스트·시뮬 창의 Field 문법(라벨 위·바닥 정렬·
 * 등고 32px)으로 다시 세운다. */
/* `Field` 는 여기서 정의하지 않는다 — 앱에 하나뿐인 것을 임포트한다
   (`ui/ControlCard`). 이 파일이 갖고 있던 `help`(값의 출처를 라벨이 진다)는
   그 공용 것으로 올라갔다 [OWNER 2026-08-25]. */

/* σ 알약·값 고르개·숫자 칸은 **공용 노브 바**로 옮겼다(`KnobBar.tsx`,
 * 2026-09-01) — 통합 장부 창이 같은 노브를 쓰기 때문이다.
 *
 * **`InlineSigma` 도 2026-09-02 에 내렸다** [OWNER — "이건 뭔지 확인하고
 * 필요없으면 치우기"]. 그 부품이 잡고 있던 값은 `warnZ`(「관찰 σ」) 하나뿐이고,
 * 그 값은 z 오실레이터에 점선 두 줄을 긋는 것 말고 아무 일도 안 했다 — 이름은
 * 「경보 문턱」인데 **경보하는 곳이 화면에 없었다**(그 값을 읽는 마커·집계·
 * 상태 문장이 하나도 없었다). 통합 장부 창에는 애초에 없었으니 두 창이 갈려
 * 있기도 했다(캐논 얼라인 8). 그림에는 이미 0선과 진입 문턱 ±entryZ 가
 * 굵게 서 있어서, 세 번째 점선 쌍은 잉크만 늘리고 결정은 안 붙어 있었다.
 *
 * 노브 하나를 내리는 값은 화면 밖에도 있었다: `warnZ` 는 쿼리·백엔드 검증·
 * 응답 `params` 세 층에 실려 다니면서 **결과를 한 번도 안 바꿨다**. */

/* ── 진단 절과 이웃 칸은 **화면에서 내렸다** [OWNER 2026-09-02 — 몸통에서
 * 내릴 절을 고른 그 선택] ────────────────────────────────────────────────────
 *
 * 내린 둘과 그 이유:
 *
 *   **진단**(135px) — 「신호가 한 일 · 승률의 출처 · 구간별」 세 칸. 2026-08-28
 *   오너 질문 둘(「저렇게 단순한 전략이 승률이 이렇게 높을 수 있나」·「과거에
 *   Overfitting 된 것 아닌가」)에 답하려고 세운 절이고, **그 답은 이미 나왔다** —
 *   승률은 청산 구조의 산물이 아니라 신호의 공로이고(신호일 10일 앞 +1.84bp·
 *   적중 72% 대 비신호일 −0.08bp·49%), 과거적합의 증거는 못 찾았으며 대신 국면
 *   의존이 보였다(−0.08 → 1.21 → 0.62). 근거와 수치는 `docs/MR_LANE_STATE.md`
 *   §승률·과거적합 의심에 대한 답 에 있다. 답이 끝난 질문을 매번 화면에 세울
 *   이유는 없다.
 *
 *   **이웃 칸**(260px) — 노브 넷 × 각 3칸 격자. 이 창에서 제일 큰 비차트
 *   블록이었고, 자기 주석이 「견고성 보기이지 **고르는 도구가 아니다**」라고
 *   적어 두고 있었다. 레인 실측도 같은 방향이다 — 전진분석은 파라미터 선택에
 *   값을 못 더했다(§Ⅱ). 한 칸 옆이 궁금하면 노브를 직접 옮기고 실행한다.
 *
 * **서버는 그대로다** — `/api/mr/strategy` 는 `diag` 와 `neighbors` 를 계속
 * 내고 계약(`MrStrategyRun`)에도 남아 있다. 되살리려면 이 자리에 컴포넌트를
 * 다시 세우면 된다(git 이력: 이 주석을 넣은 커밋 하나). 화면에서 내린 것이지
 * 측정을 끈 것이 아니다 — 실전 규칙 다섯을 내릴 때와 같은 규율이다. */
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
 * 자른다 — stale 을 안 세우고 성과 카드도 안 바꾼다
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
/** 롤 표식 — 「이 줄의 Δ 는 수준의 차가 아니다」 [OWNER 2026-09-02].
 *
 *  선물·퓨처스왑의 값은 벤더 내재수익률이라 **수준**은 옳지만, 계약이 갈리는
 *  날의 차분은 앞 계약 마지막과 뒷 계약 첫 값을 뺀 것이라 아무도 실현하지
 *  못한다. 그 봉의 Δ 를 0 으로 두면 대사표의 곱셈은 닫히지만 **「청산 − 진입」과
 *  Δ 가 갈린다** — 표식이 없으면 읽는 사람이 그것을 표의 결함으로 읽는다.
 *
 *  글자가 아니라 위첨자 하나다: 숫자 열의 자릿수를 안 밀고, 뜻은 툴팁이 진다.
 *  말줄임이 아니다(잘린 글자가 아니라 덧붙인 표식). */
function RollMark({ n }: { n: number }) {
  return (
    <Tooltip
      content={
        <Text font="legal" as="span">
          {`보유 중 선물 계약이 ${n}번 갈렸어요. 그날의 수준 변화는 거래할 수 없어서 Δ 에 안 실려요 — 그래서 청산 − 진입 과 Δ 가 달라요.`}
        </Text>
      }
      maxWidth={280}
      placement="bottom"
    >
      <Text font="legal" as="span" color="fgMuted" className="sr-mr-rollmark" tabIndex={0}>
        {' R'}
      </Text>
    </Tooltip>
  );
}

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
 * 어긋나고, 어긋난 대사표는 대사표가 아니다.
 *
 * ## 다리가 «열» 이 아니라 «행» 이다 [OWNER 2026-09-03]
 *
 * 종전에는 하루가 한 줄이고 다리 레벨 셋이 열이었다. 그런데 이건 **스프레드
 * 플레이**라 하루에 다리가 둘이고, 다리마다 감도·Δ·손익이 따로 있다 — 한 줄에
 * 다 못 담는다. 그래서 백테스트·시뮬 대사표의 문법을 그대로 가져온다:
 * 하루가 **다리마다 세 줄**(KRD·Δbp·손익)이고 마지막에 종합 한 줄이다.
 *
 * 「값」 칸은 줄마다 단위가 다르다(₩/bp · bp · ₩) — 무엇인지는 「구분」이 말한다.
 * ReconStack 의 테너 칸이 KRD·Δbp·손익을 차례로 담는 것과 같은 자리다. */
export const RECON_COLS = ['값', '평가', '캐리', '비용', '그날', '누적'] as const;

/** 레벨·z·CD 는 **대사표에서 나갔다** [OWNER 2026-09-03 — "레벨이랑 Z값은
 *  일별대사 말고 일별레벨 칸을 하나 파서 다른 칸에서 보여주게 하고"]. 대사는
 *  「얼마나 벌었나」의 표고, 레벨은 「어디에 있었나」의 표다 — 위계가 같으므로
 *  서랍의 **형제 탭**으로 선다.
 *
 *  그 칸의 열은 **상수가 아니라 다리에서 뽑는다**(`levelCols`) — 다리 이름이
 *  계열마다 다르기 때문이다(BSS 국고·IRS · 퓨처스왑 선물·IRS · 선물 하나).
 *  2026-09-03 감사에서 여기 `LEVEL_COLS` 상수가 있었는데, 화면은 안 읽고
 *  가드만 읽는 **죽은 상수**였고 `국고·IRS` 로 못 박혀 있어 선물 계열에서는
 *  틀린 값이었다 — 「관찰 σ」와 같은 병이라 지웠다. */

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

/** 실가격 대사의 **거래 총손익** — 행의 「그날」을 세로로 더한다.
 *
 * 이월 앵커 행은 `actual` 이 `null` 이라 자연히 빠진다(그 행은 «내일 아침에
 * 들고 갈 리스크»이지 오늘의 돈이 아니다 — `ReconStack` 머리의 그 규약).
 * 이 값이 백테스트 성과표의 거래 손익과 다른 이유는 `realPane` 머리에. */
function reconTotal(r: Extract<MrRecon, { available: true }>): number {
  return r.rows.reduce((a, x) => a + (x.actual ?? 0), 0);
}

/** 비교 줄의 문장 — **표시 정밀도에서 더해진다**(`splitKrw` 의 수법).
 *
 * 차이·비용·롤다운을 각각 한 번씩만 만원으로 반올림하고, 「평가·캐리 차」가
 * 그 잔차를 진다. 세 항이 화면에서 차이와 정확히 같아진다 — 각자 반올림하면
 * 만원 단위에서 어긋난다(실측 2026-09-03, 16건 중 3건).
 *
 * 항의 뜻: **비용은 엔진에만** 있고(편도 costBp 를 진입·청산에 물린다),
 * **롤다운은 실가격에만** 있다(자산스왑을 실제로 가격하면 나온다). 남는 것이
 * par-par 와 DV01 중립의 차 + 캐리·조달의 차다. */
function bridgeText(t: MrStrategyTrade, r: Extract<MrRecon, { available: true }>): string {
  const uDiff = manUnits(reconTotal(r) - t.pnl);
  const uCost = manUnits(-t.cost);
  const uRoll = manUnits(reconRolldown(r));
  const uRest = uDiff - uCost - uRoll;
  return (
    `엔진 근사 ${fmtKrw(t.pnl)} · 실가격 ${fmtKrw(reconTotal(r))} · `
    + `차이 ${fmtKrwFromMan(uDiff)}`
    + ` (비용 ${fmtKrwFromMan(uCost)} · 롤다운 ${fmtKrwFromMan(uRoll)}`
    + ` · 평가·캐리 차 ${fmtKrwFromMan(uRest)})`
    + ` — 엔진은 DV01 중립 스프레드에 거래비용을 물리고, 이 표는 par-par`
    + ` 자산스왑(액면 ${fmtEok(r.principal.krw)})을 실제로 가격해요.`
    + ` 비용은 엔진에만, 롤다운은 실가격에만 있어요.`
  );
}

/** 실가격 대사의 **롤다운 합** — 엔진에는 없는 항이다. 비교 줄이 차이를
 * 성분으로 가를 때 쓴다(위 `reconTotal` 과 같은 규약: 이월 앵커는 null 이라
 * 자연히 빠진다). */
function reconRolldown(r: Extract<MrRecon, { available: true }>): number {
  return r.rows.reduce((a, x) => a + (x.rolldown ?? 0), 0);
}

/** 대사표의 **하루** — 다리마다 세 줄(KRD·Δbp·손익)에 종합 한 줄
 * [OWNER 2026-09-03 — "채권 KRD, bp, 손익과 IRS KRD, bp, 손익, 그리고 종합
 * 손익이 하루에 찍혀야 함"].
 *
 * ## 왜 이 모양인가
 *
 * 아웃라이트는 물건이 하나라 KRD·Δbp·손익 세 줄로 닫힌다(백테스트 대사표).
 * 스프레드는 **다리가 둘**이라 그 세 줄이 다리마다 있어야 「어느 다리가
 * 벌었나」를 말할 수 있다. 다리가 하나인 계열(선물 아웃라이트)은 종합 줄이
 * 없다 — 그때 표는 백테스트와 글자 그대로 같은 모양이고, 오른쪽 요약이 손익
 * 줄에 붙는다 [OWNER 2026-09-03 — "한개면 그냥 백테스트와 동일한 형태로"].
 *
 * ## 항등이 세로로 닫힌다
 *
 * 서버가 봉마다 재고 안 맞으면 아예 안 보낸다(`main._attach_leg_recon`).
 * 화면에서 눈으로 보이는 것은 둘이다 — **다리 KRD 의 합이 0**(DV01 중립)이고,
 * **다리 손익의 합이 종합의 평가**다. 캐리도 같은 자리에서 합이 닫힌다.
 *
 *
 * ## ⚠ 부호가 종전 「감도」 칸과 **반대**다
 *
 * 종전 이 표는 `감도 = hold × 명목` 을 싣고 `평가 = 감도 × Δ` 로 읽혔다. 그래서
 * 국고 매수(BSS 는 `hold = −1`)의 감도가 **음수**로 찍혔다. 백테스트·시뮬
 * 대사표는 반대 규약이다 — `손익 = −KRD × Δbp` 이고 **음수 KRD 가 「금리
 * 오르면 버는 쪽」**(페이·숏)을 뜻한다. 오너가 붙여 준 실물 표로 대조했다
 * (2026-09-03): `KRD −509,059 · Δbp 0.75 · 손익 +381,795`.
 *
 * 이 표를 백테스트 문법으로 옮기는 이상 부호도 그쪽을 따른다 — 한 데스크가 두
 * 화면에서 KRD 를 다르게 읽으면 그게 사고다. 그래서 국고 매수의 KRD 는 이제
 * **양수**다. 눈에 익은 수가 뒤집히는 변경이라 여기 적어 둔다.
 * ## 롤일
 *
 * 롤일은 봉 전체의 Δ 가 마스크되므로 **다리도 같이 0** 이다 — 한쪽만 살리면
 * 「감도 × Δ = 손익」이 그 줄에서 안 닫힌다. 왜 0 인지는 표식이 말한다.
 *
 * 날짜는 블록의 **첫 줄에만** 적는다. `rowSpan` 을 쓰지 않는 이유는 CDS
 * `Table` 이 그 개념을 안 내놓기 때문이고(`ui/window/ReconStack` 머리의 그
 * 조항), 빈 칸으로 두면 같은 읽기가 된다 — 백테스트 대사표가 이미 그렇다. */
export function ReconDay({
  p, word,
}: {
  p: MrStrategyPoint;
  word: string;
}) {
  /* 서버가 다리를 안 보냈으면(구 백엔드·분해가 안 닫힌 봉) 종합 한 줄만 선다 —
     없는 분해를 화면이 지어내지 않는다. */
  const legs = p.legs ?? [];
  const single = legs.length === 1;
  const rows: React.ReactNode[] = [];

  legs.forEach((g: MrReconLeg, j: number) => {
    const first = j === 0;
    /* 다리의 마지막 줄(손익)에 요약이 붙는 것은 **다리가 하나일 때뿐**이다.
       그때는 종합 줄이 없으므로 **그날의 사건도 여기 붙는다** — 안 그러면
       선물 두 계열의 대사표에서 「언제 들어가고 나왔나」가 통째로 사라진다
       (2026-09-03 감사가 잡았다: `word` 가 `!single` 블록에만 있었다). */
    const tail = single;
    rows.push(
      <TableRow key={`${p.t}-${g.k}-krd`} {...(first ? { 'data-sr-daytop': '1' } : {})}>
        <TableCell>
          {first ? <Text font="label2" as="span" tabularNumbers noWrap>{p.t}</Text> : ''}
        </TableCell>
        <TableCell>
          <Text font="label2" as="span" color="fgMuted" noWrap>{`${g.k} KRD`}</Text>
        </TableCell>
        <ReconNum v={g.krd} kind="won" />
        <ReconNum v={null} kind="won" />
        <ReconNum v={null} kind="won" />
        <ReconNum v={null} kind="won" />
        <ReconNum v={null} kind="won" />
        <ReconNum v={null} kind="won" />
      </TableRow>,
    );
    rows.push(
      <TableRow key={`${p.t}-${g.k}-dv`}>
        <TableCell>{''}</TableCell>
        <TableCell>
          <Text font="label2" as="span" color="fgMuted" noWrap>{`${g.k} Δbp`}</Text>
        </TableCell>
        {p.roll ? (
          <TableCell className="sr-num" justifyContent="flex-end">
            <Text font="label2" as="span" tabularNumbers noWrap color="fgMuted">
              {fmtBp(0, 2)}
              <RollMark n={1} />
            </Text>
          </TableCell>
        ) : (
          <ReconNum v={g.dv} kind="bp" />
        )}
        <ReconNum v={null} kind="won" />
        <ReconNum v={null} kind="won" />
        <ReconNum v={null} kind="won" />
        <ReconNum v={null} kind="won" />
        <ReconNum v={null} kind="won" />
      </TableRow>,
    );
    rows.push(
      <TableRow key={`${p.t}-${g.k}-pnl`}>
        <TableCell>{''}</TableCell>
        <TableCell>
          <Text font="label2" as="span" color="fgMuted" noWrap>
            {tail ? `${g.k} 손익 · ${word}` : `${g.k} 손익`}
          </Text>
        </TableCell>
        <ReconNum v={g.mtm} kind="won" tone />
        <ReconNum v={tail ? p.mtm : null} kind="won" />
        <ReconNum v={g.carry} kind="won" />
        <ReconNum v={tail ? p.cost : null} kind="won" />
        <ReconNum v={tail ? p.pnl : null} kind="won" tone />
        <ReconNum v={tail ? p.tradePnl : null} kind="won" tone />
      </TableRow>,
    );
  });

  if (!single) {
    rows.push(
      <TableRow key={`${p.t}-sum`} {...(legs.length === 0 ? { 'data-sr-daytop': '1' } : {})}>
        <TableCell>
          {legs.length === 0 ? <Text font="label2" as="span" tabularNumbers noWrap>{p.t}</Text> : ''}
        </TableCell>
        <TableCell>
          <Text font="label2" as="span" color="fgMuted" noWrap>
            {legs.length === 0 ? word : `종합 · ${word}`}
          </Text>
        </TableCell>
        {/* 「값」 칸은 **다리 줄의 것**이다(₩/bp · bp · ₩ 셋을 구분이 말한다).
            종합 줄에는 대응하는 지표가 없어 비운다.

            구 백엔드(다리 없음)에서는 종전에 여기 `hold × 명목`(옛 「감도」)을
            세웠는데, 2026-09-03 감사에서 뺐다. 이유 둘: 다리 줄이 없으니 그 수가
            **무엇인지 말해 줄 이름표가 없고**, 부호가 새 KRD 규약과 **반대**라
            (위 「부호」 문단) 한 표 안에서 두 규약이 서게 된다. 남는 열들은 전부
            제 이름을 달고 있으므로 읽기는 여전히 선다. */}
        <ReconNum v={null} kind="won" />
        <ReconNum v={p.mtm} kind="won" />
        <ReconNum v={p.carry} kind="won" />
        <ReconNum v={p.cost} kind="won" />
        <ReconNum v={p.pnl} kind="won" tone />
        <ReconNum v={p.tradePnl} kind="won" tone />
      </TableRow>,
    );
  }
  return <>{rows}</>;
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
  /* 명목·액면이 대사표 머리에 선다 [OWNER 2026-09-02] — 대사표의 KRD 줄이
     ±이 수라(다리 둘이면 합이 0), 이 표만 떼어 봐도 검산이 서게. 액면은 pv01
     근사(거래 표의 그 각주). */
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

  /* 다리 **레벨** 유무 — BSS 만 있다(캐리와 같은 출처 — api.ts `govt` 주석).
     선물·퓨처스왑·구 백엔드는 없고, 그때 열은 조용히 접힌다.

     ⚠ 점의 `legs`(다리별 대사 줄)와 **다른 것**이다. `legs` 는 계열 전부에
     오고, 이 값은 「국고·IRS·CD 세 레벨을 아는가」다 — CD 열과 거래 표의
     진입 다리 레벨이 이 값에 달려 있다. 2026-09-03 에 다리가 줄로 내려가면서
     둘이 헷갈릴 자리가 생겨 이름을 늘렸다. */
  const hasLegLevels = useMemo(() => !!run && run.points.some((p) => p.govt != null), [run]);
  /* 대사표의 숫자 열 — 레벨·z·CD 는 2026-09-03 에 「일별 레벨」 칸으로 나갔다
     (위 `LEVEL_COLS`). 머리와 몸통이 **같은 목록**을 읽어야 열이 안 어긋난다. */
  const reconCols: readonly string[] = RECON_COLS;
  /* 「일별 레벨」의 다리 이름 — 계열이 정한다(`국고`·`IRS`·`선물`). 다리가
     있는 첫 봉에서 뽑고, **머리와 몸통이 이 한 목록만 읽는다.**

     종전에는 머리는 이 목록에서, 몸통은 «그 줄의 봉»에서 열을 만들었다
     (2026-09-03 감사) — 봉 하나가 다리를 빠뜨리면 그 줄만 짧아져 격자가
     어긋난다. 어긋난 표는 대사표가 아니다(같은 이유로 `RECON_COLS` 도 한
     목록이다). 값은 이름이 아니라 **자리**로 찾는다. */
  const legNames: readonly string[] = useMemo(
    () => (run?.points ?? []).find((p) => p.legs?.length)?.legs?.map((g) => g.k) ?? [],
    [run],
  );
  const levelCols: readonly string[] = useMemo(
    () => ['레벨', 'z', ...legNames, ...(hasLegLevels ? ['CD'] : [])],
    [legNames, hasLegLevels],
  );
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

  /* 「실전 규칙이 켜져 있어요」 각주는 **없앴다** [2026-09-02 검사]. 그 다섯을
     화면에서 내린 뒤로 노브가 기본값 밖으로 갈 경로가 없어(딥링크도 없다) 이
     각주는 증명 가능하게 도달 불가였고, 도달 불가한 가지는 「끄면 원본 재현」
     이라고 말하면서 **끌 컨트롤이 없는** 화면을 만든다. 노브를 되살리는 날
     `KnobBar.tsx` 그 자리 주석과 함께 이것도 되살린다. */

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

  /* 0선과 진입 문턱 — 그림이 긋는 선은 **결정이 붙어 있는 것**뿐이다.
     ±1.5σ 점선 쌍(「관찰 σ」)이 2026-09-02 에 여기서 빠졌다 — 근거는 파일 머리
     주석. 결정이 안 붙은 선은 눈금이 아니라 잡음이다. */
  const zBands: ScalePriceLine[] = !run ? [] : [
    { value: 0, color: (pa) => pa.line },
    { value: run.params.entryZ, color: (pa) => pa.lineHeavy },
    { value: -run.params.entryZ, color: (pa) => pa.lineHeavy },
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
  /** 「일별 레벨」 칸 — **어디에 있었나**의 표 [OWNER 2026-09-03 — "레벨이랑
   *  Z값은 일별대사 말고 일별레벨 칸을 하나 파서 다른 칸에서 보여주게 하고
   *  (일별대사와 일별레벨은 동일한 위계임)"].
   *
   *  대사는 「얼마나 벌었나」이고 이 표는 「어디에 있었나」다. 둘을 한 표에 두면
   *  열이 열두 개가 되고, 어느 것이 돈이고 어느 것이 자리인지 눈이 매번 가른다.
   *  위계가 같으므로 **서랍의 형제 탭**이지 대사의 하위가 아니다.
   *
   *  다리 레벨은 서버가 봉마다 실어 준 것을 그대로 적는다(`legs[].lvl`) —
   *  BSS 는 국고·IRS, 퓨처스왑은 선물·IRS, 선물 아웃라이트는 하나다. CD 는
   *  다리가 아니라 IRS 다리 캐리의 받는 쪽이라 맨 끝에 따로 선다. */
  /* 거래 하나의 **실가격 대사** [OWNER 2026-09-03 — "이 방향이 정확한 대사"].
     BSS 를 자산스왑으로 세워 민평 노드를 범프한 테너별 KRD 를 받는다. 서버가
     별도 라우트인 이유(범프가 비싸다)와 같은 이유로 **거래를 누를 때만** 부른다. */
  const [recon, setRecon] = useState<MrRecon | null>(null);
  useEffect(() => {
    if (!sel || !run) { setRecon(null); return; }
    let alive = true;
    setRecon(null);
    fetchMrRecon(run.id, sel.entryT, sel.exitT, sel.dir, run.params.notional)
      .then((r) => { if (alive) setRecon(r); })
      /* 못 받아 온 것과 «못 세운다»는 다른 말이다 — 전자는 이유를 그대로 싣는다. */
      .catch((e: unknown) => {
        if (alive) setRecon({ available: false, why: e instanceof Error ? e.message : '대사를 못 받았어요.' });
      });
    return () => { alive = false; };
  }, [sel, run]);

  const levelPane = sel && run ? (
    <VStack gap={0.5} width="100%" flexGrow={1} minHeight={0}>
      <Text font="caption" as="span" color="fgMuted">
        {reconSub(sel, run)}
      </Text>
      <Box className="sr-mr-drawertable" width="100%">
        <Table bordered={false}>
          <TableHeader sticky>
            <TableRow>
              <TableCell as="th" scope="col">
                <Text font="caption" as="span" color="fgMuted">날짜</Text>
              </TableCell>
              {levelCols.map((c) => (
                <TableCell key={c} as="th" scope="col" className="sr-num" justifyContent="flex-end">
                  <Text font={headFont(c)} as="span" color="fgMuted" noWrap>{c}</Text>
                </TableCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {reconRows.map(({ p }) => (
              <TableRow key={p.t}>
                <TableCell>
                  <Text font="label2" as="span" tabularNumbers noWrap>{p.t}</Text>
                </TableCell>
                <ReconNum v={p.v} kind="level" unit={unit} />
                <ReconNum v={p.z} kind="sigma" />
                {legNames.map((k, j) => (
                  <ReconNum key={k} v={p.legs?.[j]?.lvl ?? null} kind="level" unit={'%' as Unit} />
                ))}
                {hasLegLevels ? <ReconNum v={p.cd ?? null} kind="level" unit={'%' as Unit} /> : null}
              </TableRow>
            ))}
            <TableRow>
              <TableCell>
                <Text font="label1" as="span" noWrap>합계</Text>
              </TableCell>
              {/* 레벨·z 는 더할 수 있는 양이 아니다 — **진입 → 청산**으로 적는다
                  (거래 표의 그 규칙). 다리 레벨도 같은 자로 잰다. */}
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
              {legNames.map((k, j) => (
                <LegArrow
                  key={k}
                  a={reconRows[0]?.p.legs?.[j]?.lvl}
                  b={reconRows.at(-1)?.p.legs?.[j]?.lvl}
                />
              ))}
              {hasLegLevels ? (
                <LegArrow a={reconRows[0]?.p.cd} b={reconRows.at(-1)?.p.cd} />
              ) : null}
            </TableRow>
          </TableBody>
        </Table>
      </Box>
    </VStack>
  ) : null;

  /** 대사 칸의 **정본** — 실가격 자산스왑 대사 [OWNER 2026-09-03 — "krd에서
   *  원래는 테너별로 민감도 찍어줬잖아 … 이 방향이 정확한 대사니까"].
   *
   *  BSS 는 국고 매수 · IRS 페이라 이 앱의 자산스왑과 같은 구조다. 그래서
   *  `cashbond` 의 그 기계를 그대로 부른다 — 민평 노드를 1bp 씩 범프해 채권을
   *  다시 가격하고, 그 결과가 **테너별 KRD**·Δbp·추정이다. 백테스트·시뮬과
   *  같은 `ReconStack` 이 그린다(같은 응답 모양).
   *
   *  ## 이 수는 백테스트 성과표와 다르다 — 그게 측정이다
   *
   *  이 리포의 자산스왑은 par-par(같은 명목)이라 **DV01 중립이 아니고**
   *  [OWNER 2026-08-14], MR 엔진은 반대로 DV01 중립이다. 그래서 실가격 손익이
   *  엔진 손익보다 체계적으로 크다(실측 BSS-7Y 거래별 +0.7~+3.5백만원). 화면이
   *  **둘을 나란히** 적어 「근사와 실제가 이만큼 다르다」를 보인다
   *  [OWNER 2026-09-03] — 숨기면 두 화면이 다른 수를 말하는 이유가 사라진다.
   *
   *  ## 못 세우는 자리
   *
   *  민평 이력은 2020-01-02 부터라 MR 표본의 절반이 그 앞이고, 선물 계열은
   *  자산스왑이 아니다. 앞의 것은 **왜인지만 적고 비워 두며**, 뒤의 것은 오늘
   *  만든 다리 표(`ReconDay`)가 그대로 선다 [OWNER 2026-09-03]. */
  const realPane = sel && run && recon?.available ? (
    <VStack gap={0.5} width="100%" flexGrow={1} minHeight={0}>
      <Text font="caption" as="span" color="fgMuted">
        {reconSub(sel, run)}
      </Text>
      {/* 근사와 실제를 **한 줄에** — 이 차이가 곧 「DV01 중립 근사가 실제
          자산스왑과 얼마나 다른가」다. 숨기면 백테스트 성과표와 이 표가 다른
          수를 말하는 이유를 읽는 사람이 못 찾는다. */}
      {/* 차이를 **성분으로 가른다** [2026-09-03 감사]. 종전에는 "잔여
          금리노출과 캐리·롤다운·조달" 이라고만 적었는데, 실측해 보니 가장 큰
          항이 **거래비용**(엔진만 있다)이고 그 다음이 **롤다운**(실가격만
          있다)이며 잔여 금리노출은 가장 작았다(16건 합: 비용 +16.0백만 ·
          롤다운 +7.9백만 · 평가 차 +1.9백만). 큰 것을 빼놓고 작은 것을 앞에
          세운 문장이었다.

          **표시 정밀도에서도 더해진다** — `splitKrw` 의 그 수법이다
          (`lib/krw.ts`, 2026-08-14): 각 항을 한 번씩만 반올림하고 **마지막
          항이 잔차를 진다.** 안 그러면 만원 단위에서 세 항의 합이 차이와
          어긋난다(실측 16건 중 3건). 읽는 사람이 암산으로 줄을 검산할 수
          있어야 하고, 그게 이 줄의 존재 이유다. */}
      <Text font="legal" as="p" color="fgMuted">
        {recon.truncated
          ? `엔진 근사 ${fmtKrw(sel.pnl)} · 실가격은 창이 잘려 합을 못 내요 — 아래 각주를 보세요.`
          : bridgeText(sel, recon)}
      </Text>
      <ReconStack
        days={backtestDays(recon)}
        tenors={recon.tenors}
        defaultOrder="desc"
        note={reconNote(recon)}
      />
    </VStack>
  ) : null;

  const reconPaneLegs = sel && run ? (
    /* 서랍의 **남는 높이를 받는다** — `.sr-drawer-body` 가 열 flex 라
       (`flex: 1 · min-height: 0`) 창이 눌리면 이 패널도 같이 줄어야 한다. */
    <VStack gap={0.5} width="100%" flexGrow={1} minHeight={0}>
      {/* 무엇을 펴 놓았는지 — 서랍은 제목이 없으므로 이 줄이 그 일을 한다. */}
      <Text font="caption" as="span" color="fgMuted">
        {reconSub(sel, run)}
      </Text>
      {/* 높이를 **박지 않는다** — 서랍이 준 남는 높이를 받고, 스크롤(가로·세로)은
          CDS 가 표에 두른 컨테이너 하나가 진다. 종전에는 여기 `maxHeight: 30vh`
          가 박혀 있어 서랍이 눌린 판(실측 173px)에서 상자 바닥이 창 밖으로
          나갔고, **가로 스크롤바가 그 바닥에 달려 있어 같이 사라졌다**
          [OWNER 2026-09-02 — "왜 밑에 좌우로 드래그 할 수 있는 홀더 같은게
          없어?"]. 규칙과 근거는 `.sr-mr-drawertable`(theme/type.css). */}
      <Box className="sr-mr-drawertable" width="100%">
                <Table bordered={false}>
                  <TableHeader sticky>
                    <TableRow>
                      <TableCell as="th" scope="col">
                        <Text font="caption" as="span" color="fgMuted">날짜</Text>
                      </TableCell>
                      <TableCell as="th" scope="col">
                        <Text font="caption" as="span" color="fgMuted">구분</Text>
                      </TableCell>
                      {reconCols.map((c) => (
                        <TableCell key={c} as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          {/* `caption` 이 아니라 `legal` 이다 — CDS 기본 테마의
                              `textTransform.caption = 'uppercase'` 가 「z」를 「Z」로,
                              「bp」를 「BP」로 만든다(실측 2026-08-28). 둘은 크기가
                              같고(0.8125rem) 중량·대문자화만 다르므로, **기호와
                              단위가 든 머리**는 `legal` 이 맞다 — `rv/SectorLane`
                              이 같은 근거로 정한 판례다. 이 표는 단위가 곧 검산의
                              전제라(감도 ₩/bp × Δbp) 대문자 BP 는 오식이다. */}
                          <Text font={headFont(c)} as="span" color="fgMuted" noWrap>{c}</Text>
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconRows.map(({ p, i }) => (
                      <ReconDay
                        key={p.t}
                        p={p}
                        word={eventWord(events.get(i), p.hold !== 0)}
                      />
                    ))}
                    <TableRow>
                      <TableCell>
                        <Text font="label1" as="span" noWrap>합계</Text>
                      </TableCell>
                      <TableCell>
                        {/* 「값」 칸이 줄마다 단위가 다르므로(₩/bp · bp · ₩) 합계
                            줄에서도 **무엇인지 말한다** — 여기 서는 것은 Δ 뿐이다
                            (2026-09-03 감사: 이름표 없는 숫자가 서 있었다). */}
                        <Text font="label1" as="span" color="fgMuted" noWrap>
                          {`${sel.bars}봉 · Δ`}
                        </Text>
                      </TableCell>
                      {/* 「값」 칸에는 **거래의 Δ 합계**가 선다. 다리 줄들이 그
                          칸을 세 단위로 쓰지만(₩/bp · bp · ₩) 합계에서 더할 수
                          있는 것은 Δ 뿐이고, 마스크된 롤이 몇 봉이었는지도 여기
                          붙는다 — 「청산 − 진입」과 이 값이 갈리는 이유다. */}
                      <TableCell className="sr-num" justifyContent="flex-end">
                        <Text font="label1" as="span" tabularNumbers noWrap>
                          {fmtBp(sel.dv, 2)}
                          {sel.masked ? <RollMark n={sel.masked} /> : null}
                        </Text>
                      </TableCell>
                      {/* 레벨·z 는 더할 수 있는 양이 아니다 — 진입 → 청산으로
                          적는다. 레벨 두 끝의 차가 곧 Δ 합계다(bp 계열에서 —
                          선물은 % 라 100배 갈리고, 그 사실은 거래 표 머리의
                          주석이 진다). */}
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

  /* 대사 칸이 무엇을 세우나 [OWNER 2026-09-03].
       BSS   → 실가격 자산스왑 대사. 못 세우면 **왜인지만** 적고 비워 둔다.
       선물  → 자산스왑이 아니므로 다리 표(`ReconDay`)가 그대로 선다.
     빈 칸에 이유를 쓰는 것이 서랍의 규율이고(`WindowDrawer` 의 `unavailable`),
     여기서는 그 이유가 **서버 문장 그대로**다 — 화면이 다시 쓰면 갈린다. */
  const reconContent = !sel || !run
    ? null
    : hasLegLevels
      ? (recon?.available ? realPane : null)
      : reconPaneLegs;
  const reconWhy = !run
    ? '실행하면 거래가 서고, 거래 줄을 누르면 하루씩 대사가 열려요.'
    : !sel
      ? '거래 줄을 누르면 하루씩 대사가 서요 — 자산스왑으로 세워 테너별 KRD 로 재요.'
      : hasLegLevels && recon === null
        ? '대사를 재는 중이에요 — 민평 노드를 하나씩 범프해서 채권을 다시 가격해요.'
        : hasLegLevels && recon && !recon.available
          ? recon.why
          : undefined;



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
          content: reconContent,
          /* 왜 비었는지를 그 자리에서 말한다(서랍의 규율). 민평 밖 거래와
             선물 계열은 이유가 서버 문장 그대로 온다 — 위 `reconWhy`. */
          unavailable: reconWhy,
        },
        {
          /* **대사와 같은 위계** [OWNER 2026-09-03 — "일별대사와 일별레벨은
             동일한 위계임"]. 대사는 「얼마나 벌었나」, 이 칸은 「어디에
             있었나」다 — 하위 탭이 아니라 형제 탭이다. */
          id: 'levels',
          label: '일별 레벨',
          content: levelPane,
          unavailable: run
            ? '거래 줄을 누르면 그 구간의 레벨·z·다리 레벨이 하루씩 서요.'
            : '실행하면 거래가 서고, 거래 줄을 누르면 레벨이 하루씩 열려요.',
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
                  {winPoints[0]!.t} 부터 표시만 잘라요 — 성과는 전체 기간 그대로예요.
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
                        {hasLegLevels ? (
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
                          {hasLegLevels ? (
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
                            {/* 롤을 지난 거래는 **청산 − 진입 ≠ Δ** 가 정상이다
                                [OWNER 2026-09-02 — 롤일 Δ 마스크]. 표식이 없으면
                                읽는 사람이 그 어긋남을 이 표의 결함으로 읽는다. */}
                            <Text font="label2" as="span" tabularNumbers noWrap>
                              {fmtBp(t.dv, 2)}
                              {t.masked ? <RollMark n={t.masked} /> : null}
                            </Text>
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
              거래 줄을 누르면 일별 대사가 열려요 — 하루가 다리마다 세 줄(KRD·Δbp·
              손익)이고 마지막이 종합이에요. 줄마다 −KRD × Δ = 손익 · 다리 손익을 더하면
              평가 · 세로합 = 거래 손익이에요. 표본 끝의 미청산 포지션은 누적에는 있고
              거래 수에는 없어요(원본 규약).
              {run.dirs.why
                ? ` ${run.dirs.why} 그래서 못 들어간 진입 신호가 ${run.dirs.blocked.spells}회(${run.dirs.blocked.days}일) 있어요.`
                : ''}
              {/* 캐리가 무엇인지 화면이 말한다 — 부호 기준이 한 방향이라 정의가
                  없으면 읽는 사람이 자기 방향으로 읽는다. 원본 PMS 산술에는 이
                  항이 없었다는 사실도 같이 적는다(재현 도구의 명구 의무). */}
              {run.carry.on && run.carry.defn
                ? ` 캐리는 ${run.carry.defn}이고 조달은 ${run.carry.funding} 이에요 — 원본 PMS 산술에는 없던 항이에요.`
                : ''}
              {run.principal
                ? ` 액면 환산(약 ${fmtEok(run.principal.krw)})은 지금 커브의 pv01 하나로 나눈 근사예요 — 크기만 좌우하고 부호·시점은 안 건드려요.`
                : ''}
              {/* 다리 레벨의 출처와 항등 — 안 적으면 이 세 열이 어디서 온
                  값인지, 스프레드와 무슨 관계인지 화면만 보고는 알 수 없다. */}
              {hasLegLevels
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
