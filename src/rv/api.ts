/* RV Analysis 의 서버 계약 — 다섯 파생량(carry_net·roll·매도 듀레이션·BEP·
 * 스왑점)은 전부 서버가 끝낸다(§16). 프런트는 틴트와 배치만 한다.
 *
 * 라이브 전용이다(백테스트·Cash Bond 와 같은 성질): 민평이 SQL 에만 있고
 * 조달·금통위 경로가 읽는 사람의 입력이다. 404 = 라우트 없음 = 백엔드 없음.
 */

import { BacktestUnavailable } from '@/lib/api';
import { API_BASE, IS_STATIC } from '@/lib/staticPaths';

export type RvWindow = '52w' | 'all';

/** 레인 A 의 한 후보(커브 노드 합성 채권). */
export interface RvCandidate {
  tenor: string;
  years: number;
  /** 매도시점 수정듀레이션(년) — BEP 의 분모. 만기 보유는 0. */
  dur: number;
  carryBp: number;
  rollBp: number;
  trBp: number;
  /** 불리 평행이동을 몇 bp 버티나. 만기 보유는 null(금리 위험 없음). */
  bepBp: number | null;
  maturityHold: boolean;
  /** 전 Δy 상단 볼록껍질 소속 — "창 안 승자"와 **다른 집합**이다(PN-2). */
  inHull: boolean;
  winFrom: number | null;
  winTo: number | null;
  /** Δy 격자(`dys`)에서의 총수익 bp — 완전 재가격. 표시 밀도용이고 결정
   * 숫자는 `swapPoints` 다(1bp 격자가 껍질 멤버를 건너뛴 실측). */
  tr: number[];
}

export interface RvSwapPoint {
  from: string;
  to: string;
  dyBp: number;
}

export interface RvSector {
  id: string;
  label: string;
  candidates: RvCandidate[];
  swapPoints: RvSwapPoint[];
  filtered: number;
}

export interface RvHeatCell {
  tenor: string;
  nowBp: number;
  pct52: number;
  pctAll: number;
  z52: number | null;
  zAll: number | null;
  obs: number;
}

/** 크레딧 RV 한 항목 — 절대축(버퍼)·상대축(RV)·합성(Score)이 **독립된 숫자**로
 * 실린다(원칙 ① — 트레이더 피드백 2026-08-18). 전부 서버 계산이고 프런트는
 * 재계산하지 않는다(§16). */
export interface RvCreditItem {
  sector: string;
  sectorLabel: string;
  tenor: string;
  years: number;
  nowBp: number;
  /** 절대축 — BEP Buffer. 국고 헤지 페어의 캐리&롤(스프레드 bp). 조달은 두
   * 다리에 같게 붙어 소거된다(원칙 ② — 금리 효과는 이 화면 밖, 각주 의무). */
  carryBp: number;
  rollBp: number;
  bufferBp: number;
  /** BEP Spread = 지금 + 버퍼 — 가산 항등을 서버 테스트가 지킨다. */
  bepSpreadBp: number;
  /** 3M 실현 스프레드 σ(bp). 관측이 얇으면 null — 지어낸 σ 는 없다. */
  vol3mBp: number | null;
  /** Coverage = 버퍼 ÷ σ. "+12bp (1.5σ)" 병기의 σ 쪽(원칙 ④). */
  coverage: number | null;
  /** 절대축의 **점수 입력** — Coverage 의 자기 이력 백분위 [OWNER 2026-08-19].
   * 오늘 크기를 오늘 후보들끼리 랭크하면 스프레드 수준(=신용위험 프리미엄)이
   * 점수로 통과해 최고 스프레드 섹터 단기물이 독식한다 — 그 수리. */
  covPct: number | null;
  /** 상대축 — z 3성분(전부 deviation, 원칙 ③)과 그 합성. */
  pct: number;
  cheapBp: number | null;
  zAbs: number | null;
  zSector: number | null;
  zCurve: number | null;
  relRv: number | null;
  /** 합성 — 랭크 백분위 50:50. 랭킹이지 투자판단이 아니다(명구 의무). */
  score: number | null;
  /** 오늘 랭크(1 = 최고 Score) — 서버가 정한다(§16, 동점 규칙 포함). */
  rank: number | null;
  /** 전 영업일 대비 랭크 변화(양수 = 올라옴) [OWNER 2026-08-19]. 전일 랭크는
   * 전일까지의 이력만 아는 세계에서 재계산 — 미래 참조 없음. */
  rankDelta: number | null;
  /** 숏 가능 만기 = {1, 1.5, 2, 3, 10} — 5년 숏 불가 게이트는 서버가 정한다. */
  shortable: boolean;
  shortVia: string | null;
  /** universe 의 CRD 어휘 그대로 — 다른 화면과 같은 계열 이름. */
  seriesId: string;
}

