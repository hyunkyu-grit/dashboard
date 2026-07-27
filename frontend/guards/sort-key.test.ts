/* Guard (§6): every instrument row must carry an explicit, finite numeric sort
 * key. The 3M-at-the-end bug happened because a tenor added after the original
 * set (CD91 / 3M) had no sort key and fell to the bottom. A row whose key is
 * empty, or contains Infinity/NaN (the "unknown tenor" sentinel from
 * tenorYears), is a silent-ordering failure — this test makes it a loud one. */

import { describe, expect, it } from "vitest";

import type {
  ForwardsPayload,
  OneLiner,
  SeriesSummary,
  WallSummary,
} from "../src/lib/api";
import { buildRows } from "../src/ui/rows";

const nullDeltas = { d1: 1, wtd: 1, mtd: 1, qtd: 1, ytd: 1 };
const NONE: OneLiner = { kind: "none", value: null };

// The sort key + quoted flag + classification now arrive from the backend (§16);
// these fixtures stand in for that DTO. `yr` mirrors the server tenor→years map.
const yr: Record<string, number> = {
  "1D": 1 / 365, "3M": 0.25, "6M": 0.5, "9M": 0.75, "1Y": 1, "1.5Y": 1.5,
  "2Y": 2, "3Y": 3, "4Y": 4, "5Y": 5, "6Y": 6, "7Y": 7, "8Y": 8, "9Y": 9,
  "10Y": 10,
};

function outright(id: string): SeriesSummary {
  return {
    id,
    label: id,
    kind: "outright",
    unit: "%",
    now: 3,
    deltas: { ...nullDeltas },
    basisValues: { d1: 3, wtd: 3, mtd: 3, qtd: 3, ytd: 3 },
    range10y: { min: 1, max: 5, pct: 50 },
    sortKey: id.split("-").map((t) => yr[t]),
    quoted: true,
    movePct: 50,
    oneLiner: NONE,
    spark: [],
  };
}

function derived(id: string, kind: "spread" | "fly"): SeriesSummary {
  return { ...outright(id), kind, unit: "bp", quoted: null };
}

function fwdCell(start: string, sortKey: number[]) {
  return {
    start,
    live: true,
    values: { now: 3 },
    deltas: { ...nullDeltas },
    sortKey,
    oneLiner: NONE,
    keyForward: false,
    movePct: null,
  };
}

// Cover every quoted node (incl. 3M/CD91, 1D, and the 1.5Y fractional tenor)
// plus interpolated tenors, a spread, and a butterfly.
const summary: WallSummary = {
  asof: "2026-07-24",
  basisDates: { d1: null, wtd: null, mtd: null, qtd: null, ytd: null },
  specNodeOrder: [],
  displayTenors: ["1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"],
  missingNodes: [],
  curveBanner: { kind: null },
  outrights: [
    "1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "4Y", "5Y",
    "6Y", "7Y", "8Y", "9Y", "10Y",
  ].map(outright),
  derived: [derived("1Y-10Y", "spread"), derived("2Y-5Y-10Y", "fly")],
  events: [],
};

const forwards: ForwardsPayload = {
  asof: "2026-07-24",
  basisDates: { d1: null, wtd: null, mtd: null, qtd: null, ytd: null },
  startPoints: [
    { label: "ON", t: 0, date: "2026-07-24" },
    { label: "2Y", t: 2, date: "2026-07-24" },
  ],
  tenors: ["1YF", "5YF"],
  grid: {
    "1YF": [
      fwdCell("ON", [0, 1]),
      fwdCell("2Y", [2, 1]),
    ],
    "5YF": [
      fwdCell("ON", [0, 5]),
      fwdCell("2Y", [2, 5]),
    ],
  } as ForwardsPayload["grid"],
  keyForwards: [],
};

describe("every row has an explicit numeric sort key (§6)", () => {
  const rows = buildRows(summary, forwards);

  it("builds rows across all groups", () => {
    expect(rows.length).toBeGreaterThan(15);
  });

  it("no row lacks a sort key or carries a non-finite entry", () => {
    for (const r of rows) {
      expect(r.sortKey.length, `${r.id} has an empty sort key`).toBeGreaterThan(0);
      for (const k of r.sortKey) {
        expect(
          Number.isFinite(k),
          `${r.id} sort key has a non-finite entry (unmapped tenor?): ${r.sortKey}`,
        ).toBe(true);
      }
    }
  });

  it("orders outrights tenor-ascending with 3M in second place, not last", () => {
    const outrights = rows
      .filter((r) => r.group === "outright")
      .sort((a, b) => {
        const n = Math.max(a.sortKey.length, b.sortKey.length);
        for (let i = 0; i < n; i++) {
          const av = a.sortKey[i] ?? -1;
          const bv = b.sortKey[i] ?? -1;
          if (av !== bv) return av - bv;
        }
        return 0;
      })
      .map((r) => r.id);
    expect(outrights[0]).toBe("1D");
    expect(outrights[1]).toBe("3M");
    expect(outrights[outrights.length - 1]).toBe("10Y");
  });
});
