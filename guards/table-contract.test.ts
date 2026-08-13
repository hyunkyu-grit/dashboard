import fs from 'node:fs';
import path from 'node:path';

import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { describe, expect, it } from 'vitest';

import { ALL_COLUMNS, BASIS_LADDER, colPx, visibleColumns } from '../src/table/columns';
import { colSpecs } from '../src/table/colgroup';
import type { Row } from '../src/table/rows';
import { byTenor, isMapped, UNMAPPED, sortVector, unmappedRows } from '../src/table/sortKey';
import { STICKY_SURFACE } from '../src/table/InstrumentTable';

const ROOT = path.resolve(import.meta.dirname, '..');

function row(id: string, sortKey: number[] | undefined): Row {
  return {
    id,
    label: id,
    group: 'spread',
    unit: 'bp',
    now: 1,
    changes: { d1: 1, mtd: 1, ytd: 1 },
    pct: 50,
    seriesId: id,
    rangeHigh: 2,
    rangeLow: 0,
    rangeAvg: 1,
    sortKey: sortKey as number[],
    movePct: 0,
    key: true,
  } as Row;
}

// ── sort key ────────────────────────────────────────────────────────────────
describe('sort key: unmapped fails loudly', () => {
  it('an unmapped row sorts by Infinity, not by 0 and not by []', () => {
    expect(sortVector(row('broken', undefined))).toEqual([UNMAPPED]);
    // [] would sort FIRST under lexicographic compare — the broken row would
    // take the most valuable slot on the screen.
    expect(sortVector(row('broken', []))).toEqual([UNMAPPED]);
  });

  it('an unmapped row lands LAST, never first', () => {
    const rows = [row('broken', undefined), row('1s2s', [1, 2]), row('2s3s', [2, 3])];
    const sorted = [...rows].sort(byTenor);
    expect(sorted.map((r) => r.id)).toEqual(['1s2s', '2s3s', 'broken']);
  });

  it('is DETECTABLE, which is what "loud" means', () => {
    const rows = [row('broken', undefined), row('1s2s', [1, 2])];
    expect(unmappedRows(rows).map((r) => r.id)).toEqual(['broken']);
    expect(isMapped(row('1s2s', [1, 2]))).toBe(true);
  });

  it('NaN is not a sort key', () => {
    expect(isMapped(row('nan', [Number.NaN]))).toBe(false);
  });

  it('v2 does not use CDS useSort', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/table/InstrumentTable.tsx'), 'utf8');
    expect(src).not.toMatch(/\buseSort\b(?!able)/);
  });
});

// ── column ladder ───────────────────────────────────────────────────────────
describe('column ladder', () => {
  const CH = 8;
  const w = colPx(CH);

  it('the sorted column always keeps a slot, even at the narrowest width', () => {
    const narrow = w.label + w.level + w.delta; // room for exactly one delta
    for (const sortCol of BASIS_LADDER) {
      const v = visibleColumns(narrow, CH, sortCol);
      expect(v.bases, `${sortCol} lost its slot`).toContain(sortCol);
      expect(v.bases).toHaveLength(1);
    }
  });

  it('drops from the tail, never from the middle', () => {
    const wide = w.label + w.level + w.delta * 3 + w.range + w.rangeSub;
    expect(visibleColumns(wide, CH, null).bases).toEqual(ALL_COLUMNS.bases);
    // one delta narrower: the last ladder rung goes, the order does not change
    const v = visibleColumns(w.label + w.level + w.delta * 2, CH, null);
    expect(v.bases.length).toBe(2);
  });

  it('the position track never outlives the numbers it is read against', () => {
    const v = visibleColumns(w.label + w.level + w.delta * 3, CH, null);
    if (!v.range52) expect(v.slider).toBe(false);
  });

  it('counts every dropped column', () => {
    const v = visibleColumns(w.label + w.level, CH, null);
    expect(v.hidden).toBe(BASIS_LADDER.length + 2);
  });
});

// ── colgroup is the only width source ───────────────────────────────────────
describe('colgroup is the single width source', () => {
  it('emits exactly one <col> per rendered column, in DOM order', () => {
    const specs = colSpecs(ALL_COLUMNS, 8);
    expect(specs.map((s) => s.key)).toEqual(['label', 'level', 'd1', 'mtd', 'ytd', 'range52']);
    // the tail is the flexible one; everything else is a fixed px width
    expect(specs.at(-1)?.width).toBeNull();
    expect(specs.slice(0, -1).every((s) => typeof s.width === 'number')).toBe(true);
  });

  it('no COLUMN width is declared anywhere else in the table source', () => {
    /* The failure mode is specific: a per-cell width silently overriding the
     * colgroup, or a second track list competing with it. A container's
     * `width: '100%'` is neither — it sizes the box the table lives in, and
     * banning it would make the guard fire on the wrong thing (it did, on the
     * first run; this is the narrowed version). */
    const dir = path.join(ROOT, 'src/table');
    const offenders: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (f === 'colgroup.ts' || f === 'columns.ts') continue; // the source and its arithmetic
      const body = fs
        .readFileSync(path.join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

      // a width on a table primitive — the thing that would beat the colgroup
      if (/<(?:TableCell|TableRow|th|td|col)\b[^>]*\bwidth[=:]/.test(body)) offenders.push(f);
      // a second, competing track definition
      if (/grid-template-columns/.test(body)) offenders.push(f);
    }
    expect(
      [...new Set(offenders)],
      `column width declared outside colgroup.ts: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('the table is laid out fixed — otherwise <col> widths are advisory', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/table/InstrumentTable.tsx'), 'utf8');
    expect(src).toMatch(/tableLayout="fixed"/);
    expect(src).toMatch(/<colgroup>/);
  });
});

// ── sticky header must be opaque ────────────────────────────────────────────
describe('sticky header is fully opaque', () => {
  it.each(['light', 'dark'] as const)('%s: the sticky surface has alpha 1', (scheme) => {
    const palette = (scheme === 'light' ? defaultTheme.lightColor : defaultTheme.darkColor) as Record<
      string,
      string
    >;
    const value = palette[STICKY_SURFACE];
    expect(value, `no such surface: ${STICKY_SURFACE}`).toBeTruthy();
    // rgba(...) with a fourth component < 1 would let body rows read through
    const alpha = value.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/)?.[1];
    expect(alpha === undefined || Number(alpha) === 1, `${value} is translucent`).toBe(true);
  });

  it('the header row actually paints that surface', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/table/InstrumentTable.tsx'), 'utf8');
    expect(src).toMatch(/<TableHeader sticky>/);
    expect(src).toMatch(/backgroundColor=\{STICKY_SURFACE\}/);
  });
});
