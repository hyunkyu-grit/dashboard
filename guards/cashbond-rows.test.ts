import { describe, expect, it } from 'vitest';

import type { CashBondInstruments } from '../src/lib/api';
import { filterByType, toCashBondRows } from '../src/table/cashbondRows';
import { GROUP_LABEL } from '../src/table/rows';
import { BACKTEST_CATEGORIES, SECTIONS, sectionOf } from '../src/ui/nav';

/**
 * Cash Bond 행 어댑터와 내비 배치 — 확정 사항의 핀.
 *
 *   - 메가 패널 다섯 번째 카테고리 아래 **별개 표 탭 둘** [기본안, 2026-08-18]
 *   - Setting 은 **Lab 앞** [OWNER 규칙]
 *   - 어댑터는 §16 을 지킨다: 서버 숫자를 그대로 옮기고 아무 산술도 없다
 */

const payload = (): CashBondInstruments => ({
  asof: '2026-08-14',
  from: '2020-01-02',
  types: [
    { id: 'KTB', label: '국고채' },
    { id: 'KDB', label: '산금채 AAA' },
  ],
  rows: [
    {
      id: 'CB:KTB:3Y', kind: 'CB', bondType: 'KTB', tenor: '3Y', label: '국고채 3Y',
      unit: '%', now: 2.47, changes: { d1: -7, mtd: null, ytd: null }, pct: 12.3,
      rangeHigh: 4.185, rangeLow: 2.4325, rangeAvg: 3.3567, sortKey: [0, 3],
      theta: { perDv01: 1, cash: 2, carry: 3, roll: -1, dv01: 4, beBp: 0.1 },
    },
    {
      id: 'ASW:KDB:5Y', kind: 'ASW', bondType: 'KDB', tenor: '5Y', label: '산금채 AAA 5Y 자산스왑',
      unit: 'bp', now: 45.2, changes: { d1: 1.2, mtd: null, ytd: null }, pct: null,
      rangeHigh: null, rangeLow: null, rangeAvg: null, sortKey: [2, 5],
      theta: null,
    },
  ],
  thetaBasis: { horizonDays: 1, notional: 1e10, side: 'buy' },
});

describe('어댑터 — 두 kind 가 두 탭이다', () => {
  it('CB → cashbond, ASW → asw', () => {
    const rows = toCashBondRows(payload());
    expect(rows.map((r) => r.group)).toEqual(['cashbond', 'asw']);
  });

  it('단위·수준·변화·52주·세타는 서버 값 그대로다 (§16)', () => {
    const [cb] = toCashBondRows(payload());
    expect(cb.unit).toBe('%');
    expect(cb.now).toBe(2.47);
    expect(cb.changes.d1).toBe(-7);
    expect(cb.rangeHigh).toBe(4.185);
    expect(cb.theta?.beBp).toBe(0.1);
  });

  it('seriesId 는 null — 히스토리는 cashbond 라우트가 진다 (PreviewPane 이 그룹으로 고른다)', () => {
    for (const r of toCashBondRows(payload())) expect(r.seriesId).toBeNull();
  });

  it('종목군 필터는 id 집합으로 좁힌다', () => {
    const p = payload();
    const rows = toCashBondRows(p);
    expect(filterByType(rows, p.rows, 'KTB').map((r) => r.id)).toEqual(['CB:KTB:3Y']);
    expect(filterByType(rows, p.rows, null)).toHaveLength(2);
  });
});

describe('내비 배치 [기본안, 2026-08-18]', () => {
  it('Backtest 메가 패널의 다섯 번째 카테고리가 현금채권이고, 항목은 두 탭이다', () => {
    const cat = BACKTEST_CATEGORIES[BACKTEST_CATEGORIES.length - 1];
    expect(cat.id).toBe('cashbond');
    expect(cat.groups).toEqual(['cashbond', 'asw']);
  });

  it('두 탭의 라벨 — 현금채권·자산스왑', () => {
    expect(GROUP_LABEL.cashbond).toBe('현금채권');
    expect(GROUP_LABEL.asw).toBe('자산스왑');
  });

  it('Setting 은 Lab 바로 앞이다 [OWNER 규칙 — Lab 은 반드시 마지막]', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids.indexOf('setting')).toBe(ids.length - 2);
    expect(ids[ids.length - 1]).toBe('lab');
  });

  it('setting 탭은 setting 섹션으로 유도된다', () => {
    expect(sectionOf('setting')).toBe('setting');
    expect(sectionOf('cashbond')).toBe('backtest');
    expect(sectionOf('asw')).toBe('backtest');
  });
});
