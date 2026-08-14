/* Format-derived column grid (grid session, Pass A) + the column priority
 * ladder (columns session).
 *
 * Column widths derive from each column's FORMAT — the widest rendering the
 * display grammar (lib/format.ts) can produce — never from today's data. With
 * `tabular-nums` every digit has the same advance, so the widest rendering is
 * a fixed template string and the grid never moves: not on tab switch, not on
 * sort, not on filter. The last column (52주, pass L) is the elastic one: it
 * holds three FIXED sub-columns and absorbs all remaining width as TRAILING
 * slack, so the numbers inside it line up down the table like every other
 * numeric column.
 *
 * WHEN SPACE RUNS OUT, COLUMNS DROP RATHER THAN SHRINK (columns session):
 * the full column set sums to ~680px, and below that squeezing or scrolling
 * both read badly. `visibleColumns` renders the longest PREFIX of a priority
 * ladder that fits the measured container — pure arithmetic against the
 * fixed widths (no magic breakpoints, so it stays correct if a width
 * changes). THE SORTED COLUMN IS NEVER DROPPED: a list ordered by a column
 * the reader cannot see is unreadable, so the sort column is promoted to
 * slot 3 and whatever it displaced falls off the end. Ladder:
 *   1 종목 · 2 레벨 (헤더 = 데이터 일자) · [3 sorted] · 어제 · YTD · MTD · 52주
 *   · 위치 (the position track) · 세타 (first to go, last to return; then 위치,
 *   then 52주)
 * None of 52주, 위치 or 세타 is sortable: they never enter the sort slot and
 * their headers carry no control. Dropping/restoring never animates — it is a
 * layout change, not a state change. Pinned by guards/table-grid.test.ts.
 */

import type { BasisKey } from "@/lib/api";

/** The change columns' header text. Lives here, beside the grid it is measured
 * against, because BOTH the instrument table and the 전체 overview render this
 * header row — and the overview is imported BY the table, so it cannot import
 * the constant back without a cycle. */
export const BASIS_HEAD: Record<BasisKey, string> = {
  d1: "어제",
  mtd: "MTD",
  ytd: "YTD",
};

export const WIDEST = {
  /** Longest instrument identifier the product can produce: the `1s1.5s10s`
   * butterfly (9 glyphs). Forwards top out at 7 (`1Y3Mx3M` — starts run
   * ON…5Y in 3M steps, tenors 3M…5Y); outright/vol tenors at 4 (`1.5Y`). */
  label: "1s1.5s10s",
  /** The level column's VALUES: a % level is 4dp (`4.2446`), a bp spread can
   * read `−100.5`, a ratio is 2dp (`12.00`). Six glyphs covers all three
   * grammars. This is the count the 52주 sub-columns use — they hold level
   * values too. */
  level: "−100.5",
  /** The level column's HEADER: the dataset's as-of date, ISO
   * (`lib/format.ts::levelHeadText`). Since pass M the header names the DAY
   * rather than reading 현재, and at ten glyphs the HEADER — not the six-glyph
   * value — is the widest thing this column renders. Counted at a full `ch`
   * per glyph although the two hyphens are narrower than a digit: erring wide
   * is what keeps a fallback face from clipping a header, and the surplus
   * lands as leading slack in a right-aligned column where nothing sees it. */
  levelHead: "2026-07-24",
  /** Change columns: sign + three integer digits + 1dp (`−999.9`); the ratio
   * delta (`−1.23`) is narrower. */
  delta: "−999.9",
  /** The 세타 column's values, through `fmtKrw` — money, so the widest is the
   * 억 rollover, not today's data. Today the column runs −397만 … −2,495만
   * (all four digits), but the front end is a RATIO — carry over a small
   * annuity — and a 100bp CD-vs-IRS gap at 6M puts it past 1억. Sizing to
   * today's range would clip exactly on the day the number matters most. */
  theta: "−1억 2,345만원",
};

/** Glyphs in the 현재 track: the wider of its values and its header, which
 * since pass M is the header. Deliberately NOT used by the 52주 sub-columns —
 * those carry level VALUES under their own labels, and letting the date's width
 * leak into them would widen three columns to fit a header they do not have. */
export const LEVEL_GLYPHS = Math.max(
  WIDEST.level.length,
  WIDEST.levelHead.length,
);

/* Cushions on top of the glyph count: label = quoted-dot (6px) + its gap
 * (6px) + pl-3 (12px) + slack; numeric = pr-3 (12px) + slack for the minus /
 * decimal point, whose advance is not exactly 1ch. */
export const COL_PAD = { label: 30, level: 18, delta: 18 };
const LABEL_W = `calc(${WIDEST.label.length}ch + ${COL_PAD.label}px)`;
const LEVEL_W = `calc(${LEVEL_GLYPHS}ch + ${COL_PAD.level}px)`;
const DELTA_W = `calc(${WIDEST.delta.length}ch + ${COL_PAD.delta}px)`;

