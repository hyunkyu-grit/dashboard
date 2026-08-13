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
import { fmtLevel } from "@/lib/format";

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
