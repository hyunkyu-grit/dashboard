/* Guard (§C): the popup must render at least every readout the preview does.
 * A larger view with fewer readouts is the defect this catches — it stops the
 * next feature from landing on only one surface. Mechanically: the popup's
 * declared readout set must be a superset of the preview's.
 *
 * Extended in pass L to the table's two LEVEL surfaces. 현재 and the 52-week
 * high/low/mean are the same quantity in the same unit, so they must print
 * IDENTICALLY — byte for byte, for every instrument kind. The failure this
 * pins has already shipped in this repo once: the carry & roll block rounded
 * its components and its headline separately and the parts summed to −3.2
 * against a −3.1 total, purely from display digits. */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import type { Unit } from "../src/lib/api";
import { levelText, rangeText } from "../src/ui/cells";
import { POPUP_READOUTS, PREVIEW_READOUTS } from "../src/ui/readouts";
import type { Row } from "../src/ui/rows";

describe("the popup is a superset of the preview (§C)", () => {
  it("every preview readout is also in the popup", () => {
    const popup = new Set(POPUP_READOUTS);
    for (const r of PREVIEW_READOUTS) {
      expect(popup.has(r), `popup is missing the preview readout "${r}"`).toBe(true);
    }
  });
});

describe("현재 and the 52-week stats are one grammar (pass L)", () => {
  // one row per instrument kind, each with its own unit; the level itself is
  // irrelevant to the formatter beyond its unit, which is the point
  const KINDS: { kind: string; unit: Unit }[] = [
    { kind: "outright", unit: "%" },
    { kind: "forward", unit: "%" },
    { kind: "spread", unit: "bp" },
    { kind: "fly", unit: "bp" },
    { kind: "volatility", unit: "ratio" },
  ];

  // values chosen to exercise every branch of the display grammar: a plain
  // rate, a negative bp spread, a value that rounds at the 4th decimal, a
  // trailing-zero case, an integer, zero, and the null placeholder
  const VALUES: (number | null)[] = [
    3.1234, -100.5, 4.24455, 2.5, 0, 12, -0.00004, 999.9999, null,
  ];

  function rowWith(now: number | null, unit: Unit): Row {
    return {
      id: "x",
      label: "x",
      group: "outright",
      unit,
      now,
      changes: { d1: null, wtd: null, mtd: null, qtd: null, ytd: null },
      pct: null,
      seriesId: null,
      rangeHigh: null,
      rangeLow: null,
      rangeAvg: null,
      sortKey: [1],
      movePct: null,
    };
  }

  it("the two paths agree byte for byte on every kind and every value", () => {
    for (const { kind, unit } of KINDS) {
      for (const v of VALUES) {
        const viaLevel = levelText(rowWith(v, unit));
        const viaRange = rangeText(v, unit);
        expect(
          viaRange,
          `${kind} (${unit}) at ${v}: 현재 printed "${viaLevel}" but the ` +
            `52-week cell printed "${viaRange}" — one quantity, two roundings`,
        ).toBe(viaLevel);
      }
    }
  });

  it("the null placeholder is the same em dash on both paths", () => {
    for (const { unit } of KINDS) {
      expect(rangeText(null, unit)).toBe(levelText(rowWith(null, unit)));
      expect(rangeText(null, unit)).toBe("—");
    }
  });

  it("neither surface reimplements the rounding", () => {
    // `identifiers` would blank the class strings we do not care about here;
    // `code` keeps them and still strips the comments above, which name
    // toFixed on purpose.
    for (const f of ["ui/cells.ts", "ui/RangeCells.tsx", "ui/InstrumentTable.tsx"]) {
      expect(code(f), `${f} rounds for display itself`).not.toMatch(/toFixed/);
    }
    // and both wrappers route to the ONE formatter
    expect(code("ui/cells.ts")).toContain("fmtLevel");
    expect((code("ui/cells.ts").match(/fmtLevel\(/g) ?? []).length).toBe(2);
  });
});
