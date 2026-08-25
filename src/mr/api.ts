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
  dir: number;
  entryZ: number;
  exitZ: number;
  entryV: number;
  exitV: number;
  pnl: number;
  why: 'exit' | 'stop';
}

export interface MrStrategyRun {
  id: string;
  label: string;
  unit: string;
  asof: string | null;
  params: MrStrategyParams;
  points: MrStrategyPoint[];
  trades: MrStrategyTrade[];
  summary: {
    totalPnl: number;
    maxDrawdown: number;
    winRate: number | null;
    sharpe: number | null;
    numTrades: number;
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