export interface RvCredit {
  /** 크레딧 RV 의 H — 레인 A(6M)와 **다르다**(3M, 트레이더 출발값). */
  hMonths: number;
  /** Relative RV 가중 (절대·섹터상대·커브) — 조건 바가 그대로 읽는다. */
  weights: { abs: number; sector: number; curve: number };
  items: RvCreditItem[];
  exclusions: { id: string; label: string; reason: string }[];
}

/** 클릭 상세의 두 소형 차트 — 스프레드 이력·섹터 상대 이력과 각각의 창 통계
 * (±σ 밴드 재료). `/api/rv/history`. */
export interface RvHistoryPayload {
  sector: string;
  sectorLabel: string;
  tenor: string;
  window: RvWindow;
  points: { t: string; s: number; rel: number | null }[];
  spread: { now: number | null; mean: number | null; sd: number | null };
  rel: { now: number | null; mean: number | null; sd: number | null };
}

export interface RvPayload {
  /** 소스별 as-of — IRS 와 민평이 1영업일 갈라진 실측(rv1 B-2)이 근거다. */
  asof: { creditMatrix: string; irs: string | null };
  funding: { basis: string; basisLabel: string; spreadBp: number; label: string; latest: number };
  hMonths: number;
  windowBp: number;
  meetings: { date: string; bp: number }[];
  window: RvWindow;
  candidates: number;
  dys: number[];
  sectors: RvSector[];
  pool: {
    hull: { sector: string; tenor: string }[];
    swapPoints: {
      from: { sector: string; tenor: string };
      to: { sector: string; tenor: string };
      dyBp: number;
      dyLinearBp: number;
    }[];
    winners: { sector: string; tenor: string; from: number; to: number }[];
  };
  heat: { tenors: string[]; sectors: { id: string; label: string; cells: (RvHeatCell | null)[] }[] };
  credit: RvCredit;
}

export async function fetchRv(params: {
  window: RvWindow;
  basis: string;
  spreadBp: number;
  mpc?: string;
}): Promise<RvPayload> {
  const q = new URLSearchParams({
    window: params.window,
    basis: params.basis,
    spreadBp: String(params.spreadBp),
    ...(params.mpc ? { mpc: params.mpc } : {}),
  });
  const path = `/api/rv/analysis?${q.toString()}`;
  const r = await fetch(IS_STATIC ? path : `${API_BASE}${path}`);
  if (r.status === 404) throw new BacktestUnavailable();
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.detail ?? `rv: HTTP ${r.status}`);
  }
  return r.json();
}

export async function fetchRvHistory(params: {
  sector: string;
  tenor: string;
  window: RvWindow;
}): Promise<RvHistoryPayload> {
  const q = new URLSearchParams({
    sector: params.sector,
    tenor: params.tenor,
    window: params.window,
  });
  const path = `/api/rv/history?${q.toString()}`;
  const r = await fetch(IS_STATIC ? path : `${API_BASE}${path}`);
  if (r.status === 404) throw new BacktestUnavailable();
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.detail ?? `rv history: HTTP ${r.status}`);
  }
  return r.json();
}
