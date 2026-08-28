/* Mean Reversion 측정면의 서버 계약 — `/api/mr/board` · `/api/mr/history/{id}`.
 *
 * 숫자는 전부 서버가 끝낸다(§16, `backend/app/mr.py`): 밴드·z·%B·상태 판정·
 * 정렬·순위까지. 이 파일은 타입과 두 페처뿐이다. 라이브 전용이다 — BSS 가
 * SQL 에만 있어 미리 구울 수 없다(Credit RV 와 같은 사정).
 */

import { BacktestUnavailable } from '@/lib/api';
import { mrBoardUrl, mrHistoryUrl, mrStrategyUrl } from '@/lib/staticPaths';

/** 밴드 상태 — 판정이지 행동이 아니다. 검증 레인(bollinger-mr)과 같은 어휘. */
export type MrStateKind = 'below' | 'above' | 'reentry-low' | 'reentry-high' | 'inside';

export interface MrState {
  kind: MrStateKind;
  /** 밖이면 며칠째, 재진입이면 복귀 며칠째. `inside` 는 null. */
  days: number | null;
}

export interface MrRow {
  id: string;
  label: string;
  /** 계열 종류 — bss(국고−IRS) · fut(선물 내재금리) · fsw(퓨처스왑). */
  kind: 'bss' | 'fut' | 'fsw';
  /** 정의 문장 — 서브라인이 그대로 읽는다(혼합 유니버스의 «무엇인지»). */
  defn: string;
  /** 순위 — |z| 내림차순, 서버가 매긴다(§16). */
  rank: number;
  /** 값의 단위 — 스프레드류 bp · 내재금리 %. */
  unit: string;
  v: number;
  /** 전일 대비 — %-계열은 서버가 bp 로 끝내서 준다(`dUnit`). */
  d1: number;
  dUnit: string;
  ma: number | null;
  upper: number | null;
  lower: number | null;
  /** (값 − 중심선)/σ — 늘어남의 크기. 정렬 축이다. */
  z: number | null;
  /** 밴드 안 위치(0~100, 밖이면 범위 밖) — %B. */
  pctB: number | null;
  /** 밴드 전폭(상단−하단) — %-계열은 bp. */
  width: number | null;
  asof: string;
  state: MrState;
}

export interface MrBoard {
  /** 소스별 as-of — BSS(민평×IRS)와 선물(선물표×IRS)이 갈라질 수 있고,
   * 갈라진 날은 화면이 그렇다고 말한다(rv 의 B-2). */
  asof: { bss: string | null; fut: string | null };
  params: { window: number; k: number; recentN: number };
  rows: MrRow[];
  /** 못 읽은 테너 — 조용히 빼지 않는다(rv 의 exclusions 문법, 사유는 서버 것). */
  excluded: { id: string; label: string; reason: string }[];
}

export interface MrHistoryPoint {
  t: string;
  v: number;
  ma: number | null;
  up: number | null;
  lo: number | null;
}

export interface MrHistory {
  id: string;
  label: string;
  unit: string;
  points: MrHistoryPoint[];
}

/* ── 전략 실험 창 [OWNER 2026-08-25 — "첫 PMS 의 그 창 참고해서 구현"] ────────
 * 산술은 서버(backend/app/mrbacktest.py — PMS 원본 이식·적합성 벡터로 잠금).
 * 기본값도 PMS s16 기본 그대로다. */

/** 진입 규칙 — 「언제 실행에 옮기는가」 [OWNER 2026-08-28 — "진입 기준이 외부로
 * 이탈했다가 다시 그 선을 터치할 때"].
 *
 *   level — |z| ≥ 진입σ 인 봉에 들어간다. 밴드를 **뚫는** 그 봉이다(원본 PMS).
 *   touch — 밖에 있다가 밴드로 **복귀하는** 봉에 들어간다. 방향은 나갔던 쪽이
 *           정한다(복귀 봉의 z 부호가 아니다 — 지나쳐 내려올 수 있다).
 *
 * 규칙 둘의 전문은 서버가 진다(`backend/app/mrbacktest.py::_entry_signal`).
 * 측정면의 「재진입」 판정(`MrStateKind`)이 가리키는 봉이 `touch` 의 진입 봉이다 —
 * 두 화면이 같은 사건을 다른 규칙으로 말하지 않게 어휘를 맞춰 둔다. */
