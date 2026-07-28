/* Carry readout copy (carry session; REWRITTEN strip session, Pass B) —
 * pure, unit-tested.
 *
 * A LABEL AND A NUMBER, not a sentence. The first draft spoke in full
 * sentences and was the only place in the product that did — prose reads as
 * chatty beside a table of bp figures. It also stated the same number twice
 * ("8.7bp 물고 갑니다" / "8.7bp 움직여야 본전"), omitted the direction of the
 * breakeven, and signed a zero (`캐리 +0.0`). The form is now:
 *
 *   3개월 캐리·롤              −8.7bp
 *   캐리 0.0 · 롤 −8.7 · 8.7bp 올라야 본전
 *
 * Mechanics, not prediction — no scores, no ratings, no badges. The backend
 * supplies PAY-side figures (§16); the Receive negation happens HERE, exactly
 * as the diagram negates, so the two can never disagree. */

import type { CarryFigures, CarryHorizon } from "@/lib/api";
import type { Side } from "./payReceiveModel";

export const HORIZON_LABEL: Record<CarryHorizon, string> = {
  "1M": "1개월",
  "3M": "3개월",
  "6M": "6개월",
  "1Y": "1년",
};

/** Below this |total| the readout says 거의 없음 instead of printing a figure
 * that invites over-reading (recorded in DESIGN §2). 0.5bp = the same "too
 * small to mean anything" line the solo-mover rung uses (SOLO_MIN_BP). */
export const NEAR_ZERO_BP = 0.5;

const MINUS = "−"; // U+2212, the product's minus (§ format grammar)

/** A component figure: a value that ROUNDS TO ZERO prints `0.0` with no sign
 * — signing a zero asserts a direction that is not there (Pass B). */
export function fmtComponent(v: number): string {
  const r = Math.abs(v) < 0.05 ? 0 : v;
  if (r === 0) return "0.0";
  return `${r < 0 ? MINUS : "+"}${Math.abs(r).toFixed(1)}`;
}

export interface CarryReadout {
  /** headline label, e.g. `3개월 캐리·롤` */
  label: string;
  /** headline figure, e.g. `−8.7bp` / `거의 없음` / `—` */
  totalText: string;
  /** signed total for the direction colour; null when there is no figure */
  total: number | null;
  /** caption line: breakdown + breakeven, or null when there is nothing */
  detail: string | null;
  kind: "figure" | "flat" | "none";
}

/** Build the readout for one horizon. `figures` is PAY-side from the wire;
 * `side` applies the negation and decides which way the breakeven runs. */
export function carryReadout(
  horizon: CarryHorizon,
  figures: CarryFigures | null,
  side: Side,
): CarryReadout {
  const label = `${HORIZON_LABEL[horizon]} 캐리·롤`;
  if (!figures) {
    // the instrument matures inside the horizon — no figure to state
    return { label, totalText: "—", total: null, detail: "만기 도래", kind: "none" };
  }

  const s = side === "pay" ? 1 : -1;
  const carry = s * figures.carry;
  const roll = s * figures.roll;
  const total = s * figures.total;
  const parts = `캐리 ${fmtComponent(carry)} · 롤 ${fmtComponent(roll)}`;

  if (Math.abs(total) < NEAR_ZERO_BP) {
    // nothing to break even against — the clause is omitted, not softened
    return { label, totalText: "거의 없음", total: null, detail: parts, kind: "flat" };
  }

  // Breakeven direction follows the Pay/Receive toggle: a payer profits when
  // the quoted value RISES, a receiver when it falls. Bleeding carry needs a
  // move in the favourable direction to get back to flat (올라야/내려야);
  // earning carry can absorb that much of an adverse move (내려도/올라도).
  const favourableUp = side === "pay";
  const bleeding = total < 0;
  const rises = bleeding ? favourableUp : !favourableUp;
  const verb = bleeding ? (rises ? "올라야" : "내려야") : rises ? "올라도" : "내려도";
  const breakeven = `${Math.abs(total).toFixed(1)}bp ${verb} 본전`;

  return {
    label,
    totalText: `${total < 0 ? MINUS : "+"}${Math.abs(total).toFixed(1)}bp`,
    total,
    detail: `${parts} · ${breakeven}`,
    kind: "figure",
  };
}
