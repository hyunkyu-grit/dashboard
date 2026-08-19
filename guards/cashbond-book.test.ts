import { describe, expect, it } from 'vitest';

import { encodeCashBondPositions } from '../src/lib/api';
import { splitCashBondKrw } from '../src/lib/krw';
import {
  decodeCashBondBook,
  encodeCashBondBook,
  MAX_POSITIONS,
  newCashBondRow,
  runnableCashBond,
  yearBefore,
  type CashBondBookRow,
} from '../src/cashbond/book';

/**
 * 현금채권 북 — IRS 북 가드(backtest-book)와 같은 두 질문: **서버가 거부하는
 * 것을 화면이 제안하지 않는지**, 그리고 **링크가 같은 질문을 여는지**. 여기에
 * 이 상품 고유의 셋이 붙는다: 매수만, 진입일 기본 1년 전, 네 칸 가로 합.
 */

const row = (over: Partial<CashBondBookRow> = {}): CashBondBookRow => ({
  key: 'k1',
  id: 'CB:KTB:3Y',
  direction: 1,
  eok: 100,
  entry: '2025-08-14',
  exit: '',
  ...over,
});

describe('방향이 없다 — 매수만 [OWNER, 2026-08-14]', () => {
  it('새 줄은 언제나 +1 이다', () => {
    expect(newCashBondRow('CB:KTB:3Y', '2026-08-14', '2020-01-02').direction).toBe(1);
  });

  it('손으로 만든 URL 의 매도(-1)는 버린다 — 서버도 거절한다', () => {
    // 대차료를 모르면서 0 으로 계산하면 공매도가 늘 이기는 백테스트가 된다.
    expect(decodeCashBondBook('CB:KTB:3Y,-1,1e10,2025-08-14')).toEqual([]);
  });
});

describe('진입일 기본 = 1년 전 (캐리가 쌓여야 읽히는 화면)', () => {
  it('1년 전으로', () => {
    expect(yearBefore('2026-08-14', '2020-01-02')).toBe('2025-08-14');
  });
  it('데이터 시작일이 바닥이다', () => {
    expect(yearBefore('2020-06-01', '2020-01-02')).toBe('2020-01-02');
  });
});

describe('링크가 곧 북 — 왕복', () => {
  it('encode → decode 가 같은 북을 세운다 (억 ↔ 원 한 자리에서만)', () => {
    const book = [
      row(),
      row({ key: 'k2', id: 'ASW:KDB:5Y', eok: 250, entry: '2026-01-05', exit: '2026-06-30' }),
    ];
    const back = decodeCashBondBook(encodeCashBondBook(book));
    expect(back.map((r) => [r.id, r.direction, r.eok, r.entry, r.exit])).toEqual([
      ['CB:KTB:3Y', 1, 100, '2025-08-14', ''],
      ['ASW:KDB:5Y', 1, 250, '2026-01-05', '2026-06-30'],
    ]);
  });

  it('인코딩은 서버가 읽는 그 문자열 하나뿐이다 (api.encodeCashBondPositions)', () => {
    const book = [row()];
    expect(encodeCashBondBook(book)).toBe(encodeCashBondPositions(runnableCashBond(book)));
  });

  it('모양이 안 맞는 조각은 버린다 — 반쯤 해석한 북으로 실행하지 않는다', () => {
    expect(decodeCashBondBook('CB:KTB:3Y,1')).toEqual([]);
    expect(decodeCashBondBook('CB:KTB:3Y,1,abc,2025-08-14')).toEqual([]);
    expect(decodeCashBondBook(undefined)).toEqual([]);
  });

  it('상한을 넘는 줄은 자른다', () => {
    const many = Array.from({ length: 20 }, () => 'CB:KTB:3Y,1,1e10,2025-08-14').join(';');
    expect(decodeCashBondBook(many)).toHaveLength(MAX_POSITIONS);
  });
});

describe('네 칸은 표시 정밀도에서 가로로 더해진다 (splitCashBondKrw)', () => {
  it('평가 + 캐리 + 롤다운 + 조달 = 합계, 만원 단위에서 정확히', () => {
    // 각자 반올림하면 1만원이 어긋나는 실제 모양의 숫자들
    const u = splitCashBondKrw(311_140_166, 353_554_999, -7_384_999, -35_034_999, 0);
    expect(u.uVal + u.uCarry + u.uRoll + u.uFund).toBe(u.uPnl);
  });

  it('개시는 평가에 접힌다 [OWNER, 2026-08-14]', () => {
    const flat = splitCashBondKrw(100_000_000, 60_000_000, 0, 0, 0);
    const folded = splitCashBondKrw(100_000_000, 50_000_000, 0, 0, 10_000_000);
    expect(folded.uVal).toBe(flat.uVal);
    expect(folded.uCarry).toBe(flat.uCarry);
  });
});
