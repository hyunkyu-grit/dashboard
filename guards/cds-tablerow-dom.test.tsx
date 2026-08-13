import { render } from '@testing-library/react';
import { Table, TableBody, TableCell, TableRow } from '@coinbase/cds-web/tables';
import { describe, expect, it } from 'vitest';

/**
 * EVIDENCE, not decoration.
 *
 * CDS `TableRow` is a memo'd function component with no `forwardRef`, so a
 * consumer cannot hold the `<tr>` directly. That pushed v2's row interaction to
 * event delegation on the container [OWNER ruling] — which is the better
 * architecture anyway at 1,000 rows.
 *
 * Delegation only works if the `<tr>` actually carries the attributes used to
 * resolve and focus it. `TableRowProps` *types* them (it extends
 * `HTMLAttributes<HTMLTableRowElement>`), but the type is a claim about the API,
 * not about the implementation. This measures the implementation.
 *
 * If `data-*` does not land, delegation is impossible and the verdict changes.
 * If `tabIndex` / `role` do not land, focus management moves to the container
 * and the report has to say so.
 */

function renderRow(props: Record<string, unknown>) {
  const { container } = render(
    <Table accessibilityLabel="probe">
      <TableBody>
        <TableRow {...props}>
          <TableCell>cell</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
  const tr = container.querySelector('tr');
  if (!tr) throw new Error('no <tr> rendered');
  return tr;
}

describe('what CDS TableRow forwards to the <tr>', () => {
  it('forwards data-* (delegation depends on this)', () => {
    const tr = renderRow({ 'data-sr-row': '1s10s' });
    expect(tr.getAttribute('data-sr-row')).toBe('1s10s');
  });

  it('forwards tabIndex (decides where focus management lives)', () => {
    const tr = renderRow({ tabIndex: 0 });
    expect(tr.getAttribute('tabindex')).toBe('0');
  });

  it('forwards role', () => {
    const tr = renderRow({ role: 'row' });
    expect(tr.getAttribute('role')).toBe('row');
  });

  it('forwards aria-selected', () => {
    const tr = renderRow({ 'aria-selected': true });
    expect(tr.getAttribute('aria-selected')).toBe('true');
  });

  it('does NOT accept a ref — the finding that moved v2 to delegation', () => {
    // A plain function component silently drops `ref` and React warns; the
    // point here is that no supported path returns the element, which is why
    // v2 resolves rows with querySelectorAll from the container instead.
    expect('$$typeof' in TableRow).toBe(true);
    expect(String((TableRow as { $$typeof?: symbol }).$$typeof)).toContain('memo');
  });
});
