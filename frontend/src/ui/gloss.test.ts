/* Pins the instrument gloss copy + construct naming.
 *
 * The pinned register is 해요체, one fact per sentence [OWNER, 2026-08-05].
 * This REPLACES the previous note here ("must not drift into something
 * friendlier"), which pinned 합니다체 and was written when the softer register
 * was the failure mode. It no longer is: the owner reversed the Session 15
 * migration to cut reading load. The strings below were rewritten as a
 * deliberate act, not adjusted until this file passed.
 *
 * What this test still guards is VOCABULARY, which did NOT move: 버터플라이,
 * 벨리, 윙, 스티프닝, 플래트닝, 파 금리, 내재 선도금리 appear verbatim. A
 * rewrite that reaches for 나비 / 양옆 / 싼지 비싼지 fails here (§15 용어). */

import { describe, expect, it } from "vitest";

import { classify, instrumentGloss, instrumentSubtitle, tenorKo } from "./gloss";
import type { Group, Row } from "./rows";

function row(id: string, group: Group): Row {
  return {
    id,
    label: id,
    group,
    unit: group === "vol" ? "ratio" : group === "outright" ? "%" : "bp",
    now: 1,
    changes: { d1: 0, mtd: 0, ytd: 0 },
    pct: null,
    seriesId: id,
    rangeHigh: 4,
    key: true,
    rangeLow: 2,
    rangeAvg: 3,
    sortKey: [1],
    movePct: null,
  };
}

describe("instrument classification", () => {
  it("reads kind + legs from group and id", () => {
    expect(classify(row("10Y", "outright"))).toEqual({ kind: "outright", tenor: "10Y" });
    expect(classify(row("1D", "outright"))).toEqual({ kind: "call" });
    expect(classify(row("1Y-10Y", "spread"))).toEqual({ kind: "spread", short: "1Y", long: "10Y" });
    expect(classify(row("1Y-2Y-10Y", "spread"))).toEqual({
      kind: "butterfly", short: "1Y", belly: "2Y", long: "10Y",
    });
    expect(classify(row("6Mx3M", "forward"))).toEqual({ kind: "forward", start: "6M", tenor: "3M" });
    expect(classify(row("vol:10Y", "vol"))).toEqual({ kind: "volatility", tenor: "10Y" });
  });
});

describe("tenorKo", () => {
  it("renders durations in Korean", () => {
    expect(tenorKo("10Y")).toBe("10년");
    expect(tenorKo("1.5Y")).toBe("1년 6개월");
    expect(tenorKo("1Y3M")).toBe("1년 3개월");
    expect(tenorKo("6M")).toBe("6개월");
    expect(tenorKo("1D")).toBe("1일");
    expect(tenorKo("ON")).toBe("익일");
  });
});

describe("subtitle names the construct", () => {
  it("matches the spec examples", () => {
    expect(instrumentSubtitle(row("1Y-2Y-10Y", "spread"))).toBe("1Y·2Y·10Y 버터플라이");
    expect(instrumentSubtitle(row("6Mx3M", "forward"))).toBe("6개월 후 3개월 선도금리");
    expect(instrumentSubtitle(row("10Y", "outright"))).toBe("10년 만기 IRS 파 금리");
  });
});

describe("gloss copy is exactly the owner wording (do not paraphrase)", () => {
  it("outright", () => {
    expect(instrumentGloss(row("10Y", "outright"))).toBe(
      "10년 만기 KRW IRS 파 금리예요. CD 91일물을 변동금리로 교환하는 조건이에요. 국내 IRS 시장의 표준 호가예요.",
    );
  });
  it("spread", () => {
    expect(instrumentGloss(row("1Y-10Y", "spread"))).toBe(
      "1Y·10Y 커브 스프레드예요. 10Y에서 1Y를 뺀 값이에요. 확대는 스티프닝, 축소는 플래트닝이에요.",
    );
  });
  it("butterfly", () => {
    expect(instrumentGloss(row("1Y-2Y-10Y", "spread"))).toBe(
      "1Y·2Y·10Y 버터플라이예요. 2Y 금리의 두 배에서 1Y와 10Y를 뺀 값이에요. 확대되면 벨리가 윙 대비 약세, 축소되면 강세예요.",
    );
  });
  it("forward", () => {
    expect(instrumentGloss(row("6Mx3M", "forward"))).toBe(
      "6개월 후 시작하는 3개월 내재 선도금리예요. 현재 커브에서 도출해요. 해당 구간에 대한 시장의 기대 금리를 나타내요.",
    );
  });
  it("volatility", () => {
    expect(instrumentGloss(row("vol:10Y", "vol"))).toBe(
      "최근 5일 평균 변동폭을 60일 평균으로 나눈 상대 변동성 지표예요. 1을 넘으면 단기 변동성이 장기 평균보다 확대된 상태예요.",
    );
  });
});

describe("every gloss is one fact per sentence [OWNER, 2026-08-05]", () => {
  /* The failure this replaces: three facts welded into one 120자 string. A
   * sentence here may carry a 확대/축소 pair (one sign convention), so the
   * check is length per sentence, not clause count — a sentence that grows
   * past ~45자 has picked up a second fact again. */
  const samples = [
    row("1D", "outright"),
    row("10Y", "outright"),
    row("1Y-10Y", "spread"),
    row("1Y-2Y-10Y", "spread"),
    row("6Mx3M", "forward"),
    row("vol:10Y", "vol"),
  ];
  for (const r of samples) {
    it(`${r.id} splits its facts`, () => {
      for (const s of instrumentGloss(r).split(". ")) {
        expect(s.length, `sentence too long, likely two facts: "${s}"`)
          .toBeLessThanOrEqual(45);
      }
    });
  }
});

describe("the register is 해요체, and the vocabulary did not move with it", () => {
  it("no gloss reverts to 합니다체", () => {
    for (const r of [
      row("10Y", "outright"),
      row("1Y-10Y", "spread"),
      row("1Y-2Y-10Y", "spread"),
      row("6Mx3M", "forward"),
      row("vol:10Y", "vol"),
    ]) {
      expect(instrumentGloss(r)).not.toMatch(/입니다|습니다|합니다/);
    }
  });

  it("market terms survive the register change verbatim (§15 용어)", () => {
    expect(instrumentGloss(row("1Y-2Y-10Y", "spread"))).toContain("버터플라이");
    expect(instrumentGloss(row("1Y-2Y-10Y", "spread"))).toContain("벨리");
    expect(instrumentGloss(row("1Y-2Y-10Y", "spread"))).toContain("윙");
    expect(instrumentGloss(row("1Y-10Y", "spread"))).toContain("스티프닝");
    expect(instrumentGloss(row("1Y-10Y", "spread"))).toContain("플래트닝");
    expect(instrumentGloss(row("6Mx3M", "forward"))).toContain("내재 선도금리");
    expect(instrumentGloss(row("10Y", "outright"))).toContain("파 금리");
  });

  it("the banned everyday paraphrases stay banned", () => {
    for (const r of samples()) {
      expect(instrumentGloss(r)).not.toMatch(/나비|양옆|싼지|비싼지|거친지/);
    }
  });

  function samples() {
    return [
      row("1D", "outright"),
      row("10Y", "outright"),
      row("1Y-10Y", "spread"),
      row("1Y-2Y-10Y", "spread"),
      row("6Mx3M", "forward"),
      row("vol:10Y", "vol"),
    ];
  }
});