export type MrEntryMode = 'level' | 'touch';

export const MR_ENTRY_MODES: { v: MrEntryMode; label: string; help: string }[] = [
  { v: 'level', label: '이탈 즉시',
    help: '|z|가 진입σ를 넘는 봉에 들어가요 — 밴드를 뚫는 그 봉이에요. 첫 PMS 규칙이에요.' },
  { v: 'touch', label: '밴드 복귀',
    help: '밖에 있다가 밴드 선으로 돌아오는 봉에 들어가요. 방향은 나갔던 쪽이 정해요.' },
];

/* ── 실전 운용 규칙 [OWNER 2026-08-28 — "일단 민평 기준으로"] ─────────────────
 *
 * 다섯 지침을 화면 노브로 올린 것이다. **전부 끄면 원본 PMS 재현 그대로**이고,
 * 근거·실측은 `docs/MR_LANE_STATE.md` 와 `backend/scripts/mr_live_report.py` 가
 * 진다. 필터와 비용 경로는 서버가 만든다(§16) — `backend/app/mrregime.py`.
 *
 * 표본외 실측에서 기여가 균등하지 않았다는 점을 화면이 말해야 한다: 타임스탑이
 * 단독 최대(SR 0.63→0.95)이고, 동적 비용은 유일하게 깎는 항이며, 변동성 필터는
 * 검증 창에서 한 건도 안 막았다. */

/** 레짐 필터 — 진입만 막는다. 청산·손절은 필터를 안 본다(엔진 규약). */
export type MrRegime = 'none' | 'vol' | 'trend';

/** 거래비용 모델 — 고정 편도 bp 대 변동성 연동 0.15~0.25bp. */
export type MrCostModel = 'flat' | 'dynamic';

export const MR_REGIMES: { v: MrRegime; label: string; help: string }[] = [
  { v: 'none', label: '없음', help: 'z 문턱만 봐요. 원본 PMS 규칙이에요.' },
  { v: 'vol', label: '변동성',
    help: '30일 실현변동성이 그날까지의 상위 10%면 진입을 막아요. 백분위는 과거만 봐요.' },
  { v: 'trend', label: '추세',
    help: '20일 이동평균이 120일 위면(스프레드 확대 추세) 진입을 막아요. 실측에서는 과잉 차단이었어요.' },
];

export const MR_COST_MODELS: { v: MrCostModel; label: string; help: string }[] = [
  { v: 'flat', label: '고정', help: '옆 칸의 편도 bp를 모든 봉에 그대로 써요.' },
  { v: 'dynamic', label: '동적',
    help: '변동성 백분위에 연동해 편도 0.15~0.25bp를 물려요. 진입일은 평시보다 변동성이 높아요(중앙 백분위 0.71 대 0.46).' },
];

/** 타임스탑 선택지(영업일). 0 은 끔이다. 20 은 지시가 준 값이고 실측에서 단독
 *  최대 기여였다 — 앞뒤로 절반·두 배를 둔다. */
export const MR_TIME_STOPS = [0, 10, 20, 40] as const;

export interface MrStrategyParams {
  lookback: number;
  entryZ: number;
  warnZ: number;
  exitZ: number;
  stopZ: number;
  costBp: number;
  notional: number;
  entryMode: MrEntryMode;
  /** 진입 후 N영업일이면 손익 불문 청산. 0 이면 끔. */
  timeStop: number;
  costModel: MrCostModel;
  regime: MrRegime;
  /** 반대 방향 진입 신호를 **나가는 문**으로 쓴다(그 방향으로 들어가지는 않는다). */
  reverseExit: boolean;
  /** 표본 끝의 미청산 다리를 거래로 센다 — 승률·거래 수·보유기간에 든다.
   *  총손익·MDD 는 원래부터 미청산을 지고 있어서 안 바뀐다. */
  countOpen: boolean;
}