/** The 52주 column holds three sub-columns — high, low, mean — each carrying
 * ONE number in the 현재 grammar, so the glyph count is 현재's. That makes the
 * column's FLOOR format-derived like every other width; it replaced a flat
 * 120px floor that had been sized for a sentence. Any width beyond the floor
 * becomes trailing slack inside the cell, never extra space between the
 * numbers, so the three stay aligned all the way down the table.
 *
 * The CUSHION is larger than 현재's, and it is the one width here not set by
 * the number: a sub-column has to fit its header LABEL too, and the longest
 * (`52주 고점`) is Korean, whose advance scales with the font size and NOT with
 * `ch`. Measured live at 11px it is ~45px of ink; 현재's 18px cushion leaves
 * that 7.7px of room at the runtime ch of 7.74, which holds today but is thin
 * enough that a fallback face could close it — and a clipped or wrapped header
 * label is not a failure any test would catch. 24px puts ~13.7px under it for
 * 18px of table width. Shrink it only against a fresh measurement of the
 * longest label, not from the arithmetic alone. */
export const RANGE_SUBS = 3;
export const RANGE_PAD = 24;
const RANGE_SUB_W = `calc(${WIDEST.level.length}ch + ${RANGE_PAD}px)`;
const RANGE_W = `calc(${RANGE_SUBS * WIDEST.level.length}ch + ${
  RANGE_SUBS * RANGE_PAD
}px)`;

/** The 52주 cell with the POSITION TRACK (pass N): a fourth sub-track to the
 * right of 평균 — a low→high slider with a marker at the current level. It is
 * sized as ONE MORE range sub-column, so it keeps the sub-grid's rhythm and
 * scales with the table font like its neighbours; a graphic has no format to
 * derive a width from, and borrowing the numbers' track is the next-best
 * discipline. It has its OWN ladder rung (first to drop, before the three
 * numbers) — see `visibleColumns`. */
const RANGE_W_SLIDER = `calc(${(RANGE_SUBS + 1) * WIDEST.level.length}ch + ${
  (RANGE_SUBS + 1) * RANGE_PAD
}px)`;

/** The 세타 sub-column [OWNER, 2026-08-13 — "위치 오른쪽에 남는 칸에"]. It sits
 * where the reader pointed: immediately right of the position track, inside the
 * 52주 cell, with the cell's trailing slack still trailing it.
 *
 * IT IS A TRACK, NOT THE SLACK. Dropping the value into the existing filler
 * would have cost nothing — but that filler is `minmax(0, 1fr)`, so its width
 * is whatever the table has left over, and at a narrow container it is ZERO. A
 * number that silently vanishes is the opposite of "바로 눈에 띄게". With a
 * track of its own it follows the house rule instead: columns DROP rather than
 * shrink, visibly and by the ladder.
 *
 * The cushion is bigger than RANGE_PAD's for the reason stated there — `ch` is
 * the DIGIT advance and 억/만/원 are Korean, wider than a digit at the same
 * size. Three of them ride in the widest rendering, at roughly 5.3px of excess
 * each over the 7.74px runtime `ch`, plus `pr-3`. 30px covers both with room;
 * shrink it only against a fresh measurement, never from the arithmetic. */
export const THETA_PAD = 30;
const THETA_W = `calc(${WIDEST.theta.length}ch + ${THETA_PAD}px)`;

/** The sub-grid INSIDE the 52주 cell — the fixed tracks (three numbers, plus
 * the position track when it fits), then a filler that takes the slack.
 * Shared by the header's sub-labels and every body cell, exactly as
 * `gridTemplate` is shared by the header row and every body row. */
export function rangeTemplate(slider: boolean, theta = false): string {
  const fixed = `repeat(${RANGE_SUBS + (slider ? 1 : 0)}, ${RANGE_SUB_W})`;
  return `${fixed}${theta ? ` ${THETA_W}` : ""} minmax(0, 1fr)`;
}

/** Change-column priority (slots 4–6): 어제 first, then YTD, then MTD.
 * The sorted column, if any, jumps this queue (slot 3). */
export const BASIS_LADDER: BasisKey[] = ["d1", "ytd", "mtd"];

// canonical DISPLAY order — the ladder decides WHICH columns show, never
// their order (a reordering on resize would read as a glitch)
const BASIS_CANON: BasisKey[] = ["d1", "mtd", "ytd"];

export interface VisibleColumns {
  bases: BasisKey[]; // in canonical display order
  range52: boolean;
  /** the 52주 position track (pass N). Implies `range52` — the marker's frame
   * of reference is the three numbers beside it, so it can never outlive them. */
  slider: boolean;
  /** the 세타 column [OWNER, 2026-08-13]. Implies `slider`: it was placed BY
   * its neighbour ("위치 오른쪽"), and a column that outlived the thing it was
   * positioned against would be somewhere the owner never put it. */
  theta: boolean;
  hidden: number; // how many columns are dropped (bases + 52주 + 위치 + 세타)
}

