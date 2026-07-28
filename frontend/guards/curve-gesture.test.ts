/* Guard: the pin gesture (motion session, Pass E). The real curve carries the
 * trade's intent as a GESTURE on a ghost copy — the data line never moves.
 * Geometry is the diagram's own (diagramSpec + modeShape), exaggerated to a
 * fixed px amount, confined to the instrument's band; volatility plays
 * nothing. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GESTURE, GESTURE_AMP_PX, gestureOffsets, hasCurveStatement } from "../src/ui/gesture";
import { labelToYears } from "../src/ui/payReceiveModel";
import type { Row } from "../src/ui/rows";

const NODES = ["3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"];

function row(group: Row["group"], id: string): Row {
  return {
    id,
    label: id,
    group,
    unit: "%",
    now: 3,
    changes: { d1: 0, wtd: 0, mtd: 0, qtd: 0, ytd: 0 },
    pct: null,
    seriesId: id,
    oneLiner: "",
    sortKey: [0],
    movePct: null,
  };
}

describe("gestureOffsets — the diagram's geometry on the node ladder", () => {
  it("a spread's deformation is confined to its band; zero outside", () => {
    const offs = gestureOffsets(row("spread", "5Y-10Y"), NODES)!;
    // band [0.5, 1]: every node up to 5Y sits at or before the band start
    NODES.forEach((label, i) => {
      if (labelToYears(label) <= 5) expect(offs[i]).toBe(0);
    });
    // something non-trivial happens inside (10Y is the band end → its
    // interior neighbours carry the tilt; the ladder has none between 5Y and
    // 10Y… so relax: at least one node deforms for a front spread instead)
    const front = gestureOffsets(row("spread", "1Y-10Y"), NODES)!;
    expect(Math.max(...front.map(Math.abs))).toBeGreaterThan(0);
  });

  it("the exaggeration is the fixed px amount, not the true bp", () => {
    // outright 5Y: plateau reaches exactly GESTURE_AMP_PX inside its band
    const offs = gestureOffsets(row("outright", "5Y"), NODES)!;
    expect(Math.max(...offs.map(Math.abs))).toBeCloseTo(GESTURE_AMP_PX, 6);
  });

  it("receive is the exact negation of pay", () => {
    const pay = gestureOffsets(row("outright", "5Y"), NODES, "pay")!;
    const rec = gestureOffsets(row("outright", "5Y"), NODES, "receive")!;
    pay.forEach((v, i) => expect(rec[i]).toBeCloseTo(-v, 9));
  });

  it("volatility makes no curve statement — nothing plays", () => {
    const vol: Row = { ...row("vol", "vol:3M"), unit: "ratio" };
    expect(gestureOffsets(vol, NODES)).toBeNull();
    expect(hasCurveStatement(vol)).toBe(false);
    expect(hasCurveStatement(row("spread", "1Y-10Y"))).toBe(true);
  });
});

describe("timing: slower than the interface's other motion", () => {
  it("deform ~400ms, hold ~600ms, fade ~300ms", () => {
    expect(GESTURE).toEqual({ deformMs: 400, holdMs: 600, fadeMs: 300 });
  });
});

describe("the data line never moves", () => {
  const src = readFileSync(
    join(__dirname, "..", "src", "ui", "CurveView.tsx"),
    "utf8",
  );
  it("the ghost is a separate dashed polyline; the now-line is untouched", () => {
    expect(src).toContain("strokeDasharray");
    // the data polyline's points come only from line("now") — no
    // progress/offset term anywhere near it
    expect(src).toMatch(/points=\{line\("now"\)\}/);
  });
  it("reduced motion shows the deformed ghost statically", () => {
    expect(src).toContain("useReducedMotion");
    expect(src).toMatch(/useState\(reduced \? 1 : 0\)/);
  });
});
