/* Guard: prefers-reduced-motion collapses every animation to an instant state
 * change (DESIGN §14). MotionConfig reducedMotion="user" enforces this at
 * runtime; here we assert the rule's core — instant() drops any spring to a
 * zero-duration transition when reduced motion is requested, and leaves it
 * untouched otherwise. */

import { describe, expect, it } from "vitest";

import { instant, SHEET_SPRING, SPRING } from "../src/ui/motion";

describe("reduced motion collapses animations to instant", () => {
  it("returns a zero-duration transition when reduced", () => {
    expect(instant(SPRING, true)).toEqual({ duration: 0 });
    expect(instant(SHEET_SPRING, true)).toEqual({ duration: 0 });
  });

  it("passes the spring through when motion is allowed", () => {
    expect(instant(SPRING, false)).toBe(SPRING);
    expect(instant(SHEET_SPRING, false)).toBe(SHEET_SPRING);
  });

  it("the springs themselves are springs (not tuned to 0)", () => {
    expect(SPRING.type).toBe("spring");
    expect(SPRING).toHaveProperty("stiffness");
  });
});
