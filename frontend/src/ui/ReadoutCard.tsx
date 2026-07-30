"use client";

/* THE hovered-point readout card — one component, two surfaces (§C, pass N).
 *
 * The preview chart's tooltip and the idle curve's tooltip answer the same
 * question about different x-axes: "what is the number under my cursor, and how
 * does it sit against its own 52 weeks". Same card, same rows, same order, same
 * formatters — so they cannot drift into two grammars for one quantity. This
 * repo has already shipped that failure (carry & roll rounded its components
 * and its headline separately, and the parts summed to −3.2 against a −3.1
 * total); `ui/cells.ts` is the same fix applied to the table's two level cells.
 *
 * What the two callers still own is what x IS — a date for the history line, a
 * tenor for the curve — which is the card's `title` and nothing else.
 *
 * Levels go through `fmtLevel`, the change through `fmtDelta` + `dirClass`, and
 * NOTHING here rounds: no `toFixed` in this file, pinned by
 * `guards/readout-parity.test.ts`. Colour follows §5/§9 — a level is ink
 * because it has no direction; only the signed change takes a hue.
 */

import type { Unit } from "@/lib/api";
import { dirClass, fmtDelta, fmtLevel } from "@/lib/format";

/** The card's fixed width. The callers clamp `left` against it so the card
 * never leaves the plot; it is exported so they clamp against the real number
 * rather than a copy of it. */
export const READOUT_CARD_W = 140;

/** The card's visible labels, in render order, shared by both surfaces.
 *
 * Deliberately NOT in `ui/readouts.ts`: that file registers the semantic KEYS
 * each surface renders, and the popup's labels legitimately differ (구간, not
 * 52주 — it zooms, so its statistics are the visible range's, §F). These are the
 * labels of the surfaces that share THIS card, where the window is the same 52
 * weeks and the wording must therefore be the same too. */
export const READOUT_LABEL = {
  level: "레벨",
  rangeHigh: "52주 최고",
  rangeLow: "52주 최저",
  rangeAvg: "52주 평균",
  dailyChange: "당일 변화",
} as const;

/** Floating card, pinned near the top of the plot rather than following the
 * cursor's y — a card that tracks both axes is harder to read against a moving
 * line, and the y is already marked by the crosshair + dot. */
export function ReadoutCard({
  title,
  left,
  children,
}: {
  title: string;
  left: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="pointer-events-none absolute top-2 rounded-[8px] bg-popover p-2 text-[12px] shadow-lg"
      style={{ left, width: READOUT_CARD_W }}
    >
      <div className="mb-1 font-semibold">{title}</div>
      {children}
    </div>
  );
}

/** One LEVEL row: label left, value right, ink, tabular. */
export function ReadoutLevel({
  k,
  v,
  unit,
}: {
  k: string;
  v: number | null | undefined;
  unit: Unit;
}) {
  return (
    <div className="flex justify-between">
      <span className="opacity-50">{k}</span>
      <span className="tabular-nums">{fmtLevel(v, unit)}</span>
    </div>
  );
}

/** The signed CHANGE row — the only coloured line in the card, and the reason
 * the level rows above it are not. Separated by a top margin because it is a
 * different quantity from the four levels, not another statistic of them. */
export function ReadoutChange({
  k,
  v,
  unit,
}: {
  k: string;
  v: number | null | undefined;
  unit: Unit;
}) {
  return (
    <div className="mt-1 flex justify-between">
      <span className="opacity-50">{k}</span>
      <span className={`tabular-nums ${dirClass(v)}`}>{fmtDelta(v, unit)}</span>
    </div>
  );
}
