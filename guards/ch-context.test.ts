import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CH_PROBE_HOST } from '../src/table/InstrumentTable';

/**
 * The measuring context and the rendering context must be the same element.
 *
 * Column widths are `format maxima × the '0' advance`. Measured somewhere the cells do
 * not render, every width comes from the wrong font and nothing on screen says so.
 * That happened: the probe sat on the table's host `div`, which resolved to CDS's face
 * at 8.881 px while the cells drew Pretendard at 8.813 px. The error was small; the
 * structure was wrong, and it is the same class of defect the `<colgroup>` removed.
 *
 * ── Why this reads source rather than a render ───────────────────────────────
 * A rendered assertion was tried first and cannot work here: jsdom loads no CDS
 * stylesheet, so `useScrollElement` never finds an `overflow: auto` ancestor, the
 * virtualizer computes an empty window, and no row mounts. Stubbing boxes did not fix
 * it and only made the environment lie about geometry.
 *
 * So this asserts the two things that can actually drift apart — the selector, and the
 * markup it has to land in — from the source they both live in.
 */

const SRC = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/table/InstrumentTable.tsx'),
  'utf8',
);

describe('the ch probe measures where the text renders', () => {
  it('the probe targets the table body, not the shell', () => {
    expect(CH_PROBE_HOST).toMatch(/tbody/);
    expect(CH_PROBE_HOST).toMatch(/tr\[data-sr-row\]/);
    expect(CH_PROBE_HOST).toMatch(/td/);
    // The regression, named: a host-div probe has none of the above.
    expect(CH_PROBE_HOST).not.toMatch(/^div/);
  });

  it('rows carry the attribute the probe selector depends on', () => {
    expect(SRC).toMatch(/\{\.\.\.\{ \[ROW_ATTR\]: row\.id \}\}/);
  });

  it('cell values render inside a span, which is what the probe appends to', () => {
    // `TextLabel2 as="span"` is what puts a <span> under the <td>. If a later pass
    // renders values as bare text or through a different element, the selector stops
    // matching and widths quietly fall back to an unmeasured context.
    const cellSpans = SRC.match(/<TextLabel2\s+as="span"/g) ?? [];
    expect(cellSpans.length).toBeGreaterThanOrEqual(4);
  });

  it('the probe is used to derive widths, and widths are not derived without it', () => {
    expect(SRC).toMatch(/useChPx\(hostRef,/);
    // colPx must never run on a zero advance — that would collapse every fixed width.
    expect(SRC).toMatch(/chPx > 0 \? colSpecs\(cols, chPx\) : \[\]/);
    expect(SRC).toMatch(/width > 0 && chPx > 0 \? visibleColumns/);
  });
});
