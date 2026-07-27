/* Guard: the Pay/Receive diagram is a MODE picture (diagram rebuild). Each
 * instrument kind maps to exactly one curve mode; Receive is the exact negation
 * of Pay; the wanted shape stays inside the plot; the label matches the mode +
 * direction; and the SVG draws only the two curves + the fill (no markers, no
 * tenor text — the regression that came back twice). */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Construct } from "../src/ui/gloss";
import {
  baseValue,
  diagramSpec,
  N,
  wantedValue,
} from "../src/ui/payReceiveModel";

const KINDS: [string, Construct, string][] = [
  ["outright", { kind: "outright", tenor: "5Y" }, "level"],
  ["spread", { kind: "spread", short: "1Y", long: "10Y" }, "slope"],
  ["forward", { kind: "forward", start: "5Y", tenor: "5Y" }, "slope"],
  ["butterfly", { kind: "butterfly", short: "1Y", belly: "3Y", long: "5Y" }, "curvature"],
];

describe("each instrument kind maps to its curve mode", () => {
  it.each(KINDS)("%s → %s", (_n, c, mode) => {
    expect(diagramSpec(c, "pay")!.mode).toBe(mode);
  });

  it("a forward is a slope confined to a band; a spread is not", () => {
    expect(diagramSpec({ kind: "forward", start: "5Y", tenor: "5Y" }, "pay")!.band).toBeDefined();
    expect(diagramSpec({ kind: "spread", short: "1Y", long: "10Y" }, "pay")!.band).toBeUndefined();
  });

  it("volatility and unknown have no diagram", () => {
    expect(diagramSpec({ kind: "volatility", tenor: "3Y" }, "pay")).toBeNull();
    expect(diagramSpec({ kind: "unknown" }, "pay")).toBeNull();
  });
});

describe("Receive is the exact negation of Pay", () => {
  it.each(KINDS)("%s: same mode/band, sign flips, deformation negates", (_n, c) => {
    const pay = diagramSpec(c, "pay")!;
    const rec = diagramSpec(c, "receive")!;
    expect(rec.mode).toBe(pay.mode);
    expect(rec.band).toEqual(pay.band);
    expect(rec.sign).toBe(-pay.sign);
    expect(rec.term).not.toBe(pay.term);
    // the wanted-vs-current deformation is exactly opposite at every sample
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const dPay = wantedValue(pay, t) - baseValue(t);
      const dRec = wantedValue(rec, t) - baseValue(t);
      expect(dRec).toBeCloseTo(-dPay, 9);
    }
  });
});

describe("the wanted shape stays inside the plot (value domain [0,1])", () => {
  const specs = KINDS.flatMap(([, c]) => [
    diagramSpec(c, "pay")!,
    diagramSpec(c, "receive")!,
  ]);
  it.each(specs)("wanted(t) in [0,1] for %o", (spec) => {
    for (let i = 0; i < N; i++) {
      const v = wantedValue(spec, i / (N - 1));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("the label matches the mode and direction", () => {
  const cases: [Construct, string, string][] = [
    [{ kind: "outright", tenor: "5Y" }, "금리 상승", "금리 하락"],
    [{ kind: "spread", short: "1Y", long: "10Y" }, "스티프닝", "플래트닝"],
    [{ kind: "forward", start: "5Y", tenor: "5Y" }, "스티프닝", "플래트닝"],
    [{ kind: "butterfly", short: "1Y", belly: "3Y", long: "5Y" }, "벨리 약세", "벨리 강세"],
  ];
  it.each(cases)("%o → pay %s / receive %s", (c, pay, rec) => {
    expect(diagramSpec(c, "pay")!.term).toBe(pay);
    expect(diagramSpec(c, "receive")!.term).toBe(rec);
  });
});

describe("the SVG carries only the shape — no markers, no tenor text", () => {
  const src = readFileSync(
    join(__dirname, "..", "src", "ui", "PayReceive.tsx"),
    "utf8",
  );
  it("renders no leg markers (<circle>) and no in-svg text (<text>)", () => {
    expect(src).not.toMatch(/<circle/);
    expect(src).not.toMatch(/<text/);
  });
  it("draws exactly the two curve paths (current + wanted)", () => {
    expect(src).toContain("smoothPath(cur)");
    expect(src).toContain("smoothPath(want)");
  });
});
