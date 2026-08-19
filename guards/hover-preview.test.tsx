import fs from 'node:fs';
import path from 'node:path';

import { ThemeProvider } from '@coinbase/cds-web';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { fireEvent, render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { InstrumentTable } from '../src/table/InstrumentTable';
import type { Row } from '../src/table/rows';

/**
 * 미리보기 hover — 한 행에 한 번만 알린다.
 *
 * `mouseover` 는 포인터가 지나는 **자손마다** 버블한다. 한 행에 셀이 여섯,
 * 셀마다 span 이 있으니 행 하나를 지나가면 이벤트가 여러 번 온다. 그걸 그대로
 * 흘려보내면 뒤에서 기다리는 120ms 타이머가 매번 리셋돼서 **영원히 끝나지
 * 않는다** — 미리보기가 안 뜨는데 이벤트는 정상적으로 오고 있는, 디버깅이 제일
 * 오래 걸리는 종류의 고장이다. 그래서 중복 제거는 선택이 아니라 계약이다.
 */

const ROWS: Row[] = [0, 1].map(
  (i) =>
    ({
      id: `R${i}`,
      label: `R${i}`,
      group: 'spread',
      unit: 'bp',
      now: 1,
      changes: { d1: 1, mtd: 1, ytd: 1 },
      pct: 50,
      seriesId: `R${i}`,
      rangeHigh: 2,
      rangeLow: 0,
      rangeAvg: 1,
      sortKey: [i + 1, i + 2],
      movePct: 0,
      key: true,
    }) as Row,
);

/* ── jsdom has no layout, and this table needs exactly two facts from it ─────
 * `@tanstack/virtual-core` bails at `outerSize === 0` (index.js:724), and
 * `useScrollElement` walks up to the first ancestor whose computed `overflow-y`
 * scrolls. In jsdom every element measures 0 and CDS's stylesheet is not
 * applied, so BOTH are missing and the table renders zero rows — which is why
 * `virtualization.test.tsx` passes vacuously today (it asserts "fewer than
 * 2000", and 0 is fewer).
 *
 * So a scrollable wrapper is supplied with an INLINE style (jsdom does resolve
 * those), and `offsetWidth`/`offsetHeight` are given one fixed size —
 * `getRect` reads those two properties and nothing else (index.js:14), so
 * stubbing `getBoundingClientRect` instead does nothing at all. This is the
 * same class of stub as `guards/setup.ts`: it lets the component mount so its
 * BEHAVIOUR can be asserted, and nothing below reads a pixel. */
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

function setup() {
  const onHover = vi.fn();
  const { container } = render(
    <ThemeProvider theme={defaultTheme} activeColorScheme="light">
      <div style={{ overflowY: 'auto', height: 600 }}>
        <InstrumentTable rows={ROWS} onSelect={() => undefined} onHover={onHover} />
      </div>
    </ThemeProvider>,
  );
  const trs = [...container.querySelectorAll<HTMLElement>('tr[data-sr-row]')];
  expect(trs.length, 'no rows rendered — the harness, not the behaviour, is broken').toBe(2);
  // the delegating host: the table's own outer div, the one that carries the handlers
  const host = container.querySelector<HTMLElement>('div[tabindex="-1"]')!;
  return { onHover, container, trs, host };
}

describe('hover reports the row, once', () => {
  it('fires once for a row however many descendants the pointer crosses', () => {
    const { onHover, trs } = setup();
    const cells = [...trs[0].querySelectorAll('td, span')];
    expect(cells.length).toBeGreaterThan(2);
    for (const c of cells) fireEvent.mouseOver(c);

    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls[0][0]?.id).toBe('R0');
  });

  it('fires again when the pointer reaches a DIFFERENT row', () => {
    const { onHover, trs } = setup();
    fireEvent.mouseOver(trs[0].querySelector('td')!);
    fireEvent.mouseOver(trs[1].querySelector('td')!);
    expect(onHover.mock.calls.map((c) => c[0]?.id)).toEqual(['R0', 'R1']);
  });

  it('clears when the pointer leaves the table', () => {
    const { onHover, trs, host } = setup();
    fireEvent.mouseOver(trs[0].querySelector('td')!);
    // React synthesises onMouseLeave from a native mouseout whose relatedTarget
    // is outside — dispatching it this way is what the browser actually sends.
    fireEvent.mouseOut(host, { relatedTarget: document.body });
    expect(onHover).toHaveBeenLastCalledWith(undefined);
  });
});

describe('focus is hover — the keyboard reader gets the same pane', () => {
  it('focusing a row previews it', () => {
    const { onHover, trs } = setup();
    trs[1].focus();
    expect(onHover.mock.calls.at(-1)?.[0]?.id).toBe('R1');
  });

  it('leaving the table by keyboard clears it', () => {
    const { onHover, trs } = setup();
    trs[1].focus();
    trs[1].blur(); // relatedTarget null = focus went nowhere inside
    expect(onHover).toHaveBeenLastCalledWith(undefined);
  });
});

describe('the delay lives where the answer is shown', () => {
  const ROOT = path.resolve(import.meta.dirname, '..');

  it('120ms is in the page, not in the table', () => {
    const page = fs.readFileSync(path.join(ROOT, 'src/app/page.tsx'), 'utf8');
    expect(page).toMatch(/HOVER_MS\s*=\s*120/);
    expect(page).toMatch(/setTimeout\(/);

    /* The table reports what the pointer is ON; how long the pointer must stay
     * before the screen answers is the reader's question. A timer in the table
     * would also make the dedupe above untestable — the two would be one
     * mechanism with one set of symptoms. */
    const table = fs.readFileSync(path.join(ROOT, 'src/table/InstrumentTable.tsx'), 'utf8');
    expect(table).not.toMatch(/setTimeout\(/);
  });

  it('hover is not written to the URL', () => {
    const page = fs.readFileSync(path.join(ROOT, 'src/app/page.tsx'), 'utf8');
    /* A hover is not a destination. `useUrlState` holds the PIN (`?r=`), which
     * a reader can paste to a colleague; routing every row the pointer passes
     * through it would either fill the history or fire a replace per row. */
    expect(page).toMatch(/const \[hoveredId, setHoveredId\] = useState/);
    expect(page).not.toMatch(/useUrlState\([^)]*hover/i);
  });
});
