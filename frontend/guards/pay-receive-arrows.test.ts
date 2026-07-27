/* Guard: the Pay/Receive diagram's arrow directions match the sign convention
 * — **Pay profits when the displayed value rises; Receive is the exact mirror.**
 * A later refactor of payReceiveModel.ts must not silently invert a leg. Also
 * pins the forward's "interpolate, don't snap" rule and the ghost's correct side
 * (so it can never imply the opposite trade). */

import { describe, expect, it } from "vitest";

import type { Construct } from "../src/ui/gloss";
import {
  buildDiagramModel,
  DIAGRAM_NODES,
  labelToYears,
  yearsToFrac,
  yearsToLabel,
  type Side,
} from "../src/ui/payReceiveModel";

// A plausible upward-sloping KRW par curve at the nine nodes.
const CURVE = [2.9, 3.1, 3.3, 3.5, 3.75, 3.9, 4.0, 4.15, 4.27];
const idx = (id: string) => DIAGRAM_NODES.indexOf(id as (typeof DIAGRAM_NODES)[number]);

function legArrows(c: Construct, side: Side): Map<number, number> {
  const m = buildDiagramModel(c, CURVE, side);
  if (!m) throw new Error("no model");
  return new Map(m.legs.map((l) => [Number(l.frac.toFixed(4)), l.arrow]));
}

describe("label / year helpers", () => {
  it("parses composite, half-year, month and overnight labels", () => {
    expect(labelToYears("1Y3M")).toBeCloseTo(1.25, 9);
    expect(labelToYears("9M")).toBeCloseTo(0.75, 9);
    expect(labelToYears("1.5Y")).toBeCloseTo(1.5, 9);
    expect(labelToYears("10Y")).toBe(10);
    expect(labelToYears("1D")).toBeCloseTo(1 / 365, 9);
  });

  it("formats years back to composite labels", () => {
    expect(yearsToLabel(3.25)).toBe("3Y3M");
    expect(yearsToLabel(10)).toBe("10Y");
    expect(yearsToLabel(0.75)).toBe("9M");
  });

  it("maps years to fractional node indices (nodes land exactly)", () => {
    expect(yearsToFrac(5)).toBe(idx("5Y")); // 7
    expect(yearsToFrac(10)).toBe(idx("10Y")); // 8
    expect(yearsToFrac(0.25)).toBe(0);
    expect(yearsToFrac(1.25)).toBeCloseTo(3.5, 6); // between 1Y and 1.5Y
  });
});

describe("Pay arrows follow the sign convention (value rises → up)", () => {
  it("outright: the tenor node points up", () => {
    const a = legArrows({ kind: "outright", tenor: "5Y" }, "pay");
    expect(a.get(idx("5Y"))).toBe(1);
  });

  it("spread: long up, short down (paying a spread = steepening)", () => {
    const a = legArrows({ kind: "spread", short: "1Y", long: "3Y" }, "pay");
    expect(a.get(idx("3Y"))).toBe(1); // long leg
    expect(a.get(idx("1Y"))).toBe(-1); // short leg
  });

  it("butterfly: belly up, both wings down (belly cheapens)", () => {
    const a = legArrows(
      { kind: "butterfly", short: "1Y", belly: "3Y", long: "5Y" },
      "pay",
    );
    expect(a.get(idx("3Y"))).toBe(1); // belly
    expect(a.get(idx("1Y"))).toBe(-1); // short wing
    expect(a.get(idx("5Y"))).toBe(-1); // long wing
  });

  it("forward: far end up, near end down (segment steepens)", () => {
    const a = legArrows({ kind: "forward", start: "5Y", tenor: "5Y" }, "pay");
    expect(a.get(idx("10Y"))).toBe(1); // far end (5Y+5Y)
    expect(a.get(idx("5Y"))).toBe(-1); // near end
  });
});

describe("Receive is the exact mirror of Pay", () => {
  const kinds: Construct[] = [
    { kind: "outright", tenor: "5Y" },
    { kind: "spread", short: "1Y", long: "3Y" },
    { kind: "butterfly", short: "1Y", belly: "3Y", long: "5Y" },
    { kind: "forward", start: "5Y", tenor: "5Y" },
    { kind: "forward", start: "1Y3M", tenor: "2Y" },
  ];

  it.each(kinds)("every leg arrow flips for %o", (c) => {
    const pay = legArrows(c, "pay");
    const rec = legArrows(c, "receive");
    expect([...rec.keys()].sort()).toEqual([...pay.keys()].sort());
    for (const [frac, arrow] of pay) {
      expect(rec.get(frac)).toBe(-arrow);
    }
  });

  it("ghost mirrors about the current curve (spread)", () => {
    const c: Construct = { kind: "spread", short: "1Y", long: "3Y" };
    const pay = buildDiagramModel(c, CURVE, "pay")!;
    const rec = buildDiagramModel(c, CURVE, "receive")!;
    for (let i = 0; i < pay.ghost.length; i++) {
      const base = CURVE[Math.round(pay.ghost[i].frac)];
      // pay deviation and receive deviation are equal and opposite
      expect(rec.ghost[i].rate - base).toBeCloseTo(-(pay.ghost[i].rate - base), 9);
    }
  });
});

describe("forward interpolates, never snaps to a node", () => {
  it("1Y3Mx2Y legs sit between quoted nodes", () => {
    const m = buildDiagramModel(
      { kind: "forward", start: "1Y3M", tenor: "2Y" },
      CURVE,
      "pay",
    )!;
    const fracs = m.legs.map((l) => l.frac).sort((a, b) => a - b);
    // near = 1.25y → 3.5 ; far = 3.25y → 6.125 ; neither is an integer node
    expect(fracs[0]).toBeCloseTo(3.5, 6);
    expect(fracs[1]).toBeCloseTo(6.125, 6);
    expect(Number.isInteger(fracs[0])).toBe(false);
    expect(Number.isInteger(fracs[1])).toBe(false);
    expect(m.shaded).toBe(true);
    expect(m.regionLabel).toBe("선도 구간");
  });
});

describe("ghost sits on the profitable side (no opposite-trade implication)", () => {
  it("spread pay: ghost lifts the long leg and drops the short", () => {
    const m = buildDiagramModel(
      { kind: "spread", short: "1Y", long: "3Y" },
      CURVE,
      "pay",
    )!;
    const gLong = m.ghost.find((g) => g.frac === idx("3Y"))!;
    const gShort = m.ghost.find((g) => g.frac === idx("1Y"))!;
    expect(gLong.rate).toBeGreaterThan(CURVE[idx("3Y")]);
    expect(gShort.rate).toBeLessThan(CURVE[idx("1Y")]);
  });

  it("forward pay: ghost rotates near-end below, far-end above the curve", () => {
    const m = buildDiagramModel(
      { kind: "forward", start: "5Y", tenor: "5Y" },
      CURVE,
      "pay",
    )!;
    const near = m.ghost[0];
    const far = m.ghost[1];
    expect(near.rate).toBeLessThan(CURVE[idx("5Y")]);
    expect(far.rate).toBeGreaterThan(CURVE[idx("10Y")]);
  });
});

describe("no curve statement → no model", () => {
  it("volatility and unknown return null", () => {
    expect(buildDiagramModel({ kind: "volatility", tenor: "3Y" }, CURVE, "pay")).toBeNull();
    expect(buildDiagramModel({ kind: "unknown" }, CURVE, "pay")).toBeNull();
  });
});
