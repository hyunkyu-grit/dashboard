/* Guard [OWNER feedback, 2026-08-04]: the backtest answers "where in the
 * market am I getting in" BEFORE the server is ever asked "and what did it
 * pay".
 *
 * Three properties:
 *
 *   ONE SNAP RULE. The pre-run 진입 레벨 readout snaps a typed date to the
 *   first dataset point ON OR AFTER it — exactly the server's
 *   `_index_on_or_after` (backtest.py `_span_of`). Two snap rules would put
 *   two 진입 레벨 on screen for one date, one of which the run then
 *   contradicts.
 *
 *   THE READOUT EXISTS PRE-RUN. The window renders a 진입 레벨 field beside
 *   진입일 with no result and no backend — an em dash while the series
 *   loads, never a blank and never 0.00.
 *
 *   ONE CHART IMPLEMENTATION. The single-instrument context chart is
 *   PreviewChart — references, dual axis, zoom and tooltip come from the one
 *   renderer the reference-line ruling already has. Its marks pin the level
 *   from the plotted points themselves (the dot cannot sit off the line),
 *   and a mark outside the visible slice draws nothing rather than pinning
 *   itself to an edge.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { code } from "./_source";

import type { HistoryPoint } from "../src/lib/api";
import { mintBacktestKey } from "../src/ui/backtestMemory";
import { BacktestWindow, pointOnOrAfter } from "../src/ui/BacktestWindow";
import { type ChartMark, PreviewChart } from "../src/ui/PreviewChart";
import type { Row } from "../src/ui/rows";

/* ── the snap rule ──────────────────────────────────────────────────────── */

const PTS: HistoryPoint[] = [
  { t: "2026-01-05", v: 3.1, d: null },
  { t: "2026-01-06", v: 3.2, d: 10 },
  { t: "2026-01-09", v: 3.3, d: 10 },
  { t: "2026-01-12", v: 3.4, d: 10 },
];

describe("pointOnOrAfter is the server's entry snap", () => {
  it("a trading day strikes that day", () => {
    expect(pointOnOrAfter(PTS, "2026-01-06")).toEqual(PTS[1]);
  });

  it("a holiday strikes the NEXT trading day, never the previous", () => {
    // 01-07/08 are missing from the dataset; the server's on-or-after rule
    // lands on 01-09 — a last-on-or-before rule would print 01-06's level
    expect(pointOnOrAfter(PTS, "2026-01-07")).toEqual(PTS[2]);
  });

  it("past the data's end there is no level, not a clamped one", () => {
    expect(pointOnOrAfter(PTS, "2026-02-01")).toBeNull();
  });

  it("no series / no date → no level", () => {
    expect(pointOnOrAfter(undefined, "2026-01-06")).toBeNull();
    expect(pointOnOrAfter(PTS, "")).toBeNull();
  });
});

/* ── the readout exists before any run ──────────────────────────────────── */

function row(id: string): Row {
  return {
    id,
    label: id,
    group: "outright",
    unit: "%",
    now: 3,
    changes: { d1: null, mtd: null, ytd: null },
    pct: null,
    seriesId: id,
    rangeHigh: 4,
    rangeLow: 2,
    rangeAvg: 3,
    sortKey: [1],
    movePct: null,
    key: true,
  };
}

describe("the window prices the entry before 실행", () => {
  const markup = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(BacktestWindow, {
        row: row("10Y"),
        rows: [row("10Y")],
        asOf: "2026-08-03",
        memoryKey: mintBacktestKey(),
        onClose: () => {},
      }),
    ),
  );

  it("renders a 진입 레벨 readout with no result and no backend", () => {
    expect(markup).toContain("진입 레벨");
    // the series has not loaded in a static render: the placeholder is the
    // em dash — never blank, never 0.00 (§ vol's null rule)
    expect(markup).toContain("—");
  });
});

/* ── the context chart's marks ──────────────────────────────────────────── */

const W = 600;
const H = 240;

function chart(marks: ChartMark[]): string {
  return renderToStaticMarkup(
    createElement(PreviewChart, {
      points: PTS,
      stats: { min: 3.1, max: 3.4, avg: 3.25 },
      unit: "%",
      width: W,
      height: H,
      marks,
    }),
  );
}

