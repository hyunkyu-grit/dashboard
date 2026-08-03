/* Guard (2026-08-03 verification): displayed money is additive where the
 * screen claims a sum.
 *
 * The server split is exact to the won (verified across 1,499 revaluation
 * points: worst |pnl − (val+carry)| = 1원). The lie lived in DISPLAY: fmtKrw
 * FLOORED each figure to the 만원, so the real book 평가 1,091,329,056 +
 * 캐리 823,973 = 1,092,153,029 printed as 9,132만 + 82만 against a 9,215만
 * total — off by one 만원 for any reader who adds the row. That is the same
 * defect class the old carry & roll block was deleted for ("components did
 * not sum to the total at the displayed precision").
 *
 * The fix has two parts, both pinned here: fmtKrw ROUNDS to the nearest
 * 만원 (symmetrically, so payer and receiver mirror), and the 손익 구성
 * table does its arithmetic in 만-units (`splitKrw`: carry IS total −
 * valuation) so every row sums across and the 합계 row is the column sum of
 * what is actually displayed.
 */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import {
  fmtKrw,
  fmtKrwFromMan,
  manUnits,
  splitKrw,
} from "../src/ui/BacktestSheet";

describe("the verified live case that exposed the floor", () => {
  it("평가 + 캐리 now reads 9,133만 + 82만 = 9,215만 — and it sums", () => {
    const u = splitKrw(1_092_153_029, 1_091_329_056);
    expect(fmtKrwFromMan(u.uVal)).toBe("+10억 9,133만원");
    expect(fmtKrwFromMan(u.uCarry)).toBe("+82만원");
    expect(fmtKrwFromMan(u.uPnl)).toBe("+10억 9,215만원");
    expect(u.uVal + u.uCarry).toBe(u.uPnl);
  });
});

describe("splitKrw is additive by construction, for any inputs", () => {
  it("uVal + uCarry === uPnl across a deterministic sweep", () => {
    // a pseudo-random-ish sweep over signs and magnitudes, incl. the
    // half-만원 boundaries where independent rounding goes wrong
    for (let k = 0; k < 500; k++) {
      const pnl = (k * 7_919_777 - 1_987_654_321) % 2_000_000_000;
      const val = (k * 104_729_331 - 999_999_999) % 2_000_000_000;
      const u = splitKrw(pnl, val);
      expect(u.uVal + u.uCarry).toBe(u.uPnl);
      expect(u.uPnl).toBe(manUnits(pnl));
      expect(u.uVal).toBe(manUnits(val));
    }
  });
});

describe("fmtKrw rounds to the nearest 만원 and mirrors under negation", () => {
  it("rounds, never floors", () => {
    expect(fmtKrw(1_091_329_056)).toBe("+10억 9,133만원"); // floor said 9,132
    expect(fmtKrw(825_900)).toBe("+83만원"); // floor said 82
    expect(fmtKrw(3_626_027)).toBe("+363만원"); // floor said 362
  });

  it("a payer and its mirror receiver print mirror figures", () => {
    for (const v of [15_000, 4_999, 825_900, 1_092_153_029, 99_995_000]) {
      const pos = fmtKrw(v);
      const neg = fmtKrw(-v);
      expect(neg).toBe(pos.replace(/^\+/, "−"));
    }
  });

  it("fmtKrw and the units twin are ONE grammar at or above a 만원", () => {
    for (const v of [10_000, -10_000, 825_900, 1_092_153_029, -73_450_000]) {
      expect(fmtKrw(v)).toBe(fmtKrwFromMan(manUnits(v)));
    }
    // below a 만원 the won branch keeps real money from reading as +0만원
    expect(fmtKrw(4_999)).toBe("+4,999원");
    expect(fmtKrw(-4_999)).toBe("−4,999원");
  });
});

describe("the 손익 구성 table actually uses the additive path", () => {
  it("rows and the 합계 row format units, never independent fmtKrw calls", () => {
    const src = code("ui/BacktestSheet.tsx");
    const table = src.slice(src.indexOf("손익 구성"), src.indexOf("자세히"));
    expect(table).toContain("splitKrw(");
    expect(table).toContain("fmtKrwFromMan(");
    // an independent rounding of carry inside this table is the regression
    expect(table).not.toMatch(/fmtKrw\(\s*p\.carry/);
    expect(table).not.toMatch(/fmtKrw\(\s*p\.valuation/);
    expect(table).not.toMatch(/fmtKrw\(\s*result\.pnl/);
  });
});
