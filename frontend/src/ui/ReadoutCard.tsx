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
import { dirClass, fmtChangePct, fmtDelta, fmtLevel } from "@/lib/format";

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
  /* 캔들 모드의 다섯 줄 [OWNER, 2026-08-13]. 팝업이 이미 이 낱말로 쓰고 있었고
     (§G), 작은 차트가 캔들을 그리게 되면서 같은 낱말이 두 표면에 필요해졌다.
     레벨 다섯 줄이 아니라 **한 봉의 다섯 값**이라 52주 통계 자리와 겹치지
     않는다 — 캔들 툴팁은 저 위 넷을 아예 안 쓴다. */
  open: "시가",
  high: "고가",
  low: "저가",
  close: "종가",
  changePct: "등락률",
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
      className="pointer-events-none absolute top-2 rounded-control bg-popover p-2 text-[13px] shadow-lg"
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

/** A candle's 등락률 row — the change line of the CANDLE card, sitting where
 * `ReadoutChange` sits on the line card and coloured by the same rule. The
 * percent itself comes from `fmtChangePct` (lib/format), which both this card
 * and the popup's tooltip call: 등락률 is one quantity and it gets one grammar.
 * A zero open has no percent change and the formatter says so with the em dash;
 * the hue goes with it, because an em dash has no direction. */
export function ReadoutPct({
  k,
  open,
  close,
}: {
  k: string;
  open: number;
  close: number;
}) {
  return (
    <div className="mt-1 flex justify-between">
      <span className="opacity-50">{k}</span>
      <span className={`tabular-nums ${dirClass(open === 0 ? null : close - open)}`}>
        {fmtChangePct(open, close)}
      </span>
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
