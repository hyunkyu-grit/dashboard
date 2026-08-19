/* The table's two LEVEL call sites, side by side, so they cannot drift.
 *
 * 현재 and the 52-week high/low/mean are the SAME quantity in the same unit —
 * a level. They must therefore print through the same function at the same
 * precision. This repo has already shipped the alternative once: the carry &
 * roll block rounded its components and its headline separately, and the parts
 * summed to −3.2 against a −3.1 total purely from display digits. Nobody could
 * tell whether the arithmetic or the formatting was wrong.
 *
 * So there is exactly one formatter (`fmtLevel`, lib/format.ts) and both
 * wrappers below are pass-throughs that exist to be NAMED — the parity guard
 * (`guards/readout-parity.test.ts`) asserts they produce byte-identical strings
 * for every instrument kind, which only means something if the two paths are
 * separately reachable. If a second rounding ever appears in one of them, that
 * test goes red. */

import type { Unit } from "@/lib/api";
import { fmtLevel, unitSuffix } from "@/lib/format";

import type { Row } from "./rows";

/** The 현재 column: the row's current level. */
export function levelText(row: Row): string {
  return fmtLevel(row.now, row.unit);
}

/** One 52-week statistic (high, low or mean) in the row's unit. Same grammar,
 * same precision, same null placeholder as 현재 — deliberately the same call. */
export function rangeText(v: number | null, unit: Unit): string {
  return fmtLevel(v, unit);
}

/* ── A curve-position ANCHOR CHIP was built, measured and REMOVED. Do not
 *    re-derive it. ─────────────────────────────────────────────────────────
 *
 * The design rule it came from is real and measured: Coinbase's /explore anchors
 * every row with a coin logo, and a list of near-identical strings with nothing
 * for the eye to catch on is materially harder to scan. The implementation drawn
 * from it — a fixed-width chip holding the instrument's front-leg tenor, read out
 * of `sortKey[0]` — does not transfer to this product, and the reason is in the
 * data rather than in the taste.
 *
 * **v2's labels already lead with the tenor**, so the chip restated a substring
 * of the name in every group. Measured in the running app, one tab at a time:
 *
 *     아웃라이트   [3M]  3M                     ← identical
 *     스프레드     [6M]  6M/9M                  ← prefix
 *     버터플라이   [6M]  6M/9M/1Y               ← prefix
 *     포워드       [3M]  3Mx6M                  ← prefix
 *     변동성       [1Y]  1Y σ                   ← prefix
 *     국고         [6M]  국고 6M                 ← contained
 *     국채선물     [3Y]  3년 국채선물 가격         ← contained ("3년" IS 3Y)
 *     크레딧       [6M]  통안 6M / 산금 6M / …    ← contained, AND harmful
 *
 * The credit tab is what settled it. Those rows differ by ISSUER and share a
 * tenor, so the chip repeated the one field they have in common while the field
 * that tells them apart sat unemphasised beside it — an anchor that hides the
 * discriminating value is worse than no anchor.
 *
 * The mockup this was ported from needed the chip because ITS labels were prose
 * ("IRS 3M", "Call (1D)"); v2's `buildRows` uses the series id, which is the
 * tenor. The anchor for this table is therefore the NAME itself, which is why it
 * carries the row's only non-numeric emphasis (label1/600).
 */

/**
 * The row's second line: where this instrument normally sits, so today's level
 * has something to be read against without leaving the row.
 *
 * The 1-year mean is the reference a level is actually judged by, and it prints
 * through `rangeText` — the SAME formatter as 현재 — so the two can never show
 * the same quantity at two precisions (the failure `cells.ts` exists to
 * prevent).
 *
 * ── 고시 / 보간, and when neither is printed ─────────────────────────────────
 * An earlier pass printed 호가 and deliberately withheld 보간, on the reading
 * that `s.quoted ?? undefined` collapsed the API's `null` into the same
 * `undefined` as an interpolated tenor. It does not: `??` only replaces null
 * and undefined, so `false` was arriving intact the whole time, and the backend
 * only ever sends null for a kind the question does not apply to
 * (`derive.py:355`). The distinction was available and unprinted.
 *
 * The 호가 mark is RETIRED [OWNER 2026-08-19 — "백테스트에서 호가라고 적힌
 * 것들 없애고"]: a quoted node is the DEFAULT state of this table, and marking
 * the default marks almost every row. Only the exception is stated — 보간, the
 * tenor whose level is interpolated between two quoted ones. The third state
 * stays silence: a spread, a butterfly, a volatility ratio and every 민평 row
 * carry no mark, because 고시 vs 보간 is a fact about a CURVE NODE and those
 * rows are not one.
 */
export function subText(row: Row): string {
  const avg = `1년 평균 ${rangeText(row.rangeAvg, row.unit)}${unitSuffix(row.unit)}`;
  if (row.quoted === false) return `${avg} · 보간`;
  return avg;
}
