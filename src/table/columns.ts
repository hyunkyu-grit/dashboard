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
 *   · 위치 (the position track — first to go, last to return; then 52주)
 * Neither 52주 nor 위치 is sortable: they never enter the sort slot and their
 * headers carry no control. Dropping/restoring never animates — it is a
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
  /** The level column's HEADER: the dataset's as-of date, MONTH-DAY
   * (`lib/format.ts::levelHeadText`). Since pass M the header names the DAY
   * rather than reading 현재; since 2026-08-14 it drops the year [OWNER].
   *
   * That is what took this column from 104px to 74. MEASURED in the running
   * app: a CDS `TableCell` keeps 16px on EACH side, so a 104px column offers
   * 72px of text, and the ISO date rendered 78.2px at 13px/600 — the header
   * wrapped to two lines and pulled the whole header row taller. `08-13` is
   * ~40px and clears it with room, which means the six-glyph VALUE is once
   * again what sizes this column, as it was before pass M. */
  levelHead: "08-13",
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

/* Cushions on top of the glyph count: label — see the measurement below;
 * numeric = pr-3 (12px) + slack for the minus / decimal point, whose advance is
 * not exactly 1ch.
 *
 * ── Why the label cushion is 80 and not the old 30 ──────────────────────────
 * MEASURED in the running app at ch = 8.791 (Pretendard SR, 14px/500), because
 * the two things that actually size this column are BOTH Korean, and Korean
 * advance scales with font size and NOT with `ch` — the same reason `RANGE_PAD`
 * is a measured px number rather than a glyph count.
 *
 *     widest Latin id      `1s1.5s10s`               62.1 px
 *     widest Korean name   `10년 국채선물 내재금리`     130.9 px   ← the real max
 *     widest subtitle      `1년 평균 3.0801% · 호가`   130.6 px
 *
 *     9ch (79.1) + 80 = 159.1 px, which clears both with ~28px of slack.
 *
 * ── `WIDEST.label` is STALE, and this cushion is currently covering for it ──
 * That constant still says the longest identifier this product can produce is
 * the 9-glyph `1s1.5s10s` butterfly. That was true of v1's swap-only universe.
 * v2 added 국고 / 크레딧 / 본드스왑 / 국채선물, whose labels are Korean and run to
 * `10년 국채선물 내재금리` — 130.9px, or roughly 15 ch-equivalents. So the glyph
 * count under-declares the column by ~52px and the px cushion is what keeps the
 * futures names from clipping.
 *
 * That is the wrong place for it to be fixed: a `ch`-counted maximum and a
 * px-measured maximum should not be silently summed. The honest repair is a
 * second `WIDEST` entry measured in px for the Korean-labelled groups, which is
 * a change to the width model rather than to a cushion — recorded here rather
 * than done quietly as part of a type pass.
 *
 * 말줄임은 이제 어디에도 없다 [OWNER 2026-08-25 — CLAUDE.md «말줄임 절대
 * 금지»]. 한때 서브라인은 꼬리 잘림을 허용했고 `.sr-name-stack > *` 이
 * ellipsis 를 세웠는데, 그 안전판이 걷히면서 이 폭 모델이 유일한 방어선이다 —
 * 이름·서브라인 모두 여기 실측 폭 안에 들어가야 하고, 넘치면 잘리는 대신
 * 이웃 위로 넘쳐 보인다(시끄러운 실패). */
/* `level: 22`, MEASURED 2026-08-14 and not the old 18. The cell's own inset is
 * 16px per side (32 total), so a column of `6ch + pad` offers `6ch + pad − 32`
 * of text. The header `08-13` renders ~40px at 13px/600, and 6×8.6 + 22 − 32 =
 * 41.6 clears it; at 18 it did not, and the header would have wrapped for a
 * second time in this column's history. The VALUES (`−100.5`, 46.7px) are
 * right-aligned single lines and may bleed into the left inset, which is empty
 * gutter — that is why the value is not what this number has to cover. */
export const COL_PAD = { label: 80, level: 22, delta: 18 };
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
/* 20, MEASURED 2026-08-14 (was 24, which was itself a live measurement at the
 * previous type scale). Inside the sub-grid each track carries its own 12px
 * `padding-inline-end` and nothing else, so a track of `6ch + pad` offers
 * `6ch + pad − 12` of text:
 *
 *     header  `52주 고점`   53.5 px  ← the binding one, Korean
 *     value   `−100.5`      46.7 px
 *     6×8.6 + 20 − 12    =  59.6 px  →  6.1 px over the header
 *
 * The saving is 4px per track and it is spent on the ladder's last rung, which
 * is what decides whether 세타 appears at all. Do not take it below the header
 * measurement plus a real margin — a clipped or wrapped sub-label is not a
 * failure any test would catch. */
