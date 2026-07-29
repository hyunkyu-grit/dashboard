/* Guard: freshness is computed against the READER's clock, and against the
 * real KR business calendar.
 *
 * Static conversion, Pass C. Every other number in the product is a pure
 * function of the xlsx and is safe to freeze at build time. This one is not:
 * "how old is the data" is a question about now. Baked into the build it would
 * answer as of the build and then go on being wrong silently — which is the
 * precise failure the indicator was added to prevent, reintroduced by the
 * hosting change.
 *
 * The manifest under test is the committed one, so these also confirm the
 * pipeline actually emitted the ladder rather than an empty array.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  freshnessFrom,
  localIsoDate,
  type Manifest,
} from "../src/lib/freshness";

const manifest: Manifest = JSON.parse(
  readFileSync(join(__dirname, "..", "public", "api", "manifest.json"), "utf8"),
);

/** Noon local, so a timezone slip shows up as a wrong DATE rather than hiding. */
const at = (iso: string) => new Date(`${iso}T12:00:00`);

describe("the committed manifest carries what freshness needs", () => {
  it("has a business-day ladder, not an empty array", () => {
    expect(manifest.businessDaysAfter.length).toBeGreaterThan(300);
  });

  it("the ladder is ascending and strictly after asof", () => {
    const d = manifest.businessDaysAfter;
    expect(d[0] > manifest.asof).toBe(true);
    for (let i = 1; i < d.length; i++) expect(d[i] > d[i - 1]).toBe(true);
  });

  it("the ladder is a KR business calendar, not just weekdays", () => {
    // no weekends...
    for (const iso of manifest.businessDaysAfter) {
      const wd = at(iso).getDay();
      expect(wd).not.toBe(0);
      expect(wd).not.toBe(6);
    }
    // ...and holidays are missing too. 2026-08-17 is the observed Liberation
    // Day (the 15th falls on a Saturday), so a weekday-only ladder would
    // include it and this is what distinguishes the two.
    expect(manifest.businessDaysAfter).not.toContain("2026-08-17");
    expect(manifest.businessDaysAfter).toContain("2026-08-18");
  });

  it("carries the thresholds rather than duplicating them here", () => {
    expect(manifest.freshnessThresholds).toEqual({ behind: 1, stale: 2 });
  });
});

describe("freshnessFrom counts business days against the reader's clock", () => {
  const m: Manifest = {
    ...manifest,
    asof: "2026-07-24", // a Friday
    businessDaysAfter: ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30"],
    freshnessThresholds: { behind: 1, stale: 2 },
  };

  it("is current on the as-of date itself", () => {
    const f = freshnessFrom(m, at("2026-07-24"));
    expect(f.ageBusinessDays).toBe(0);
    expect(f.level).toBe("current");
  });

  it("is still current across the weekend — the market was shut", () => {
    for (const d of ["2026-07-25", "2026-07-26"]) {
      const f = freshnessFrom(m, at(d));
      expect(f.ageBusinessDays).toBe(0);
      expect(f.level).toBe("current");
    }
  });

  it("goes behind after one business day, stale after two", () => {
    expect(freshnessFrom(m, at("2026-07-27")).level).toBe("behind");
    expect(freshnessFrom(m, at("2026-07-28")).ageBusinessDays).toBe(2);
    expect(freshnessFrom(m, at("2026-07-28")).level).toBe("stale");
  });

  it("clamps at the end of the ladder instead of throwing", () => {
    const f = freshnessFrom(m, at("2030-01-01"));
    expect(f.ageBusinessDays).toBe(m.businessDaysAfter.length);
    expect(f.level).toBe("stale");
  });

  it("advances with the clock, which is the whole point", () => {
    const a = freshnessFrom(m, at("2026-07-27")).ageBusinessDays;
    const b = freshnessFrom(m, at("2026-07-30")).ageBusinessDays;
    expect(b).toBeGreaterThan(a);
  });
});

describe("the date is the reader's LOCAL date", () => {
  it("reports the local calendar date, not the UTC one", () => {
    // Constructed in LOCAL time, so this is zone-independent: just after
    // midnight on 29 July, wherever the runner is, the local date is the 29th.
    // Seoul is UTC+9, so `toISOString().slice(0,10)` would say the 28th all
    // morning — a reader in KST would see the badge age a day early, every day.
    const justAfterMidnight = new Date(2026, 6, 29, 0, 30);
    expect(localIsoDate(justAfterMidnight)).toBe("2026-07-29");

    const lateEvening = new Date(2026, 6, 29, 23, 30);
    expect(localIsoDate(lateEvening)).toBe("2026-07-29");
  });

  it("zero-pads, so string comparison against the ladder is total", () => {
    expect(localIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
