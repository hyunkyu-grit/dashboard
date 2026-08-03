/* Guard (pass L): the 52-week high/low/mean column is INK and INERT.
 *
 * Two properties, and both are easy to lose to a well-meaning edit:
 *
 * 1. **No colour.** These are LEVELS. Hue in this product means the sign of a
 *    CHANGE (§5 channel budget, §9 direction) — that is why 현재 is ink too. A
 *    tint on a level would spend the one meaningful colour channel on a
 *    quantity that has no direction, and the reader would start looking for a
 *    meaning that is not there.
 *
 * 2. **No sort.** Three statistics do not rank rows, so the column has no sort
 *    key and its header is not a control: no button, no hover state promising
 *    one, and a click that changes nothing. That silence is deliberate and is
 *    NOT the same condition as a ROW with no sort key, which must still fail
 *    loudly to a non-finite key so it lands visibly at the end (§6,
 *    guards/sort-key.test.ts). A column that cannot be sorted and a row that
 *    cannot be placed are different failures; only the second should shout.
 *
 * `code()` — the banned things here are class names and JSX attributes, which
 * live in strings, so a string occurrence IS the violation. Comments are
 * stripped, so the paragraphs above (which name every banned token) cannot
 * trip their own guard. */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import type { BasisKey, SeriesSummary, WallSummary } from "../src/lib/api";
import { RANGE_LABELS, rangeValues } from "../src/ui/RangeCells";
import { buildRows, orderRows, type Row } from "../src/ui/rows";

const src = code("ui/RangeCells.tsx");
const table = code("ui/InstrumentTable.tsx");

