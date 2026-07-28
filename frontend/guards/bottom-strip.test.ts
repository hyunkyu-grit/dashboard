/* Guard: the bottom strip (strip session, Pass C).
 *
 * It is CHROME: fixed to the viewport, above the card, never scrolling with
 * content — and the app root pads by its height so the last table row is
 * never underneath it in either state. The anchors are one of each curve mode
 * (a level, a slope, a forward), read from the summary payload the table
 * already has: the strip added nothing to the backend. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ANCHOR_IDS, STRIP_H } from "../src/ui/BottomStrip";

const src = (p: string) => readFileSync(join(__dirname, "..", "src", p), "utf8");
const strip = src("ui/BottomStrip.tsx");
const app = src("ui/App.tsx");

describe("the anchors are a level, a slope and a forward", () => {
  it("three ids, one of each mode", () => {
    expect(ANCHOR_IDS).toHaveLength(3);
    const [level, slope, forward] = ANCHOR_IDS;
    expect(level).not.toContain("-"); // outright: a bare tenor
    expect(level).not.toContain("x");
    expect(slope.split("-")).toHaveLength(2); // two legs
    expect(forward).toContain("x"); // start x tenor
  });

  it("10Y is among them — the reference every other number is judged against", () => {
    expect(ANCHOR_IDS).toContain("10Y");
  });

  it("figures come from the rows the table already has, not a new fetch", () => {
    expect(strip).not.toMatch(/fetch|useQuery/);
    expect(strip).toContain("rows.find");
  });
});

describe("it is chrome, not content", () => {
  it("fixed to the viewport bottom, above the card", () => {
    expect(strip).toMatch(/fixed inset-x-0 bottom-0 z-40/);
    // twice: the open bar and the collapsed handle
    expect(strip.match(/fixed inset-x-0 bottom-0 z-40/g)).toHaveLength(2);
  });

  it("the app root pads by the strip's height, in BOTH states", () => {
    expect(app).toMatch(
      /paddingBottom: stripCollapsed \? STRIP_H\.collapsed : STRIP_H\.open/,
    );
    expect(STRIP_H.open).toBeGreaterThan(STRIP_H.collapsed);
    expect(STRIP_H.collapsed).toBeGreaterThan(0); // collapsed still leaves a handle
  });

  it("clicking an anchor pins it, exactly as clicking its row does", () => {
    expect(strip).toContain("onClick={() => onPin(row)}");
    expect(app).toMatch(/<BottomStrip[\s\S]*?onPin=\{setPinned\}/);
  });

  it("is rendered once, outside the panes, so it shows on every tab", () => {
    expect(app.match(/<BottomStrip/g)).toHaveLength(1);
  });
});

describe("the calendar is disconnected (removal session, Pass B)", () => {
  it("the strip reads no calendar and shows no event", () => {
    // CODE only: the header comment explains what the right side USED to
    // hold and why it went, and that explanation must not trip its own guard
    const code = strip
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/from "\.\/calendar"/);
    expect(code).not.toMatch(/nextMeeting|countdown|shortDate|todayISO/);
    // and no leftover of the run-out state, which had nothing left to guard
    expect(code).not.toContain("일정 파일 갱신 필요");
  });

  it("the anchors — the reason the strip exists — are untouched", () => {
    expect(ANCHOR_IDS).toEqual(["10Y", "3Y-10Y", "1Yx1Y"]);
    expect(strip).toContain("rows.find");
  });
});

describe("register: terse labels and tabular numerals, no prose", () => {
  it("figures are tabular-nums", () => {
    expect(strip.match(/tabular-nums/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("no sentence endings anywhere in the strip's copy", () => {
    const copy = strip.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(copy).not.toMatch(/합니다|입니다/);
  });
});
