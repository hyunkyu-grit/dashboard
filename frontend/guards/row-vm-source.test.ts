/* Guard (§16 — the computation boundary): the row view-model builder turns the
 * API's numbers into a row shape; it must not COMPUTE any of them. Every field
 * a built row carries has to be declared in `ROW_FIELD_SOURCE` as either `dto`
 * (read straight from the API) or `format` (pure presentation). A field that
 * would need arithmetic on market data has no honest declaration — it belongs
 * in the backend. This test fires the moment a new, undeclared field appears on
 * a row, and additionally checks that `dto` fields are passed through
 * unchanged, so arithmetic can't hide inside the builder. */

import { describe, expect, it } from "vitest";

import type {
  ForwardsPayload,
  OneLiner,
  SeriesSummary,
  WallSummary,
} from "../src/lib/api";
import { buildRows, ROW_FIELD_SOURCE } from "../src/ui/rows";

const EXTREME: OneLiner = { kind: "extreme", value: 99 };
const NONE: OneLiner = { kind: "none", value: null };
const deltas = { d1: 2, wtd: -3, mtd: 4, qtd: -5, ytd: 6 };

const src: SeriesSummary = {
  id: "10Y",
  label: "IRS 10Y",
  kind: "outright",
  unit: "%",
  now: 3.1234,
  deltas: { ...deltas },
  basisValues: { d1: 3, wtd: 3, mtd: 3, qtd: 3, ytd: 3 },
  range10y: { min: 1, max: 5, pct: 99 },
  sortKey: [10],
  quoted: true,
  movePct: 42,
  oneLiner: EXTREME,
  spark: [],
};

const summary: WallSummary = {
  asof: "2026-07-27",
  basisDates: { d1: null, wtd: null, mtd: null, qtd: null, ytd: null },
  specNodeOrder: [],
  displayTenors: [],
  missingNodes: [],
  outrights: [src],
  derived: [{ ...src, id: "1Y-10Y", kind: "spread", unit: "bp", quoted: null, sortKey: [1, 10] }],
  events: [],
};

const forwards: ForwardsPayload = {
  asof: "2026-07-27",
  basisDates: { d1: null, wtd: null, mtd: null, qtd: null, ytd: null },
  startPoints: [{ label: "1Y", t: 1, date: "2027-07-27" }],
  tenors: ["1YF"],
  grid: {
    "1YF": [
      {
        start: "1Y",
        live: true,
        values: { now: 3 },
        deltas: { ...deltas },
        sortKey: [1, 1],
        oneLiner: NONE,
        keyForward: true,
      },
    ],
  } as ForwardsPayload["grid"],
  keyForwards: [],
};

describe("row view-model source boundary (§16)", () => {
  const rows = buildRows(summary, forwards);

  it("builds rows across groups", () => {
    expect(rows.length).toBeGreaterThan(2);
  });

  it("every field a built row carries is declared in ROW_FIELD_SOURCE", () => {
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        expect(
          key in ROW_FIELD_SOURCE,
          `Row field "${key}" is undeclared — classify it dto|format in ` +
            `ROW_FIELD_SOURCE. A field that needs a calculation belongs in the ` +
            `backend (§16), not the row builder.`,
        ).toBe(true);
      }
    }
  });

  it("provenance is only dto or format — there is no client-compute lane", () => {
    for (const [k, v] of Object.entries(ROW_FIELD_SOURCE)) {
      expect(["dto", "format"], `${k} has an illegal provenance`).toContain(v);
    }
  });

  it("dto-sourced fields are passed through unchanged (no hidden arithmetic)", () => {
    const row = rows.find((r) => r.id === src.id)!;
    expect(row.now).toBe(src.now);
    expect(row.unit).toBe(src.unit);
    expect(row.pct).toBe(src.range10y.pct);
    expect(row.changes).toEqual(src.deltas);
    expect(row.sortKey).toEqual(src.sortKey);
    expect(row.quoted).toBe(src.quoted);
  });

  it("the 한 줄 is rendered from the classification, never recomputed", () => {
    // backend said {kind:"extreme", value:99}; the browser only phrases it.
    const row = rows.find((r) => r.id === src.id)!;
    expect(row.oneLiner).toBe("백분위 99");
  });
});
