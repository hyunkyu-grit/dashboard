/* Mean Reversion 측정면의 서버 계약 — `/api/mr/board` · `/api/mr/history/{id}`.
 *
 * 숫자는 전부 서버가 끝낸다(§16, `backend/app/mr.py`): 밴드·z·%B·상태 판정·
 * 정렬까지. 이 파일은 타입과 두 페처뿐이다. 라이브 전용이다 — BSS·선물이
 * SQL 에만 있어 미리 구울 수 없다(Credit RV 와 같은 사정).
 */

import { BacktestUnavailable } from '@/lib/api';
import { mrBoardUrl, mrHistoryUrl } from '@/lib/staticPaths';

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
  group: 'bss' | 'futures' | 'outright' | 'spread' | 'fly';
  groupLabel: string;
  /** 값의 단위 — %(IRS 레벨)·bp(스프레드류)·가격(선물). */
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
  /** 소스별 as-of — IRS(기동 스냅샷)와 민평·선물(호출 시 SQL)이 갈라질 수
   * 있고, 갈라진 날은 그렇다고 말해야 한다(rv 의 B-2 와 같은 판단). */
  asof: { irs: string | null; bss: string | null; futures: string | null };
  params: { window: number; k: number; recentN: number };
  rows: MrRow[];
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

async function get<T>(url: string, what: string): Promise<T> {
  const r = await fetch(url);
  if (r.status === 404) throw new BacktestUnavailable();
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.detail ?? `${what}: HTTP ${r.status}`);
  }
  return r.json();
}

export function fetchMrBoard(): Promise<MrBoard> {
  return get<MrBoard>(mrBoardUrl(), 'mr board');
}

export function fetchMrHistory(id: string): Promise<MrHistory> {
  return get<MrHistory>(mrHistoryUrl(id), 'mr history');
}
