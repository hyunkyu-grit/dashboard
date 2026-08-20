/* 발행 캘린더가 서버와 주고받는 둘 — 달과 하루.
 *
 * CSV 가 원천이라 굽기에 실을 수 없다. 수집기가 평일 5분마다 새로 쓰고, 서버는
 * mtime 을 캐시 키로 써서 다음 요청 때 알아서 읽는다. 백엔드가 없거나 CSV 경로가
 * 안 잡히면 화면이 그 사실을 말한다 — 백테스트·시뮬과 같은 규약이다.
 */

import { issuanceCalendarUrl, issuanceDayUrl } from '@/lib/staticPaths';

export class IssuanceUnavailable extends Error {
  constructor(detail?: string) {
    super(detail ?? '발행 캘린더는 실행 중인 백엔드가 필요해요');
    this.name = 'IssuanceUnavailable';
  }
}

/** 달력 한 칸. 섹터 합계를 서버가 미리 더하지 않는다 — 화면의 섹터 필터가 달력을
 * 실제로 바꾸려면 하루치가 섹터별로 갈려 있어야 한다. */
export type CalDay = {
  d: number;
  iso: string;
  /** 영업일인가. 비영업일도 자리는 지킨다 — 빠지면 요일이 어긋난다. */
  biz: boolean;
  past: boolean;
  today: boolean;
  /** 섹터 → 조원. */
  isec: Record<string, number>;
  /** 섹터 → 건수. */
  isn: Record<string, number>;
  ev: { lane: string; label: string }[];
};

export type CalMonth = {
  /** 1일의 요일(월=0). 격자 앞을 그만큼 비운다. */
  lead: number;
  days: CalDay[];
};

export type IssuanceCalendar = {
  months: Record<string, CalMonth>;
  order: string[];
  sectors: { k: string; v: number; n: number; fin: boolean }[];
  today: string;
  /** 발행 공시가 닿는 마지막 날. 그 뒤의 빈칸은 «없음» 이 아니다. */
  issuanceThrough: string | null;
  /** 국고채 입찰 **결과**가 나온 마지막 날. 앞날의 예정은 이 판에 없다. */
  auctionThrough: string | null;
  caveats: string[];
};

/** 같은 연물 52주와 견준 판정. 표본이 모자라면 등급 대신 그렇다고 말한다. */
export type Strength = {
  grade: string;
  tone?: string | null;
  label?: string | null;
  /** 응찰률 백분위. `null` 이면 표본 부족이라 등급을 안 낸 것이다. */
  pct: number | null;
  median?: number | null;
  why?: string | null;
  legs?: number;
  tot?: number | null;
  ratio?: number | null;
  wavgDelta?: number | null;
  prevDate?: string | null;
  totMed?: number | null;
  partMed?: number | null;
  notes?: string[];
};

export type IssuanceDay = {
  date: string;
  issuing: {
    issuer: string;
    sector: string;
    round: string | null;
    /** 억원. */
    eok: number;
    coupon: number | null;
    maturity: string | null;
    rating: string | null;
    stage: string | null;
    report: string | null;
    rcept: string | null;
  }[];
  auctions: {
    kind: string;
    name: string;
    code: string | null;
    offered: number | null;
    bid: number | null;
    ratio: number | null;
    allotted: number | null;
    lowRate: number | null;
    highRate: number | null;
    wavgRate: number | null;
    partial: number | null;
    dealers: number | null;
    issueDate: string | null;
    strength: Strength | null;
  }[];
  omo: {
    kind: string;
    name: string | null;
    planned: number | null;
    allotted: number | null;
    rate: number | null;
  }[];
  /** 금통위가 **있는 날**인지와 그날 **무엇을 정했는지**는 다른 사실이다.
   * `scheduled` 는 검증된 달력이, `decision` 은 수집기의 결과표가 답한다. */
  mpc: {
    scheduled: boolean;
    decision: {
      decision: string | null;
      before: number | null;
      after: number | null;
      changePp: number | null;
      gist: string | null;
    } | null;
  } | null;
};

async function get<T>(url: string, what: string): Promise<T> {
  const r = await fetch(url);
  if (r.status === 404) throw new IssuanceUnavailable();
  if (r.status === 503) {
    const detail = (await r.json().catch(() => null)) as { detail?: string } | null;
    throw new IssuanceUnavailable(detail?.detail);
  }
  if (!r.ok) {
    const detail = (await r.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(detail?.detail ?? `${what}: HTTP ${r.status}`);
  }
  return (await r.json().catch(() => {
    throw new Error('서버가 응답을 끝내지 못했어요, 다시 열어 보세요');
  })) as T;
}

export const fetchIssuanceCalendar = (ym: string, months: number) =>
  get<IssuanceCalendar>(issuanceCalendarUrl(ym, months), '발행 캘린더');

export const fetchIssuanceDay = (iso: string) =>
  get<IssuanceDay>(issuanceDayUrl(iso), '그날 발행');
