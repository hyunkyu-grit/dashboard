/**
 * 손으로 넣은 스왑 한 줄 → 엔진이 받는 Position.
 *
 * 왜 이게 생겼나 [OWNER, 2026-08-07]: 북(`data/Portfolio Data.xlsx`)을 한동안
 * 안 쓰기로 했다. 알고 싶은 것이 "내 북이 어떻게 되나"가 아니라 "이 포지션을
 * 이 금리 경로에 두면 어떻게 되나"이기 때문이다. 북 브릿지는 살아 있지만
 * (use-book.ts) 더 이상 포지션의 주인이 아니고, 실패해도 화면을 막지 않는다.
 *
 * ─ 최소 입력 ──────────────────────────────────────────────────────────────
 * 백엔드가 스왑에서 실제로 요구하는 것은 계약 조건뿐이다. 나머지는
 * services/simulation/swap_inputs.py가 채운다:
 *
 *   remainingDays      만기 − 기준일
 *   nextFixingDate     ISDA 스케줄에서 기준일 다음 지급일
 *   currentFloatRate   CD 픽싱 이력에서 그 구간의 리셋값
 *
 * 그래서 이 모듈은 그 세 개를 **지어내지 않는다.** 여기서 계산하면 백엔드와
 * 두 개의 진실이 생기고, 어긋나는 순간 어느 쪽이 맞는지 알 방법이 없다.
 * `irsToPosition`(use-book.ts)이 북 행에 대해 지키는 규율과 같은 규율이다.
 *
 * ─ 단위 ───────────────────────────────────────────────────────────────────
 * `couponRate`는 **퍼센트**(3.4225), 시장 스냅샷의 `rate`는 **소수**(0.034225).
 * 화면의 명목은 **억 원**, 페이로드의 notional은 **원**. 둘 다 여기서 한 번만
 * 변환한다 — 컴포넌트가 ×100이나 ×1e8을 들고 있으면 그게 다음 버그다.
 */

import type { Position } from "@/sim/types/portfolio";

/** 화면이 들고 있는 한 줄. 페이로드가 아니라 입력 폼의 상태다. */
export interface ManualPosition {
  /** 행의 안정적인 신원. 정렬·삭제·React key가 이것에 매달린다. */
  id: string;
  /** +1 = 고정 수취, −1 = 고정 지급. 백엔드 관례와 같은 부호다. */
  direction: 1 | -1;
  /** 표시용 테너 라벨 ("3Y"). 만기일을 만들고 par 금리를 고르는 데 쓴다. */
  tenor: TenorLabel;
  /** 억 원. 사람이 말하는 단위로 들고 있다가 페이로드에서만 원으로 바꾼다. */
  notionalEok: number;
  /** 퍼센트. 빈 문자열 = "시장 par를 따르겠다" — 숫자 0과 다르다. */
  fixedRatePct: number | "";
  startDate: string;
  maturityDate: string;
}

/** 시장 스냅샷이 주는 테너들(19개) 중 사람이 실제로 고르는 것들.
 * 화면의 드롭다운이자, 만기일 산술의 정의역이다. */
export const TENORS = ["1Y", "2Y", "3Y", "4Y", "5Y", "7Y", "10Y", "15Y", "20Y"] as const;
export type TenorLabel = (typeof TENORS)[number];

export const DEFAULT_TENOR: TenorLabel = "3Y";

/** "3Y" → 3. 라벨이 곧 연수라 파싱이 곧 정의다. */
export function tenorYears(t: TenorLabel): number {
  return Number(t.slice(0, -1));
}

/** 기준일 + n년. 같은 월·일을 잡되, 그 날이 없는 경우(2/29 → 평년)만
 * 그 달의 마지막 날로 내린다. Date의 월 넘침(3/1로 굴러가는 것)을 막는다. */
