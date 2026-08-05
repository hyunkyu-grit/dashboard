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

import type { BacktestResult, HistoryPoint, PolicyStep } from "../src/lib/api";
import { mintBacktestKey } from "../src/ui/backtestMemory";
import {
  BacktestWindow,
  LinkedPnlChart,
  pointOnOrAfter,
  policyRateOn,
} from "../src/ui/BacktestWindow";
import { LinkedLegsChart } from "../src/ui/LinkedLegsChart";
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

  it("renders the per-position component line pre-run [OWNER 재피드백, 2026-08-05]", () => {
    // 진입 레벨 alone is not enough: each component's own entry level shows
    // in the row, before 실행. An outright's line carries the references
    // (its own level IS the 진입 레벨 beside it); em dashes while loading.
    expect(markup).toContain("data-entry-components");
    expect(markup).toContain("CD 91일");
    expect(markup).toContain("기준금리");
  });
});

/* ── the base rate in force at a date ───────────────────────────────────── */

describe("policyRateOn follows the step's own rules", () => {
  const policy = {
    unit: "%" as const,
    asof: "2026-01-12",
    through: "2026-01-09",
    steps: [
      { date: "2025-01-01", rate: 3.0 },
      { date: "2026-01-06", rate: 2.75 },
    ],
    latest: 2.75,
    warnings: [],
  };

  it("the last decision on or before the date is the rate in force", () => {
    expect(policyRateOn(policy, "2026-01-05")).toBe(3.0);
    expect(policyRateOn(policy, "2026-01-06")).toBe(2.75);
    expect(policyRateOn(policy, "2026-01-09")).toBe(2.75);
  });

  it("NEVER past `through` — an unverified carry prints nothing, not the old rate", () => {
    expect(policyRateOn(policy, "2026-01-10")).toBeNull();
  });

  it("before the first decision, and without inputs, there is no rate", () => {
    expect(policyRateOn(policy, "2024-12-31")).toBeNull();
    expect(policyRateOn(undefined, "2026-01-06")).toBeNull();
    expect(policyRateOn(policy, null)).toBeNull();
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
  it("an entry mark pins date AND level — dot and level hairline, label WITHOUT digits", () => {
    // 01-07 is not a trading day: the mark must snap ON OR AFTER, to 01-09
    // — the same rule the readout and the server use. The label carries no
    // value [lighten pass]: the figure lives in the readouts, and digits
    // made the label collide with the 최고 extreme in the same top band.
    const m = chart([{ date: "2026-01-07", label: "진입", level: true }]);
    expect(m).toContain('data-mark="level"');
    expect(m).toContain("진입");
    expect(m).not.toContain("진입 3.3000");
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

/* ── the linked P&L panel ───────────────────────────────────────────────── */

describe("the linked P&L panel [OWNER 재피드백: 밑에, 완전히 수직 얼라인]", () => {
  // the run window IS the slice both charts plot: far left = entry
  // (2026-01-06), far right = exit (2026-01-12)
  const pts = PTS.slice(1);
  const result: BacktestResult = {
    positions: [],
    from: "2026-01-06",
    to: "2026-01-12",
    points: [
      { t: "2026-01-06", pnl: 0, d: null },
      { t: "2026-01-09", pnl: 5_000_000, d: 5_000_000 },
      { t: "2026-01-12", pnl: 3_000_000, d: -2_000_000 },
    ],
    complete: true,
    pnl: 3_000_000,
    maxProfit: 5_000_000,
    maxLoss: 0,
  };

  const crosshairX = (m: string) =>
    /<line[^>]*data-crosshair[^>]*x1="([\d.]+)"/.exec(m)?.[1];

  const top = renderToStaticMarkup(
    createElement(PreviewChart, {
      points: pts,
      stats: { min: 3.1, max: 3.4, avg: 3.25 },
      unit: "%",
      width: W,
      height: H,
      still: true,
      hoverDate: "2026-01-09",
    }),
  );
  const bottom = renderToStaticMarkup(
    createElement(LinkedPnlChart, {
      pts,
      result,
      width: W,
      height: 140,
      hoverIso: "2026-01-09",
      onHover: () => {},
    }),
  );

  it("one date, one x: the two crosshairs land on the same pixel column", () => {
    // this IS the alignment property — same slice, shared CHART_PAD, same
    // index→x formula. A drift in any of the three breaks this byte equality.
    expect(crosshairX(top)).toBeTruthy();
    expect(crosshairX(top)).toBe(crosshairX(bottom));
  });

  it("the external hoverDate shows the instrument readout without a mouse", () => {
    // the sibling P&L chart drives the top chart's crosshair through the
    // shared parent — the readout card renders at that date
    expect(top).toContain("2026-01-09");
    expect(top).toContain("레벨");
  });

  it("the panel prints the SERVER's 누적/당일 at the hovered date", () => {
    expect(bottom).toContain("누적");
    expect(bottom).toContain("당일");
    // fmtKrw(5,000,000) — served figures, never differenced here
    expect(bottom).toContain("+500만원");
  });

  it("zero stays in frame with an all-positive run — the win/lose boundary", () => {
    // the area polygon closes on the zero line's y: its last two points sit
    // at the same y, which only holds when zero is inside the domain
    const poly = /<polygon[^>]*points="([^"]*)"/.exec(bottom)?.[1] ?? "";
    const ys = poly.split(" ").map((p) => Number(p.split(",")[1]));
    expect(ys.length).toBeGreaterThan(3);
    expect(ys[ys.length - 1]).toBe(ys[ys.length - 2]);
    expect(Math.max(...ys)).toBeLessThanOrEqual(140);
  });

  it("a hover outside the window draws no crosshair in the panel", () => {
    const m = renderToStaticMarkup(
      createElement(LinkedPnlChart, {
        pts,
        result,
        width: W,
        height: 140,
        hoverIso: "2025-01-01",
        onHover: () => {},
      }),
    );
    expect(crosshairX(m)).toBeUndefined();
  });
});

/* ── the 구성 금리 panel [OWNER, 2026-08-05] ─────────────────────────────── */

describe("the component-rates panel: legs + CD + Base, aligned with the stack", () => {
  // full-resolution leg series over the same trading days as the instrument
  const legPts = (base: number): HistoryPoint[] =>
    PTS.map((p, i) => ({ t: p.t, v: base + i * 0.01, d: p.d }));
  const policy: PolicyStep = {
    unit: "%",
    asof: "2026-01-12",
    through: "2026-01-12",
    steps: [{ date: "2025-01-01", rate: 2.75 }],
    latest: 2.75,
    warnings: [],
  };
  const pts = PTS.slice(1); // the run window the whole stack plots
  const legs = (ids: string[]) =>
    ids.map((id, k) => ({ id, points: legPts(3.0 + 0.2 * k) }));

  const panel = (over: Partial<Parameters<typeof LinkedLegsChart>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(LinkedLegsChart, {
        legs: legs(["3Y", "5Y", "10Y"]),
        pts,
        cd: legPts(2.6),
        policy,
        markDates: ["2026-01-06"],
        width: W,
        height: 150,
        hoverIso: "2026-01-09",
        onHover: () => {},
        ...over,
      }),
    );

  const crosshairX = (m: string) =>
    /<line[^>]*data-crosshair[^>]*x1="([\d.]+)"/.exec(m)?.[1];

  it("a fly draws its three legs, each named, plus both references", () => {
    const m = panel();
    for (const id of ["3Y", "5Y", "10Y"]) expect(m).toContain(`data-leg="${id}"`);
    // the references wear the owner's ref tokens — the one encoding
    expect(m).toContain("stroke-ref-cd");
    expect(m).toContain("stroke-ref-policy");
    expect(m).toContain("CD 91일");
    expect(m).toContain("기준금리");
    expect(m).toContain("구성 금리");
  });

  it("fewer than two legs is no panel — an outright is its own component", () => {
    expect(panel({ legs: legs(["10Y"]) })).toBe("");
  });

  it("one date, one x, across the WHOLE stack — same slice, same pad, same formula", () => {
    const top = renderToStaticMarkup(
      createElement(PreviewChart, {
        points: pts,
        stats: { min: 3.1, max: 3.4, avg: 3.25 },
        unit: "%",
        width: W,
        height: H,
        still: true,
        hoverDate: "2026-01-09",
      }),
    );
    expect(crosshairX(panel())).toBeTruthy();
    expect(crosshairX(panel())).toBe(crosshairX(top));
  });

  it("the readout prints every leg, CD and the base rate at the hovered date", () => {
    const m = panel();
    expect(m).toContain("2026-01-09");
    // legVals at 01-09 = base + 2 steps of 0.01; via fmtLevel's 4dp grammar
    expect(m).toContain("3.0200");
    expect(m).toContain("2.7500"); // the base rate IN FORCE, from the drawn step
  });

  it("legs are LEVELS: ink strokes, no direction hue", () => {
    const m = panel();
    expect([...m.matchAll(/data-leg=/g)].length).toBeGreaterThan(0);
    expect(m).not.toMatch(/data-leg[^>]*class="[^"]*(?:up|down)/);
    for (const x of [...m.matchAll(/<polyline[^>]*data-leg[^>]*class="([^"]*)"/g)])
      expect(x[1]).toContain("stroke-ink");
  });

  it("entry hairlines are dates only — the labels live on the chart above", () => {
    const m = panel();
    expect(m).toContain('data-mark="date"');
    expect(m).not.toContain("진입");
  });
});

/* ── one implementation, pinned in source ───────────────────────────────── */

describe("the context chart reuses the one renderer", () => {
  const win = code("ui/BacktestWindow.tsx");

  it("draws PreviewChart with the one CD hook — no second CD, no inline reference machinery", () => {
    expect(win).toMatch(/<PreviewChart/);
    expect(win).toMatch(/useCdReference\(/);
    // the window itself hand-rolls no reference projection: the 구성 금리
    // panel is the sanctioned second reference surface [OWNER, 2026-08-05]
    // and its machinery lives in LinkedLegsChart.tsx, built ON the shared
    // policyLine helpers — pinned below, not here
    expect(win).not.toMatch(/policySegments|alignSeries|seriesPath/);
  });

  it("the 구성 금리 panel: gated on ≥2 legs, complete legs only, shared slice + hover", () => {
    const legsChart = code("ui/LinkedLegsChart.tsx");
    // the window renders it only for a derived instrument, with EVERY leg
    // loaded — a fly drawn with two of three legs looks complete and is wrong
    expect(win).toMatch(/legIds\.length >= 2/);
    expect(win).toMatch(/\.every\(\(s\) => s && s\.points\.length >= 2\)/);
    expect(win).toMatch(/<LinkedLegsChart/);
    // the panel borrows the stack's own pad and the SHARED policyLine
    // helpers — a copied constant or a re-derived projection is the drift
    // class both rulings exist to catch
    expect(legsChart).toMatch(/right: CHART_PAD\.right/);
    expect(legsChart).toMatch(/left: CHART_PAD\.left/);
    expect(legsChart).toMatch(/from "\.\/policyLine"/);
    expect(legsChart).toMatch(/stroke-ref-cd/);
    expect(legsChart).toMatch(/stroke-ref-policy/);
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

  it("the linked pair is gated on the result pricing THIS instrument, and Result's own P&L chart yields to it", () => {
    // a result left over from an edited book must never be paired with a
    // different instrument's line
    expect(win).toMatch(/shownResult\.positions\.every\(\(p\) => p\.id === soleId\)/);
    // linked → the standalone line would be the same series twice
    expect(win).toMatch(/\{!chartLinked && \(/);
  });

  it("every authored transition collapses under reduced motion (instant)", () => {
    // §14: reduced motion is an instant state change, not a shorter one.
    // Any transition= in the window that skips instant() is a regression.
    const transitions = (win.match(/transition=\{/g) ?? []).length;
    const instants = (win.match(/transition=\{instant\(/g) ?? []).length;
    expect(transitions).toBeGreaterThan(0);
    expect(transitions).toBe(instants);
  });

  it("alignment is constructed, not tuned", () => {
    // the panel borrows the instrument chart's own horizontal pad — a copied
    // constant is the drift this pin exists to catch
    expect(win).toMatch(/right: CHART_PAD\.right/);
    expect(win).toMatch(/left: CHART_PAD\.left/);
    // the top chart is windowed to the run and holds still while linked —
    // a zoom the sibling cannot follow would silently break the alignment
    expect(win).toMatch(/points\.findIndex\(\(p\) => p\.t >= result\.from\)/);
    expect(win).toMatch(/still=\{!!result\}/);
  });
});
