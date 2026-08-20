/* RV Analysis 의 서버 계약 — 다섯 파생량(carry_net·roll·매도 듀레이션·BEP·
 * 스왑점)은 전부 서버가 끝낸다(§16). 프런트는 틴트와 배치만 한다.
 *
 * 라이브 전용이다(백테스트·Cash Bond 와 같은 성질): 민평이 SQL 에만 있고
 * 조달·금통위 경로가 읽는 사람의 입력이다. 404 = 라우트 없음 = 백엔드 없음.
 */

import { BacktestUnavailable } from '@/lib/api';
import { rvAnalysisUrl, rvHistoryUrl } from '@/lib/staticPaths';

export type RvWindow = '52w' | 'all';

/** 재투자 방식 — 워크북 `만기선택!B11` 의 세 갈래. 기본 `none`(앵커 8행). */
export type RvReinvestMode = 'none' | 'manual' | 'residual';

export const REINVEST_LABEL: Record<RvReinvestMode, string> = {
  none: '재투자 안 함',
  manual: '금리 직접 입력',
  residual: '남은 기간 커브금리',
};

/** 레인 A 의 한 후보(커브 노드 합성 채권). */
export interface RvCandidate {
  tenor: string;
  years: number;
  /** 매도시점 수정듀레이션(년) — BEP 의 분모. 만기 보유는 0. */
  dur: number;
  carryBp: number;
  rollBp: number;
  /** 재투자수익 bp — 만기가 H 안에 드는 후보에만 산다(워크북 O열). 재투자
   * 방식이 `none` 이면 0 이다. */
  reinvBp: number;
  reinvDays: number;
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
  /** 비평행 경로별 총수익 bp — 워크북 케이스 C/C-2. `paths` 와 같은 순서. */
  pathTr: number[];
  /** 그 경로가 이 후보의 **잔존만기 지점**에서 실제로 몇 bp 였나(워크북 E열).
   * 같은 경로가 후보마다 다른 크기로 닿는다는 사실을 표가 말한다. 만기 보유는
   * 매도금리가 없어 null. */
  pathDy: (number | null)[];
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
 * 재계산하지 않는다(§16).
 *
 * 2026-08-20 워크북 정렬 [OWNER]: 버퍼가 **아웃라이트 금리축**으로 옮겼고
 * (조달이 더 이상 상쇄되지 않는다), 사분면 두 축이 `trMonthBp` × `pctLastWeek`
 * 로 바뀌었다. `bepSpreadBp`·`vol3mBp`·`coverage` 는 은퇴 — 축이 달라지면
 * 그 σ 가 뜻을 잃는다. `covPct` 는 **이름만 바뀌어 살아 있다**(`spreadVolPct`)
 * — Score 입력은 이번 지시의 범위 밖이었다. */
export interface RvCreditItem {
  sector: string;
  sectorLabel: string;
  /** **스프레드의 앵커** — 무엇 대비로 잰 값인가 [트레이더 피드백 2026-08-20].
   * 앞단(통안·특은·공사)은 국고, 확산(은행·회사·카드·캐피탈)은 특은채다.
   * 한 표에 두 앵커가 섞이므로 열 머리 하나로는 못 적는다 — 행마다 붙는다. */
  base: string;
  baseLabel: string;
  tenor: string;
  years: number;
  /** 그 앵커 대비 스프레드(bp). */
  nowBp: number;
  /** 절대축 — 버퍼(**아웃라이트 금리 bp**). 캐리&롤을 매도시점 par 듀레이션으로
   * 나눈 값 = 워크북 Q/R/S열. 조달은 캐리에 그대로 남는다(스프레드축의 국고
   * 헤지 페어에서는 소거됐다 — 2026-08-20 에 축이 바뀌었다). */
  carryBp: number;
  rollBp: number;
  bufferBp: number;
  /** 사분면 x축 — **월환산 총수익 bp** [OWNER 2026-08-20]. (캐리+롤+재투자) ÷ H.
   * 듀레이션으로 **안 나눈** 값이라 버퍼와 순서가 반대로 나온다 — "한 달에 몇
   * bp 버나". 점수에는 안 들어간다(레벨 오염 방지). */
  trMonthBp: number;
  /** 사분면 y축 — **지난주 스프레드의 창 백분위** [OWNER 2026-08-20]. 직전
   * 5영업일 평균을 창(52주/전체) 분포에서 midrank 로 센다. Score 의 절대축
   * 입력이기도 하다(covPct 의 후임). */
  pctLastWeek: number | null;
  /** 그 백분위가 무엇을 랭크했나 — 직전 5영업일 스프레드 평균(bp). */
  lastWeekBp: number | null;
  /** **Score 절대축의 점수 입력** — s/vol3m 의 자기 이력 백분위. 사분면 y축
   * (`pctLastWeek`)과 **다른 통계**다: 하나는 보는 축, 하나는 점수 입력이라
   * 다른 이름으로 산다. 표에는 안 서고 이력창에서만 보인다 — Score 가 어디서
   * 왔는지 물을 자리가 거기다. */
  spreadVolPct: number | null;
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
  /** 숏 가능 만기 = {1, 1.5, 2, 3} — 5년 숏 불가 게이트는 서버가 정한다.
   * (10Y 선물은 만기 상한 3Y 밖이라 이 화면에 안 선다 — OWNER 2026-08-20.) */
  shortable: boolean;
  shortVia: string | null;
  /** universe 의 CRD 어휘 그대로 — 다른 화면과 같은 계열 이름. */
  seriesId: string;
}

export interface RvCredit {
  /** 크레딧 RV 의 H — 2026-08-20 부터 레인 A 와 **같다**(워크북에 H 가 하나다). */
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
  /** 스프레드 앵커 — 차트 제목이 이 이름을 읽는다("국고 대비"로 고정하면
   * 확산 섹터에서 거짓이 된다). */
  base: string;
  baseLabel: string;
  /** 횡단면(섹터 상대) 비교의 동료 수 — 앵커가 갈리며 7 → 3/4 로 줄었다. */
  peers: number;
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
  /** 이 화면의 만기 상한(년) — 3.0 [OWNER 2026-08-20]. 화면이 "왜 5Y 가
   * 없나"를 스스로 답한다. 공용 테너 격자(3M~30Y)는 그대로다. */
  maxYears: number;
  /** 재투자 규약 — 만기가 H 안에 드는 후보에만 닿는다(워크북 만기선택!B11). */
  reinvest: { mode: RvReinvestMode; rate: number | null };
  /** 비평행 경로 — 화면이 입력한 그대로 되돌아온다(열 머리에 쓴다). */
  paths: { nodes: { years: number; bp: number }[] }[];
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
  heat: {
    tenors: string[];
    sectors: {
      id: string;
      label: string;
      /** 이 행의 스프레드 앵커 — 히트맵 한 장에 두 벌이 섞인다. */
      base: string;
      baseLabel: string;
      cells: (RvHeatCell | null)[];
    }[];
  };
  credit: RvCredit;
}

export async function fetchRv(params: {
  window: RvWindow;
  basis: string;
  spreadBp: number;
  /** 보유기간 H(개월) — **두 레인이 같은 값을 쓴다**(워크북 만기선택!B7). */
  h?: number;
  mpc?: string;
  reinvest?: RvReinvestMode;
  /** 화면 단위 그대로 퍼센트 — 서버가 decimal 로 나눈다. */
  reinvestRate?: number;
  /** `3M:0,6M:5,…|3M:20,…` — 비평행 경로. 빈 문자열이면 경로 열이 없다. */
  paths?: string;
}): Promise<RvPayload> {
  const q = new URLSearchParams({
    window: params.window,
    basis: params.basis,
    spreadBp: String(params.spreadBp),
    ...(params.h ? { h: String(params.h) } : {}),
    ...(params.mpc ? { mpc: params.mpc } : {}),
    ...(params.reinvest && params.reinvest !== 'none'
      ? { reinvest: params.reinvest, reinvestRate: String(params.reinvestRate ?? 0) }
      : {}),
    ...(params.paths ? { paths: params.paths } : {}),
  });
  const r = await fetch(rvAnalysisUrl(q.toString()));
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
  const r = await fetch(rvHistoryUrl(q.toString()));
  if (r.status === 404) throw new BacktestUnavailable();
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.detail ?? `rv history: HTTP ${r.status}`);
  }
  return r.json();
}