describe("PreviewChart marks", () => {
  it("an entry mark pins date AND level — dot, level hairline, valued label", () => {
    // 01-07 is not a trading day: the mark must snap ON OR AFTER, to 01-09,
    // and say 01-09's level — the same rule the readout and the server use
    const m = chart([{ date: "2026-01-07", label: "진입", level: true }]);
    expect(m).toContain('data-mark="level"');
    expect(m).toContain("진입 3.3000");
    // the dot sits ON the line: same ink class the selection language uses
    expect(m).toMatch(/<circle[^>]*class="fill-ink"/);
  });

  it("a date-only mark draws no dot and no level", () => {
    const m = chart([{ date: "2026-01-06", label: "청산" }]);
    expect(m).toContain('data-mark="date"');
    expect(m).toContain("청산");
    expect(m).not.toMatch(/<circle[^>]*class="fill-ink"/);
    expect(m).not.toContain("3.2000");
  });

  it("a mark outside the plotted span draws nothing", () => {
    // before the first point (the zoomed-past case) and after the last —
    // pinning either to an edge would claim a strike the chart cannot show
    for (const date of ["2025-12-01", "2026-03-01"]) {
      const m = chart([{ date, label: "진입", level: true }]);
      expect(m).not.toContain("data-mark");
      expect(m).not.toContain("진입");
    }
  });

  it("marks never move the chart itself", () => {
    // the instrument line must be byte-identical with and without marks — an
    // annotation that widened the y-domain would be data, not annotation
    const line = (m: string) =>
      [...m.matchAll(/<polyline([^>]*)>/g)].find((x) =>
        x[1].includes('stroke-width="1.6"'),
      )?.[1];
    expect(line(chart([{ date: "2026-01-06", label: "진입", level: true }]))).toBe(
      line(chart([])),
    );
  });
});

/* ── the P&L overlay rides ON the chart ─────────────────────────────────── */

describe("the P&L overlay [OWNER: 겹쳐서]", () => {
  const instrumentLine = (m: string) =>
    [...m.matchAll(/<polyline([^>]*)>/g)].find((x) =>
      x[1].includes('stroke-width="1.6"'),
    )?.[1];
  const overlayLine = (m: string) =>
    [...m.matchAll(/<polyline([^>]*)>/g)].find((x) =>
      x[1].includes("data-overlay"),
    )?.[1];

  function withOverlay(points: { t: string; v: number }[]): string {
    return renderToStaticMarkup(
      createElement(PreviewChart, {
        points: PTS,
        stats: { min: 3.1, max: 3.4, avg: 3.25 },
        unit: "%",
        width: W,
        height: H,
        overlay: { points, label: "손익" },
      }),
    );
  }

  const m = withOverlay([
    { t: "2026-01-06", v: 0 },
    { t: "2026-01-09", v: 5_000_000 },
  ]);

  it("draws the overlay run, named in the legend", () => {
    expect(overlayLine(m)).toBeTruthy();
    expect(m).toContain("손익");
  });

  it("never moves the instrument's own line — the overlay scale is its own", () => {
    expect(instrumentLine(m)).toBe(instrumentLine(withOverlay([])));
  });

  it("is BOUNDED to its span — no fabricated flat P&L to the axis end", () => {
    // the overlay covers 01-06..01-09 of a chart running 01-05..01-12: the
    // run must hold exactly those two dates' points, not carry the last
    // value forward to the edge
    const pts = /points="([^"]*)"/.exec(overlayLine(m)!)![1];
    expect(pts.split(" ").filter(Boolean).length).toBe(2);
  });

  it("prints no money axis — the figures live in the headline and hover strip", () => {
    // a money tick beside bp/% ticks is the ambiguity the dual-axis rule
    // exists to prevent
    expect(m).not.toContain("만원");
    expect(m).not.toContain("5,000,000");
  });

  it("an overlay outside the plotted dates draws nothing", () => {
    expect(overlayLine(withOverlay([{ t: "2025-06-01", v: 1 }, { t: "2025-07-01", v: 2 }]))).toBeUndefined();
  });
});

/* ── one implementation, pinned in source ───────────────────────────────── */

describe("the context chart reuses the one renderer", () => {
  const win = code("ui/BacktestWindow.tsx");

  it("draws PreviewChart with the one CD hook — no second chart, no second CD", () => {
    expect(win).toMatch(/<PreviewChart/);
    expect(win).toMatch(/useCdReference\(/);
    // no hand-rolled reference machinery of its own
    expect(win).not.toMatch(/policySegments|alignSeries|seriesPath/);
  });

  it("the readout routes through the snap helper and the one level grammar", () => {
    expect(win).toMatch(/pointOnOrAfter\(/);
    // rendered through entryLevelText (readout-parity pins that = fmtLevel)
    expect(win).toMatch(/entryLevelText\(struck\?\.v \?\? null, unit\)/);
  });

  it("the series is fetched at FULL resolution under the shared key", () => {
    // preview resolution snaps an entry to the nearest ~3.5 weeks — a wrong
    // level printed confidently; and the key must match PreviewPane's so the
    // pane's cache is a hit
    expect(win).toMatch(/queryKey: \["series", id, "full"\]/);
  });

  it("the overlay is gated on the result pricing THIS instrument, and the standalone P&L chart yields to it", () => {
    // a result left over from an edited book must never be drawn over a
    // different instrument's line
    expect(win).toMatch(/shownResult\.positions\.every\(\(p\) => p\.id === soleId\)/);
    // overlaid → the line below would be the same series twice
    expect(win).toMatch(/\{!chartOverlaid && \(/);
  });
});
