/* Guard: the bottom strip (strip session, Pass C).
 *
 * It is CHROME: fixed to the viewport, above the card, never scrolling with
 * content — and the app root pads by its height so the last table row is
 * never underneath it in either state. The anchors are one of each curve mode
 * (a level, a slope, a forward), read from the summary payload the table
 * already has: the strip added nothing to the backend. */

import { describe, expect, it } from "vitest";

import { ANCHOR_IDS, STRIP_H } from "../src/ui/BottomStrip";
import { code } from "./_source";

// comments stripped at the source (Pass D): this file's header explains at
// length what the strip used to hold, and that prose kept tripping the guards
// against the things it names
const strip = code("ui/BottomStrip.tsx");
const app = code("ui/App.tsx");

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
    /* ONCE, not twice. It was twice while the two states were separate
       subtrees returned from separate branches; pass B made collapse/expand
       animate, which needs both contents mounted inside ONE fixed container
       so the height can interpolate between them. The two inner layers are
       absolutely positioned within it. */
    expect(strip.match(/fixed inset-x-0 bottom-0 z-40/g)).toHaveLength(1);
    expect(strip.match(/absolute inset-x-0 top-0/g)).toHaveLength(2);
  });

  it("the collapsed handle and the open bar cross-fade rather than swap", () => {
    // a hard subtree swap mid-height-animation read as a glitch, not a fold
    expect(strip).toMatch(/animate=\{\{ opacity: collapsed \? 1 : 0 \}\}/);
    expect(strip).toMatch(/animate=\{\{ opacity: collapsed \? 0 : 1 \}\}/);
  });

  it("the faded-out layer cannot eat clicks aimed at the other one", () => {
    // opacity 0 still hit-tests; both layers overlap by construction here
    expect(strip).toMatch(/inert=\{collapsed\}/);
    expect(strip).toMatch(/tabIndex=\{collapsed \? 0 : -1\}/);
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
    expect(strip).not.toMatch(/from "\.\/calendar"/);
    expect(strip).not.toMatch(/nextMeeting|countdown|shortDate|todayISO/);
    // and no leftover of the run-out state, which had nothing left to guard
    expect(strip).not.toContain("일정 파일 갱신 필요");
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
    expect(strip).not.toMatch(/합니다|입니다/);
  });
});
