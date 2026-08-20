/* 고시 / 보간 / 개념 없음 — the three states of `Row.quoted`, pinned end to end.
 *
 * The defect this guards against has already happened once and was SILENT: the
 * row builder was read as collapsing the API's `false` (보간 만기) into the same
 * `undefined` as "the question does not apply", so `cells.ts` printed 호가 and
 * withheld its opposite. Nothing looked broken — a row simply said less than it
 * knew. `??` never collapsed `false`; only the belief did.
 *
 * So the assertions below run the whole path (API shape → row → subtitle)
 * rather than checking any one of its steps, because every step of it was
 * individually defensible while the screen was still wrong. */

import { describe, expect, it } from 'vitest';

import type { ForwardsPayload, SeriesSummary, WallSummary } from '../src/lib/api';
import { subText } from '../src/table/cells';
import { buildRows, type Row } from '../src/table/rows';
import { toRows, type UniversePayload } from '../src/table/universeRows';

function summaryRow(id: string, quoted: boolean | null): SeriesSummary {
  return {
    id,
    label: id,
    kind: quoted === null ? 'spread' : 'outright',
    unit: quoted === null ? 'bp' : '%',
    now: 3.1,
    deltas: { d1: 1, mtd: 1, ytd: 1 },
    basisValues: { d1: 3, mtd: 3, ytd: 3 },
    range1y: { min: 2, max: 4, avg: 3, pct: 50 },
    sortKey: [1],
    quoted,
    movePct: 0,
    key: quoted === true,
  };
}

const SUMMARY: WallSummary = {
  asof: '2026-08-13',
  basisDates: { d1: '2026-08-12', mtd: '2026-07-31', ytd: '2025-12-31' },
  specNodeOrder: [],
  displayTenors: [],
  missingNodes: [],
  curveBanner: { kind: null },
  // 3Y is a quoted node, 4Y is interpolated (`dataset.QUOTED_NODES`)
  outrights: [summaryRow('3Y', true), summaryRow('4Y', false)],
  derived: [summaryRow('3Y-5Y', null)],
  events: [],
  policy: { unit: '%', asof: '', through: '', steps: [], latest: null, warnings: [] },
};

function forwards(live: boolean): ForwardsPayload {
  return {
    asof: '2026-08-13',
    basisDates: { d1: null, mtd: null, ytd: null },
    startPoints: [{ label: '1Y', t: 1, date: '2027-08-13' }],
    tenors: ['1YF'],
    grid: {
      '1YF': [
        {
          start: '1Y',
          live,
          values: { now: 3.2, d1: 3.1, mtd: 3.0, ytd: 2.9 },
          deltas: { d1: 1, mtd: 2, ytd: 3 },
          sortKey: [1, 1],
          keyForward: false, // deliberately NOT key — `live` is its own fact
          movePct: null,
          range1y: { min: 2, max: 4, avg: 3 },
        },
      ],
    },
    keyForwards: [],
  };
}

const byId = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;

describe('Row.quoted carries three states, not two', () => {
  const rows = buildRows(SUMMARY, undefined);

  it('a quoted node is true and an interpolated one is FALSE, not undefined', () => {
    expect(byId(rows, '3Y').quoted).toBe(true);
    // the whole point: `false` must survive the builder
    expect(byId(rows, '4Y').quoted).toBe(false);
  });

  it('a derived instrument has no state at all', () => {
    // null → undefined, because 고시/보간 is a fact about a curve NODE and a
    // spread is not one. Not `false`, which would assert it is interpolated.
    expect(byId(rows, '3Y-5Y').quoted).toBeUndefined();
  });

  it("a forward reads the grid point's own live flag", () => {
    expect(byId(buildRows(SUMMARY, forwards(true)), '1Yx1Y').quoted).toBe(true);
    expect(byId(buildRows(SUMMARY, forwards(false)), '1Yx1Y').quoted).toBe(false);
  });
});

describe('the subtitle marks ONLY the exception (보간)', () => {
  const rows = buildRows(SUMMARY, undefined);

  it('prints NO mark for a quoted node — 호가 is retired [OWNER 2026-08-19]', () => {
    expect(subText(byId(rows, '3Y'))).not.toContain('호가');
  });

  it('prints 보간 for an interpolated one — the mark this guard exists for', () => {
    expect(subText(byId(rows, '4Y'))).toContain('· 보간');
  });

  it('prints NEITHER where the distinction does not apply', () => {
    const s = subText(byId(rows, '3Y-5Y'));
    expect(s).not.toContain('호가');
    expect(s).not.toContain('보간');
  });

  it('never prints both', () => {
    for (const r of rows) {
      const s = subText(r);
      expect(s.includes('호가') && s.includes('보간')).toBe(false);
    }
  });
});

describe('민평·선물 rows claim nothing', () => {
  /* `universe.py:144` writes `"quoted": True` as a literal to fill the shared row
   * shape. Nothing measured it, and these feeds have no 고시/보간 split to
   * report, so the browser must not repeat the claim. */
  const payload: UniversePayload = {
    asof: '2026-08-13',
    rows: [
      {
        id: 'govt-3Y',
        label: '국고 3Y',
        kind: 'govt',
        unit: '%',
        now: 3.0,
        deltas: { d1: 1, mtd: 1, ytd: 1 },
        range1y: { min: 2, max: 4, avg: 3, pct: 50 },
        sortKey: [3],
        quoted: true,
        movePct: null,
        key: true,
      },
    ],
    sources: {},
    absent: [],
  };

  it('drops the hardcoded flag rather than printing it', () => {
    const [row] = toRows(payload);
    expect(row.quoted).toBeUndefined();
    expect(subText(row)).not.toContain('호가');
  });
});
