/* Guard: the right pane does NOT animate on pin (strip session, Pass A).
 *
 * The ghost-curve gesture was removed — at a 10px peak against a curve
 * spanning 136bp it was too small to read as an intent and large enough to
 * draw the eye. The popup's mode diagram makes the same statement on a
 * SCHEMATIC curve where the exaggeration can be large enough to work, so the
 * gesture was the worse of two attempts at one job. This guard fails if it
 * (or any pane animation on pin) comes back, and pins what survived: the
 * corner label naming the pinned instrument and its mode.
 *
 * The diagram's own geometry (diagramSpec / toBand / modeShape) stays — the
 * popup still uses it; only the curve-view rendering of it is gone. */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* Comments stripped: the removal is EXPLAINED in prose in both files, so the
 * ban must look at code only or the explanation trips its own guard. This was
 * the first of four occurrences; the shared reader is Pass D's answer. */
import { code } from "./_source";

const curveView = code("ui/CurveView.tsx");
const app = code("ui/App.tsx");

describe("no gesture in the right pane", () => {
  it("the gesture module is gone", () => {
    expect(existsSync(join(__dirname, "..", "src", "ui", "gesture.ts"))).toBe(false);
  });

  it("CurveView animates nothing — no motion imports, no ghost", () => {
    expect(curveView).not.toMatch(/from "motion\/react"/);
    /* `strokeDasharray` used to be banned here too, as a proxy for the ghost
     * curve's draw-on animation. It is the wrong proxy: a dash PATTERN is
     * static, and the base-rate reference line (2026-07-31) is dashed
     * precisely so it reads as a reference in grayscale without a second hue
     * (§5). What actually animates a dash is `strokeDashoffset`, so that is
     * what is banned — the guard now names the thing it means. */
    expect(curveView).not.toMatch(/animate\(|useReducedMotion|strokeDashoffset/);
    expect(curveView).not.toMatch(/CurveGesture|ghost/i);
  });

  it("pinning is a plain state set — no gesture trigger in App", () => {
    expect(app).not.toMatch(/CurveGesture|gestureSeq|hasCurveStatement/);
    expect(app).toContain("onPin={setPinned}");
  });
});

describe("what survived: the pane's corner label", () => {
  it("names the pinned instrument and its mode", () => {
    expect(app).toContain("pinnedMode");
    expect(app).toMatch(/diagramSpec\(classify\(pinned\), "pay"\)\?\.term/);
    // rendered as `label · mode`
    expect(app).toMatch(/\$\{pinnedMode\}/);
  });
});

describe("the diagram's geometry is untouched", () => {
  it("payReceiveModel still exports the shared mode helpers", () => {
    const model = code("ui/payReceiveModel.ts");
    expect(model).toMatch(/export function modeShape/);
    expect(model).toMatch(/export function diagramSpec/);
  });
});
