import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { encodePositions } from '../src/lib/api';
import { splitCashBondKrw } from '../src/lib/krw';
import {
  bookKindOf,
  decodeBook,
  defaultEntry,
  directionLabel,
  encodeBook,
  isBondRow,
  MAX_POSITIONS,
  newRow,
  runnable,
  yearBefore,
  type BookRow,
} from '../src/backtest/book';

/**
 * 현금채권 줄 — **IRS 북과 같은 북**이 됐다 [OWNER, 2026-08-21 — "현금채권이랑
 * 스왑을 섞어서 백테스팅"]. 이 파일이 지키는 질문은 종전과 같다: **서버가
 * 거부하는 것을 화면이 제안하지 않는지**, 그리고 **링크가 같은 질문을 여는지**.
 * 상품 고유의 셋도 그대로다: 매수만, 진입일 기본 1년 전, 네 칸 가로 합.
 *
 * 달라진 것은 그 규칙이 사는 자리뿐이다 — `cashbond/book.ts` 가 은퇴하고
 * `backtest/book.ts` 하나가 두 상품을 다 진다. 북이 둘이면 "이 북이 얼마였나"
 * 에 두 답이 생기고, 그건 두 북이다.
 */

const row = (over: Partial<BookRow> = {}): BookRow => ({
  key: 'k1',
  id: 'CB:KTB:3Y',
  direction: 1,
  eok: 100,
  entry: '2025-08-14',
  exit: '',
  ...over,
});

describe('id 만 보고 종류를 안다 — 백엔드 mixedbook.is_bond 와 같은 규칙', () => {
  it('접두사가 가장 먼저다 — CB: 에는 - 가 없어 아웃라이트로 읽힌다', () => {
    expect(bookKindOf('CB:KTB:3Y')).toBe('cashbond');
    expect(bookKindOf('ASW:KDB:5Y')).toBe('assetswap');
    expect(bookKindOf('3Y-10Y')).toBe('swap');
    expect(bookKindOf('10Y')).toBe('swap');
  });

  it('채권 줄인지가 한 함수의 답이다', () => {
    expect(isBondRow({ id: 'CB:KTB:3Y' })).toBe(true);
    expect(isBondRow({ id: '2Y-5Y-10Y' })).toBe(false);
  });
});

describe('방향이 없다 — 매수만 [OWNER, 2026-08-14]', () => {
  it('새 줄은 언제나 +1 이다', () => {
    expect(newRow('CB:KTB:3Y', '2025-08-14').direction).toBe(1);
  });

  it('손으로 만든 URL 의 매도(-1)는 버린다 — 서버도 거절한다', () => {
    // 대차료를 모르면서 0 으로 계산하면 공매도가 늘 이기는 백테스트가 된다.
    expect(decodeBook('CB:KTB:3Y,-1,1e10,2025-08-14')).toEqual([]);
  });

  it('스왑 줄의 매도는 그대로 통과한다 — 규칙은 상품의 것이지 북의 것이 아니다', () => {
    expect(decodeBook('3Y-10Y,-1,1e10,2025-08-14')).toHaveLength(1);
  });

  it('매도 채권이 섞인 북은 실행 목록에서 그 줄만 빠진다', () => {
    const book = [row({ direction: -1 }), row({ key: 'k2', id: '10Y', direction: -1 })];
    expect(runnable(book).map((r) => r.id)).toEqual(['10Y']);
  });

  it('방향 문구를 물으면 "매수" 라고 답한다 — "페이" 는 거짓말이다', () => {
    expect(directionLabel('CB:KTB:3Y', 1)).toBe('매수');
    expect(directionLabel('CB:KTB:3Y', -1)).toBe('매수');
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

describe('진입일 기본은 **상품이** 정한다 — 부르는 자리마다가 아니라', () => {
  /* 창을 합치는 첫 판이 정확히 여기서 틀렸다: 현금채권 탭의 백테스트 버튼과
   * 「줄 추가」 가 채권 줄에 **오늘**을 심어, 캐리가 하루도 안 쌓인 «거의 0» 북이
   * 떴다. 판단이 한 함수에 있어야 세 자리가 같이 따라간다. */
  it('스왑은 데이터 일자, 채권은 1년 전', () => {
    expect(defaultEntry('10Y', '2026-08-19', '2026-08-19', '2020-01-02')).toBe('2026-08-19');
    expect(defaultEntry('CB:KTB:3Y', '2026-08-19', '2026-08-19', '2020-01-02')).toBe(
      '2025-08-19',
    );
    expect(defaultEntry('ASW:KTB:3Y', '2026-08-19', '2026-08-19', '2020-01-02')).toBe(
      '2025-08-19',
    );
  });

  it('민평 시작일이 바닥이다 — 그 앞은 서버가 조용히 스냅한다', () => {
    expect(defaultEntry('CB:KTB:3Y', '2020-06-01', '2020-06-01', '2020-01-02')).toBe(
      '2020-01-02',
    );
  });

  it('새 줄을 만드는 세 자리가 전부 그 함수를 지난다', () => {
    const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const win = read('src/backtest/BacktestWindow.tsx');
    const page = read('src/app/page.tsx');
    // 창의 「줄 추가」 · 창을 열 때의 씨앗 · 차트 클릭 진입
    expect(win).toMatch(/newRow\(id, defaultEntry\(/);
    expect(win).toMatch(/newRow\(seedId, defaultEntry\(/);
    /* 페이지 쪽은 `row.id` 가 아니라 `bookId` 를 넘긴다 — Main 의 선물 행은
       id 어휘가 달라 `bookIdOf` 로 한 번 옮긴다(2026-08-25 선물 레인). */
    expect(page).toMatch(/defaultEntry\([\s\S]{0,20}?bookId/);
  });
});

describe('링크가 곧 북 — 스왑과 채권이 한 문자열에 실린다', () => {
  it('encode → decode 가 같은 북을 세운다 (억 ↔ 원 한 자리에서만)', () => {
    const book = [
      row(),
      row({ key: 'k2', id: 'ASW:KDB:5Y', eok: 250, entry: '2026-01-05', exit: '2026-06-30' }),
      row({ key: 'k3', id: '3Y-10Y', direction: -1, eok: 50, entry: '2026-02-02' }),
    ];
    const back = decodeBook(encodeBook(book));
    expect(back.map((r) => [r.id, r.direction, r.eok, r.entry, r.exit])).toEqual([
      ['CB:KTB:3Y', 1, 100, '2025-08-14', ''],
      ['ASW:KDB:5Y', 1, 250, '2026-01-05', '2026-06-30'],
      ['3Y-10Y', -1, 50, '2026-02-02', ''],
    ]);
  });

  it('인코딩은 서버가 읽는 그 문자열 하나뿐이다 (api.encodePositions)', () => {
    const book = [row(), row({ key: 'k2', id: '10Y' })];
    expect(encodeBook(book)).toBe(encodePositions(runnable(book)));
  });

  it('모양이 안 맞는 조각은 버린다 — 반쯤 해석한 북으로 실행하지 않는다', () => {
    expect(decodeBook('CB:KTB:3Y,1')).toEqual([]);
    expect(decodeBook('CB:KTB:3Y,1,abc,2025-08-14')).toEqual([]);
    expect(decodeBook(undefined)).toEqual([]);
  });

  it('상한을 넘는 줄은 자른다', () => {
    const many = Array.from({ length: 20 }, () => 'CB:KTB:3Y,1,1e10,2025-08-14').join(';');
    expect(decodeBook(many)).toHaveLength(MAX_POSITIONS);
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