describe("the cell carries no colour or tint (§5)", () => {
  // every way this product expresses hue or emphasis on a number
  const COLOUR_TOKENS = [
    "text-up",
    "text-down",
    "text-flat",
    "bg-up",
    "bg-down",
    "dirClass",
    "columnCue",
    "matrixTint",
    "tintStyle",
    "--bw-up",
    "--bw-down",
    "--chart-",
    "opacity-",
    "font-bold",
    "font-semibold",
  ];

  it("no colour, tint or emphasis token appears in the cell", () => {
    for (const t of COLOUR_TOKENS) {
      expect(src, `RangeCells.tsx uses "${t}" — a level has no direction`)
        .not.toContain(t);
    }
  });

  it("the body values are plain ink; only the header and the note are muted", () => {
    // exactly three text-colour declarations in the file: the header's
    // text-ink/50 (the same muting every other column header uses), the
    // hidden-column note's text-ink/45 (the table's own note idiom), and the
    // body cell's plain text-ink. A fourth would be something new on the
    // numbers. The track's bg-ink/25 hairline and bg-ink marker are ink at
    // alpha too — a graphic of a level is still a level (§5).
    expect(src.match(/text-ink[^"\s]*/g)).toEqual([
      "text-ink/50",
      "text-ink/45",
      "text-ink",
    ]);
    expect(src.match(/bg-ink[^"\s]*/g)).toEqual(["bg-ink/25", "bg-ink"]);
    // Three inline styles: the two copies of the shared sub-grid template
    // (header and body, one definition, exactly as the table's outer grid
    // works) and the track marker's position — which is a percentage of the
    // track, derived in markerPct from the same values the numbers print,
    // never a per-value colour or width.
    expect((src.match(/style=\{/g) ?? []).length).toBe(3);
    expect((src.match(/gridTemplateColumns: rangeTemplate\(slider\)/g) ?? []).length).toBe(2);
    expect(src).toMatch(/style=\{\{ left: `\$\{pct\}%` \}\}/);
  });
});

describe("the column carries no sort affordance", () => {
  const INTERACTIVE = [
    "<button",
    "onClick",
    "clickSort",
    "cursor-pointer",
    "hover:",
    'role="button"',
    "tabIndex",
    "aria-sort",
  ];

  it("nothing in the cell or its header is clickable or hoverable", () => {
    for (const t of INTERACTIVE) {
      expect(src, `RangeCells.tsx contains "${t}" — the column is not a control`)
        .not.toContain(t);
    }
  });

  it("the table wires clickSort to the change columns and nowhere else", () => {
    // exactly one call site, and it is inside the loop over visible.bases —
    // the change columns (the arrow-function definition is `clickSort = (b`,
    // which this deliberately does not match)
    expect((table.match(/clickSort\(/g) ?? []).length).toBe(1);
    const headerLoop = table.slice(
      table.indexOf("visible.bases.map", table.indexOf("columnheader")),
    );
    expect(headerLoop.indexOf("clickSort(")).toBeGreaterThan(-1);
    // the range header carries LAYOUT props only (which tracks show, the
    // hidden-column note) and never a handler — it is still not a control
    const headerTag = /<RangeHeader\b[^>]*>|<RangeHeader\b[\s\S]*?\/>/.exec(table)?.[0] ?? "";
    expect(headerTag).not.toBe("");
    expect(headerTag).not.toMatch(/on[A-Z]/);
  });

  it("header and body resolve the shared sub-grid at the SAME font size", () => {
    // RANGE_TEMPLATE is written in `ch`, which resolves against the element's
    // OWN font size. A text size on either GRID CONTAINER therefore silently
    // gives that grid different tracks from the other one. It shipped once in
    // this pass: `text-[11px]` on the header container made its tracks 63.3px
    // against the body's 70.4px and slid every label left of the numbers it
    // names — 7px, then 14px, then 21px. Nothing about that is visible in the
    // arithmetic, so it is asserted structurally: font sizing lives on the
    // SPANS, and neither element carrying `gridTemplateColumns` sets one.
    for (const line of src.split("\n")) {
      if (!line.includes("className=") || !line.includes("grid")) continue;
      expect(line, `a sub-grid container sizes its own text: ${line.trim()}`)
        .not.toMatch(/text-\[\d+px\]/);
    }
    // and the sizing that does exist is on a child
    expect(src).toMatch(/<span[\s\S]{0,160}text-\[11px\]/);
  });

  it("the header states three sub-labels, in high → low → mean order", () => {
    // the order does not read as a number line, so it has to be said
    expect(RANGE_LABELS.length).toBe(3);
    expect(RANGE_LABELS[0]).toContain("고점");
    expect(RANGE_LABELS[1]).toContain("저점");
    expect(RANGE_LABELS[2]).toContain("평균");
    // the window is named, once, on the first label
    expect(RANGE_LABELS[0]).toContain("52주");
  });
});

describe("a header click on this column leaves row order unchanged", () => {
  function summary(ids: string[]): WallSummary {
    const row = (id: string, i: number): SeriesSummary => ({
      id,
      label: id,
      kind: "outright",
      unit: "%",
      now: 3 + i,
      // magnitudes deliberately NOT monotonic in i, so a |change| sort
      // produces an order the default sort key never would
      deltas: (() => {
        const m = ((i * 7) % 5) + 1; // 1, 3, 5, 2, 4 across the five rows
        return { d1: m, mtd: m, ytd: m };
      })(),
      basisValues: { d1: 3, mtd: 3, ytd: 3 },
      range1y: { min: 1 + i, max: 9 - i, avg: 5, pct: 50 },
      sortKey: [i + 1],
      quoted: true,
      key: true,
      movePct: 50,
    });
    return {
      asof: "2026-07-29",
      basisDates: { d1: null, mtd: null, ytd: null },
      specNodeOrder: [],
      displayTenors: [],
      missingNodes: [],
      curveBanner: { kind: null },
      policy: { unit: "%" as const, asof: "2026-07-16", through: "2026-07-30",
      steps: [{ date: "2026-07-16", rate: 2.75 }], latest: 2.75, warnings: [] },
      outrights: ids.map(row),
      derived: [],
      events: [],
    };
  }

  const rows: Row[] = buildRows(summary(["1Y", "2Y", "3Y", "5Y", "10Y"]), undefined);
  const ids = (rs: Row[]) => rs.map((r) => r.id);
  const DEFAULT = ids(orderRows(rows, null, false, false));

  it("the sort state a range-header click can produce is: no sort state", () => {
    // `sortCol` is typed BasisKey | null and the range column is no BasisKey,
    // so the only state its header can leave the table in is the one it was
    // already in. Ordering under that state is the default order, before and
    // after any number of clicks.
    for (let click = 0; click < 3; click++) {
      expect(ids(orderRows(rows, null, false, false))).toEqual(DEFAULT);
      expect(ids(orderRows(rows, null, true, false))).toEqual(DEFAULT);
    }
    expect(DEFAULT).toEqual(["1Y", "2Y", "3Y", "5Y", "10Y"]);
  });

  it("but a CHANGE column does reorder — so the check above is not vacuous", () => {
    const bases: BasisKey[] = ["d1", "mtd", "ytd"];
    for (const b of bases) {
      const sorted = ids(orderRows(rows, b, false, false));
      expect(sorted, `sorting by ${b} changed nothing`).not.toEqual(DEFAULT);
      expect(ids(orderRows(rows, b, true, false))).toEqual([...sorted].reverse());
    }
  });

  it("the three values are read in the declared order, not re-derived", () => {
    const r = rows[0];
    expect(rangeValues(r)).toEqual([r.rangeHigh, r.rangeLow, r.rangeAvg]);
    // high really is the high: the fixture's max is above its min
    expect(r.rangeHigh!).toBeGreaterThan(r.rangeLow!);
  });
});