export const RANGE_PAD = 20;
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

/**
 * 세타 sub-track cushion — it has to cover the three Korean glyphs (억/만/원)
 * that `ch`, a DIGIT advance, under-counts, plus the cell's own right padding.
 *
 * 20, and it is a MEASUREMENT, not v1's number. v1 carried 30, sized against its
 * own 11px caption; this table draws the value at 14px/400. Measured in the
 * running app (2026-08-14), rendering the declared maximum inside the actual
 * cell:
 *
 *     "−1억 2,345만원"   95.2 px   ← the widest string this column can produce
 *     11 × ch (8.6)      94.6 px   ← what the glyph count declares
 *     padding-inline-end 12.0 px
 *                        ────────
 *     needed            107.2 px ;  11ch + 20 = 114.6, so 7.4px of slack
 *
 * The old 30 reserved 124.6 for 107.2 of ink — 17px that the ladder then had to
 * find, and it is the ladder's last 17px that decide whether this column
 * appears at all. Shrink it further only against a fresh measurement.
 */
export const THETA_PAD = 20;
const THETA_W = `calc(${WIDEST.theta.length}ch + ${THETA_PAD}px)`;

/**
 * The sub-grid INSIDE the 52주 cell — the fixed tracks (three numbers, the
 * position track when it fits, then 세타 when THAT fits), then a filler that
 * takes the slack. Shared by the header's sub-labels and every body cell,
 * exactly as `<colgroup>` is shared by the header row and every body row.
 *
 * 세타 is not a 52-week statistic and sits here anyway: it is the column the
 * owner asked for beside 위치, and the cell is the table's one elastic track —
 * the only place a fifth number can appear without re-deriving every width.
 *
 * ── Why `chPx` and not `ch` — MEASURED IN THE RUNNING APP, 2026-08-14 ────────
 * These tracks used to be CSS `calc(6ch + 24px)` strings. `ch` resolves against
 * THE ELEMENT'S OWN FONT, and the element here is the `.sr-range` grid
 * container, whose font is the CDS cell default. Measured on the 아웃라이트 tab:
 *
 *     .sr-range      (grid container)  16px/600   ch = 10.86   ← sized the tracks
 *     .sr-range > *  (the numbers)     13px/600   ch =  8.34
 *     td.sr-num span (the ch probe)    14px/400   ch =  8.60   ← sized the ladder
 *
 * So the tracks were laid out with an advance that belongs to NO text in the
 * table, 26% wider than the ladder's arithmetic. Nothing looked wrong while the
 * trailing filler could absorb it; the moment 세타 added a fifth track the cell
 * overflowed its column by 61px and the table grew a horizontal scrollbar.
 *
 * This is the `<colgroup>` ruling one level down: the ladder and the render must
 * consume THE SAME NUMBER, so the template is built in px from the measured
 * advance rather than re-derived from a font. `chPx = 0` (before the first
 * measurement) keeps the old `ch` strings — that frame has no ladder either.
 */