export function addYearsIso(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const targetY = y + years;
  const lastDay = new Date(Date.UTC(targetY, m, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${targetY}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 시장 스냅샷의 스왑 호가 한 줄. api-types의 것과 같은 모양이지만 이 모듈은
 * 필요한 두 필드만 본다 — 스냅샷 타입 전체에 묶이면 테스트가 무거워진다. */
export interface ParQuote {
  tenor_years: number;
  /** 선택적이고 null도 된다 — api-types의 RateQuoteIn과 같은 모양이어야 하고,
   * 그쪽이 두 상태를 모두 쓴다. 아래 조회는 `== null`로 둘을 함께 잡는다. */
  tenor_months?: number | null;
  rate: number;
}

/**
 * 해당 테너의 시장 par 금리(퍼센트). 없으면 null.
 *
 * `tenor_months`가 채워진 행은 1년 미만 구간(6M·9M)이라 연 단위 테너와 겹치지
 * 않는다. 그 행들을 먼저 걸러내지 않으면 `tenor_years: 1`인 6M 호가가 1Y로
 * 잡힌다 — 백테스트가 같은 함정을 한 번 밟았다(1년 미만 만기가 1Y로 가격됨).
 */
export function parRatePct(quotes: readonly ParQuote[], tenor: TenorLabel): number | null {
  const years = tenorYears(tenor);
  const hit = quotes.find((q) => q.tenor_months == null && q.tenor_years === years);
  return hit ? hit.rate * 100 : null;
}

/** 새 행 하나. 고정금리는 비워 둔다 — 화면이 시장 par로 채운다. */
export function newManualPosition(baseDate: string, seq: number): ManualPosition {
  return {
    id: `manual-${seq}`,
    direction: 1,
    tenor: DEFAULT_TENOR,
    notionalEok: 100,
    fixedRatePct: "",
    startDate: baseDate,
    maturityDate: addYearsIso(baseDate, tenorYears(DEFAULT_TENOR)),
  };
}

/** 테너를 바꾸면 만기일이 따라간다 — 시작일은 그대로. 사용자가 만기일을 직접
 * 고친 뒤 테너를 다시 건드리면 그 편집은 덮인다. 테너가 만기의 주인이고,
 * 만기를 직접 쓰는 것은 그 위의 명시적 덮어쓰기라는 순서다. */
export function withTenor(p: ManualPosition, tenor: TenorLabel): ManualPosition {
  return { ...p, tenor, maturityDate: addYearsIso(p.startDate, tenorYears(tenor)) };
}

/** 시작일을 바꾸면 만기일도 테너만큼 다시 민다. 같은 이유다. */
export function withStartDate(p: ManualPosition, startDate: string): ManualPosition {
  return { ...p, startDate, maturityDate: addYearsIso(startDate, tenorYears(p.tenor)) };
}

/** 이 줄이 실행 가능한가. 불가능하면 그 이유 — 실행 버튼을 막는 쪽이 아니라
 * 무엇이 틀렸는지 말하는 쪽이 이 함수의 일이다. */
export function positionError(p: ManualPosition, parPct: number | null): string | null {
  if (!p.startDate || !p.maturityDate) return "날짜가 비었어요";
  if (Date.parse(p.maturityDate) <= Date.parse(p.startDate)) {
    return "만기일이 시작일보다 뒤여야 해요";
  }
  if (!(p.notionalEok > 0)) return "명목이 0보다 커야 해요";
  if (p.fixedRatePct === "" && parPct === null) {
    return `${p.tenor} 시장 호가가 그날 없어요 — 고정금리를 직접 넣어주세요`;
  }
  return null;
}

/** 화면의 한 줄 → 엔진의 Position.
 *
 * `parPct`는 고정금리를 비워 둔 줄에만 쓰인다. 그 경우 진입 시점 MtM이 0인
 * 신규 거래가 되고, 결과에 남는 것은 **경로가 만든 손익뿐**이다 — 이 화면이
 * 답하려는 질문이 정확히 그것이다. 직접 적은 금리는 그대로 존중한다(기존
 * 포지션은 par에 있지 않다).
 */
export function toEnginePosition(
  p: ManualPosition,
  parPct: number | null,
  baseDate: string,
): Position {
  const coupon = p.fixedRatePct === "" ? (parPct ?? 0) : p.fixedRatePct;
  return {
    id: p.id,
    name: `${p.direction === 1 ? "수취" : "지급"} ${p.tenor}`,
    book: "직접입력",
    bondType: "swap",
    sector: "IRS",
    maturityDate: p.maturityDate,
    couponRate: coupon,
    // 원화 IRS는 분기 정산이다. 북 브릿지도 같은 값을 싣는다.
    frequency: 4,
    notional: p.notionalEok * 1e8,
    entryYield: 0,
    entryYieldPurchase: 0,
    evaluationAmount: 0,
    duration: 0,
    pvbp: 0,
    tenor: p.tenor,
    // 0을 보내면 백엔드가 만기−기준일로 채운다 (swap_inputs.py). 여기서
    // 계산해 보내면 그 규칙이 두 곳에 살게 된다.
    remainingDays: 0,
    durationWeight: 0,
    krdMap: {},
    direction: p.direction,
    currentFloatRate: 0,
    startDate: p.startDate,
  };
}

/** 기준일에 이미 만기가 지난 줄은 평가 대상이 아니다. 북 브릿지가 북 행에
 * 대해 하는 필터와 같은 것 — 손입력이라고 예외를 두면 엔진이 조용히 제외한
 * 뒤 결과만 비어 보인다. */
export function isLive(p: ManualPosition, baseDate: string): boolean {
  return Date.parse(p.maturityDate) > Date.parse(baseDate);
}
