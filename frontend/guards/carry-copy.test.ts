/* Guard: the carry readout (carry session; register rewritten strip session,
 * Pass B). A LABEL AND A NUMBER, in the register used everywhere else — the
 * sentence form was a mistake. The four faults it fixed are each pinned here:
 * the number was stated twice, the breakeven omitted its direction, a zero
 * component was signed, and prose sat beside a table of bp figures.
 * Mechanics, not prediction: no scores, ratings, or badges. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { carryReadout, fmtComponent, NEAR_ZERO_BP } from "../src/ui/carryCopy";

const fig = (carry: number, roll: number) => ({
  carry,
  roll,
  total: carry + roll,
});

describe("the readout is a label and a number", () => {
  it("headline is the horizon label plus the signed total", () => {
    const r = carryReadout("3M", fig(0.0, -8.7), "pay");
    expect(r.label).toBe("3개월 캐리·롤");
    expect(r.totalText).toBe("−8.7bp");
    expect(r.total).toBeCloseTo(-8.7, 9);
    expect(r.kind).toBe("figure");
  });

  it("the caption is breakdown + breakeven, and states each number ONCE", () => {
    const r = carryReadout("3M", fig(0.0, -8.7), "pay");
    expect(r.detail).toBe("캐리 0.0 · 롤 −8.7 · 8.7bp 올라야 본전");
    // the total appears in the headline; the caption's 8.7 is the breakeven
    // MOVE, not a restatement of the same fact in words
    expect(r.detail).not.toContain("물고");
    expect(r.detail).not.toContain("벌고");
  });

  it("no sentence anywhere — no 합니다/입니다 verb endings in the readout", () => {
    for (const side of ["pay", "receive"] as const) {
      for (const f of [fig(2.8, 1.4), fig(-4.7, -1.4), fig(0.2, -0.1), null]) {
        const r = carryReadout("3M", f, side);
        for (const s of [r.label, r.totalText, r.detail ?? ""]) {
          expect(s).not.toMatch(/니다/);
        }
      }
    }
  });
});

describe("the breakeven states its direction, following Pay/Receive", () => {
  it("a payer bleeding carry needs the value to RISE", () => {
    expect(carryReadout("3M", fig(-4.7, -1.4), "pay").detail).toContain(
      "6.1bp 올라야 본전",
    );
  });

  it("a receiver bleeding carry needs the value to FALL", () => {
    // pay-side figures are positive here, so the receiver is the one bleeding
    expect(carryReadout("3M", fig(2.8, 1.4), "receive").detail).toContain(
      "4.2bp 내려야 본전",
    );
  });

  it("earning carry states the adverse move it can absorb instead", () => {
    // payer earning: the value may FALL that far before the carry is eaten
    expect(carryReadout("3M", fig(2.8, 1.4), "pay").detail).toContain(
      "4.2bp 내려도 본전",
    );
    // receiver earning: the adverse direction is a rise
    expect(carryReadout("3M", fig(-4.7, -1.4), "receive").detail).toContain(
      "6.1bp 올라도 본전",
    );
  });
});

describe("a zero component is never signed", () => {
  it("prints 0.0 with no sign, for either rounding direction", () => {
    expect(fmtComponent(0)).toBe("0.0");
    expect(fmtComponent(0.04)).toBe("0.0");
    expect(fmtComponent(-0.04)).toBe("0.0");
    expect(carryReadout("3M", fig(0.02, -8.7), "pay").detail).toContain("캐리 0.0");
  });

  it("a component that does NOT round to zero keeps its sign", () => {
    expect(fmtComponent(0.2)).toBe("+0.2");
    expect(fmtComponent(-0.1)).toBe("−0.1");
  });
});

describe("near zero and no-figure cases", () => {
  it("below the threshold the total reads 거의 없음 with no breakeven clause", () => {
    const r = carryReadout("3M", fig(0.2, -0.1), "pay");
    expect(r.totalText).toBe("거의 없음");
    expect(r.total).toBeNull(); // no direction colour for a non-figure
    expect(r.detail).toBe("캐리 +0.2 · 롤 −0.1");
    expect(r.detail).not.toContain("본전");
    expect(NEAR_ZERO_BP).toBe(0.5);
    // just above the threshold a real figure prints again
    expect(carryReadout("3M", fig(0.4, 0.2), "pay").kind).toBe("figure");
  });

  it("an instrument maturing inside the horizon states that, not a zero", () => {
    const r = carryReadout("1Y", null, "pay");
    expect(r.kind).toBe("none");
    expect(r.totalText).toBe("—");
    expect(r.detail).toBe("만기 도래");
  });
});

describe("Receive is the exact negation of Pay", () => {
  it("negates the total and both components", () => {
    const pay = carryReadout("3M", fig(-4.7, -1.4), "pay");
    const rec = carryReadout("3M", fig(-4.7, -1.4), "receive");
    expect(rec.total).toBeCloseTo(-(pay.total ?? 0), 9);
    expect(pay.detail).toContain("캐리 −4.7 · 롤 −1.4");
    expect(rec.detail).toContain("캐리 +4.7 · 롤 +1.4");
  });
});

describe("no scores, ratings, or prediction language anywhere in the panel", () => {
  const src =
    readFileSync(join(__dirname, "..", "src", "ui", "CarryPanel.tsx"), "utf8") +
    readFileSync(join(__dirname, "..", "src", "ui", "carryCopy.ts"), "utf8");
  it("bans the judgement-compression vocabulary", () => {
    for (const banned of ["★", "점수", "등급", "추천", "예상", "전망"]) {
      expect(src).not.toContain(banned);
    }
  });
});
