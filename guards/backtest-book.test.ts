import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { encodePositions } from '../src/lib/api';
import { splitKrw } from '../src/lib/krw';
import type { Row } from '../src/table/rows';
import {
  BOOKABLE_GROUPS,
  SWAP_GROUPS,
  decodeBook,
  directionLabel,
  encodeBook,
  forgetBacktestMemory,
  isBookable,
  loadBacktestMemory,
  MAX_POSITIONS,
  newRow,
  runnable,
  saveBacktestMemory,
  type BookRow,
} from '../src/backtest/book';

/**
 * 백테스트 북 (레인 4) — **서버가 거부하는 것을 화면이 제안하지 않는지**, 그리고
 * **링크가 같은 질문을 여는지**.
 *
 * 둘 다 조용히 틀린다: 목록에 포워드가 섞이면 고른 다음 실행할 때 422 가 나고,
 * 왕복이 깨지면 붙여넣은 링크가 **남의 북**을 연다(그리고 그 답을 내 질문의
 * 답으로 읽는다).
 */

const row = (id: string, group: Row['group']): Row =>
  ({ id, label: id, group, unit: '%', now: 3, changes: { d1: null, mtd: null, ytd: null },
     pct: null, seriesId: id, rangeHigh: null, rangeLow: null, rangeAvg: null,
     sortKey: [1], movePct: null, key: false }) as Row;

describe('담을 수 있는 것 — 엔진이 받는 것만', () => {
  it('스왑 셋 + 채권 둘 [OWNER, 2026-08-21 — 한 북에 섞는다]', () => {
    expect(BOOKABLE_GROUPS).toEqual(['outright', 'spread', 'fly', 'cashbond', 'asw']);
  });

  it('종목 드롭다운이 쓰는 목록은 스왑 셋뿐이다', () => {
    /* 현금채권·자산스왑은 **종목군과 만기를 따로** 고른다 [OWNER — "Cash Bond
     * 에서는 종목, 테너로"]. 같은 드롭다운에 섞으면 90줄이 넘어 고를 수가 없다. */
    expect(SWAP_GROUPS).toEqual(['outright', 'spread', 'fly']);
  });

  it('포워드는 뺀다 — `_validate` 가 x 가 든 id 를 전부 거부한다', () => {
    // v1 이 이걸 목록에 두었을 때, 고를 수는 있는데 실행하면 매번 422 였다.
    expect(isBookable(row('1Yx1Y', 'forward'))).toBe(false);
  });

  it('변동성·민평·선물도 아니다 — 스왑이 아니거나 포지션이 아니다', () => {
    expect(isBookable(row('vol:1Y', 'vol'))).toBe(false);
    expect(isBookable(row('국고 3Y', 'govt'))).toBe(false);
    expect(isBookable(row('3년 국채선물', 'futures'))).toBe(false);
    expect(isBookable(row('BSS 3Y', 'bss'))).toBe(false);
  });

  it('담을 수 있는 다섯은 통과', () => {
    expect(isBookable(row('10Y', 'outright'))).toBe(true);
    expect(isBookable(row('3Y-10Y', 'spread'))).toBe(true);
    expect(isBookable(row('1Y-3Y-10Y', 'fly'))).toBe(true);
    expect(isBookable(row('CB:KTB:3Y', 'cashbond'))).toBe(true);
    expect(isBookable(row('ASW:KTB:3Y', 'asw'))).toBe(true);
  });
});

