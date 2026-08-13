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
import { GROUP_TABS, SECTIONS, sectionOf, tabForSection } from "../src/ui/tabs";

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
     * exists. It builds from ALL_COLUMNS and NEVER calls the width ladder —
     * that second clause is the load-bearing one and is asserted directly.
     *
     * 세타 (2026-08-13) is not a counter-example: `withThetaData` is the
     * applies/does-not-apply rule, not the ladder. A 스프레드 column has no
     * swap theta to print, and no width was consulted to decide that. */
    expect(overview).toMatch(/ALL_COLUMNS/);
    expect(overview).not.toContain("visibleColumns(");
    expect(overview).toMatch(/BASIS_ORDER\.map/);
  });

  it("IS the table's grid — it does not fork one", () => {
    /* The overview shipped with a bespoke eight-track grid at its own type
     * size, and that second definition of one thing drifted twice in a single
     * session: a level track sized by a header it did not print, and labels
     * clipped at three successive widths because `ch` is the ZERO advance and
     * `M` is not. The shared template had already solved both. */
    expect(overview).toMatch(/from "\.\/columns"/);
    expect(overview).toMatch(/<RangeCells row=\{row\} \/>/);
    expect(overview).toMatch(/<RangeHeader \/>/);
    // header and body resolve ONE template — never two literals
    expect((overview.match(/gridTemplateColumns: TEMPLATE/g) ?? []).length).toBe(2);
    // no private grid, no private type scale
    expect(overview).not.toMatch(/const GRID =/);
    expect(overview).not.toMatch(/\dch /);
  });

  it("prints the 52주 figures through the table's own component", () => {
    // RangeCells is the single path the readout-parity guard compares against
    // 현재; a local re-render of the three numbers would make it vacuous
    expect(overview).toContain("RangeCells");
    expect(overview).not.toMatch(/rangeText\(/);
    expect(overview).not.toMatch(/levelText\(\{ \.\.\.row/);
  });

  it("sets the table's type size — the same size every instrument tab uses", () => {
    /* It shipped at 11px, was raised to 16px when that read as small, landed
     * at 13px when the owner asked for parity with the tabs, and moved to 14
     * with the 2026-08-07 ladder bump. `ch` resolves against the element's OWN
     * font-size, so the size and the column widths are one decision, not two —
     * which is the argument for taking both from `columns.ts` rather than
     * setting either here.
     *
     * **파리티를 재고, 숫자를 재지 않는다** [2026-08-07]. 앞 판은 `13px` 을
     * 문자열로 박아 뒀는데, 그러면 사다리를 한 칸 올릴 때마다 이 가드가 파리티가
     * 깨져서가 아니라 숫자가 달라져서 빨간불이 된다 — 지키려던 것이 파리티였는데
     * 실제로 지킨 것은 13이었다. 이제 표에서 읽어 와 비교한다. */
    // 표의 사다리는 `role="table"` 을 진 요소가 한 번 정하고 행들이 물려받는다.
    // 그 요소에서 읽는다 — 다른 곳의 크기(스크리너 설명, 구분 헤딩)를 집으면
    // 파리티를 엉뚱한 것과 재게 된다.
    const tableSize = /role="table"[\s\S]{0,200}?text-\[(\d+)px\]/.exec(table)?.[1];
    expect(tableSize, "instrument table sets no explicit type size on role=table").toBeDefined();
    expect(overview).toMatch(new RegExp(`text-\\[${tableSize}px\\]`));
    // 그리고 그 하나뿐이다 — 개요가 자기 사다리를 따로 들면 파리티가 이름만 남는다
    const sizes = new Set(
      [...overview.matchAll(/text-\[(\d+)px\]/g)].map((m) => m[1]),
    );
    expect([...sizes]).toEqual([tableSize]);
  });

  it("heads the level column with the data's date, as the table does", () => {
    // pass M's rule: these are closes, so the header names the DAY rather
    // than reading 현재
    expect(overview).toMatch(/levelHeadText\(asOf\)/);
    expect(overview).not.toContain("현재</");
  });

  it("names each column with the tab's own 주요 heading", () => {
    expect(overview).toMatch(/주요 \{GROUP_LABEL\[group\]\}/);
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

  it("the three charts are one height BY CONSTRUCTION", () => {
    /* A constant, not a measured agreement. The previous version had each
     * column report its leftover height and took the minimum — which worked,
     * and was an apparatus that could disagree with itself. A constant cannot,
     * and it needs no height measurement at all, so the ResizeObserver
     * feedback loop has nothing to feed on. */
    expect(overview).toMatch(/const CHART_H = \d+;/);
    expect(overview).toMatch(/height=\{CHART_H\}/);
    expect(overview).not.toContain("sharedH");
    expect(overview).not.toContain("onAvail");
  });

  it("세 열이 폭을 나눠 진다 — 아무도 잘리지 않는다", () => {
    /* `max-content` + `justify-evenly` 였다 [OWNER, 2026-07-31 — 좌/중/우 고정,
     * 바깥 여백 = 안쪽 간격]. 그 배치는 폭이 남을 때만 성립한다: 세 열이 각자
     * 필요한 만큼 요구하므로 합이 화면보다 넓으면 셸의 `overflow-hidden` 에
     * **잘리고** 스크롤바도 안 생겨 오른쪽 열에 닿을 방법이 없다.
     * [OWNER, 2026-08-07 — "100%에서 잘린다"]
     *
     * `minmax(0,1fr)` 는 남는 폭을 나누는 것이 아니라 **모자란 폭을 나눠
     * 진다** — 셋이 같이 좁아진다. sauron.html `.ov` 가 그 값이다. 바깥 여백은
     * 이제 컨테이너의 거터가 지므로 `justify-*` 는 할 일이 없다. */
    expect(overview).toMatch(/lg:grid-cols-3/);
    expect(overview).not.toContain("max-content");
    expect(overview).not.toContain("justify-evenly");
    expect(overview).not.toContain("justify-between");
  });

  it("열 사이는 목업의 14px 간격이다", () => {
    // sauron.html `.ov { gap: 14px }`
    expect(overview).toMatch(/gap-3\.5/);
  });

  it("the charts sit on the floor of the column", () => {
    expect(overview).toContain("mt-auto");
    /* 열이 그룹박스가 됐다 [2026-08-07] — 높이를 채우는 일은 박스가 `h-full`
     * 로 하고, 그 안의 본문이 `flex-1 flex-col` 로 차트에 바닥을 준다. 주장은
     * 그대로다: 차트가 열 **바닥**에 앉아야 세 열의 차트가 한 선에 선다. */
    expect(overview).toMatch(/<GroupBox\s*\r?\n?\s*className="h-full"/);
    expect(overview).toMatch(/flex min-h-0 flex-1 flex-col px-3/);
  });

  it("the overview fills the container with flex, never min-h-full", () => {
    // a percentage min-height resolves against the CONTENT box while the
    // scroll container's pt-3/pb-8 sit outside it — min-h-full overshoots by
    // 44px and puts a permanent scrollbar on a page that fits
    expect(overview).not.toContain("min-h-full");
    /* 시뮬레이션 joined the overview on this branch (2026-08-07): both own
     * their layout and neither is the table, so they take the same arm.
     * 그 팔이 그룹박스 도입으로 세 갈래가 됐다 — 오버뷰·시뮬(박스 없음),
     * 연구실(박스 없음, 거터 있음), 행 목록(박스 안). */
    expect(table).toMatch(/isOverview\s*\r?\n?\s*\?\s*`flex flex-col pb-8 pt-3/);
  });
});

describe("the tab set", () => {
  it("butterfly is its own tab, between 스프레드 and 포워드", () => {
    expect(GROUP_LABEL.fly).toBe("버터플라이");
    /* 연구실 rides at the FAR RIGHT [OWNER, 2026-08-04] — the incubation
     * surface; its last position is pinned by guards/regret-list.
     * 시뮬레이션 sits just inside it (2026-08-07): finished work, so it goes
     * to the LEFT of the incubation surface, and the two must not swap.
     *
     * 탭이 사이드바가 되면서 "오른쪽"이 "아래"가 됐다 [2026-08-07]. 순서가
     * 확신의 순서라는 규칙은 그대로이고 축만 돌았다. 정의도 표에서 나가
     * ui/tabs.ts 로 갔으므로 소스를 정규식으로 긁는 대신 배열을 그대로
     * import 한다 — 표의 텍스트를 읽던 것이 애초에 우회로였다. */
    expect(GROUP_TABS.map((t) => t.id)).toEqual([
      "outright",
      "spread",
      "fly",
      "forward",
      "vol",
    ]);
  });

  it("탐색이 두 층이다 — 섹션 넷, 그 중 Backtest 아래에만 종목군", () => {
    /* [OWNER, 2026-08-07 · 2차] 툴바에 섹션을 올렸다가 되돌렸다. 둘 다
     * 사이드바에 있고, 위가 섹션 아래가 종목군이다 — HIG Sidebars 가 허용하는
     * 두 단계 그대로. 탐색이 두 곳에 나뉘면 무엇이 무엇의 하위인지가 사라진다. */
    expect(SECTIONS.map((s) => s.id)).toEqual([
      "main",
      "backtest",
      "simulation",
      "lab",
    ]);
    // 종목군은 섹션 이름을 쓰지 않는다 — 둘이 겹치면 한 목록에 같은 말이 둘이다
    const sectionIds = new Set<string>(SECTIONS.map((s) => s.id));
    expect(GROUP_TABS.some((t) => sectionIds.has(t.id))).toBe(false);
  });

  it("섹션과 탭이 서로를 정확히 되돌린다", () => {
    /* `tab` 하나가 상태이고 섹션은 거기서 유도된다. 왕복이 안 맞으면 화면에
     * 없는 조합(Backtest 인데 종목군 없음)이 표현 가능해진다. */
    expect(sectionOf("all")).toBe("main");
    expect(sectionOf("sim")).toBe("simulation");
    expect(sectionOf("lab")).toBe("lab");
    for (const t of GROUP_TABS) expect(sectionOf(t.id)).toBe("backtest");
    // Backtest 는 마지막으로 보던 종목군으로 돌아간다
    expect(tabForSection("backtest", "spread")).toBe("spread");
    expect(tabForSection("main", "spread")).toBe("all");
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