export function rangeTemplate(slider: boolean, theta = false, chPx = 0): string {
  const n = RANGE_SUBS + (slider ? 1 : 0);
  if (chPx > 0) {
    const w = colPx(chPx);
    const fixed = `repeat(${n}, ${w.rangeSub}px)`;
    return `${fixed}${theta ? ` ${w.theta}px` : ""} minmax(0, 1fr)`;
  }
  return `repeat(${n}, ${RANGE_SUB_W})${theta ? ` ${THETA_W}` : ""} minmax(0, 1fr)`;
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
  /** 세타. Implies `slider`: it was placed beside the track, so it returns
   * after it and drops before it. */
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
/**
 * What a CDS `TableCell` spends on its own inner inset, MEASURED in the running
 * app (2026-08-14): the 52주 `<th>` ran 496.2 → 935.0 and its sub-grid started
 * at 512.2. Sixteen pixels of the cell are not available to the tracks inside
 * it.
 *
 * Every other column absorbs this in its cushion (the label's is 80px). The 52주
 * cell cannot: its width is the SUM OF FIXED SUB-TRACKS with no cushion of its
 * own, so a ladder that hands it the full column width overcommits by exactly
 * this much — and the symptom is a horizontal scrollbar on the whole table, not
 * a clipped number, because the sub-grid's `1fr` filler collapses to 0 first.
 */
export const CELL_INSET = 16;

export function visibleColumns(
  containerPx: number,
  chPx: number,
  sortCol: BasisKey | null,
  /** Does any row on this tab carry a 세타? The ladder needs to know, because a
   * column that is not drawn must not reserve width from the one beside it —
   * see the note on the tail order below. */
  hasTheta = true,
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
  /* The 52주 tail is measured against the width MINUS the cell's own inset —
   * everything from here down lives inside one `TableCell` (see CELL_INSET). */
  const tail = containerPx - CELL_INSET;
  const range52 = included.length === ladder.length && used + w.range <= tail;

  /* ── Tail order: 52주 세 숫자 → 세타 → 위치 [OWNER 2026-08-14] ──────────────
   * 세타 used to be the last rung and therefore the FIRST thing to disappear —
   * measured, it dropped below a 1390px viewport, which is an ordinary window
   * on a large screen. The owner asked for this column so that carry and hedge
   * cost would be visible without opening anything; a column that vanishes
   * first is the opposite of that.
   *
   * 위치 gives up the slot instead. It is a PICTURE of the three numbers beside
   * it — drop it and the same fact is still on the row, in ink. Drop 세타 and a
   * quantity that appears nowhere else on the screen is gone.
   *
   * DISPLAY order does not change (…평균 · 위치 · 세타): what changed is which
   * one yields. The two flags are independent, so `위치 off / 세타 on` renders
   * exactly as it reads. */
  const theta = hasTheta && range52 && used + w.range + w.theta <= tail;
  /* Width is reserved for 세타 whenever the column APPLIES — never merely
   * because it fits. On a tab with no theta the position track must not be made
   * to pay for a column that is not drawn. */
  const thetaW = hasTheta ? w.theta : 0;
  /* And it is a strict PREFIX: 위치 does not come back once 세타 has been
   * dropped, even though it is the narrower of the two and would fit. A column
   * that REAPPEARS as the window gets smaller reads as a glitch, and the ladder
   * is a priority order, not a packing problem. */
  const slider =
    range52 && (!hasTheta || theta) && used + w.range + thetaW + w.rangeSub <= tail;

  return {
    bases: BASIS_CANON.filter((b) => included.includes(b)),
    range52,
    slider,
    theta,
    /* A column that does not APPLY here was not hidden from the reader — there
     * was nothing to hide — so `hasTheta === false` adds nothing to the count.
     * Only width-driven drops are counted, because that is what the note
     * ("N개 열이 폭에 맞춰 숨었어요") claims. */
    hidden:
      BASIS_LADDER.length - included.length +
      (range52 ? 0 : 1) +
      (slider ? 0 : 1) +
      (hasTheta && !theta ? 1 : 0),
  };
}

/* `withThetaData(v, hasAny)` stood here and is GONE (2026-08-14). It answered
 * "does the column APPLY" as a second pass over a finished ladder, which was
 * fine while 세타 was the last rung and nothing was sized behind it. Once 위치
 * moved BEHIND 세타 in the drop order, a second pass could no longer be right:
 * turning 세타 off after the fact left 위치 having reserved width for a column
 * that is not drawn, so the forward and 민평 tabs would drop the position track
 * to make room for nothing.
 *
 * The question is now an INPUT to `visibleColumns` (`hasTheta`), where both
 * flags can be decided against the same width in one place. The distinction it
 * protected is unchanged and still asserted by `guards/theta-column.test.tsx`:
 * a column that does not apply is not "hidden", so it never reaches `hidden`. */

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
export function gridTemplate(v: VisibleColumns): string {
  const deltas = v.bases.length ? ` repeat(${v.bases.length}, ${DELTA_W})` : "";
  // the 52주 cell's FLOOR has to cover whatever sub-tracks it holds — the three
  // numbers, the position track and 세타 — or the sub-grid overflows the cell it
  // lives in and every row's tail slides left of its header
  const floor = v.slider
    ? v.theta
      ? `calc(${RANGE_W_SLIDER} + ${THETA_W})`
      : RANGE_W_SLIDER
    : RANGE_W;
  const tail = v.range52 ? `minmax(${floor}, 1fr)` : "minmax(0, 1fr)";
  return `${LABEL_W} ${LEVEL_W}${deltas} ${tail}`;
}

export const GRID_TEMPLATE = gridTemplate(ALL_COLUMNS);