describe('방향을 뭐라고 부르는가 [OWNER 2026-07-31]', () => {
  it('아웃라이트는 페이 / 리시브', () => {
    expect(directionLabel('10Y', 1)).toBe('페이');
    expect(directionLabel('10Y', -1)).toBe('리시브');
  });

  it('스프레드는 스티프너 / 플래트너 — 그리고 다리를 같이 적는다', () => {
    // 긴 다리에 고정을 지급하는 것이 스티프너(Clarus). 용어만 믿지 않도록
    // 다리를 괄호에 적는다.
    expect(directionLabel('3Y-10Y', 1)).toBe('스티프너 (10Y 페이 · 3Y 리시브)');
    expect(directionLabel('3Y-10Y', -1)).toBe('플래트너 (10Y 리시브 · 3Y 페이)');
  });

  it('버터플라이는 **용어를 지어내지 않는다** — 다리만 적는다', () => {
    /* 조사 결론: Clarus 는 "buy the fly = 벨리 페이", 다른 데스크는 반대,
     * TraditionData 는 "다리를 명시하지 않는 한 서로 다른 뜻" 이라고 적는다.
     * v1 이 두 번(벨리 지급/수취, 벨리 페이/리시브) 지어냈다가 둘 다 오너가
     * 처음 듣는 말이었다. */
    expect(directionLabel('1Y-3Y-10Y', 1)).toBe('3Y 페이 · 1Y/10Y 리시브');
    expect(directionLabel('1Y-3Y-10Y', -1)).toBe('3Y 리시브 · 1Y/10Y 페이');
    for (const d of [1, -1]) {
      expect(directionLabel('1Y-3Y-10Y', d)).not.toMatch(/플라이|나비|벨리 (페이|리시브)$/);
    }
  });
});

describe('링크가 곧 북 — 왕복', () => {
  const book: BookRow[] = [
    { key: 'a', id: '10Y', direction: 1, eok: 100, entry: '2026-03-09', exit: '' },
    { key: 'b', id: '3Y-10Y', direction: -1, eok: 250, entry: '2026-01-05', exit: '2026-06-30' },
  ];

  it('인코딩은 서버가 읽는 그 문자열 하나뿐이다', () => {
    expect(encodeBook(book)).toBe(encodePositions(book));
  });

  it('디코딩이 같은 북을 낸다 (키만 새로 붙는다)', () => {
    const back = decodeBook(encodeBook(book));
    const drop = (r: BookRow) => ({ ...r, key: undefined });
    expect(back.map(drop)).toEqual(book.map(drop));
  });

  it('억 ↔ 원 변환은 한 자리에서만 일어난다', () => {
    expect(encodeBook([book[0]])).toContain('10000000000'); // 100억
    expect(decodeBook('10Y,1,10000000000,2026-03-09')[0].eok).toBe(100);
  });

  it('모양이 깨진 조각은 버린다 — 반쯤 해석한 북으로 실행하지 않는다', () => {
    expect(decodeBook('10Y,1')).toEqual([]);
    expect(decodeBook('10Y,3,1e10,2026-03-09')).toEqual([]); // 방향은 ±1 뿐
    expect(decodeBook(';;;')).toEqual([]);
    expect(decodeBook(undefined)).toEqual([]);
  });

  it('열두 줄에서 끊는다', () => {
    const many = Array.from({ length: 20 }, () => '10Y,1,10000000000,2026-03-09').join(';');
    expect(decodeBook(many)).toHaveLength(MAX_POSITIONS);
  });
});

describe('실행할 수 있는 줄', () => {
  it('종목·진입일이 있고 규모가 0 이 아니어야 한다', () => {
    const b: BookRow[] = [
      { key: '1', id: '10Y', direction: 1, eok: 100, entry: '2026-03-09', exit: '' },
      { key: '2', id: '', direction: 1, eok: 100, entry: '2026-03-09', exit: '' },
      { key: '3', id: '10Y', direction: 1, eok: 0, entry: '2026-03-09', exit: '' },
      { key: '4', id: '10Y', direction: 1, eok: 100, entry: '', exit: '' },
    ];
    // 반쯤 채운 줄을 보내면 서버가 422 를 주고, 그 422 에는 어느 줄인지가 없다.
    expect(runnable(b).map((r) => r.key)).toEqual(['1']);
  });
});

