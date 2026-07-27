/* Pins the instrument gloss copy + construct naming (Pass C1). The wording is
 * owner-specified and must not drift into something friendlier — this test
 * fails if it is paraphrased. */

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
    changes: { d1: 0, wtd: 0, mtd: 0, qtd: 0, ytd: 0 },
    pct: null,
    seriesId: id,
    oneLiner: "",
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
      "10년 만기 KRW IRS 파 금리입니다. CD 91일물을 변동금리로 교환하는 조건이며, 국내 IRS 시장의 표준 호가입니다.",
    );
  });
  it("spread", () => {
    expect(instrumentGloss(row("1Y-10Y", "spread"))).toBe(
      "1Y·10Y 커브 스프레드. 10Y에서 1Y를 뺀 값입니다. 확대는 스티프닝, 축소는 플래트닝을 뜻합니다.",
    );
  });
  it("butterfly", () => {
    expect(instrumentGloss(row("1Y-2Y-10Y", "spread"))).toBe(
      "1Y·2Y·10Y 버터플라이. 2Y 금리의 두 배에서 1Y와 10Y를 뺀 값입니다. 확대되면 벨리가 윙 대비 약세, 축소되면 강세입니다.",
    );
  });
  it("forward", () => {
    expect(instrumentGloss(row("6Mx3M", "forward"))).toBe(
      "6개월 후 시작하는 3개월 내재 선도금리입니다. 현재 커브에서 도출되며, 해당 구간에 대한 시장의 기대 금리를 나타냅니다.",
    );
  });
  it("volatility", () => {
    expect(instrumentGloss(row("vol:10Y", "vol"))).toBe(
      "최근 5일 평균 변동폭을 60일 평균으로 나눈 상대 변동성 지표입니다. 1을 넘으면 단기 변동성이 장기 평균보다 확대된 상태입니다.",
    );
  });
});
