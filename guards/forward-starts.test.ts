import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveStart, rowsFor, startPoints } from '../src/table/forwardStarts';
import type { Group, Row } from '../src/table/rows';

/**
 * 포워드 시작점 필터 — 이 필터가 낼 수 있는 최악의 화면은 **빈 표**다.
 *
 * 빈 표는 "그 조건에 맞는 게 없어요" 가 아니라 "데이터가 안 왔어요" 로 읽힌다.
 * 두 상태가 화면에서 똑같이 생겼기 때문이다. 그래서 필터는 결과가 빌 수 있는
 * 상황에서 스스로 물러난다 — 다른 탭이거나, 이 데이터에 없는 시작점이거나.
 */

function row(id: string, group: Group, startLabel?: string): Row {
  return {
    id,
    label: id,
    group,
    unit: '%',
    now: 3,
    changes: { d1: 1, mtd: 1, ytd: 1 },
    pct: 50,
    seriesId: id,
    rangeHigh: 4,
    rangeLow: 2,
    rangeAvg: 3,
    sortKey: [1],
    movePct: null,
    startLabel,
    key: false,
  } as Row;
}

const ROWS: Row[] = [
  row('3M', 'outright'),
  row('3Mx3M', 'forward', '3M'),
  row('3Mx6M', 'forward', '3M'),
  row('1Yx1Y', 'forward', '1Y'),
  row('1Yx2Y', 'forward', '1Y'),
  row('국고 3Y', 'govt'),
];

describe('시작점 목록은 행에서 나온다', () => {
  it('중복 없이, 표에 나오는 순서 그대로', () => {
    expect(startPoints(ROWS)).toEqual(['3M', '1Y']);
  });

  it('포워드가 아닌 행은 세지 않는다', () => {
    expect(startPoints([row('3M', 'outright'), row('국고 3Y', 'govt')])).toEqual([]);
  });
});

describe('필터는 결과가 빌 수 있으면 물러난다', () => {
  const starts = startPoints(ROWS);

  it('포워드 탭에서 아는 시작점이면 적용된다', () => {
    expect(resolveStart('1Y', starts, 'forward')).toBe('1Y');
    expect(rowsFor(ROWS, 'forward', '1Y').map((r) => r.id)).toEqual(['1Yx1Y', '1Yx2Y']);
  });

  it('다른 탭에서는 무시된다 — 아웃라이트 행에는 시작점이 없다', () => {
    expect(resolveStart('1Y', starts, 'outright')).toBeUndefined();
    // 무시하지 않으면 아웃라이트 탭이 통째로 빈다
    expect(rowsFor(ROWS, 'outright', undefined).map((r) => r.id)).toEqual(['3M']);
  });

  it('이 데이터에 없는 시작점(오래된 링크)은 버린다', () => {
    expect(resolveStart('7Y', starts, 'forward')).toBeUndefined();
    expect(rowsFor(ROWS, 'forward', resolveStart('7Y', starts, 'forward')).length).toBe(4);
  });

  it('필터가 없으면 그 탭 전부', () => {
    expect(resolveStart(undefined, starts, 'forward')).toBeUndefined();
    expect(rowsFor(ROWS, 'forward', undefined).length).toBe(4);
  });
});

describe('컨트롤이 서는 자리', () => {
  const ROOT = path.resolve(import.meta.dirname, '..');

  it('URL 에 있고, 쓰기는 replace 다 — 시작점은 목적지가 아니다', () => {
    const page = fs.readFileSync(path.join(ROOT, 'src/app/page.tsx'), 'utf8');
    // useUrlState 의 기본 모드가 replace 이므로 세 번째 인자가 없어야 맞다
    expect(page).toMatch(/useUrlState\('fs'\)/);
    expect(page).not.toMatch(/useUrlState\('fs',[^)]*'push'\)/);
  });

  it('칩 줄이 돌아오지 않았다 [OWNER 2026-08-13]', () => {
    const page = fs.readFileSync(path.join(ROOT, 'src/app/page.tsx'), 'utf8');
    // 이름이 주석에 남아 있는 건 기록이다. 돌아온 건 IMPORT 뿐이니 그것만 본다.
    expect(page).not.toMatch(/import[^;]*SCREENERS/);
    const filter = fs.readFileSync(path.join(ROOT, 'src/ui/StartFilter.tsx'), 'utf8');
    expect(filter).not.toMatch(/from '@coinbase\/cds-web\/chips'/);
  });
});
