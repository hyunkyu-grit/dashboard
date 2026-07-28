/* Guard: the carry sentence (carry session, Pass C). Mechanics, not
 * prediction: the copy prints real numbers and nothing else — no scores, no
 * ratings, no badges. Receive is the EXACT negation of Pay, applied in the
 * copy layer from the wire's PAY-side figures so the diagram and the
 * sentence can never disagree. Near zero, the sentence refuses false
 * precision (NEAR_ZERO_BP, recorded in DESIGN). */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { carrySentence, NEAR_ZERO_BP } from "../src/ui/carryCopy";

const fig = (carry: number, roll: number) => ({
  carry,
  roll,
  total: carry + roll,
});

describe("the three sentence shapes", () => {
  it("positive: earns going in, with the curve-unchanged clause", () => {
    const s = carrySentence("3M", fig(2.8, 1.4), "pay");
    expect(s.headline).toBe("3개월 동안 4.2bp 벌고 들어갑니다");
    expect(s.tail).toBe("커브가 그대로일 때");
    expect(s.kind).toBe("earn");
  });

  it("negative: pays, with the break-even clause", () => {
    const s = carrySentence("3M", fig(-4.7, -1.4), "pay");
    expect(s.headline).toBe("3개월 동안 6.1bp 물고 갑니다");
    expect(s.tail).toBe("그만큼 움직여야 본전입니다");
    expect(s.kind).toBe("pay");
  });

  it("near zero: refuses false precision below the recorded threshold", () => {
    const s = carrySentence("3M", fig(0.2, -0.1), "pay");
    expect(s.headline).toBe("캐리는 거의 없습니다");
    expect(s.kind).toBe("flat");
    expect(NEAR_ZERO_BP).toBe(0.5);
    // just above the threshold a real figure prints
    expect(carrySentence("3M", fig(0.4, 0.2), "pay").kind).toBe("earn");
  });

  it("null figures: says the statement cannot be made, never zeros", () => {
    const s = carrySentence("1Y", null, "pay");
    expect(s.kind).toBe("none");
    expect(s.headline).toContain("셈할 수 없습니다");
  });
});

describe("Receive is the exact negation of Pay", () => {
  it("flips headline direction and negates both caption figures", () => {
    const pay = carrySentence("3M", fig(-4.7, -1.4), "pay");
    const rec = carrySentence("3M", fig(-4.7, -1.4), "receive");
    expect(pay.kind).toBe("pay");
    expect(rec.kind).toBe("earn");
    expect(rec.carry).toBeCloseTo(-pay.carry, 9);
    expect(rec.roll).toBeCloseTo(-pay.roll, 9);
    expect(rec.headline).toBe("3개월 동안 6.1bp 벌고 들어갑니다");
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
