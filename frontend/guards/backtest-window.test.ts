/* Guard (backtest-window session, 2026-08-03): the backtest is a single
 * floating window, parallel to the app underneath it.
 *
 * Three properties, each of which regressed as a bug in the modal era:
 *
 *   ORTHOGONAL STATE. The `bt` namespace and the `tile` namespace live in
 *   one URL without seeing each other: every write goes through `mergeQuery`
 *   which patches only its own keys. The route sequence from the brief —
 *   open backtest → open ?tile → close ?tile — must leave the bt params
 *   (and with them the window and its inputs) intact.
 *
 *   ONE WINDOW, USER FREEDOM LOW. Presence IS the `bt` param, so a second
 *   instance cannot exist; drag is the header's alone; no resize handles;
 *   the clamp keeps the drag handle inside the viewport at any position.
 *
 *   OPAQUE AND INSTANT-CAPABLE. The window root carries an opaque surface
 *   token and a hairline (depth = surface step + border, §9 — no shadow, no
 *   translucent chrome over data), and its open/close transition goes
 *   through `instant()` so prefers-reduced-motion renders without one.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { code } from "./_source";

import { mintBacktestKey } from "../src/ui/backtestMemory";
import { BacktestWindow } from "../src/ui/BacktestWindow";
import {
  clampWindowPos,
  defaultWindowPos,
  WINDOW_HEADER_H,
  WINDOW_W,
} from "../src/ui/floatingWindow";
import type { Row } from "../src/ui/rows";
import { BT_KEYS, clearBtPatch, mergeQuery } from "../src/ui/urlState";

describe("URL namespaces are orthogonal (mergeQuery)", () => {
  it("the brief's route sequence: tile opens and closes OVER an open backtest", () => {
    // open backtest (replace)
    let url = mergeQuery(new URLSearchParams(), {
      bt: "n1",
      bti: "series:10Y",
      btf: "2025-08-14",
    });
    // open the enlarged view (push) — carries bt forward untouched
    url = mergeQuery(new URLSearchParams(url), { tile: "series:3Y" });
    expect(url).toContain("bt=n1");
    expect(url).toContain("tile=series%3A3Y");
    // close the enlarged view — bt still there, so the window never blinked
    url = mergeQuery(new URLSearchParams(url), { tile: null, type: null });
    expect(url).toContain("bt=n1");
    expect(url).toContain("bti=series%3A10Y");
    expect(url).toContain("btf=2025-08-14");
    expect(url).not.toContain("tile=");
  });

  it("closing the backtest strips its WHOLE namespace and nothing else", () => {
    const url = mergeQuery(
      new URLSearchParams("tile=series%3A3Y&bt=n1&bti=series%3A10Y&btf=2025-08-14"),
      clearBtPatch(),
    );
    for (const k of BT_KEYS) expect(url).not.toContain(`${k}=`);
    expect(url).toContain("tile=");
  });

  it("an empty result is the bare path, not a dangling '?'", () => {
    expect(mergeQuery(new URLSearchParams("bt=n1"), { bt: null, bti: null, btf: null })).toBe("");
  });
});

describe("window geometry: the handle can never leave the viewport", () => {
  const vp = { w: 1600, h: 900 };

  it("clamps every direction, including a viewport narrower than the window", () => {
    expect(clampWindowPos({ left: -500, top: -500 }, vp)).toEqual({ left: 0, top: 0 });
    expect(clampWindowPos({ left: 99_999, top: 99_999 }, vp)).toEqual({
      left: vp.w - WINDOW_W,
      top: vp.h - WINDOW_HEADER_H,
    });
    // narrower viewport: left-anchored rather than pushed off the left edge
    expect(clampWindowPos({ left: 300, top: 100 }, { w: 800, h: 600 }).left).toBe(0);
  });

  it("the default position is itself inside the clamp", () => {
    const d = defaultWindowPos(vp);
    expect(clampWindowPos(d, vp)).toEqual(d);
  });
});

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

describe("the rendered window", () => {
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

  it("is opaque, hairlined and SHADOWED — still no backdrop", () => {
    /* `not.toContain("shadow")` was asserted here until 2026-08-05, encoding
     * §9's "no elevation" rule. That rule was corrected in the geometry pass:
     * it claimed one sanctioned shadow existed while six did, and the honest
     * rule is that shadows are permitted on FLOATING surfaces and banned on
     * in-flow chrome. This window was the only floating surface with neither
     * shadow nor scrim — in light, popover and tile are both #ffffff (ΔL* 0),
     * so it rested entirely on a 2.47:1 hairline. The shadow is the
     * consistency fix; the assertion is inverted deliberately, not relaxed.
     *
     * 2026-08-06: the class moved from Tailwind's `shadow-lg` preset to the
     * `shadow-window` token, whose value is measured off the macOS kit
     * (Windows - Utility Panel - Active: 0,5 blur 20 at black 30 percent).
     * The preset is a two-layer stack that sits tighter and darker than the
     * single low drop macOS uses. The assertion still pins a specific shadow
     * class, so a future edit that drops elevation still fails here. */
    const root = /<div[^>]*role="dialog"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(root).toContain("bg-popover");
    expect(root).toContain("border-edge-live");
    expect(root).toContain("shadow-window");
    // a floating window still has no full-screen dim behind it — a backdrop is
    // a FIXED full-viewport layer ("fixed inset-0"); bare "inset-0" also
    // appears inside AnimatedNumber's cross-fade span and is not a backdrop
    expect(markup).not.toContain("fixed inset-0");
    expect(markup).not.toContain("bg-page/70");
  });

  it("the seeded inputs render — 종목, 방향, 명목, 진입일", () => {
    for (const label of ["종목", "방향", "명목", "진입일", "청산일"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('value="10Y"');
  });
});

describe("mechanics, pinned in source", () => {
  const win = code("ui/BacktestWindow.tsx");
  const app = code("ui/App.tsx");

  it("single instance: the app renders exactly one <BacktestWindow", () => {
    expect((app.match(/<BacktestWindow/g) ?? []).length).toBe(1);
    // and its presence is the bt param — no second open path
    expect(app).toMatch(/btKey && btRow && summary &&/);
  });

  it("drag is the header's alone, with event-time snapshots and a clamp", () => {
    expect((win.match(/onPointerDown=\{onHeaderPointerDown\}/g) ?? []).length).toBe(1);
    expect(win).toMatch(/setPointerCapture/);
    expect(win).toMatch(/base: pos/); // position snapshotted AT the event
    expect(win).toMatch(/clampWindowPos/);
    // no resize, no minimize
    expect(win).not.toMatch(/resize/i);
    expect(win).not.toMatch(/minimi[zs]e/i);
  });

  it("reduced motion renders without a transition (instant)", () => {
    // the shape of the transition grew an ease (motion pass); what this pins
    // is the ROUTE — reduced motion goes through instant(). The companion
    // pin in backtest-context.test.ts asserts EVERY transition= does.
    expect(win).toMatch(/useReducedMotion/);
    expect(win).toMatch(/transition=\{instant\(/);
    expect(win).toMatch(/reduced === true/);
  });

  it("position is session memory, never persisted storage", () => {
    const geom = code("ui/floatingWindow.ts");
    expect(geom).not.toMatch(/localStorage|sessionStorage/);
    expect(win).not.toMatch(/localStorage/);
  });
});
