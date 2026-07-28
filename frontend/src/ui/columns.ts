/* Format-derived column grid (grid session, Pass A).
 *
 * Column widths derive from each column's FORMAT — the widest rendering the
 * display grammar (lib/format.ts) can produce — never from today's data. With
 * `tabular-nums` every digit has the same advance, so the widest rendering is
 * a fixed template string and the grid never moves: not on tab switch, not on
 * sort, not on filter. The one flexible column is 한 줄, which absorbs all
 * remaining width — horizontal slack lives in the sentence, never in the
 * numbers. Pinned by guards/table-grid.test.ts.
 */

export const WIDEST = {
  /** Longest instrument identifier the product can produce: the `1s1.5s10s`
   * butterfly (9 glyphs). Forwards top out at 7 (`1Y3Mx3M` — starts run
   * ON…5Y in 3M steps, tenors 3M…5Y); outright/vol tenors at 4 (`1.5Y`). */
  label: "1s1.5s10s",
  /** 현재: a % level is 4dp (`4.2446`), a bp spread can read `−100.5`, a
   * ratio is 2dp (`12.00`). Six glyphs covers all three grammars. */
  level: "−100.5",
  /** Change columns: sign + three integer digits + 1dp (`−999.9`); the ratio
   * delta (`−1.23`) is narrower. */
  delta: "−999.9",
};

/* Cushions on top of the glyph count: label = quoted-dot (6px) + its gap
 * (6px) + pl-3 (12px) + slack; numeric = pr-3 (12px) + slack for the minus /
 * decimal point, whose advance is not exactly 1ch. */
const LABEL_W = `calc(${WIDEST.label.length}ch + 30px)`;
const LEVEL_W = `calc(${WIDEST.level.length}ch + 18px)`;
const DELTA_W = `calc(${WIDEST.delta.length}ch + 18px)`;

/** THE one grid definition, shared by the header row and every body row —
 * a single source so the two can never drift apart. Tracks: 종목 · 현재 ·
 * five change columns · 한 줄 (the only flexible one). 한 줄 keeps a small
 * FLOOR (carry session, Pass D): without it a narrow viewport crushed the
 * track to 0 and the sentence clipped flush against the card edge; with it
 * the row overflows into a horizontal scroll instead, and no column ever
 * touches the edge. */
export const ONE_LINER_MIN_PX = 120;
export const GRID_TEMPLATE = `${LABEL_W} ${LEVEL_W} repeat(5, ${DELTA_W}) minmax(${ONE_LINER_MIN_PX}px, 1fr)`;
