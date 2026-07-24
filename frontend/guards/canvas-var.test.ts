/* Guard: canvas-bound option objects must never carry unresolved CSS vars.
 * assertNoCssVars() is the runtime gate every canvas option factory calls;
 * this test pins its behavior (design spec §9 theme-bridge rule).
 */

import { describe, expect, it } from "vitest";

import { assertNoCssVars } from "../src/theme/bridge";

describe("assertNoCssVars", () => {
  it("accepts resolved color strings", () => {
    expect(() =>
      assertNoCssVars({
        layout: { background: "rgb(250, 250, 250)", textColor: "rgb(26, 26, 26)" },
        series: [{ color: "rgba(26, 26, 26, 0.78)", lineWidth: 1.5 }],
      }),
    ).not.toThrow();
  });

  it("rejects a top-level var() string", () => {
    expect(() => assertNoCssVars("var(--bw-ink)")).toThrow(/unresolved CSS var/);
  });

  it("rejects nested var() strings and names the path", () => {
    expect(() =>
      assertNoCssVars({ series: [{ color: "var(--bw-ink)" }] }),
    ).toThrow(/options\.series\[0\]\.color/);
  });

  it("tolerates null, numbers, booleans, functions", () => {
    expect(() =>
      assertNoCssVars({ a: null, b: 1, c: true, d: () => "var(--x)" }),
    ).not.toThrow();
  });
});
