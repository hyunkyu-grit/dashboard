/* Guard: the CD + base-rate overlay on SPREAD and BUTTERFLY charts
 * [OWNER, 2026-08-03].
 *
 * A bp instrument and a % reference share no unit, so the overlay there is a
 * DUAL AXIS: the instrument keeps its own bp scale, the references keep their
 * own % scale, and both axes are labelled with their unit. The two failure
 * modes this pins are both silent and both plausible-looking:
 *
 *   — a shared scale: the spread's ±30bp domain is stretched to hold 2.75,
 *     flattening the spread into a hairline (or pinning the references off
 *     the plot). "Neither series is rescaled into the other's range" is
 *     asserted, not eyeballed.
 *   — an unlabelled second axis: with two scales on one plot, a reader has no
 *     way to know 2.75 is not 2.75bp. Both units must be printed.
 *
 * WHICH charts take which mode is DERIVED FROM THE ROW MODEL — `buildRows`
 * over the committed static payloads — never from a hand-written list of
 * kinds. The kind someone forgets to list is the kind that breaks.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ForwardsPayload,
  HistoryPoint,
  PolicyStep,
  Unit,
  VolatilityPayload,
  WallSummary,
} from "../src/lib/api";
import { PreviewChart } from "../src/ui/PreviewChart";
import { policyAxisMode, takesPolicyOverlay } from "../src/ui/policyLine";
import { buildRows } from "../src/ui/rows";

/* ── the row model, from the payloads the product actually ships ────────── */

const payload = <T,>(rel: string): T =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "public", "api", rel), "utf8"),
  ) as T;

const rows = buildRows(
  payload<WallSummary>("wall/summary.json"),
  payload<ForwardsPayload>("forwards.json"),
  payload<VolatilityPayload>("volatility.json"),
);

describe("which chart kinds take the overlay comes from the row model", () => {
  it("the model actually exercises every unit (non-vacuous)", () => {
    const units = new Set(rows.map((r) => r.unit));
    for (const u of ["%", "bp", "ratio"] as const) {
      expect(units.has(u), `no ${u} rows in the shipped payloads`).toBe(true);
    }
  });

  it("every non-ratio row's chart takes the overlay; every ratio row's does not", () => {
    for (const r of rows) {
      expect(
        takesPolicyOverlay(r.unit),
        `${r.group} row ${r.id} (${r.unit}): overlay gate disagrees with its unit`,
      ).toBe(r.unit !== "ratio");
    }
  });

  it("bp rows exist and land on the secondary axis; % rows share; a group never straddles", () => {
    const modesByGroup = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = modesByGroup.get(r.group) ?? new Set();
      set.add(String(policyAxisMode(r.unit)));
      modesByGroup.set(r.group, set);
    }
    // one axis answer per chart kind — a kind whose rows split between modes
    // would draw the same chart two ways depending on the row
    for (const [g, modes] of modesByGroup) {
      expect(modes.size, `${g} rows disagree about their axis mode`).toBe(1);
    }
    const secondary = rows.filter((r) => policyAxisMode(r.unit) === "secondary");
    expect(secondary.length, "no chart kind reads bp — the dual axis is dead code").toBeGreaterThan(0);
    for (const r of secondary) expect(r.unit).toBe("bp");
  });
});

/* ── the rendered chart: two scales, two labels, no rescaling ───────────── */

const DATES = [
  "2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05",
  "2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05",
];
const spreadPts: HistoryPoint[] = DATES.map((t, i) => ({
  t,
  v: 20 + 10 * Math.sin(i), // a spread wandering ~10–30bp
  d: 0,
}));
const cdPts: HistoryPoint[] = DATES.map((t, i) => ({
  t,
  v: 2.5 + i * (1.0 / 7), // CD walking 2.5% → 3.5%
  d: 0,
}));
const policy: PolicyStep = {
  unit: "%",
  asof: DATES[DATES.length - 1],
  through: DATES[DATES.length - 1],
  steps: [{ date: DATES[0], rate: 3.0 }],
  latest: 3.0,
  warnings: [],
};

const W = 600;
const H = 300;

function markup(unit: Unit, points: HistoryPoint[], withRefs: boolean): string {
  return renderToStaticMarkup(
    createElement(PreviewChart, {
      points,
      stats: { min: 0, max: 1, avg: 0.5 },
      unit,
      width: W,
      height: H,
      policy: withRefs ? policy : undefined,
      cd: withRefs ? cdPts : undefined,
    }),
  );
}

