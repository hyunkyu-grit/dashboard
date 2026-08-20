/* 행의 **순서** — 정렬 키와, 순서가 바뀔 때의 움직임.
 *
 * v1 패리티 레인 P2 (LANE-v1-parity-2026-08-20.md). v1 의 `sort-key` 와
 * `reorder` 를 한 파일에 담았다 — 둘 다 "행이 어디 서는가" 의 이야기이고,
 * v2 에서는 같은 두 모듈(`sortKey.ts` · `useFlipReorder.ts`)이 진다.
 *
 * 정렬 키가 틀리면 화면은 멀쩡하고 순서만 조용히 틀린다. 그리고 이 표에서
 * 순서는 정보다 — 맨 위 세 줄이 데스크가 실제로 보는 전부인 날이 있다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Row } from '../src/table/rows';
import { UNMAPPED, byTenor, isMapped, sortVector, unmappedRows } from '../src/table/sortKey';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const row = (over: Partial<Row>): Row =>
  ({
    id: 'x',
    label: 'x',
    group: 'outright',
    unit: '%',
    now: 3,
    changes: { d1: null, mtd: null, ytd: null },
    pct: null,
    seriesId: null,
    rangeHigh: null,
    rangeLow: null,
    rangeAvg: null,
    sortKey: [0, 10],
    movePct: null,
    key: false,
    ...over,
  }) as Row;

describe('모든 행이 유한한 숫자 키를 든다', () => {
  it('정상 행은 mapped 다', () => {
    expect(isMapped(row({ sortKey: [0, 3] }))).toBe(true);
  });

  it('빈 벡터·비유한값·없음은 전부 unmapped 다', () => {
    expect(isMapped(row({ sortKey: [] }))).toBe(false);
    expect(isMapped(row({ sortKey: [0, NaN] }))).toBe(false);
    expect(isMapped(row({ sortKey: [0, Infinity] }))).toBe(false);
    expect(isMapped(row({ sortKey: undefined as unknown as number[] }))).toBe(false);
  });

  it('unmapped 는 `[Infinity]` 로 서지 `[]` 나 0 이 아니다', () => {
    /* 빈 벡터는 사전식 비교에서 **맨 앞**으로 간다 — 깨진 행이 화면에서 가장
     * 값진 자리를 차지한다. 0 도 같은 병이다. */
    expect(sortVector(row({ sortKey: [] }))).toEqual([UNMAPPED]);
    expect(UNMAPPED).toBe(Infinity);
  });

  it('그래서 깨진 행은 **맨 뒤**에 선다', () => {
    const rows = [row({ id: 'broken', sortKey: [] }), row({ id: 'ok', sortKey: [0, 3] })];
    const sorted = [...rows].sort(byTenor);
    expect(sorted.map((r) => r.id)).toEqual(['ok', 'broken']);
  });

  it('건강한 페이로드에는 unmapped 가 없다 — 목록으로 읽는다', () => {
    const rows = [row({ sortKey: [0, 3] }), row({ sortKey: [0, 10] })];
    expect(unmappedRows(rows)).toEqual([]);
  });
});

describe('키는 백엔드가 준다 — 프런트가 짓지 않는다', () => {
  it('sortKey 의 출처가 dto 로 선언돼 있다', () => {
    /* 프런트가 테너 문자열을 파싱해 키를 만들면 "1.5Y" 와 "1Y6M" 이 다른 곳에
     * 선다. §16 이 막는 그것이고, `row-vm-source` 가 그 경계를 지킨다. */
    expect(read('src/table/rows.ts')).toMatch(/sortKey: "dto"/);
  });

  it('정렬 모듈이 시장 데이터를 재계산하지 않는다', () => {
    const src = read('src/table/sortKey.ts');
    expect(src).not.toMatch(/parseFloat|Number\(.*label|replace\(.*Y/);
  });
});

describe('값이 없는 것과 움직이지 않은 것은 다르다', () => {
  it('변화가 없는 행은 0 으로 정렬되지 않고 뒤에서 테너 순을 지킨다', () => {
    /* "고시가 없다" 를 "안 움직였다" 로 적으면 없는 사실을 주장하게 된다. */
    const src = read('src/table/sortKey.ts');
    expect(src).toMatch(/if \(av == null && bv == null\) return byTenor\(a, b\)/);
    expect(src).toMatch(/if \(av == null\) return 1/);
    expect(src).toMatch(/if \(bv == null\) return -1/);
  });
});

describe('순서가 바뀔 때의 움직임', () => {
  const FLIP = 'src/table/useFlipReorder.ts';
  const TABLE = 'src/table/InstrumentTable.tsx';

  it('정렬을 바꿀 때만 스냅숏을 찍는다 — 탭·필터는 스냅이다', () => {
    /* v1 의 규칙: 정렬·스크리너는 애니메이션, 탭·시작필터는 스냅. v2 는 그것을
     * **구조로** 이룬다 — `snapshot()` 이 정렬 `onChange` 에서만 불린다.
     * 다른 곳에서 부르면 탭 전환마다 표 전체가 날아다닌다. */
    const src = read(TABLE);
    const calls = [...src.matchAll(/flip\.snapshot\(\)/g)];
    expect(calls).toHaveLength(1);
    expect(src).toMatch(/onChange: \(key\) => \{\s*\n\s*flip\.snapshot\(\);/);
  });

  it('새로 생긴 행은 날지 않는다 — 이전 자리가 없다', () => {
    expect(read(FLIP)).toMatch(/if \(was == null\) continue;/);
  });

  it('안 움직인 행은 애니메이션하지 않는다', () => {
    expect(read(FLIP)).toMatch(/if \(dy !== 0\) moved\.push/);
  });

  it('움직인 행이 없으면 아무것도 하지 않는다 — 빈 프레임을 예약하지 않는다', () => {
    expect(read(FLIP)).toMatch(/if \(moved\.length === 0\) return;/);
  });

  it('행을 찾는 선택자가 한 곳에서 나온다', () => {
    /* 속성 이름과 선택자가 두 벌이면 하나만 고쳐지는 날 조용히 아무 행도 안
     * 잡히고, 애니메이션이 그냥 사라진다(에러 없이). */
    const src = read(FLIP);
    expect(src).toMatch(/export const ROW_ATTR = 'data-sr-row'/);
    expect(src).toMatch(/export const ROW_SELECTOR = `tr\[\$\{ROW_ATTR\}\]`/);
    expect(read(TABLE)).toMatch(/ROW_ATTR, ROW_SELECTOR/);
  });
});

describe('판정기 자신 — 심어서 실패하는지', () => {
  it('빈 벡터를 그대로 쓰면 깨진 행이 맨 앞에 선다', () => {
    const naive = (r: Row) => (r.sortKey?.length ? r.sortKey : []);
    const cmp = (a: Row, b: Row) => {
      const av = naive(a);
      const bv = naive(b);
      for (let i = 0; i < Math.max(av.length, bv.length); i += 1) {
        const x = av[i] ?? -1;
        const y = bv[i] ?? -1;
        if (x !== y) return x - y;
      }
      return 0;
    };
    const rows = [row({ id: 'broken', sortKey: [] }), row({ id: 'ok', sortKey: [0, 3] })];
    expect([...rows].sort(cmp).map((r) => r.id)).toEqual(['broken', 'ok']);
    // 진짜 구현은 반대다.
    expect([...rows].sort(byTenor).map((r) => r.id)).toEqual(['ok', 'broken']);
  });
});
