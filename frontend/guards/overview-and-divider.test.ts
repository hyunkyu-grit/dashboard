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
