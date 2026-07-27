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
  MIN_BAND,
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

  it("volatility and unknown have no diagram", () => {
    expect(diagramSpec({ kind: "volatility", tenor: "3Y" }, "pay")).toBeNull();
    expect(diagramSpec({ kind: "unknown" }, "pay")).toBeNull();
  });
});

describe("every kind carries exactly one positional band (band session)", () => {
  it.each(KINDS)("%s renders a band", (_n, c) => {
    const band = diagramSpec(c, "pay")!.band;
    expect(band).toBeDefined();
    expect(band[1]).toBeGreaterThan(band[0]);
  });

  it("the band's span matches the instrument's legs (10y x-domain)", () => {
    // forward 5Y×5Y covers years 5..10; spread/fly span leg to leg / wing to wing
    expect(diagramSpec({ kind: "forward", start: "5Y", tenor: "5Y" }, "pay")!.band).toEqual([0.5, 1]);
    expect(diagramSpec({ kind: "spread", short: "1Y", long: "10Y" }, "pay")!.band).toEqual([0.1, 1]);
    expect(
      diagramSpec({ kind: "butterfly", short: "1Y", belly: "3Y", long: "5Y" }, "pay")!.band,
    ).toEqual([0.1, 0.5]);
  });

  it("an outright's band is narrow, centred on its tenor", () => {
    const band = diagramSpec({ kind: "outright", tenor: "5Y" }, "pay")!.band;
    expect((band[0] + band[1]) / 2).toBeCloseTo(0.5, 9);
    expect(band[1] - band[0]).toBeCloseTo(MIN_BAND, 9);
  });

  it("a narrow-span instrument gets the minimum band width, inside the plot", () => {
    // 1s1.5s raw span is 5% of the plot — a sliver; it widens to MIN_BAND
    const band = diagramSpec({ kind: "spread", short: "1Y", long: "1.5Y" }, "pay")!.band;
    expect(band[1] - band[0]).toBeCloseTo(MIN_BAND, 9);
    expect(band[0]).toBeGreaterThanOrEqual(0);
    expect(band[1]).toBeLessThanOrEqual(1);
  });

  it("bands distinguish same-mode instruments (1s2s vs 5s10s)", () => {
    const near = diagramSpec({ kind: "spread", short: "1Y", long: "2Y" }, "pay")!.band;
    const far = diagramSpec({ kind: "spread", short: "5Y", long: "10Y" }, "pay")!.band;
    expect(near).not.toEqual(far);
  });

  it.each(KINDS)("%s: the wanted curve equals the current curve outside the band", (_n, c) => {
    for (const side of ["pay", "receive"] as const) {
      const spec = diagramSpec(c, side)!;
      const [t0, t1] = spec.band;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        if (t <= t0 || t >= t1) {
          expect(wantedValue(spec, t)).toBeCloseTo(baseValue(t), 12);
        }
      }
    }
  });

  it.each(KINDS)("%s: the deformation is non-trivial inside the band", (_n, c) => {
    const spec = diagramSpec(c, "pay")!;
    const [t0, t1] = spec.band;
    let maxAbs = 0;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      if (t > t0 && t < t1) {
        maxAbs = Math.max(maxAbs, Math.abs(wantedValue(spec, t) - baseValue(t)));
      }
    }
    expect(maxAbs).toBeGreaterThan(0.1); // exaggerated, not a sliver
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
  it("draws exactly one band rect, and it carries no text or boundary marks", () => {
    // one <rect> = the positional band; the no-<text> check above keeps it
    // unlabelled, and there is no <line> that could mark its boundaries
    expect(src.match(/<rect/g)).toHaveLength(1);
    expect(src).not.toMatch(/<line/);
  });
});