export const MR_STRATEGY_DEFAULTS: MrStrategyParams = {
  lookback: 60,
  entryZ: 2.0,
  warnZ: 1.5,
  exitZ: 0.5,
  stopZ: 3.5,
  costBp: 0.5,
  notional: 1_000_000,
  entryMode: 'level',
  /* 실전 규칙은 **꺼진 채로 시작한다** — 이 창의 계약이 「원본 PMS 재현」이라,
     열자마자 딴 규칙의 수가 서 있으면 그 계약이 깨진다. */
  timeStop: 0,
  costModel: 'flat',
  regime: 'none',
  reverseExit: false,
  countOpen: false,
};

/** PMS 룩백 프리셋 그대로 — 20/60/120 + 자유 입력. */
export const MR_STRATEGY_LOOKBACKS = [20, 60, 120] as const;

/** σ 문턱의 선택지 [OWNER 2026-08-25 — "선택지로 다 줄 수 있는거야?"].
 *
 * 보드(MR_WINDOWS·MR_KS)와 같은 규율이다: **근거 있는 값만** 늘어놓는다.
 * 가운데가 PMS s16 기본이고 양옆이 문헌·데스크의 통상 변형이다.
 *
 *   진입 1.5 / 2.0 / 2.5 — 볼린저 밴드의 통상 배수(2가 기본, 1.5 민감·2.5 보수)
 *   관찰 1.0 / 1.5 / 2.0 — 경보 문턱. 진입보다 낮아야 뜻이 있다
 *   청산 0 / 0.5 / 1.0   — 0 은 완전 평균회귀(중심선), 0.5 가 PMS 기본
 *   손절 3.0 / 3.5 / 4.0 — z-발산 손절. 진입의 대략 1.5~2배가 통상
 *
 * **명목은 프리셋이 없다** — 그건 「보통 쓰는 값」이 아니라 이 데스크의 포지션
 * 크기다. 세 개를 늘어놓으면 근거가 아니라 지어낸 기준이 된다.
 *
 * **비용은 2026-08-28 에 프리셋이 생겼다.** 종전에는 같은 이유로 자유 입력만
 * 뒀는데, 그 사이에 근거가 생겼다 — 오너가 국고3Y·IRS3Y 패키지 실제 편도를
 * **≤0.5bp** 로 답했다. 근거 있는 값이 있으면 프리셋이 지어낸 기준이 아니라
 * 사실이 된다. 셋의 뜻이 각각 다르다(`MR_COST_PRESETS`).
 */
/** 편도 비용(bp)의 선택지 — **셋의 뜻이 다르다**.
 *
 *   0.05  첫 PMS 의 값. 재현용이지 이 데스크의 호가폭이 아니다.
 *   0.2   중간. 좋은 날의 호가폭 언저리.
 *   0.5   **오너 실측** — 국고3Y·IRS3Y 패키지 실제 편도(2026-08-26). 기본값이다.
 *
 * 기본을 0.5 로 둔 이유: 싸게 잡은 비용은 결론을 통째로 뒤집는다. 이웃 레인이
 * 0.05 에서 통과하고 0.5 에서 죽는 판정을 냈고(손익분기 0.479bp), 이 창도
 * 0.05 로 열리면 그 함정을 매번 다시 밟게 된다. */
export const MR_COST_PRESETS = [0.05, 0.2, 0.5] as const;

export const MR_STRATEGY_PRESETS = {
  entryZ: [1.5, 2.0, 2.5],
  warnZ: [1.0, 1.5, 2.0],
  exitZ: [0, 0.5, 1.0],
  stopZ: [3.0, 3.5, 4.0],
} as const;

/** σ 표기 — 2.0 은 「2」로. 알약 넷이 한 줄에 서므로 자릿수가 곧 폭이다. */
export const fmtSigma = (v: number): string => `${Number(v.toFixed(1))}σ`;

