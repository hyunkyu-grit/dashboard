/* Guard: the 전체 overview, the 주요/전체 divider, and instrument labelling
 * (2026-07-31 session).
 *
 * These three landed together and share one failure mode: a set that LOOKS
 * populated but is not the owner's. A divider over the wrong rows, a column
 * quietly missing an instrument, or a butterfly labelled `6Ms9Ms1s` all render
 * without error.
 */

import { describe, expect, it } from "vitest";

import { code } from "./_source";
import {
  BASIS_ORDER,
  GROUP_LABEL,
  OVERVIEW_GROUPS,
  orderRows,
  traderName,
  type Group,
  type Row,
} from "../src/ui/rows";

const table = code("ui/InstrumentTable.tsx");
const overview = code("ui/OverviewColumns.tsx");
const app = code("ui/App.tsx");

function row(id: string, group: Group, key: boolean, sort: number[]): Row {
  return {
    id,
    label: id,
    group,
    unit: group === "outright" ? "%" : "bp",
    now: 1,
    changes: { d1: 0, mtd: 0, ytd: 0 },
    pct: null,
    seriesId: id,
    rangeHigh: 2,
    rangeLow: 0,
    rangeAvg: 1,
    sortKey: sort,
    movePct: null,
    key,
  };
}

describe("instrument labelling (traderName)", () => {
  it("all-year legs get trader shorthand", () => {
    expect(traderName("1Y-10Y")).toBe("1s10s");
    expect(traderName("2Y-5Y-10Y")).toBe("2s5s10s");
    expect(traderName("1Y-1.5Y-2Y")).toBe("1s1.5s2s");
  });

  it("a month leg keeps its unit and joins on a slash", () => {
    /* The regression this exists for: the old rule stripped a trailing "Y"
     * and appended "s" unconditionally, so the 6M/9M/1Y butterfly — one of
     * the four 주요 flies — came out `6Ms9Ms1s`. That is not shorthand for
     * anything, and it would have shipped looking like a real ticker. */
    expect(traderName("6M-9M-1Y")).toBe("6M/9M/1Y");
    expect(traderName("6M-1Y")).toBe("6M/1Y");
    expect(traderName("6M-9M-1Y")).not.toMatch(/Ms/);
  });
});

