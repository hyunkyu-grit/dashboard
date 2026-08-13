import { render } from '@testing-library/react';
import { ThemeProvider } from '@coinbase/cds-web';
import { Table, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { describe, expect, it } from 'vitest';

/**
 * EVIDENCE, not decoration — the companion to `cds-tablerow-dom.test.tsx`.
 *
 * `TableCellBaseProps` is typed as `TdHTMLAttributes & ThHTMLAttributes & …`,
 * which *claims* every DOM attribute and handler passes through. Pass 2 found
 * the claim is partly false: a `<th>` rendered by `TableCell` came back with
 * `onClick === undefined` and `aria-sort === null`, so the props
 * `useSortableCell()` returns do nothing when spread onto it — CDS's own
 * sorting hook cannot be wired through CDS's own header cell.
 *
 * This measures exactly which props survive, so the report states a fact rather
 * than an impression, and so a future CDS version that fixes it turns this red.
 */

function renderHeaderCell(props: Record<string, unknown>) {
  const { container } = render(
    /* A ThemeProvider is REQUIRED, not decoration: passing `onClick` makes
     * TableCell render through CDS `Interactable`, which calls `useTheme()` and
     * throws without one. The first version of this probe omitted it and the
     * failure looked like "onClick is dropped" — it was not. Measure inside the
     * environment the component actually runs in. */
    <ThemeProvider theme={defaultTheme} activeColorScheme="light">
    <Table accessibilityLabel="probe">
      <TableHeader>
        <TableRow>
          <TableCell as="th" scope="col" {...props}>
            head
          </TableCell>
        </TableRow>
      </TableHeader>
    </Table>
    </ThemeProvider>,
  );
  const th = container.querySelector('th');
  if (!th) throw new Error('no <th> rendered');
  return th;
}

describe('what CDS TableCell forwards to the <th>', () => {
  it('forwards data-* — which is why delegation is possible at all', () => {
    const th = renderHeaderCell({ 'data-sr-sort': 'd1' });
    expect(th.getAttribute('data-sr-sort')).toBe('d1');
  });

  it('forwards scope', () => {
    expect(renderHeaderCell({}).getAttribute('scope')).toBe('col');
  });

  it('forwards aria-sort', () => {
    // Measured, and it contradicts the first reading of this gap: aria-sort
    // DOES reach the <th>. Only the click handler does not bind there.
    expect(renderHeaderCell({ 'aria-sort': 'ascending' }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
  });

  it('binds onClick to an INNER element, not to the <th> itself', () => {
    let onTh = 0;
    const th = renderHeaderCell({ onClick: () => (onTh += 1) });

    th.click();
    const firedOnTh = onTh;

    // CDS renders the cell's content through `Interactable`; the handler lives
    // on that node. A user clicking the visible cell hits it, so sorting works
    // for a human — but `th.click()` does not, which is why the first browser
    // probe of this session read "onClick is undefined" and was wrong.
    let deepest: Element = th;
    while (deepest.firstElementChild) deepest = deepest.firstElementChild;
    (deepest as HTMLElement).click();

    expect(firedOnTh, 'th.click() should not fire — the handler is not on the th').toBe(0);
    expect(onTh, 'a click on the inner interactable should fire').toBeGreaterThan(0);
  });
});
