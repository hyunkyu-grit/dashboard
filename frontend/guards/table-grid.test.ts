/* Guard: the table's column grid is format-derived and frozen (grid session,
 * Pass A). Widths come from each column's widest possible RENDERING, never
 * from today's data, so the grid is identical across tabs, sorts, and filters
 * — the header must never move. One template string is shared by the header
 * row and every body row so the two cannot drift apart. */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { code } from "./_source";

import { fmtDelta, fmtLevel } from "../src/lib/format";
import {
  ALL_COLUMNS,
  colPx,
  GRID_TEMPLATE,
  gridTemplate,
  LEVEL_GLYPHS,
  RANGE_PAD,
  RANGE_SUBS,
  rangeTemplate,
  THETA_PAD,
  visibleColumns,
  WIDEST,
  withThetaData,
} from "../src/ui/columns";
import { levelHeadText } from "../src/lib/format";
import { InstrumentTable } from "../src/ui/InstrumentTable";
import { OverviewColumns } from "../src/ui/OverviewColumns";
import { traderName, type Group, type Row } from "../src/ui/rows";

describe("column widths derive from the format, not the data", () => {
  const level = `calc(${LEVEL_GLYPHS}ch + 18px)`;
  const sub = `calc(${WIDEST.level.length}ch + ${RANGE_PAD}px)`;
  // the full tail floor is FOUR sub-tracks since pass N: three numbers plus
  // the position track, which is one more sub-column of the same width
  const range = `calc(${(RANGE_SUBS + 1) * WIDEST.level.length}ch + ${
    (RANGE_SUBS + 1) * RANGE_PAD
  }px)`;
  // 세타 [OWNER, 2026-08-13] is a FIFTH fixed sub-track, and unlike the other
  // four it is sized by the money grammar, not the level grammar — so it has
  // its own glyph count and its own cushion.
  const thetaW = `calc(${WIDEST.theta.length}ch + ${THETA_PAD}px)`;
  const tailFloor = `calc(${range} + ${thetaW})`;

  it("the template is a constant built only from the WIDEST renderings", () => {
    const label = `calc(${WIDEST.label.length}ch + 30px)`;
    const delta = `calc(${WIDEST.delta.length}ch + 18px)`;
    expect(GRID_TEMPLATE).toBe(
      `${label} ${level} repeat(3, ${delta}) minmax(${tailFloor}, 1fr)`,
    );
  });

  it("52주 is the only flexible track, floored so it never clips to zero", () => {
    expect(GRID_TEMPLATE.match(/1fr/g)).toHaveLength(1);
    expect(GRID_TEMPLATE.endsWith(`minmax(${tailFloor}, 1fr)`)).toBe(true);
  });

  it("the tail floor covers EVERY sub-track the cell holds", () => {
    // The cell's floor and the sub-grid inside it are written in two places;
    // if the floor forgets a track the sub-grid overflows its own cell and
    // every row's tail slides left of the header that names it. Assert the
    // floor mentions each fixed track's width exactly as the sub-grid does.
    expect(GRID_TEMPLATE).toContain(range);
    expect(GRID_TEMPLATE).toContain(thetaW);
    expect(rangeTemplate(true, true)).toContain(thetaW);
    expect(rangeTemplate(true, false)).not.toContain(thetaW);
  });

  it("the 세타 cushion clears the money grammar's Korean glyphs", () => {
    // `ch` is the DIGIT advance; 억/만/원 are wider at the same size, and the
    // widest rendering carries three of them. Measured at 13px body type the
    // excess is ~5.3px each over the 7.74px runtime ch. Plus pr-3. This is the
    // assertion that stops THETA_PAD being "simplified" down to RANGE_PAD.
    const KOREAN_EXCESS_PX = 3 * 5.3;
    const PR3 = 12;
    for (const ch of [6.5, 7.74, 9]) {
      const room = colPx(ch).theta - WIDEST.theta.length * ch - PR3;
      expect(room - KOREAN_EXCESS_PX, `at ch ${ch}`).toBeGreaterThan(0);
    }
  });

  it("the 52주 floor is derived sub-columns — never a magic number", () => {
    // pass L: the floor used to be a flat 120px sized for a sentence. It is
    // now the level glyph count times the sub-track count, so it tracks any
    // change to the level grammar automatically. A hardcoded px floor fails.
    expect(range).not.toMatch(/\b120px\b/);
    for (const ch of [6.5, 7.74, 9]) {
      expect(colPx(ch).range).toBeCloseTo(RANGE_SUBS * colPx(ch).rangeSub, 10);
      // Same GLYPH count as a LEVEL VALUE; only the cushion differs, and only
      // because a Korean header label does not scale with `ch` (RANGE_PAD).
      //
      // Against WIDEST.level, NOT against the level COLUMN (pass M): that
      // column is now sized by its date header, and if this tracked the column
      // the three sub-columns would each grow by four glyphs to fit a header
      // they do not carry — ~90px of table width bought for nothing.
      const levelValue = WIDEST.level.length * ch + 18;
      expect(colPx(ch).rangeSub - levelValue).toBeCloseTo(RANGE_PAD - 18, 10);
      expect(colPx(ch).rangeSub).toBeLessThan(colPx(ch).level);
    }
  });

  it("the label cushion leaves real margin at every ch we render at", () => {
    // Measured live at 11px: the longest sub-label (52주 고점) is ~45px of
    // ink, and being Korean it does NOT shrink with ch. The content box is
    // 6ch + RANGE_PAD − pr-3(12). This is the assertion that stops the cushion
    // being "simplified" back to 현재's 18px, which leaves 7.7px at the runtime
    // ch and less than that on any narrower face — a clipped header label is
    // not something the rest of this file could catch.
    const LONGEST_LABEL_PX = 45;
    const PR3 = 12;
    for (const ch of [6.5, 7.74, 9]) {
      const room = colPx(ch).rangeSub - PR3;
      expect(room - LONGEST_LABEL_PX, `at ch ${ch}`).toBeGreaterThan(5);
    }
  });

  it("the sub-grid inside the cell is fixed tracks then the slack", () => {
    // slack at the TRAILING edge: the column keeps absorbing leftover table
    // width while the numbers stay put and stay aligned down the table. The
    // position track (pass N) is the fourth fixed track, SAME width, so the
    // sub-grid's rhythm survives it — and dropping it removes exactly one
    // track without moving the other three.
    expect(rangeTemplate(false)).toBe(
      `repeat(${RANGE_SUBS}, ${sub}) minmax(0, 1fr)`,
    );
    expect(rangeTemplate(true)).toBe(
      `repeat(${RANGE_SUBS + 1}, ${sub}) minmax(0, 1fr)`,
    );
    // 세타 joins as a fifth fixed track, still ahead of the slack — the money
    // column has to align down the table exactly as the level ones do.
    expect(rangeTemplate(true, true)).toBe(
      `repeat(${RANGE_SUBS + 1}, ${sub}) ${thetaW} minmax(0, 1fr)`,
    );
    for (const t of [
      rangeTemplate(false),
      rangeTemplate(true),
      rangeTemplate(true, true),
    ]) {
      expect(t.match(/1fr/g)).toHaveLength(1);
      expect(t.endsWith("minmax(0, 1fr)")).toBe(true);
    }
  });
});

