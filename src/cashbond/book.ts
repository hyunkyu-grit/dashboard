/* Cash Bond 백테스트의 북 — IRS 쪽 `backtest/book.ts` 의 현금채권 판.
 *
 * 이 파일은 순수하다 — DOM 도 fetch 도 없다. 다른 것은 상품이 달라서다:
 *
 *   **방향이 없다** [OWNER, 2026-08-14 — "국고채는 매도는 없는거고"]. 현금채권은
 *   사는 것이지 파는 것이 아니다. 공매도는 채권을 빌려야 하고 그 대차료는 이
 *   화면이 아는 값이 아니다. 그래서 고를 것 자체를 두지 않는다 — direction 은
 *   언제나 +1 이다(서버가 -1 을 거절한다).
 *
 *   **진입일 기본이 1년 전이다.** 채권은 캐리가 쌓여야 읽히는 화면이라 며칠짜리
 *   기본값은 늘 "거의 0" 을 보여 준다 (v1 CashBondWindow 의 같은 규칙).
 */

import { encodeCashBondPositions, type CashBondPositionInput } from '@/lib/api';

/** 백엔드 `app/cashbond.py:MAX_POSITIONS` 와 같은 수. */
export const MAX_POSITIONS = 12;

export interface CashBondBookRow extends CashBondPositionInput {
  /** 표시용 로컬 키. id 는 중복될 수 있다(같은 종목을 다른 날 두 번). */
  key: string;
}

/** 진입일 기본값 = 1년 전, 데이터 시작일보다 이르면 그 날. */
export function yearBefore(asOf: string, floorDate: string): string {
  const d = new Date(asOf);
  d.setFullYear(d.getFullYear() - 1);
  const iso = d.toISOString().slice(0, 10);
  return iso < floorDate ? floorDate : iso;
}

let seq = 0;
export function newCashBondRow(id: string, asOf: string, minDate: string): CashBondBookRow {
  seq += 1;
  return { key: `c${seq}`, id, direction: 1, eok: 100, entry: yearBefore(asOf, minDate), exit: '' };
}

/** 실행할 수 있는 줄만 — IRS `runnable` 과 같은 이유. */
export function runnableCashBond(book: CashBondBookRow[]): CashBondBookRow[] {
  return book.filter((r) => r.id && r.entry && r.eok > 0);
}

/* ── URL — 북은 붙여넣을 수 있는 링크다 (IRS 의 `bt` 와 같은 성질, 키는 `cb`) ── */

export function encodeCashBondBook(book: CashBondBookRow[]): string {
  return encodeCashBondPositions(runnableCashBond(book));
}

/** `id,direction,notional,entry[,exit]` (`;` 구분)의 역. 모양이 안 맞는 조각은
 * **버린다** — 반쯤 해석한 북으로 실행하느니 그 줄이 없는 게 낫다. 방향은 +1
 * 만 통과시킨다(손으로 만든 URL 의 매도는 서버도 거절한다). */
export function decodeCashBondBook(s: string | undefined | null): CashBondBookRow[] {
  if (!s) return [];
  const out: CashBondBookRow[] = [];
  for (const part of s.split(';')) {
    const f = part.split(',');
    if (f.length < 4) continue;
    const [id, dir, notional, entry, exit] = f;
    const n = Number(notional);
    if (!id || !entry || Number(dir) !== 1 || !Number.isFinite(n) || n <= 0) continue;
    seq += 1;
    out.push({
      key: `u${seq}`,
      id,
      direction: 1,
      // 서버 문법은 원이고 화면은 억이다. 나누는 자리는 여기 하나뿐.
      eok: n / 1e8,
      entry,
      exit: exit ?? '',
    });
    if (out.length >= MAX_POSITIONS) break;
  }
  return out;
}