export interface MrStrategyPoint {
  t: string;
  v: number;
  z: number | null;
  ma: number | null;
  /** 밴드 배수는 entryZ — PMS 의 «노브 하나, 뜻 둘» 그대로. */
  up: number | null;
  lo: number | null;
  /** 누적 손익(₩) — 표본 끝 미청산 MTM 포함. */
  cum: number;
  /** 그날의 분해 — 셋의 합이 `pnl` 이다. 거래를 누르면 **일별 대사**가 이걸
   *  편다(백테스트 창의 「일별 대사」와 같은 문법). */
  mtm: number;
  carry: number;
  cost: number;
  pnl: number;
  /** 그날의 포지션(엔진 부호). 0 이면 무포지션이다. */
  pos: number;
  /** 그 봉을 **통과해서 들고 있던** 포지션 — `pos` 와 다르다(진입 봉 0 · 청산
   *  봉 ±1). 대사표의 「감도」가 이 값이고, `평가 = 감도 × 명목 × Δ` 가 한 줄
   *  안에서 닫힌다(백테스트 대사표의 「전일 종가 KRD」와 같은 자리). */
  hold: number;
  /** 전 봉 대비 변화(**bp**). 첫 봉은 null. 브라우저는 계산하지 않는다(§16) —
   *  %-계열(선물 내재금리)의 환산도 서버가 끝낸다. */
  dv: number | null;
  /** 그 거래 안에서의 누적(₩) — 무포지션이면 0, 청산 봉이면 확정 손익이다.
   *  대사표의 **세로합**을 줄마다 적어서, 「합계」 줄이 스스로 맞는지 보이게 한다. */
  tradePnl: number;
  /** 밴드 밖 여부 — `+1` 위(비쌈) · `-1` 아래(쌈) · `0` 안. 측정 보드의
   *  `MrState` 와 같은 어휘다(`밖`/`재진입`). */
  out: number;
  /** 연속 며칠째 밖인가. 안이면 0. */
  outRun: number;
}

export interface MrStrategyTrade {
  entryT: string;
  exitT: string;
  /** 엔진 부호 — 이름은 `run.dirs` 가 진다(계열마다 다른 다리다). */
  dir: number;
  entryZ: number;
  exitZ: number;
  entryV: number;
  exitV: number;
  pnl: number;
  /** 청산 사유. 우선순위가 곧 이름이다 — 손절 > 청산 > 역신호 > 타임스탑.
   *  `open` 은 표본 끝의 미청산 다리를 거래로 셀 때만 나온다(청산 비용 없음). */
  why: 'exit' | 'stop' | 'reverse' | 'time' | 'open';
  /** 대사 삼분해 — `mtm + carry + cost = pnl`. 화면이 그 항등을 보여 준다. */
  mtm: number;
  carry: number;
  cost: number;
  /** 보유 봉 수. */
  bars: number;
  /** 진입 직전의 밴드 밖 구간 — 언제 나갔고(outFrom) 며칠이었고(outDays)
   *  얼마나 벌어졌는지(peakZ · 부호 유지). `밴드 복귀` 판에서는 진입 z 가 밴드
   *  선 언저리라 이것 없이는 4σ 까지 갔다 온 것과 살짝 넘었다 온 것이 같은
   *  줄로 보인다. `이탈 즉시` 판에서는 outDays 가 늘 1 이다. */
  outFrom: string | null;
  outDays: number | null;
  peakZ: number | null;
  /** 보유 동안의 총 변화(**bp**) — 대사표 「합계」 줄의 Δ 칸이고, 줄마다의
   *  Δ 를 세로로 더한 값과 같아야 한다. */
  dv: number;
}

/** 방향 하나의 이름 — 표 칸은 `short`, 문장은 `legs`. 서버가 계열마다 짓는다
 * (`backend/app/mr.py::DIR_LEGS`) — 「롱/숏」이라고만 적으면 BSS 에서는 정확히
 * 반대로 읽힌다(스프레드 롱 = 국고 매도). */
export interface MrDirName {
  short: string;
  legs: string;
}

/** 실행할 수 있는 방향 [OWNER 2026-08-25 — "BSS에서 숏은 없는거야,, 현물대차매도는
 * 안할거거든"]. 노브가 아니라 데스크의 사실이라 화면에 스위치가 없다 — 백테스트의
 * 현금채권이 매수만 받는 것과 같은 규칙이다(`backtest/book.ts::runnable`). */
