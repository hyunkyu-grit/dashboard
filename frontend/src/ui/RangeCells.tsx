/* The table's last column: 52-week high / low / mean (pass L).
 *
 * It replaced the 한 줄 sentence and keeps its slot, its width behaviour and
 * its role as the elastic column — only the contents changed, from a Korean
 * sentence to three numbers.
 *
 * Three rules hold this file, and each is pinned by guards/range-column.test.ts:
 *
 * 1. ONE formatter. Every number here goes through `rangeText`, which is
 *    `fmtLevel` — the same call the 현재 column makes. There is no rounding,
 *    no unit selection and no `toFixed` in this file. Two displays of one
 *    quantity at different precision has shipped here once already.
 * 2. THESE ARE LEVELS, SO THEY ARE INK. No hue, no tint, no emphasis weight.
 *    Colour is reserved for signed change values (§5/§9); a level has no
 *    direction, which is why 현재 is ink too.
 * 3. NOT SORTABLE. The header carries no button, no hover state and no click
 *    handler, because there is nothing here to rank rows by — three statistics,
 *    not one. This is a property of the COLUMN and is silent by design. It is
 *    not the same condition as a row with no sort key, which must still fail
 *    loudly to Infinity (§6, guards/sort-key.test.ts).
 *
 * The three sub-columns are fixed-width (the 현재 glyph count, plus a cushion
 * sized for the header label — see `RANGE_PAD`) and the slack sits at the
 * trailing edge, so the column keeps absorbing leftover table width while the
 * numbers stay aligned down the table. */

import { RANGE_TEMPLATE } from "./columns";
import { rangeText } from "./cells";
import type { Row } from "./rows";

/** Sub-labels, in render order. The window is named once, on the first label,
 * and scopes the three by adjacency — 52주 고점 · 저점 · 평균. Labels are
 * required: high/low/mean is not a number line and does not read from order. */
export const RANGE_LABELS = ["52주 고점", "저점", "평균"] as const;

/** high, low, mean — the order the labels declare. */
export function rangeValues(row: Row): (number | null)[] {
  return [row.rangeHigh, row.rangeLow, row.rangeAvg];
}

/** Header sub-labels, sitting in the same sub-grid as the numbers below them.
 * Plain text: a columnheader with no control inside it.
 *
 * The smaller type is on the SPANS, never on the grid container. `RANGE_TEMPLATE`
 * is written in `ch`, which resolves against the element's OWN font size — so a
 * `text-[11px]` container silently made the header's tracks 63.3px against the
 * body's 70.4px and slid every label left of the numbers it names, by 7px, then
 * 14px, then 21px. Sizing the children instead leaves both grids resolving `ch`
 * at the table's 13px, which is the only reason header and body line up. */
export function RangeHeader() {
  return (
    <div
      role="columnheader"
      style={{ gridTemplateColumns: RANGE_TEMPLATE }}
      className="grid text-ink/50"
    >
      {RANGE_LABELS.map((label) => (
        <span
          key={label}
          className="whitespace-nowrap pr-3 text-right text-[11px]"
        >
          {label}
        </span>
      ))}
      <span />
    </div>
  );
}

/** One row's three statistics. `tabular-nums` + the fixed sub-tracks are what
 * make the digits line up vertically down the whole table. */
export function RangeCells({ row }: { row: Row }) {
  return (
    <div
      role="cell"
      style={{ gridTemplateColumns: RANGE_TEMPLATE }}
      className="grid text-ink"
    >
      {rangeValues(row).map((v, i) => (
        <span
          key={RANGE_LABELS[i]}
          className="pr-3 text-right tabular-nums"
        >
          {rangeText(v, row.unit)}
        </span>
      ))}
      <span />
    </div>
  );
}
