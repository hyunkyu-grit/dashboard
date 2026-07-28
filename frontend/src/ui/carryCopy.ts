/* Carry-sentence copy (carry session, Pass C) — pure, unit-tested.
 *
 * A sentence, not a table: what holding the trade earns over the horizon,
 * from today's curve. Mechanics, not prediction — no scores, no ratings, no
 * "good entry" badges. Register 합니다체 (§15). The backend supplies PAY-side
 * figures (§16); the Receive negation happens HERE, exactly as the diagram
 * negates, so the two can never disagree. */

import type { CarryFigures, CarryHorizon } from "@/lib/api";
import type { Side } from "./payReceiveModel";

export const HORIZON_LABEL: Record<CarryHorizon, string> = {
  "1M": "1개월",
  "3M": "3개월",
  "6M": "6개월",
  "1Y": "1년",
};

/** Below this |total| the sentence says there is no meaningful carry instead
 * of printing a figure that invites over-reading (recorded in DESIGN §C).
 * 0.5bp = the same "too small to mean anything" line the solo-mover rung
 * uses (SOLO_MIN_BP). */
export const NEAR_ZERO_BP = 0.5;

const fmt = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}`;

export interface CarrySentence {
  headline: string;
  /** caption parts; carry/roll keep their signed value for direction colour */
  carry: number;
  roll: number;
  tail: string | null; // trailing clause after the numbers, if any
  kind: "earn" | "pay" | "flat" | "none";
}

/** Build the sentence for one horizon. `figures` is PAY-side from the wire;
 * `side` applies the negation. Null figures → the no-statement line. */
export function carrySentence(
  horizon: CarryHorizon,
  figures: CarryFigures | null,
  side: Side,
): CarrySentence {
  if (!figures) {
    return {
      headline: `${HORIZON_LABEL[horizon]} 안에 만기가 도래해 캐리를 셈할 수 없습니다`,
      carry: 0,
      roll: 0,
      tail: null,
      kind: "none",
    };
  }
  const s = side === "pay" ? 1 : -1;
  const carry = s * figures.carry;
  const roll = s * figures.roll;
  const total = s * figures.total;
  const h = HORIZON_LABEL[horizon];

  if (Math.abs(total) < NEAR_ZERO_BP) {
    return { headline: "캐리는 거의 없습니다", carry, roll, tail: null, kind: "flat" };
  }
  if (total > 0) {
    return {
      headline: `${h} 동안 ${total.toFixed(1)}bp 벌고 들어갑니다`,
      carry,
      roll,
      tail: "커브가 그대로일 때",
      kind: "earn",
    };
  }
  return {
    headline: `${h} 동안 ${Math.abs(total).toFixed(1)}bp 물고 갑니다`,
    carry,
    roll,
    tail: "그만큼 움직여야 본전입니다",
    kind: "pay",
  };
}

export const fmtSigned = fmt;