export interface MrStrategyDirs {
  /** 엔진 부호 목록 — `+1`은 값이 오르면 버는 쪽. BSS 는 `[-1]` 뿐이다. */
  allowed: number[];
  plus: MrDirName;
  minus: MrDirName;
  /** 한 방향뿐일 때의 사유 문장. 양방향이면 null. */
  why: string | null;
  /** 막혀서 못 들어간 진입 신호 — 구간 수와 일수. 조용히 빠지면 «신호가
   * 없었다»로 읽히므로 화면이 세어서 말한다. */
  blocked: { spells: number; days: number };
}

/** 표본 끝의 미청산 다리. 원본 규약대로 거래·승률·건수에는 **안** 들어가고
 * 누적에만 있다 — 그래서 화면이 이걸 승률 옆에서 말하지 않으면 열려 있는 손실
 * 포지션이 승률에서 조용히 사라진다(실측 2026-08-26: 승률 80% = 12/15 였고
 * 빠진 한 건은 표본 두 번째로 나쁜 −600만이었다). */
export interface MrStrategyOpen {
  entryT: string;
  /** 엔진 부호 — 이름은 `run.dirs` 가 진다. */
  dir: number;
  entryZ: number;
  entryV: number;
  pnl: number;
  /** 진입 이후 지난 봉 수. */
  bars: number;
  outFrom: string | null;
  outDays: number | null;
  peakZ: number | null;
}

/** 노브 하나를 프리셋 안에서 옮겼을 때의 결과 한 칸. */
export interface MrNeighborCell {
  v: number;
  totalPnl: number;
  sharpe: number | null;
  winRate: number | null;
  numTrades: number;
  /** 지금 고른 칸인가. */
  current: boolean;
}

/** 노브 하나의 프리셋 행 — 견고성은 «고른 칸» 이 아니라 «이웃과의 차이» 다. */
export interface MrNeighborRow {
  knob: 'lookback' | 'entryZ' | 'exitZ' | 'stopZ';
  label: string;
  suffix: string;
  cells: MrNeighborCell[];
}