describe("the WIDEST templates actually cover the display grammar", () => {
  it("현재: all three unit grammars fit the level template", () => {
    // % level 4dp / bp level 1dp incl. sign / ratio 2dp
    for (const s of [fmtLevel(4.2446, "%"), fmtLevel(-100.5, "bp"), fmtLevel(12.0, "ratio")]) {
      expect(s.length).toBeLessThanOrEqual(WIDEST.level.length);
    }
  });

  it("the level track fits its HEADER too, which is the wider of the two", () => {
    // pass M: the header is the dataset's as-of date (10 glyphs), the values
    // are 6. A track sized to the values alone would clip the header, and
    // nothing else in this file would notice — the grid would still be
    // frozen and shared, just too narrow.
    expect(levelHeadText("2026-07-24")).toHaveLength(WIDEST.levelHead.length);
    expect(LEVEL_GLYPHS).toBeGreaterThanOrEqual(WIDEST.levelHead.length);
    expect(LEVEL_GLYPHS).toBeGreaterThanOrEqual(WIDEST.level.length);
    // and the fallback (a payload with no asof) is narrower than the date
    expect(levelHeadText(null).length).toBeLessThanOrEqual(LEVEL_GLYPHS);
  });

  it("change columns: bp and ratio deltas fit the delta template", () => {
    for (const s of [fmtDelta(-999.9, "bp"), fmtDelta(999.9, "%"), fmtDelta(-1.23, "ratio")]) {
      expect(s.length).toBeLessThanOrEqual(WIDEST.delta.length);
    }
  });

  it("종목: the longest producible identifiers fit the label template", () => {
    // the longest fly, the longest forward (start ON…5Y in 3M steps × tenor
    // 3M…5Y), and the longest outright/vol tenor
    for (const s of [traderName("1Y-1.5Y-10Y"), "1Y3Mx3M", "4Y9Mx5Y", "1.5Y"]) {
      expect(s.length).toBeLessThanOrEqual(WIDEST.label.length);
    }
  });
});

