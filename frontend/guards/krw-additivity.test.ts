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
} from "../src/ui/krw";

/* The ENGINE-LEVEL identity — |손익 − (평가 + 캐리)| ≤ 1원 — lives where the
 * engine does: backend test_carry_and_valuation_sum_to_the_pnl and the V1
 * telescoping sweep assert it on live runs. What THIS guard owns is the
 * boundary the frontend can actually break: the displayed split must stay
 * TIED TO THE RAW FIELDS the server sent. The first version of this file
 * asserted uVal + uCarry === uPnl where uCarry was DEFINED as uPnl − uVal —
 * vacuous by construction, it could never fail (V-PASS Phase 0 finding).
 * The non-vacuous statement: GIVEN a triple satisfying the server identity,
 * the derived display carry sits within ONE 만원 of the raw carry rounded
 * on its own — so the residual trick can never drift the printed 캐리 away
 * from what the engine computed, and re-deriving it any other way (the old
 * floor, an independent rounding) breaks this pin. */
describe("the displayed split stays tied to the raw engine fields", () => {
  it("the verified live triple: 9,133 + 82 = 9,215, and 82 IS the raw carry", () => {
    // raw fields from the audited run: val + carry == pnl to the won
    // (a 2-way triple — splitKrw's rolldown default 0 must reproduce the
    // exact pre-3분해 display, which is also the restored-old-result path)
    const pnl = 1_092_153_029;
    const val = 1_091_329_056;
    const carry = 823_973;
    expect(Math.abs(pnl - (val + carry))).toBeLessThanOrEqual(1);
    const u = splitKrw(pnl, val);
    expect(fmtKrwFromMan(u.uVal)).toBe("+10억 9,133만원");
    expect(u.uRoll).toBe(0);
    expect(u.uStart).toBe(0); // 구 세션 복원 경로도 그대로 보존된다
    expect(fmtKrwFromMan(u.uCarry)).toBe("+82만원");
    expect(fmtKrwFromMan(u.uPnl)).toBe("+10억 9,215만원");
    // the tie: the residual-derived carry equals the raw carry's own units
    expect(Math.abs(u.uCarry - manUnits(carry))).toBeLessThanOrEqual(1);
    expect(u.uCarry).toBe(manUnits(carry)); // exactly, on this triple
  });

  it("the tie holds across a deterministic sweep of identity-true quadruples", () => {
    // raw (val, carry, rolldown) triples over signs, magnitudes and half-만원
    // edges; pnl reconstructed WITH the server's ±1원 rounding slack, so the
    // sweep exercises exactly the inputs the API contract permits.
    // [2026-08-11 — 3분해] rolldown rounds on its own like valuation; carry
    // stays the residual, so its tie tolerance grows.
    // [2026-08-14 — 개시 분리] startup rounds on its own too, so THREE
    // independent roundings now sit between the residual carry and the raw
    // carry — the tolerance is three units.
    for (let k = 0; k < 500; k++) {
      const val = (k * 104_729_331 - 999_999_999) % 2_000_000_000;
      const carry = (k * 7_919_777 - 87_654_321) % 50_000_000;
      const roll = (k * 3_331_337 - 23_456_789) % 80_000_000;
      const start = (k * 1_299_709 - 6_543_211) % 4_000_000;
      const eps = (k % 3) - 1; // −1, 0, +1원 — the server's rounding slack
      const pnl = val + carry + roll + start + eps;
      const u = splitKrw(pnl, val, roll, start);
      expect(u.uPnl).toBe(manUnits(pnl));
      expect(u.uVal).toBe(manUnits(val));
      expect(u.uRoll).toBe(manUnits(roll));
      expect(u.uStart).toBe(manUnits(start));
      // the row still sums across at displayed precision, by construction
      expect(u.uVal + u.uRoll + u.uStart + u.uCarry).toBe(u.uPnl);
      expect(
        Math.abs(u.uCarry - manUnits(carry)),
        `raw carry ${carry} drifted from displayed at k=${k}`,
      ).toBeLessThanOrEqual(3);
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
    // `code()` — comments stripped so this file's own prose (which names the
    // banned calls) cannot trip the scan; the anchors are the table's OWN
    // header text and the fold that follows it, asserted present rather
    // than trusted, so a rename fails loudly instead of degrading the slice
    const src = code("ui/BacktestWindow.tsx");
    const from = src.indexOf("손익 구성");
    const to = src.indexOf("자세히");
    expect(from, "구성 table header not found — re-anchor this guard").toBeGreaterThan(-1);
    expect(to, "fold summary not found — re-anchor this guard").toBeGreaterThan(from);
    const table = src.slice(from, to);
    expect(table).toContain("splitKrw(");
    expect(table).toContain("fmtKrwFromMan(");
    // 개시 칸은 표에 서 있어야 한다 [OWNER, 2026-08-14]. 서버가 보낸 값을
    // 그리지 않으면 splitKrw 의 잔차인 캐리가 그 몴까지 조용히 먹는다 —
    // 숫자가 사라지는 것이 아니라 딱 잘못된 칸으로 간다.
    expect(table).toContain("uStart");
    expect(table).toContain("개시손익");
    // an independent rounding of any of the three figures inside this table
    // is the regression — the floor era, back under a new name
    expect(table).not.toMatch(/fmtKrw\(\s*p\.carry/);
    expect(table).not.toMatch(/fmtKrw\(\s*p\.valuation/);
    expect(table).not.toMatch(/fmtKrw\(\s*result\.pnl/);
    expect(table).not.toMatch(/toFixed/);
  });
});
