/* Guard (pass Q): back returns the reader to the backtest AS THEY LEFT IT.
 *
 * The reported sequence: open the backtest, build a book, run it, and a
 * back-navigation later re-enters the popup's URL — which used to mount a
 * FRESH sheet (seed row, no result), because the contents lived only in
 * component state and every close PUSHED another history entry for back to
 * fall into. The reader returned to an emptied popup rather than the one
 * they left.
 *
 * The reproduction here is exactly that sequence at the component's own
 * boundary: mount the sheet (the seed state), record what the reader built
 * into the session memory (what the fixed sheet does as state changes),
 * unmount, and mount it AGAIN with the same instance key — the remount that
 * a history traversal performs. The assertion is that the second mount
 * renders the book and the result as left, not the seed.
 *
 * RED FIRST: this test was written before the fix and watched to fail on
 * the then-current sheet (it rendered the single seed row and "조건을 정하고
 * 실행을 눌러 주세요" instead of the remembered two-position book and its
 * headline). The close-semantics pins at the bottom are source-shape checks:
 * close must BE back (not a fresh push) whenever the app pushed the entry,
 * or the history keeps collecting emptied popups for back to land on.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { code } from "./_source";

import type { BacktestResult } from "../src/lib/api";
import {
  loadBacktestMemory,
  mintBacktestKey,
  saveBacktestMemory,
} from "../src/ui/backtestMemory";
import { BacktestSheet } from "../src/ui/BacktestSheet";
import type { Row } from "../src/ui/rows";

function row(id: string, unit: Row["unit"] = "%"): Row {
  return {
    id,
    label: id,
    group: "outright",
    unit,
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

const RESULT: BacktestResult = {
  positions: [
    {
      id: "10Y",
      direction: 1,
      notional: 1e10,
      entry: "2025-08-14",
      exit: "2026-07-24",
      closed: true,
      matured: false,
      legs: [
        { tenor: "10Y", side: "pay", notional: 1e10, entryRate: 2.5925, dv01: 8.2 },
      ],
      entryValue: 2.5925,
      exitValue: 4.26,
      pnl: 1_234_560_000,
      valuation: 1_200_000_000,
      carry: 34_560_000,
      cash: 30_000_000,
    },
  ],
  from: "2025-08-14",
  to: "2026-07-24",
  points: [
    { t: "2025-08-14", pnl: 0, d: null },
    { t: "2026-07-24", pnl: 1_234_560_000, d: 500_000 },
  ],
  complete: true,
  pnl: 1_234_560_000,
  maxProfit: 1_300_000_000,
  maxLoss: -78_200_000,
};

const sheet = (key: string) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(BacktestSheet, {
        row: row("10Y"),
        rows: [row("10Y"), row("3Y")],
        asOf: "2026-08-03",
        entryFrom: "2025-08-14",
        memoryKey: key,
        onClose: () => {},
      }),
    ),
  );

describe("the reported sequence: leave the popup, come back, find it as left", () => {
  it("a remount with the same instance key restores the book AND the result", () => {
    const key = mintBacktestKey();

    // 1. first mount — the seed: one row, no result
    const fresh = sheet(key);
    expect(fresh).toContain("조건을 정하고 실행을 눌러 주세요");
    expect((fresh.match(/value="10Y"/g) ?? []).length).toBeGreaterThan(0);

    // 2. the reader works in it: a second position, and a run — which the
    //    sheet records into the session memory as it happens
    saveBacktestMemory(key, {
      book: [
        { id: "10Y", direction: 1, eok: 100, entry: "2025-08-14", exit: "" },
        { id: "3Y", direction: -1, eok: 50, entry: "2025-09-01", exit: "" },
      ],
    });
    saveBacktestMemory(key, { result: RESULT });

    // 3. back-navigation unmounts and re-mounts the same URL → same key.
    //    The remount must show what was left, not the seed.
    const restored = sheet(key);
    expect(restored, "the second position did not survive the traversal")
      .toContain('value="50"');
    expect(restored, "the run's answer did not survive the traversal")
      .toContain("+12억 3,456만원");
    expect(restored).not.toContain("조건을 정하고 실행을 눌러 주세요");

    // and a DIFFERENT instance (a fresh chart click) still seeds fresh
    const fresh2 = sheet(mintBacktestKey());
    expect(fresh2).toContain("조건을 정하고 실행을 눌러 주세요");
  });

  it("the memory is instance-keyed and merge-written", () => {
    const a = mintBacktestKey();
    const b = mintBacktestKey();
    expect(a).not.toBe(b);
    saveBacktestMemory(a, { book: [{ id: "10Y", direction: 1, eok: 1, entry: "2026-01-02", exit: "" }] });
    saveBacktestMemory(a, { result: RESULT });
    expect(loadBacktestMemory(a)?.book).toHaveLength(1); // result write kept the book
    expect(loadBacktestMemory(a)?.result?.pnl).toBe(RESULT.pnl);
    expect(loadBacktestMemory(b)).toBeUndefined();
  });
});

describe("close IS back — one meaning per step, no residue for back to land on", () => {
  const app = code("ui/App.tsx");

  it("closing a popup the app pushed goes BACK, never pushes a fresh entry", () => {
    // the old shape — router.push("/") on close — is what filled the history
    // with emptied popups
    expect(app).not.toMatch(/closeBacktest[\s\S]{0,200}router\.push\("\/"/);
    expect(app).toMatch(/closeBacktest[\s\S]{0,400}router\.back\(\)/);
    // …but a COLD link (nothing pushed) must not back out of the site
    expect(app).toMatch(/closeBacktest[\s\S]{0,400}router\.replace\("\/"/);
  });

  it("each deliberate open mints its own instance key into the URL", () => {
    expect(app).toMatch(/openBacktest[\s\S]{0,400}mintBacktestKey\(\)/);
    expect(app).toMatch(/bt=/);
  });

  it("the sheet records what the reader builds, as it changes", () => {
    const src = code("ui/BacktestSheet.tsx");
    expect(src).toMatch(/saveBacktestMemory\(\s*memoryKey,\s*\{\s*book/);
    expect(src).toMatch(/saveBacktestMemory\(\s*memoryKey,\s*\{\s*result/);
    expect(src).toMatch(/loadBacktestMemory\(memoryKey\)/);
  });
});