function polylines(m: string): { attrs: string; ys: number[] }[] {
  return [...m.matchAll(/<polyline([^>]*)>/g)].map((match) => {
    const attrs = match[1];
    const pts = /points="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const ys = pts
      .split(" ")
      .filter(Boolean)
      .map((p) => Number(p.split(",")[1]));
    return { attrs, ys };
  });
}

const instrumentLine = (m: string) =>
  polylines(m).find((p) => p.attrs.includes('stroke-width="1.6"'));
const cdLine = (m: string) =>
  polylines(m).find((p) => p.attrs.includes('stroke-dasharray="1 2"'));
const policyLine = (m: string) =>
  polylines(m).find((p) => p.attrs.includes('stroke-dasharray="3 3"'));

describe("a spread chart with the overlay on (secondary mode)", () => {
  const bare = markup("bp", spreadPts, false);
  const laid = markup("bp", spreadPts, true);

  it("draws both references", () => {
    expect(cdLine(laid), "CD missing from the bp chart").toBeTruthy();
    expect(policyLine(laid), "base rate missing from the bp chart").toBeTruthy();
  });

  it("never rescales the instrument to hold the references", () => {
    // the spread's own line must be BYTE-IDENTICAL with and without the
    // overlay — a widened domain here is the shared-scale failure
    const a = instrumentLine(bare);
    const b = instrumentLine(laid);
    expect(a && b).toBeTruthy();
    expect(b!.attrs).toBe(a!.attrs);
  });

  it("never rescales the references into the instrument's bp range", () => {
    /* Under ANY single scale holding both series, CD's 1.0-unit span against
     * the spread's ~20-unit span is squashed under ~10% of the plot (or, on
     * the untouched bp domain, pushed off-canvas entirely). On its own axis
     * it spans most of the plot. Span, not position, is the discriminator. */
    const cd = cdLine(laid)!;
    const span = Math.max(...cd.ys) - Math.min(...cd.ys);
    expect(span).toBeGreaterThan(0.4 * H);
    for (const y of cd.ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(H);
    }
  });

  it("labels BOTH axes with their unit, each on its own scale", () => {
    const texts = [...laid.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    const bpTicks = texts
      .filter((t) => /^-?[\d.]+bp$/.test(t))
      .map((t) => Number.parseFloat(t));
    const pctTicks = texts
      .filter((t) => /^-?[\d.]+%$/.test(t))
      .map((t) => Number.parseFloat(t));
    expect(bpTicks.length, "no bp-unit axis labels").toBeGreaterThanOrEqual(2);
    expect(pctTicks.length, "no %-unit axis labels").toBeGreaterThanOrEqual(2);
    // and the values orient on the right scales: ticks inside each series'
    // own domain, which do not overlap in this fixture
    for (const v of bpTicks) {
      expect(v).toBeGreaterThan(5);
      expect(v).toBeLessThan(35);
    }
    for (const v of pctTicks) {
      expect(v).toBeGreaterThan(2.0);
      expect(v).toBeLessThan(4.0);
    }
  });
});

describe("the other two modes did not move", () => {
  it("a % chart still WIDENS its one shared axis to hold the references", () => {
    const pct: HistoryPoint[] = DATES.map((t, i) => ({ t, v: 3.4 + i * 0.01, d: 0 }));
    // policy at 3.0 sits below the series; sharing the axis must move the line
    const bare = instrumentLine(markup("%", pct, false))!;
    const laid = instrumentLine(markup("%", pct, true))!;
    expect(laid.attrs).not.toBe(bare.attrs);
    // and a shared axis carries NO per-unit tick labels — one scale, no
    // ambiguity for a label to resolve
    const texts = [...markup("%", pct, true).matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
      .map((m) => m[1]);
    expect(texts.filter((t) => /^-?[\d.]+(bp|%)$/.test(t))).toEqual([]);
  });

  it("a ratio chart still draws no reference at all", () => {
    const ratio: HistoryPoint[] = DATES.map((t, i) => ({ t, v: 1 + i * 0.1, d: 0 }));
    const m = markup("ratio", ratio, true);
    expect(cdLine(m)).toBeUndefined();
    expect(policyLine(m)).toBeUndefined();
  });
});
