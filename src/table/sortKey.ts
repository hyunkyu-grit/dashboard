import type { BasisKey } from '@/lib/api';

import { cmpKey, type Row } from './rows';

/**
 * The sort contract, kept out of CDS's hands on purpose.
 *
 * CDS ships `useSort`, and v2 does NOT use it. It is a `lodash/get` plus a bare
 * `>` comparator over one field. That cannot express two things this table
 * depends on:
 *
 *   1. **The tenor sort key is a VECTOR** (`[1, 10]` for 1s10s), compared
 *      lexicographically. A bare `>` on an array compares stringified junk.
 *   2. **An unmapped series must fail LOUDLY.** With `>`, a row whose key is
 *      missing compares false against everything and sinks quietly to the
 *      bottom of the list, where it looks like data rather than like a bug. A
 *      new instrument that the backend forgot to key would ship, be read, and
 *      be traded from — silently in the wrong place.
 *
 * So an unmapped row sorts to `Infinity`: it goes to the end AND it is
 * detectable, because `unmappedRows()` can name it and the guard asserts it.
 * "Loud" is the whole point — the position is a symptom, the assertion is the
 * alarm.
 *
 * A later session may be tempted to "simplify" this back onto `useSort`. This
 * comment is the reason not to.
 */

/** The sentinel an unmapped row sorts by. Exported so the guard can assert it
 * rather than re-deriving it. */
export const UNMAPPED = Infinity;

/** A row is mapped when the backend gave it a non-empty numeric sort vector. */
export function isMapped(row: Row): boolean {
  return (
    Array.isArray(row.sortKey) &&
    row.sortKey.length > 0 &&
    row.sortKey.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** The vector a row sorts by. Unmapped → `[Infinity]`, never `[]` and never 0:
 * an empty vector sorts FIRST under lexicographic compare, which would put the
 * broken row at the top of the screen wearing the most valuable slot. */
export function sortVector(row: Row): number[] {
  return isMapped(row) ? row.sortKey : [UNMAPPED];
}

/** Every row the backend failed to key. Empty in a healthy payload; the screen
 * and the guard both read this rather than eyeballing the order. */
export function unmappedRows(rows: Row[]): Row[] {
  return rows.filter((r) => !isMapped(r));
}

/** Tenor order — the default. Stable, and unmapped rows land last. */
export function byTenor(a: Row, b: Row): number {
  return cmpKey(sortVector(a), sortVector(b));
}

/** |change| order for a basis column, biggest first. Rows with no value for
 * that basis keep tenor order behind the ones that have it — "no print" is not
 * "no move", and sorting them as zero would claim it was. */
export function byAbsChange(basis: BasisKey, asc: boolean) {
  return (a: Row, b: Row): number => {
    const av = a.changes[basis];
    const bv = b.changes[basis];
    if (av == null && bv == null) return byTenor(a, b);
    if (av == null) return 1;
    if (bv == null) return -1;
    const d = Math.abs(bv) - Math.abs(av);
    return asc ? -d : d;
  };
}