describe("the 주요/전체 divider", () => {
  it("주요 rows sort ahead of 전체 rows when the tab divides", () => {
    const rows = [
      row("b", "spread", false, [2]),
      row("a", "spread", true, [9]), // 주요 but a LATER sort key
    ];
    expect(orderRows(rows, null, false, true).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("a sorted change column overrides the pin", () => {
    /* Deliberate: "what moved most" is asked of the whole tab. The component
     * suppresses the headings in the same state, so the divider and the order
     * can never disagree — assert the ordering half here and the suppression
     * half below. */
    const rows = [
      { ...row("b", "spread", false, [2]), changes: { d1: 9, mtd: 0, ytd: 0 } },
      { ...row("a", "spread", true, [1]), changes: { d1: 1, mtd: 0, ytd: 0 } },
    ];
    expect(orderRows(rows, "d1", false, true).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("the headings are suppressed while a change column is sorted", () => {
    expect(table).toMatch(/if \(!divided \|\| sortCol\)/);
  });

  it("a heading is never drawn over a block with no counterpart", () => {
    // a screener can filter one side away entirely; a lone 주요 or 전체
    // heading would then state a split that is not on screen
    expect(table).toMatch(/shown\.some\(\(r\) => r\.key !== row\.key\)/);
  });

  it("every instrument tab divides; 변동성 and 전체 do not", () => {
    expect(table).toMatch(
      /const DIVIDED: Group\[\] = \["outright", "spread", "fly", "forward"\]/,
    );
  });
});

describe("the 전체 overview", () => {
  it("is three groups, outright / spread / forward, in that order", () => {
    expect(OVERVIEW_GROUPS).toEqual(["outright", "spread", "forward"]);
  });

  it("butterflies and volatility are NOT in it", () => {
    expect(OVERVIEW_GROUPS).not.toContain("fly");
    expect(OVERVIEW_GROUPS).not.toContain("vol");
  });

  it("shows only 주요 rows of each group", () => {
    expect(overview).toMatch(/r\.group === group && r\.key/);
  });

  it("takes the full surface — the side preview is hidden beside it", () => {
    /* One flag widens the left pane AND hides the right one, so the two
     * cannot disagree about who owns the width (the matrix mode's mechanism,
     * reused). If these drift apart the overview renders in an 880px column
     * with three 8-column tables crushed inside it. */
    expect(app).toMatch(/const fullWidth = matrixOpen \|\| tab === "all"/);
    expect(app).toMatch(/wide && !fullWidth \? \{ width: TABLE_W \}/);
    expect(app).toMatch(/\{wide && !fullWidth && \(/);
  });

  it("each column owns its own chart", () => {
    // per-column selection state, not one lifted selection shared by three
    expect(overview).toMatch(/const \[selectedId, setSelectedId\] = useState/);
    expect(overview).toContain("<ColumnChartSlot");
  });

  it("reconciles the selection during render, never in an effect", () => {
    // setState-in-effect is lint-banned in this repo and the derivation is
    // simpler anyway — see the comment at the call site
    expect(overview).toMatch(/shown\.find\(\(r\) => r\.id === selectedId\) \?\? shown\[0\]/);
    expect(overview).not.toMatch(/setSelectedId\(null\)/);
  });

  it("prints all six figures — it never drops a column to fit", () => {
    /* The table drops columns when space runs out; the overview must not.
     * Showing 어제·MTD·YTD·52주 고/저/평 at once is the entire reason the tab
     * exists, so it sets smaller type instead and stacks below the two-pane
     * breakpoint. */
    for (const b of BASIS_ORDER) expect(overview).toContain(`row.changes.${b}`);
    expect(overview).toContain("row.rangeHigh");
    expect(overview).toContain("row.rangeLow");
    expect(overview).toContain("row.rangeAvg");
    expect(overview).not.toContain("visibleColumns");
  });

  it("the 52주 figures go through rangeText, keeping the parity guard real", () => {
    expect(overview).toMatch(/rangeText\(row\.rangeHigh, row\.unit\)/);
    expect(overview).not.toMatch(/levelText\(\{ \.\.\.row/);
  });

  it("sets the table's type size, not a smaller one", () => {
    /* Shipped at 11px on the theory that three tables side by side had to be
     * small; on screen it just read as small, and the tracks fit 13px with
     * room over. `ch` resolves against the element's OWN font-size, so a
     * stray size on the grid container silently resizes every track. */
    // 12px is allowed for the one CAPTION (the dataset date above the grid),
    // which is chrome and matches the freshness chip; the banned sizes are the
    // ones the ROWS shipped at.
    expect(overview).not.toMatch(/text-\[1[01]px\]/);
    expect(overview).toMatch(/text-\[13px\]/);
  });

  it("no track is widened by a header the column does not print", () => {
    // the ten-glyph ISO date used to size the six-glyph level column, and the
    // surplus showed as a gap right after 종목 — three times over. The date is
    // stated once above the grid instead.
    expect(overview).toMatch(/const GRID = "7ch 6\.5ch/);
    expect(overview).toMatch(/levelHeadText\(asOf\)\} 종가 기준/);
  });

  it("the chart is measured OUT OF FLOW — the loop that broke the page", () => {
    /* Sizing an in-flow child from a ResizeObserver on its own parent is a
     * feedback loop: the chart grows to the measured height, which grows the
     * box, which reports larger. It does not settle — it ran the charts off
     * the bottom of the page. Absolute positioning is what makes the loop
     * impossible, so it is asserted rather than left to look like styling. */
    expect(overview).toMatch(/className="absolute inset-x-0 bottom-0"/);
    expect(overview).toMatch(/relative mt-auto min-h-0 min-w-0 flex-1/);
  });

  it("the three charts are one height and one baseline", () => {
    // the shortest column decides, so a 10-row list and a 6-row list do not
    // produce charts of two sizes; the slack sits ABOVE the shorter chart
    expect(overview).toMatch(/Math\.min\(\.\.\.reported\)/);
    expect(overview).toMatch(/\(sharedH \?\? box\.h\) - 20/);
  });

  it("columns hug their content — the gap between them is the grid gap", () => {
    /* Equal thirds put ~145px of trailing slack between one column's last
     * number and the next column's first: the widest gap on screen, three
     * times over, in the place with nothing in it. */
    expect(overview).toMatch(/lg:grid-cols-\[repeat\(3,max-content\)\]/);
    expect(overview).not.toMatch(/repeat\(3,minmax\(0,1fr\)\)/);
  });

  it("the charts sit on the floor of the column", () => {
    expect(overview).toContain("mt-auto");
    expect(overview).toMatch(/flex h-full min-w-0 flex-col/);
  });

  it("the overview fills the container with flex, never min-h-full", () => {
    // a percentage min-height resolves against the CONTENT box while the
    // scroll container's pt-3/pb-8 sit outside it — min-h-full overshoots by
    // 44px and puts a permanent scrollbar on a page that fits
    expect(overview).not.toContain("min-h-full");
    expect(table).toMatch(/isOverview \? "flex flex-col" : ""/);
  });
});

describe("the tab set", () => {
  it("butterfly is its own tab, between 스프레드 and 포워드", () => {
    expect(GROUP_LABEL.fly).toBe("버터플라이");
    const order = ["all", "outright", "spread", "fly", "forward", "vol"];
    const found = [...table.matchAll(/\{ id: "(\w+)", label:/g)].map((m) => m[1]);
    expect(found).toEqual(order);
  });
});

describe("the change bases", () => {
  it("are three: 어제, MTD, YTD", () => {
    expect(BASIS_ORDER).toEqual(["d1", "mtd", "ytd"]);
  });

  it("WTD and QTD are gone from the table's headers", () => {
    expect(table).not.toMatch(/wtd|qtd|WTD|QTD/);
  });
});
