import { render } from '@testing-library/react';
import { ThemeProvider } from '@coinbase/cds-web';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InstrumentTable } from '../src/table/InstrumentTable';
import { ROW_H } from '../src/table/rowHeight';
import type { Row } from '../src/table/rows';

/**
 * THE regression this session exists to prevent from coming back.
 *
 * Pass 2 measured 43,080 DOM nodes at 1,000 rows and nothing recycled, because
 * CDS `Table` renders every row. The fix was virtualization; this guard asserts
 * the *shape* of the fix — node count bounded by the viewport, not by the row
 * count — so that a future refactor cannot quietly restore the old behaviour
 * while every other test stays green.
 *
 * It asserts a RATIO, not an absolute count. jsdom has no layout, so the
 * virtualizer's window here is not the browser's window and the absolute number
 * is meaningless. What is meaningful, and what actually failed before, is that
 * 10× the rows produced 10× the DOM.
 *
 * ── This guard used to pass on ZERO rows (2026-08-14) ───────────────────────
 * "Fewer rows than it is given" was true of 0, and 0 is what the table rendered
 * here: `@tanstack/virtual-core` returns no range at `outerSize === 0`
 * (index.js:724), jsdom measures every element at 0, and `useScrollElement`
 * found no scrolling ancestor because CDS's stylesheet is not applied in jsdom.
 * So the one guard standing between this repo and the 43,080-node regression
 * was measuring an empty table.
 *
 * The stubs below are the minimum that makes it real: a wrapper whose INLINE
 * `overflow-y` jsdom does resolve, and `offsetWidth`/`offsetHeight` — the two
 * properties `getRect` reads (index.js:14). `renderRows` now also asserts that
 * rows exist at all, which is the assertion whose absence hid this.
 */

const SIZE = { offsetWidth: 900, offsetHeight: 600 };
const originals: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  for (const [prop, value] of Object.entries(SIZE)) {
    originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
  }
});
afterAll(() => {
  for (const [prop, desc] of Object.entries(originals)) {
    if (desc) Object.defineProperty(HTMLElement.prototype, prop, desc);
  }
});

function rowAt(i: number): Row {
  const a = 1 + (i % 40) * 0.25;
  return {
    id: `R${i}-${a}Y`,
    label: `R${i}`,
    group: 'spread',
    unit: 'bp',
    now: 1 + i * 0.01,
    changes: { d1: 1, mtd: -1, ytd: 2 },
    pct: 50,
    seriesId: `R${i}`,
    rangeHigh: 2,
    rangeLow: 0,
    rangeAvg: 1,
    sortKey: [a, a + 1],
    movePct: 10,
    key: i % 5 === 0,
  } as Row;
}

function renderRows(n: number) {
  const rows = Array.from({ length: n }, (_, i) => rowAt(i));
  const { container, unmount } = render(
    <ThemeProvider theme={defaultTheme} activeColorScheme="light">
      <div style={{ overflowY: 'auto', height: 600 }}>
        <InstrumentTable rows={rows} onSelect={() => undefined} />
      </div>
    </ThemeProvider>,
  );
  const rendered = container.querySelectorAll('tr[data-sr-row]').length;
  const nodes = container.querySelectorAll('*').length;
  unmount();
  // the assertion whose absence let this whole file pass on an empty table
  expect(rendered, 'no rows rendered — this guard is measuring nothing').toBeGreaterThan(0);
  return { rendered, nodes };
}

describe('the table is virtualized', () => {
  it('renders far fewer rows than it is given', () => {
    const big = renderRows(2000);
    expect(big.rendered).toBeLessThan(2000);
  });

  it('10x the rows does NOT mean 10x the DOM', () => {
    const small = renderRows(200);
    const big = renderRows(2000);

    // The pre-virtualization behaviour was an exact 10× here. A small multiple
    // is the pass condition; anything near linear is the regression.
    expect(
      big.nodes,
      `200 rows -> ${small.nodes} nodes, 2000 rows -> ${big.nodes} nodes ` +
        `(ratio ${(big.nodes / Math.max(1, small.nodes)).toFixed(2)}x) — this is the ` +
        `43,080-node regression coming back`,
    ).toBeLessThan(small.nodes * 2);
  });

  it('spacer rows carry the scroll height, and are hidden from assistive tech', () => {
    const rows = Array.from({ length: 500 }, (_, i) => rowAt(i));
    const { container } = render(
      <ThemeProvider theme={defaultTheme} activeColorScheme="light">
        <div style={{ overflowY: 'auto', height: 600 }}>
          <InstrumentTable rows={rows} onSelect={() => undefined} />
        </div>
      </ThemeProvider>,
    );
    const spacers = container.querySelectorAll('tr[data-sr-spacer]');
    expect(spacers.length, 'no spacers — 500 rows should not all fit the window').toBeGreaterThan(0);
    for (const s of spacers) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
    }
    // A spacer must never look like a row to the delegation selector.
    for (const s of spacers) {
      expect(s.hasAttribute('data-sr-row')).toBe(false);
    }
  });

  it('ROW_H is a plain number — spacer arithmetic depends on it', () => {
    // A CSS string here ('48px', '3rem') would make every spacer height NaN and
    // the scrollbar would silently lie about the document length.
    expect(typeof ROW_H).toBe('number');
    expect(Number.isFinite(ROW_H)).toBe(true);
  });
});
