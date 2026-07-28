/* Format-derived column grid (grid session, Pass A) + the column priority
 * ladder (columns session).
 *
 * Column widths derive from each column's FORMAT — the widest rendering the
 * display grammar (lib/format.ts) can produce — never from today's data. With
 * `tabular-nums` every digit has the same advance, so the widest rendering is
 * a fixed template string and the grid never moves: not on tab switch, not on
 * sort, not on filter. The one flexible column is 한 줄, which absorbs all
 * remaining width — horizontal slack lives in the sentence, never in the
 * numbers.
 *
 * WHEN SPACE RUNS OUT, COLUMNS DROP RATHER THAN SHRINK (columns session):
 * eight fixed columns sum to ~600px, and below that squeezing or scrolling
 * both read badly. `visibleColumns` renders the longest PREFIX of a priority
 * ladder that fits the measured container — pure arithmetic against the
 * fixed widths (no magic breakpoints, so it stays correct if a width
 * changes). THE SORTED COLUMN IS NEVER DROPPED: a list ordered by a column
 * the reader cannot see is unreadable, so the sort column is promoted to
 * slot 3 and whatever it displaced falls off the end. Ladder:
 *   1 종목 · 2 현재 · [3 sorted] · 어제 · YTD · WTD · MTD · QTD · 한 줄
 * (한 줄 first to go, last to return). Dropping/restoring never animates —
 * it is a layout change, not a state change. Pinned by
 * guards/table-grid.test.ts.
 */

import type { BasisKey } from "@/lib/api";

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
export const COL_PAD = { label: 30, level: 18, delta: 18 };
const LABEL_W = `calc(${WIDEST.label.length}ch + ${COL_PAD.label}px)`;
const LEVEL_W = `calc(${WIDEST.level.length}ch + ${COL_PAD.level}px)`;
const DELTA_W = `calc(${WIDEST.delta.length}ch + ${COL_PAD.delta}px)`;

/** 한 줄 keeps a small FLOOR (carry session, Pass D): with the ladder it is
 * the first column dropped, but while visible it never crushes below this. */
export const ONE_LINER_MIN_PX = 120;

/** Change-column priority (slots 4–8): 어제 first, then YTD, then the rest.
 * The sorted column, if any, jumps this queue (slot 3). */
export const BASIS_LADDER: BasisKey[] = ["d1", "ytd", "wtd", "mtd", "qtd"];

// canonical DISPLAY order — the ladder decides WHICH columns show, never
// their order (a reordering on resize would read as a glitch)
const BASIS_CANON: BasisKey[] = ["d1", "wtd", "mtd", "qtd", "ytd"];

export interface VisibleColumns {
  bases: BasisKey[]; // in canonical display order
  oneLiner: boolean;
  hidden: number; // how many columns are dropped (bases + 한 줄)
}

/** Fixed column widths in px for a measured `ch` (the '0' advance in the
 * table's font) — the same arithmetic the CSS calc() resolves to. */
export function colPx(chPx: number): { label: number; level: number; delta: number } {
  return {
    label: WIDEST.label.length * chPx + COL_PAD.label,
    level: WIDEST.level.length * chPx + COL_PAD.level,
    delta: WIDEST.delta.length * chPx + COL_PAD.delta,
  };
}

/** The longest prefix of the ladder that fits `containerPx`, sorted column
 * forced into slot 3. 종목 and 현재 always render (overflow-x-auto is the
 * final backstop below even that). */
export function visibleColumns(
  containerPx: number,
  chPx: number,
  sortCol: BasisKey | null,
): VisibleColumns {
  const w = colPx(chPx);
  const ladder = sortCol
    ? [sortCol, ...BASIS_LADDER.filter((b) => b !== sortCol)]
    : BASIS_LADDER;
  let used = w.label + w.level;
  const included: BasisKey[] = [];
  for (const b of ladder) {
    if (used + w.delta > containerPx) break; // prefix: stop at first miss
    included.push(b);
    used += w.delta;
  }
  const oneLiner =
    included.length === ladder.length && used + ONE_LINER_MIN_PX <= containerPx;
  return {
    bases: BASIS_CANON.filter((b) => included.includes(b)),
    oneLiner,
    hidden: BASIS_LADDER.length - included.length + (oneLiner ? 0 : 1),
  };
}

/** Every column visible — the initial state before the first measurement. */
export const ALL_COLUMNS: VisibleColumns = {
  bases: BASIS_CANON,
  oneLiner: true,
  hidden: 0,
};

/** THE one grid definition, shared by the header row and every body row —
 * a single source so the two can never drift apart. When 한 줄 is dropped
 * the flexible tail becomes an EMPTY filler track so rows still span the
 * card (hairlines/hover) and the header's hidden-column note has a slot. */
export function gridTemplate(v: VisibleColumns): string {
  const deltas = v.bases.length ? ` repeat(${v.bases.length}, ${DELTA_W})` : "";
  const tail = v.oneLiner ? `minmax(${ONE_LINER_MIN_PX}px, 1fr)` : "minmax(0, 1fr)";
  return `${LABEL_W} ${LEVEL_W}${deltas} ${tail}`;
}

export const GRID_TEMPLATE = gridTemplate(ALL_COLUMNS);
