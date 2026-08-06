/* Guard: the motion timing system is THREE durations and ONE curve, defined
 * once and mirrored exactly (DESIGN §14, pass B).
 *
 * Two failure modes this exists for, both with precedent in this repo:
 *
 *  1. DRIFT between the CSS tokens and the TS mirror. motion/react takes
 *     numbers and cannot read a custom property, so the values necessarily
 *     live twice — the same arrangement theme/ramp.ts EDGE_OPACITY has with
 *     the dark hairlines, and ramp-sync.test.ts is the model for this file.
 *
 *  2. DEFINED-BUT-UNREFERENCED. `--radius-card` and `--radius-sheet` sat in
 *     tokens.css for sessions while every call site hardcoded
 *     `rounded-[16px]`, and it was only caught by reading the EMITTED CSS
 *     rather than the source. So this checks the built stylesheet, not just
 *     the token file: Tailwind reads source text, and a token wired to a
 *     `@theme` key that Tailwind does not recognise silently generates
 *     nothing.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { css, SRC } from "./_source";

import { EASE_OUT, ENTER, EXIT, FAST, MOTION } from "../src/ui/motion";

const tokens = css("theme/tokens.css");

/** ms out of the CSS token, e.g. `--bw-motion-base: 220ms`. */
function cssMs(name: string): number {
  const m = new RegExp(`--bw-${name}:\\s*(\\d+)ms`).exec(tokens);
  if (!m) throw new Error(`--bw-${name} missing from tokens.css`);
  return Number(m[1]);
}

describe("CSS tokens and the TS mirror agree", () => {
  it.each([
    ["motion-fast", MOTION.fast],
    ["motion-base", MOTION.base],
    ["motion-exit", MOTION.exit],
  ])("--bw-%s === %s s", (name, seconds) => {
    expect(cssMs(name)).toBe(Math.round(seconds * 1000));
  });

  it("--bw-ease-out === EASE_OUT", () => {
    const m = /--bw-ease-out:\s*cubic-bezier\(([^)]+)\)/.exec(tokens);
    expect(m).toBeTruthy();
    const nums = m![1].split(",").map((s) => Number(s.trim()));
    expect(nums).toEqual([...EASE_OUT]);
  });
});

describe("the system is three durations and one curve", () => {
  it("exactly three duration tokens", () => {
    const all = tokens.match(/--bw-motion-[a-z]+:/g) ?? [];
    expect(all.sort()).toEqual([
      "--bw-motion-base:",
      "--bw-motion-exit:",
      "--bw-motion-fast:",
    ]);
  });

  it("exactly one easing token — no --bw-ease-spring", () => {
    const all = tokens.match(/--bw-ease-[a-z-]+:/g) ?? [];
    expect(all).toEqual(["--bw-ease-out:"]);
  });

  it("an exit is shorter than an entrance, and fast is shortest", () => {
    // §14's grammar, stated as arithmetic so a future edit cannot invert it
    expect(MOTION.fast).toBeLessThan(MOTION.exit);
    expect(MOTION.exit).toBeLessThan(MOTION.base);
  });

  it("every exported transition uses the one curve and no other", () => {
    for (const t of [ENTER, EXIT, FAST]) {
      expect(t.ease).toBe(EASE_OUT);
    }
  });

  it("the curve decelerates: it starts fast and ends flat", () => {
    // y1 > x1 means the output leads the input early on (deceleration);
    // y2 === 1 with x2 < 1 means it arrives and flattens rather than easing
    // in at the end. This is the property the reference is picked FOR, and
    // the one every implicit `easeInOut` in the product violated.
    const [x1, y1, , y2] = EASE_OUT;
    expect(y1).toBeGreaterThan(x1);
    expect(y2).toBe(1);
  });
});

describe("the tokens actually reach the built stylesheet", () => {
  /* The --radius-card lesson: read the EMITTED CSS, because Tailwind reads
   * source text and a `@theme` key it does not recognise generates nothing
   * while the source looks perfectly correct.
   *
   * THE LAG IS REAL AND IS HANDLED, NOT IGNORED. The gate runs vitest BEFORE
   * `pnpm build`, so whatever is on disk describes the PREVIOUS build. A
   * naive read would have asserted against stale output — which is how a
   * guard comes to pass while its subject is broken, the exact defect class
   * this repo has hit three times. So the check runs only when the build is
   * newer than both CSS sources, and is skipped (visibly, by name) otherwise.
   * The source-level assertions above hold unconditionally and carry the
   * intent; this block is the belt for the generation trap, and it bites on
   * the second gate run after a token change. */
  const dir = join(SRC, "..", ".next", "static", "chunks");
  const cssFiles = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".css"))
    : [];
  const newestBuild = Math.max(
    0,
    ...cssFiles.map((f) => statSync(join(dir, f)).mtimeMs),
  );
  const newestSource = Math.max(
    statSync(join(SRC, "theme", "tokens.css")).mtimeMs,
    statSync(join(SRC, "app", "globals.css")).mtimeMs,
  );
  const fresh = cssFiles.length > 0 && newestBuild > newestSource;
  const built = fresh
    ? cssFiles.map((f) => readFileSync(join(dir, f), "utf8")).join("\n")
    : null;

  it.runIf(built)("Tailwind's transition defaults point at the tokens", () => {
    // this is what makes `transition-opacity` / `transition-colors` obey the
    // system without either call site naming a duration
    expect(built).toContain("--default-transition-duration:var(--bw-motion-fast)");
    expect(built).toContain(
      "--default-transition-timing-function:var(--bw-ease-out)",
    );
  });

  it.runIf(built)("the reduce blanket survived the build", () => {
    expect(built).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it.runIf(built)("the old ad-hoc Tailwind defaults are gone", () => {
    // .15s / cubic-bezier(.4,0,.2,1) were Tailwind's, never chosen here
    expect(built).not.toContain("--default-transition-duration:.15s");
  });
});
