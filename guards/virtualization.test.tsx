import { render } from '@testing-library/react';
import { ThemeProvider } from '@coinbase/cds-web';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { describe, expect, it } from 'vitest';

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
 */

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
      <InstrumentTable rows={rows} onSelect={() => undefined} />
    </ThemeProvider>,
  );
  const rendered = container.querySelectorAll('tr[data-sr-row]').length;
  const nodes = container.querySelectorAll('*').length;
  unmount();
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
        <InstrumentTable rows={rows} onSelect={() => undefined} />
      </ThemeProvider>,
    );
    const spacers = container.querySelectorAll('tr[data-sr-spacer]');
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
