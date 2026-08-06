/* Guard: prefers-reduced-motion collapses every animation to an INSTANT state
 * change (DESIGN §14) [OWNER, 2026-08-06 — "문자 그대로 전부 instant"].
 *
 * WHAT THIS USED TO BE, AND WHY IT WAS WORTHLESS. Until pass B this file
 * asserted three things about the pure function `instant()` — that it returns
 * `{duration: 0}` when reduced, passes the base through otherwise, and that
 * SPRING is a spring. It never named a component, never mentioned
 * MotionConfig, and never looked at CSS. `instant()` had exactly ONE consumer
 * in the whole product (BacktestWindow); it could have been deleted from every
 * other call site — there were none — and this file would still have gone
 * green. Meanwhile the rule it claimed to protect was false everywhere else:
 *
 *   - `MotionConfig reducedMotion="user"` only zeroes TRANSFORM and layout
 *     properties. motion@12's `positionalKeys` is
 *     {width,height,top,left,right,bottom} ∪ transforms — `opacity` is not in
 *     it, so every cross-fade in the product ran at full duration with the OS
 *     preference set.
 *   - Tailwind's `transition-opacity` / `transition-colors` are CSS.
 *     MotionConfig cannot reach them at all, and the built stylesheet had no
 *     `prefers-reduced-motion: reduce` block whatsoever.
 *   - `scrollIntoView({behavior:"smooth"})` outranks `scroll-behavior`.
 *
 * So the guard is now shaped like the one that DID work
 * (backtest-context.test.ts): it COUNTS call sites and requires every one of
 * them to route through `instant()`. A new `transition=` that forgets fails
 * this file on the day it is written.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { code, SRC, walk } from "./_source";

import { EXIT, ENTER, FAST, instant, SPRING } from "../src/ui/motion";

/** Every component that animates: the files importing motion/react, minus the
 * token module itself (type-only) and PayReceive (imperative `animate()`,
 * checked separately below — it has no `transition=` prop to count). */
const IMPERATIVE = new Set(["ui/PayReceive.tsx"]);

const animating = walk("", "code").filter(
  ([path, text]) =>
    /from "motion\/react"/.test(text) &&
    path !== "ui/motion.ts" &&
    !IMPERATIVE.has(path),
);

describe("every authored transition routes through instant()", () => {
  it("finds the components to check", () => {
    // if this drops to nothing the rest of the file is vacuous
    expect(animating.length).toBeGreaterThanOrEqual(6);
  });

  it.each(animating.map(([p]) => p))("%s", (path) => {
    const text = animating.find(([p]) => p === path)![1];

    // `transition={...}` props on motion components
    const props = text.match(/transition=\{/g) ?? [];
    const routed = text.match(/transition=\{instant\(/g) ?? [];
    expect(props.length).toBe(routed.length);

    /* `transition:` inside an exit or variant target — the other way a
       duration reaches motion, and the one InstrumentTable's row exit uses.
       The `\s*` lives INSIDE the lookahead deliberately: written as
       `transition:\s*(?!instant\()`, the star backtracks to zero width and
       the lookahead then reads the space instead of the call, so every
       correctly-routed site matched. That regex passed nothing and failed
       everything. */
    const inline =
      text.match(/transition:(?!\s*instant\()(?!\s*\{ duration: 0 \})/g) ?? [];
    expect(inline).toEqual([]);
  });

  it("no bare duration literal survives outside the token module", () => {
    // the seven ad-hoc durations pass B replaced; a new one is a regression
    for (const [path, text] of animating) {
      expect(text, path).not.toMatch(/duration:\s*0\.\d/);
    }
  });
});

describe("the imperative path checks the preference itself", () => {
  const payReceive = code("ui/PayReceive.tsx");

  it("PayReceive jumps rather than morphs under reduced motion", () => {
    // an imperative animate() sits outside MotionConfig entirely
    expect(payReceive).toMatch(/useReducedMotion\(\)/);
    expect(payReceive).toMatch(/mv\.jump\(/);
  });
});

describe("smooth scrolling is gated in JS", () => {
  const app = code("ui/App.tsx");
  const motionSrc = code("ui/motion.ts");

  it("no component calls scrollIntoView with a hardcoded smooth behaviour", () => {
    for (const [path, text] of walk("", "code")) {
      if (path === "ui/motion.ts") continue;
      expect(text, path).not.toMatch(/behavior:\s*["']smooth["']/);
    }
  });

  it("App scrolls through the gated helper", () => {
    expect(app).toMatch(/scrollIntoViewSafely\(/);
  });

  it("the helper reads the media query", () => {
    expect(motionSrc).toMatch(/prefers-reduced-motion: reduce/);
    expect(motionSrc).toMatch(/behavior: prefersReducedMotion\(\) \? "auto" : "smooth"/);
  });
});

describe("the CSS half exists", () => {
  const globals = readFileSync(join(SRC, "app", "globals.css"), "utf8");

  it("globals.css carries a reduce block", () => {
    expect(globals).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("it zeroes transitions AND animations, not just one", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/.exec(
      globals,
    )?.[0];
    expect(block).toBeTruthy();
    expect(block).toMatch(/transition-duration:\s*0s\s*!important/);
    expect(block).toMatch(/animation-duration:\s*0s\s*!important/);
    // an infinite animation with duration 0 still ticks forever in some engines
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });

  it("it is a blanket, so a future utility is covered the day it is written", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/.exec(
      globals,
    )?.[0];
    expect(block).toMatch(/\*,/);
  });
});

describe("instant() itself", () => {
  it("collapses any transition to zero duration", () => {
    expect(instant(SPRING, true)).toEqual({ duration: 0 });
    expect(instant(ENTER, true)).toEqual({ duration: 0 });
    expect(instant(EXIT, true)).toEqual({ duration: 0 });
    expect(instant(FAST, true)).toEqual({ duration: 0 });
  });

  it("passes the base through when motion is allowed", () => {
    expect(instant(SPRING, false)).toBe(SPRING);
    expect(instant(ENTER, false)).toBe(ENTER);
  });
});