describe('세션 기억', () => {
  beforeEach(() => forgetBacktestMemory());

  it('북과 결과를 함께 기억한다 — 답을 다시 보여주는 것은 재실행이 아니다', () => {
    saveBacktestMemory('backtest', { book: [newRow('10Y', '2026-03-09')] });
    saveBacktestMemory('backtest', { result: { pnl: 1 } });
    const m = loadBacktestMemory('backtest');
    expect(m.book).toHaveLength(1);
    expect(m.result).toEqual({ pnl: 1 });
  });

  it('localStorage 가 아니다 — 어제의 질문이 오늘 창에 떠 있으면 안 된다', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/backtest/book.ts'),
      'utf8',
    );
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(body).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe('3분해는 화면에서 합계와 맞는다', () => {
  it('평가 + 롤다운 + 캐리 = 합계, 만원 단위에서 정확히', () => {
    /* 실측으로 걸린 결함(2026-08-14): 세 항목을 각자 반올림했더니 화면이
     * 평가 −39,971 + 롤다운 +29,148 + 캐리 +4,696 = −6,127 인데 헤드라인은
     * −6,128 이었다. 1만원이고, 이 리포는 같은 거짓말을 이미 한 번 출하했다. */
    const pnl = -61_275_431;
    const val = -399_712_100;
    const roll = 291_480_900;
    const { uPnl, uVal, uRoll, uCarry } = splitKrw(pnl, val, roll);
    expect(uVal + uRoll + uCarry).toBe(uPnl);
  });

  it('창이 그 분해를 쓴다 — 항목마다 반올림하지 않는다', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/backtest/BacktestWindow.tsx'),
      'utf8',
    );
    expect(src).toMatch(/splitKrw\(result\.pnl/);
    // 항목은 만-단위에서 포맷된다(다시 반올림하지 않는다)
    expect(src).toMatch(/fmtKrwFromMan\(u\)/);
  });
});

describe('스스로 실행되지 않는다', () => {
  it('실행은 버튼 하나에서만 시작된다', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/backtest/BacktestWindow.tsx'),
      'utf8',
    );
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    /* 북이 바뀔 때마다 도는 이펙트가 생기면 날짜를 타이핑하는 중에 서버가
     * 하루 단위 전면 재평가를 반복한다. `run` 은 onClick 에서만 불린다. */
    expect(body).toMatch(/onClick=\{\(\) => void run\(\)\}/);
    expect(body).not.toMatch(/useEffect\([^)]*\brun\b/);
  });
});

describe('차트를 눌러서 들어간다 [v1 계약, OWNER 2026-08-18 복원]', () => {
  const pane = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/ui/PreviewPane.tsx'),
    'utf8',
  );
  const page = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/app/page.tsx'),
    'utf8',
  );

  it('플롯이 버튼이고, 짚은 날짜가 진입일로 실려 간다', () => {
    // v1: 차트 블록 전체가 role="button", 클릭 = onOpen(row, hoveredDate).
    expect(pane).toMatch(/role=\{onOpenBacktest && row \? 'button' : undefined\}/);
    expect(pane).toMatch(/onOpenBacktest\(row, hoverPoint\?\.t\)/);
  });

  it('키보드로도 들어간다 — Enter/Space', () => {
    expect(pane).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/);
  });

  it('메인 pane 에만 달린다 — 오버뷰·확대 창은 아니다', () => {
    /* 전체탭 오버뷰 차트는 v1 에서도 백테스트를 안 열었고(메모리 08-04),
     * 확대 창 안에서 열면 창 위에 창이 선다. prop 을 안 주면 안 눌린다. */
    const usages = [...page.matchAll(/onOpenBacktest=\{/g)];
    expect(usages).toHaveLength(1);
    const overview = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/ui/OverviewColumns.tsx'),
      'utf8',
    );
    expect(overview).not.toMatch(/onOpenBacktest/);
  });

  it('클릭 진입은 새로 심는다 — 기억된 북이 날짜 힌트를 가리지 않는다', () => {
    // 특정 차트의 특정 날짜를 눌렀다는 것은 명시적인 질문이다. seedBook 을
    // 지나면 기억된 북이 먼저 살아나서 짚은 날짜가 영영 안 먹는 것처럼 보인다.
    expect(page).toMatch(/setBook\(\[newRow\(row\.id, entry\)\]\)/);
    // 그 `entry` 안에 짚은 날짜가 먼저 온다 — 없을 때만 상품별 기본으로 떨어진다.
    expect(page).toMatch(/const entry =[\s\S]{0,40}?from \?\?/);
  });

  it('더블클릭 확대-리셋은 없다 — 첫 클릭이 창을 열면 도달 불가다', () => {
    const body = pane.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(body).not.toMatch(/onDoubleClick/);
    // 되돌리기는 확대 중에만 나오는 「구간 전체」 버튼이 진다.
    expect(pane).toMatch(/구간 전체/);
  });
});