export interface MrStrategyRun {
  id: string;
  label: string;
  unit: string;
  asof: string | null;
  params: MrStrategyParams;
  points: MrStrategyPoint[];
  trades: MrStrategyTrade[];
  dirs: MrStrategyDirs;
  /** 미청산이 없으면 null. */
  open: MrStrategyOpen | null;
  neighbors: MrNeighborRow[];
  /** 캐리 — 두 다리의 중간 현금흐름 [OWNER 2026-08-27]. 끄면 `{on:false}` 이고
   *  그때의 수는 원본 PMS 산술 그대로다(`backend/app/mrcarry.py` 머리에 근거). */
  carry: { on: boolean; defn?: string | null; funding?: string };
  /** 실제로 문 비용 — 고정이면 한 숫자, 동적이면 범위와 중앙값이다. */
  cost:
    | { model: 'flat'; bp: number }
    | { model: 'dynamic'; lo: number; hi: number; mid: number };
  /* ── 진단 [OWNER 2026-08-28 — "승률이 이렇게 높을 수 있다는게 이해가 잘
   *    안간다" · "과거에 Overfitting 된거 아닌가"] ────────────────────────────
   * 의심 둘 다 화면 밖에서만 답할 수 있었다. 산술은 `backend/app/mrdiag.py`. */
  diag: {
    /** 청산 사유별 — 높은 승률의 정체가 여기서 갈린다. 순서는 고정(우선순위). */
    exits: {
      why: MrStrategyTrade['why'];
      n: number;
      wins: number;
      winRate: number;
      /** 명목으로 나눠 bp 로 되돌린 값 — 만기 간 비교가 서게. */
      avgBp: number;
      sumBp: number;
      avgBars: number;
    }[];
    /** 이긴 거래나 진 거래가 아예 없으면 null — 0 이나 ∞ 로 채우지 않는다. */
    payoff: {
      wins: number;
      losses: number;
      avgWinBp: number;
      avgLossBp: number;
      payoff: number | null;
      profitFactor: number | null;
    } | null;
    /** 청산 규칙을 **떼고** 신호일의 고정 보유 수익 — 승률이 진입의 공로인지
     *  청산 구조의 산물인지. 실행 가능한 방향만 센다. */
    forward: {
      bars: number;
      onSignal: { n: number; meanBp: number; hitRate: number; medianBp: number } | null;
      offSignal: { n: number; meanBp: number; hitRate: number; medianBp: number } | null;
    };
    /** 구간을 갈라 같은 규칙을 잰 것 — 과거적합이면 최근이 무너지고, 엣지
     *  소멸이면 크기만 단조로 줄어든다. 봉이 모자라면 빈 배열. */
    periods: {
      from: string;
      to: string;
      days: number;
      totalPnl: number;
      maxDrawdown: number;
      sharpe: number | null;
    }[];
  };
  /** 레짐 필터가 지운 진입 신호 — 구간 수와 일수. 방향 때문에 못 한 것
   *  (`dirs.blocked`)과 **따로** 센다: 방향은 데스크의 제약이고 필터는 우리가
   *  고른 것이라, 한 숫자로 합치면 선택의 대가가 제약 뒤에 숨는다. */
  gated: { spells: number; days: number };
  summary: {
    totalPnl: number;
    maxDrawdown: number;
    winRate: number | null;
    sharpe: number | null;
    numTrades: number;
    /** 미청산 다리의 MTM(₩) — 총손익에는 있고 승률에는 없다. */
    openPnl: number | null;
    /** 총손익이 0 이 되는 편도 비용(bp). 거래가 z 에만 달려 있어 닫힌형이다
     *  (`mrbacktest.breakeven_cost_bp`). 음수면 «비용 0 이어도 손실» 이다.
     *  동적 비용 판에서는 한 숫자로 안 나오므로 null 이고, 대신 아래 배수가 선다. */
    breakevenCostBp: number | null;
    /** 주어진 비용 **경로의 몇 배**까지 견디는가. 고정 비용 판에서는 null. */
    breakevenCostMult: number | null;
  };
}

export function fetchMrStrategy(id: string, p: MrStrategyParams): Promise<MrStrategyRun> {
  const q = new URLSearchParams({
    id,
    lookback: String(p.lookback),
    entryZ: String(p.entryZ),
    warnZ: String(p.warnZ),
    exitZ: String(p.exitZ),
    stopZ: String(p.stopZ),
    costBp: String(p.costBp),
    notional: String(p.notional),
    entryMode: p.entryMode,
    timeStop: String(p.timeStop),
    costModel: p.costModel,
    regime: p.regime,
    reverseExit: String(p.reverseExit),
    countOpen: String(p.countOpen),
  });
  return get<MrStrategyRun>(mrStrategyUrl(q.toString()), 'mr strategy');
}

async function get<T>(url: string, what: string): Promise<T> {
  const r = await fetch(url);
  if (r.status === 404) throw new BacktestUnavailable();
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.detail ?? `${what}: HTTP ${r.status}`);
  }
  return r.json();
}

/** 룩백·밴드 폭 — 서버 허용값(mr.py WINDOWS·KS)과 같은 목록. 근거는 서버 쪽
 * 주석이 진다: 20·2σ 볼린저 기본, 60/120/252 채권 RV 관례 창, 1.5/2.5σ 문헌 변형. */
export const MR_WINDOWS = [20, 60, 120, 252] as const;
export const MR_KS = [1.5, 2.0, 2.5] as const;
export type MrParams = { window: number; k: number };

const qs = (p: MrParams) => `window=${p.window}&k=${p.k}`;

export function fetchMrBoard(p: MrParams): Promise<MrBoard> {
  return get<MrBoard>(mrBoardUrl(qs(p)), 'mr board');
}

export function fetchMrHistory(id: string, p: MrParams): Promise<MrHistory> {
  return get<MrHistory>(mrHistoryUrl(id, qs(p)), 'mr history');
}
