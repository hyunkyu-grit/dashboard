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

export interface MrStrategyParams {
  lookback: number;
  entryZ: number;
  warnZ: number;
  exitZ: number;
  stopZ: number;
  costBp: number;
  notional: number;
}

export const MR_STRATEGY_DEFAULTS: MrStrategyParams = {
  lookback: 60,
  entryZ: 2.0,
  warnZ: 1.5,
  exitZ: 0.5,
  stopZ: 3.5,
  costBp: 0.05,
  notional: 1_000_000,
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
 * **비용·명목은 프리셋이 없다** — 그 둘은 「보통 쓰는 값」이 아니라 그날 그
 * 종목의 호가폭이고 이 데스크의 포지션 크기다. 세 개를 늘어놓으면 근거가
 * 아니라 지어낸 기준이 된다. 자유 입력이 정직하다.
 */
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
  why: 'exit' | 'stop';
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
  entryZ: number;
  entryV: number;
  pnl: number;
  /** 진입 이후 지난 봉 수. */
  bars: number;
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
  summary: {
    totalPnl: number;
    maxDrawdown: number;
    winRate: number | null;
    sharpe: number | null;
    numTrades: number;
    /** 미청산 다리의 MTM(₩) — 총손익에는 있고 승률에는 없다. */
    openPnl: number | null;
    /** 총손익이 0 이 되는 편도 비용(bp). 거래가 z 에만 달려 있어 닫힌형이다
     *  (`mrbacktest.breakeven_cost_bp`). 음수면 «비용 0 이어도 손실» 이다. */
    breakevenCostBp: number | null;
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