/** Fixed column widths in px for a measured `ch` (the '0' advance in the
 * table's font) — the same arithmetic the CSS calc() resolves to. `range` is
 * the 52주 column's floor: three sub-columns at the level glyph count and the
 * label-driven cushion (see RANGE_PAD). */
export function colPx(chPx: number): {
  label: number;
  level: number;
  delta: number;
  rangeSub: number;
  range: number;
  theta: number;
} {
  const rangeSub = WIDEST.level.length * chPx + RANGE_PAD;
  return {
    label: WIDEST.label.length * chPx + COL_PAD.label,
    level: LEVEL_GLYPHS * chPx + COL_PAD.level,
    delta: WIDEST.delta.length * chPx + COL_PAD.delta,
    rangeSub,
    range: RANGE_SUBS * rangeSub,
    theta: WIDEST.theta.length * chPx + THETA_PAD,
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
  const range52 =
    included.length === ladder.length && used + w.range <= containerPx;
  // the position track returns only after the three numbers it is read
  // against, and 세타 only after the track it was placed beside — so the tail
  // restores 52주 → 위치 → 세타 and drops in exactly the reverse order
  const slider = range52 && used + w.range + w.rangeSub <= containerPx;
  const theta = slider && used + w.range + w.rangeSub + w.theta <= containerPx;
  return {
    bases: BASIS_CANON.filter((b) => included.includes(b)),
    range52,
    slider,
    theta,
    hidden:
      BASIS_LADDER.length - included.length +
      (range52 ? 0 : 1) +
      (slider ? 0 : 1) +
      (theta ? 0 : 1),
  };
}

/** Width says the 세타 column FITS; this says whether it APPLIES.
 *
 * 세타 exists for outright swap tenors only — a spread or a fly is weighted
 * DV01-neutral, so there is no net risk to divide by, and forwards, volatility
 * and the 1D/3M nodes are not swaps at all. On those surfaces every cell would
 * be an em dash, and this product has already retired one column for exactly
 * that (the backtest's 진입 par, which printed either a duplicate or a dash:
 * "a column that is either a duplicate or a dash earns no width" [OWNER,
 * 2026-08-03]). So a table with no theta anywhere does not draw the column.
 *
 * This is NOT a ladder drop and must never be counted as one: the width note
 * says "N열 숨김", and a column that does not apply here was not hidden from
 * the reader — there was nothing to hide. Callers keep `hidden` on the
 * width-derived value. */
export function withThetaData(
  v: VisibleColumns,
  hasAny: boolean,
): VisibleColumns {
  return v.theta && !hasAny ? { ...v, theta: false } : v;
}

/** Every column visible — the initial state before the first measurement. */
export const ALL_COLUMNS: VisibleColumns = {
  bases: BASIS_CANON,
  range52: true,
  slider: true,
  theta: true,
  hidden: 0,
};

/** THE one grid definition, shared by the header row and every body row —
 * a single source so the two can never drift apart. When 52주 is dropped
 * the flexible tail becomes an EMPTY filler track so rows still span the
 * card (hairlines/hover) and the header's hidden-column note has a slot. */
export function gridTemplate(v: VisibleColumns, labelW: string = LABEL_W): string {
  const deltas = v.bases.length ? ` repeat(${v.bases.length}, ${DELTA_W})` : "";
  // the 52주 cell's FLOOR has to cover whatever sub-tracks it holds — the
  // three numbers, the position track, and 세타 — or the sub-grid overflows
  // the cell it lives in and every row's tail slides left of its header
  const floor = v.slider
    ? v.theta
      ? `calc(${RANGE_W_SLIDER} + ${THETA_W})`
      : RANGE_W_SLIDER
    : RANGE_W;
  const tail = v.range52 ? `minmax(${floor}, 1fr)` : "minmax(0, 1fr)";
  return `${labelW} ${LEVEL_W}${deltas} ${tail}`;
}

/** 현금채권·자산스왑 표의 종목 열 폭 [2026-08-14].
 *
 * `WIDEST.label` 은 IRS 가 만들 수 있는 가장 긴 식별자(`1s1.5s10s`, 9글자)에서
 * 나온 값이고, 그건 **라틴 글자 9개**다. 이 표의 이름은 한글이라 같은 글자
 * 수로 훨씬 넓다 — "캐피탈채 AA- 10Y" 나 "국고채 3M 자산스왑" 이 그 트랙에서
 * 두 줄로 접혔다(실측). `ch` 는 '0' 의 진행폭이라 한글 폭을 대변하지 못하므로
 * 글자 수를 세는 대신 **잰 값**을 쓴다: 12px 한글 ~13px/자 × 13자 + 여백.
 *
 * IRS 표는 건드리지 않는다 — 그쪽은 자기 라벨에 맞는 폭을 이미 갖고 있고,
 * 넓히면 52주 꼬리가 그만큼 좁아진다. */
export const CASHBOND_LABEL_W = "200px";

export const GRID_TEMPLATE = gridTemplate(ALL_COLUMNS);
