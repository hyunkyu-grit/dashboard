import type { BasisKey } from '@/lib/api';

import type { VisibleColumns } from './columns';
import { colPx } from './columns';

/**
 * THE single source of column width in v2.
 *
 * ── Why a `<colgroup>` and not the shared CSS grid v1 uses ───────────────────
 * v1 declares one `grid-template-columns` string and hands the same string to
 * the header row and to every body row, so the two "cannot" drift. They can,
 * and did: the tracks are sized in `ch`, and `ch` is the advance of "0" IN THE
 * ELEMENT'S OWN FONT. A header cell at `font-medium` and a body cell at
 * `font-normal` resolve the same `44ch` to different pixel counts, and the
 * columns misalign by a few px per track — a defect class this repo has already
 * shipped once.
 *
 * `<col>` removes the failure mode rather than re-fixing it. Under
 * `table-layout: fixed` the browser takes each column's width from the first
 * row — here, the `<colgroup>` — and applies it to every cell in that column,
 * header and body alike. There is no second resolution to disagree with,
 * because there is no second resolution: one element declares the width, and it
 * declares it in px. Font weight cannot move it. The alignment is structural
 * instead of arithmetic.
 *
 * Widths are still DERIVED FROM FORMAT MAXIMA (v1 §4, carried): `colPx()` takes
 * the widest string each column can ever render and multiplies by a measured
 * character advance. What changes is where the number is spent, not where it
 * comes from.
 */

export type ColSpec = {
  key: 'label' | 'level' | BasisKey | 'range52';
  /** px, or null for the one flexible tail track */
  width: number | null;
};

/**
 * The column list for a ladder state. Order here IS the DOM order of `<col>`
 * and of every `<th>`/`<td>`; a mismatch is a rendering bug, not a style one,
 * which is why both come from this one function.
 */
export function colSpecs(v: VisibleColumns, chPx: number): ColSpec[] {
  const w = colPx(chPx);
  const specs: ColSpec[] = [
    { key: 'label', width: w.label },
    { key: 'level', width: w.level },
  ];
  for (const b of v.bases) specs.push({ key: b, width: w.delta });
  specs.push({
    key: 'range52',
    // The 52-week column is the flexible tail: it absorbs the slack so rows
    // span the card. When the ladder has dropped it, the track stays (as an
    // empty filler) so hairlines and hover still reach the card edge.
    width: null,
  });
  return specs;
}

/** `<col>` widths as inline styles. `null` → no width, which is how a fixed
 * layout spells "take what is left". */
export function colStyle(spec: ColSpec): React.CSSProperties | undefined {
  return spec.width == null ? undefined : { width: `${spec.width}px` };
}