describe("one grid definition shared by header and body; stable gutter", () => {
  const src = code("ui/InstrumentTable.tsx");

  it("header row and body rows both use the ONE shared template", () => {
    const uses = src.match(/gridTemplateColumns: template/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/<table/);
    // both header and rows derive from the same computed `visible` set
    expect(src).toContain("visible.bases.map");
    expect((src.match(/visible\.bases\.map/g) ?? []).length).toBe(2);
  });

  it("the scroll container reserves a stable scrollbar gutter", () => {
    expect(src).toContain("[scrollbar-gutter:stable]");
  });

  it("no cell derives a width from content (no width styles outside the template)", () => {
    // the only width-bearing style in the table is the shared template
    expect(src).not.toMatch(/style=\{\{\s*width/);
  });
});

describe("the column priority ladder (columns session)", () => {
  const CH = 7.8; // a plausible 13px-font ch; the maths must hold for any
  const w = colPx(CH);
  const LADDER_IDS = ["d1", "ytd", "mtd"] as const;

  function widthFor(
    nBases: number,
    range52: boolean,
    slider = false,
    theta = false,
  ): number {
    return (
      w.label + w.level + nBases * w.delta +
      (range52 ? w.range : 0) + (slider ? w.rangeSub : 0) +
      (theta ? w.theta : 0)
    );
  }

  it("the visible set is always a prefix of the ladder", () => {
    for (let n = 0; n < LADDER_IDS.length; n++) {
      const v = visibleColumns(widthFor(n, false) + 1, CH, null);
      // exactly the first n ladder entries are visible, regardless of order
      expect(new Set(v.bases)).toEqual(new Set(LADDER_IDS.slice(0, n)));
      expect(v.range52).toBe(false);
      expect(v.slider).toBe(false);
      expect(v.theta).toBe(false);
      // +3: the 52주 numbers, the position track and 세타 are all still hidden
      expect(v.hidden).toBe(LADDER_IDS.length - n + 3);
    }
    const all = visibleColumns(
      widthFor(LADDER_IDS.length, true, true, true) + 1,
      CH,
      null,
    );
    expect(all.bases).toEqual(["d1", "mtd", "ytd"]);
    expect(all.range52).toBe(true);
    expect(all.slider).toBe(true);
    expect(all.theta).toBe(true);
    expect(all.hidden).toBe(0);
  });

  it("the drop thresholds, recomputed for the 52주 cell (pass L)", () => {
    // The 606px 한 줄 threshold recorded in DESIGN was a stale constant the
    // moment the cell's content width changed. These are the live figures at
    // the MEASURED runtime ch (7.74px at 13px Pretendard — the columns
    // session's figure, not the 7.8 the arithmetic tests above use), in
    // TABLE-CONTENT px: the smallest container at which each column appears.
    const RUNTIME_CH = 7.74;
    const rw = colPx(RUNTIME_CH);
    const at = (n: number, r: boolean, s = false, t = false) =>
      Math.ceil(
        rw.label + rw.level + n * rw.delta +
        (r ? rw.range : 0) + (s ? rw.rangeSub : 0) + (t ? rw.theta : 0),
      );
    // Two change columns fewer since 2026-07-31 (WTD/QTD deleted), so the
    // full set now fits 129px earlier than it did — the per-column figures
    // below are unchanged, the ladder simply ends three columns in.
    expect(at(0, false)).toBe(196); // 종목 + 레벨 — the backstop pair
    expect(at(1, false)).toBe(260); // 어제
    expect(at(2, false)).toBe(324); // YTD
    expect(at(3, false)).toBe(389); // MTD — the last change column
    expect(at(3, true)).toBe(600); // 52주 — was 729 with five change columns
    expect(at(3, true, true)).toBe(671); // 위치 — the position track (pass N)
    expect(at(3, true, true, true)).toBe(786); // 세타 (2026-08-13)
  });

  it("the sorted column is NEVER dropped — it takes slot 3", () => {
    // width for exactly one change column: sorting by mtd forces mtd in,
    // displacing 어제 which is otherwise the ladder head
    const v = visibleColumns(widthFor(1, false) + 1, CH, "mtd");
    expect(v.bases).toEqual(["mtd"]);
    // and with two slots, the displaced ladder head (어제) returns next
    const v2 = visibleColumns(widthFor(2, false) + 1, CH, "mtd");
    expect(new Set(v2.bases)).toEqual(new Set(["d1", "mtd"]));
  });

  it("bases render in canonical display order, never ladder order", () => {
    const v = visibleColumns(widthFor(2, false) + 1, CH, null);
    // ladder admits d1 then ytd — displayed as d1, ytd; with the third slot
    // MTD lands BETWEEN them, which is the whole point of a canonical order
    expect(v.bases).toEqual(["d1", "ytd"]);
    const v3 = visibleColumns(widthFor(3, false) + 1, CH, null);
    expect(v3.bases).toEqual(["d1", "mtd", "ytd"]);
  });

  it("the summed width of the visible set never exceeds the container", () => {
    for (let px = 60; px <= 980; px += 7) {
      const v = visibleColumns(px, CH, "mtd");
      const sum =
        w.label + w.level + v.bases.length * w.delta +
        (v.range52 ? w.range : 0) + (v.slider ? w.rangeSub : 0) +
        (v.theta ? w.theta : 0);
      expect(sum, `at ${px}px`).toBeLessThanOrEqual(Math.max(px, w.label + w.level));
    }
  });

  it("세타 is first to go; then 위치; then 52주; all return in reverse", () => {
    // one px short of fitting 세타: everything else visible, 세타 hidden
    const noTheta = visibleColumns(widthFor(3, true, true, true) - 1, CH, null);
    expect(noTheta.bases.length).toBe(3);
    expect(noTheta.range52).toBe(true);
    expect(noTheta.slider).toBe(true);
    expect(noTheta.theta).toBe(false);
    expect(noTheta.hidden).toBe(1);
    // one px short of fitting the track: 세타 went with it
    const noSlider = visibleColumns(widthFor(3, true, true) - 1, CH, null);
    expect(noSlider.range52).toBe(true);
    expect(noSlider.slider).toBe(false);
    expect(noSlider.theta).toBe(false);
    expect(noSlider.hidden).toBe(2);
    // one px short of fitting 52주: the track is gone too — never without
    // its frame of reference
    const v = visibleColumns(widthFor(3, true) - 1, CH, null);
    expect(v.bases.length).toBe(3);
    expect(v.range52).toBe(false);
    expect(v.slider).toBe(false);
    expect(v.theta).toBe(false);
    expect(v.hidden).toBe(3);
  });

  it("no tail column ever shows without the one it was placed against", () => {
    for (let px = 60; px <= 1100; px += 3) {
      for (const sort of [null, "mtd"] as const) {
        const v = visibleColumns(px, CH, sort);
        expect(!v.slider || v.range52, `slider without 52주 at ${px}px`).toBe(true);
        // 세타 was positioned "위치 오른쪽" [OWNER]; without 위치 there is no
        // such place, so it cannot outlive it
        expect(!v.theta || v.slider, `세타 without 위치 at ${px}px`).toBe(true);
      }
    }
  });

  it("gridTemplate(ALL_COLUMNS) is the frozen full template", () => {
    expect(gridTemplate(ALL_COLUMNS)).toBe(GRID_TEMPLATE);
  });
});

describe("rendered grids: one template, and no font-size on a ch-track container", () => {
  /* The alignment invariant, asserted on RENDERED MARKUP rather than on
   * source text (2026-08-03 audit — docs/diagnostics/table-column-alignment.md).
   * Two rules, one failure mode between them:
   *
   *   1. Every outer grid a tab renders — the header row and every body row —
   *      carries THE one template string. Equality by identity: if only one
   *      outer value exists on the surface, header and body cannot disagree.
   *   2. No element that carries a ch-derived `grid-template-columns` style
   *      also carries a font-size utility. `ch` resolves against the
   *      element's OWN font size, so a size on the container re-derives every
   *      track at that size — the 63.3px-vs-70.4px drift that once slid the
   *      52주 labels 7/14/21px off their numbers. The size belongs on spans
   *      (headers) or on a wrapper both grids inherit from (the overview).
   *
   * Rendering the real components is what makes this unfoolable by comments
   * or string fixtures: a violation has to reach the DOM to exist here, and
   * the guard reads exactly what the browser would. */

  function row(id: string, group: Group, key: boolean): Row {
    return {
      id,
      label: id,
      group,
      unit: group === "outright" || group === "vol" ? "%" : "bp",
      now: 1.5,
      changes: { d1: 0.5, mtd: -0.5, ytd: 1.0 },
      pct: null,
      seriesId: group === "forward" ? null : id,
      rangeHigh: 2,
      rangeLow: 0,
      rangeAvg: 1,
      sortKey: [1],
      movePct: null,
      key,
    };
  }
  const GROUPS: Group[] = ["outright", "spread", "fly", "forward", "vol"];
  const ROWS: Row[] = GROUPS.flatMap((g) => [
    row(`${g}-a`, g, true),
    row(`${g}-b`, g, false),
  ]);

  const gridTags = (markup: string): string[] =>
    markup.match(/<[a-zA-Z][^>]*grid-template-columns[^>]*>/g) ?? [];
  const templateOf = (tag: string): string => {
    const style = /style="([^"]*)"/.exec(tag)?.[1] ?? "";
    const decl = style
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("grid-template-columns:"));
    return decl ? decl.slice("grid-template-columns:".length).trim() : "";
  };
  const classOf = (tag: string): string =>
    /class="([^"]*)"/.exec(tag)?.[1] ?? "";
  // size utilities only — text-ink/50, text-left, text-up are not sizes
  const SIZE_UTILITY = /text-\[\d|\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/;

  const renderTab = (filter: Group): string =>
    renderToStaticMarkup(
      createElement(InstrumentTable, {
        rows: ROWS,
        asOf: "2026-08-03",
        filter,
        onFilter: () => undefined,
        activeId: null,
        pinnedId: null,
        onHover: () => undefined,
        onPin: () => undefined,
        matrixOpen: false,
        onToggleMatrix: () => undefined,
      }),
    );
  const renderOverview = (): string =>
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(OverviewColumns, { rows: ROWS, asOf: "2026-08-03" }),
      ),
    );

  const SURFACES: [string, string][] = [
    ...GROUPS.map((g): [string, string] => [g, renderTab(g)]),
    ["overview", renderOverview()],
  ];

  it("header and body render THE template — no second outer value exists", () => {
    // Before the first width measurement every column renders (ALL_COLUMNS),
    // so the legal outer templates are the frozen full one and its 세타-less
    // twin — the latter is not a ladder drop but the applies/does-not-apply
    // rule (`withThetaData`): a 스프레드 or 포워드 surface has no swap theta,
    // and 2026-08-13 is when that stopped being a column of em dashes. The
    // only other grids on the surface are the 52주 sub-grids.
    const OUTER = [gridTemplate(ALL_COLUMNS), gridTemplate(withThetaData(ALL_COLUMNS, false))];
    expect(new Set(OUTER).size, "the two outer shapes must differ").toBe(2);
    const allowed = new Set([
      ...OUTER,
      rangeTemplate(true, true),
      rangeTemplate(true),
      rangeTemplate(false),
    ]);
    for (const [name, markup] of SURFACES) {
      const tags = gridTags(markup);
      const outer = tags.filter((t) => OUTER.includes(templateOf(t)));
      // at least a header row and two body rows carry it (the overview: three
      // Head rows and six body rows)
      expect(outer.length, `${name}: outer grids`).toBeGreaterThanOrEqual(3);
      // A tab is ONE table, so it resolves ONE shape — a grid that switched
      // between its header and its rows is the drift this file exists to
      // catch. The overview is three independent columns side by side, and
      // 아웃라이트 carrying 세타 while 스프레드 does not is the rule working.
      expect(
        new Set(outer.map(templateOf)).size,
        `${name}: too many outer templates`,
      ).toBeLessThanOrEqual(name === "overview" ? 2 : 1);
      for (const t of tags) {
        expect(allowed.has(templateOf(t)), `${name}: stray template in ${t}`).toBe(true);
      }
    }
  });

  it("no ch-track grid container carries a font-size utility", () => {
    for (const [name, markup] of SURFACES) {
      for (const t of gridTags(markup)) {
        expect(
          SIZE_UTILITY.test(classOf(t)),
          `${name}: font-size on a ch-track grid container — ${t}`,
        ).toBe(false);
      }
    }
  });
});
