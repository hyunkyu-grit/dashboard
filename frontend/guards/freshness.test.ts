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
  marketIsoDate,
  MARKET_TZ,
  type Manifest,
} from "../src/lib/freshness";

const manifest: Manifest = JSON.parse(
  readFileSync(join(__dirname, "..", "public", "api", "manifest.json"), "utf8"),
);

/** Midday in Seoul, expressed as an INSTANT. Every case below is an instant,
 * never a local wall-clock construction, so the runner's own timezone cannot
 * change the result — which is the property under test. */
const at = (iso: string) => new Date(`${iso}T12:00:00+09:00`);

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

describe("the reference date is Seoul's, at the reader's instant (Pass I)", () => {
  /* The reader's INSTANT is the correct input; the reader's LOCAL DATE is not.
   * The data is KRW IRS closes and the ladder counts KR business days, so
   * "which day is it" is a question about Seoul. A reader in London or New
   * York derives a different local date from the same instant for most of
   * their working evening, and would have counted a business day late every
   * time. These are instants, so the runner's timezone cannot affect them. */

  it("23:30Z on the 29th is already the 30th in Seoul", () => {
    // the boundary case: 08:30 KST the next morning
    expect(marketIsoDate(new Date("2026-07-29T23:30:00Z"))).toBe("2026-07-30");
  });

  it("14:00Z on Friday is still Friday evening in Seoul", () => {
    // 23:00 KST Friday 31 July — not yet Saturday, so no business day rolls
    const d = new Date("2026-07-31T14:00:00Z");
    expect(marketIsoDate(d)).toBe("2026-07-31");
  });

  it("an instant that is Saturday in New York can be Sunday in Seoul", () => {
    // 2026-08-01T15:30Z = Sat 11:30 EDT in New York, Sun 00:30 KST in Seoul
    const d = new Date("2026-08-01T15:30:00Z");
    expect(marketIsoDate(d)).toBe("2026-08-02");
    expect(
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d),
    ).toBe("2026-08-01");
  });

  it("early morning in Seoul is not yesterday", () => {
    // toISOString() would say the 28th here — the UTC bug, in the direction
    // that hurts an actual Seoul reader every single morning
    const d = new Date("2026-07-28T22:30:00Z"); // 07:30 KST on the 29th
    expect(d.toISOString().slice(0, 10)).toBe("2026-07-28");
    expect(marketIsoDate(d)).toBe("2026-07-29");
  });

  it("zero-pads, so string comparison against the ladder is total", () => {
    expect(marketIsoDate(new Date("2026-01-05T03:00:00Z"))).toBe("2026-01-05");
  });

  it("uses the tz database, not a hardcoded offset", () => {
    expect(MARKET_TZ).toBe("Asia/Seoul");
  });
});

describe("the VERDICT at each boundary instant, not the formatted string", () => {
  /* asof is Friday 2026-07-24; the ladder is the real KR business calendar. */
  const m: Manifest = {
    ...manifest,
    asof: "2026-07-24",
    businessDaysAfter: ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"],
    freshnessThresholds: { behind: 1, stale: 2 },
  };
  const verdict = (iso: string) => {
    const f = freshnessFrom(m, new Date(iso));
    return { age: f.ageBusinessDays, level: f.level };
  };

  it("2026-07-29T23:30:00Z → 08:30 KST on the 30th → four days on", () => {
    // 27, 28, 29 and 30 have all passed in Seoul
    expect(verdict("2026-07-29T23:30:00Z")).toEqual({ age: 4, level: "stale" });
  });

  it("nine and a half hours earlier is still the 29th in Seoul, and one day less", () => {
    // 14:00Z = 23:00 KST on the 29th, so only 27/28/29 have passed. The pair
    // with the case above is the point: the SAME reader, an evening apart,
    // must cross the boundary exactly once.
    expect(verdict("2026-07-29T14:00:00Z")).toEqual({ age: 3, level: "stale" });
  });

  it("2026-07-31T14:00:00Z → Friday 23:00 KST → five days on", () => {
    expect(verdict("2026-07-31T14:00:00Z")).toEqual({ age: 5, level: "stale" });
  });

  it("a Sunday in Seoul that is Saturday in New York rolls no further", () => {
    // the ladder ends at Friday the 31st; the weekend adds nothing
    expect(verdict("2026-08-01T15:30:00Z")).toEqual({ age: 5, level: "stale" });
  });

  it("on the as-of date itself, in Seoul, the verdict is current", () => {
    expect(verdict("2026-07-24T02:00:00Z")).toEqual({ age: 0, level: "current" });
  });

  it("late on the as-of Friday in New York is already Saturday in Seoul — still current", () => {
    // 2026-07-24T22:00Z = Fri 18:00 EDT, Sat 07:00 KST. No business day has
    // passed, so a New York reader must not see the badge age early.
    expect(verdict("2026-07-24T22:00:00Z")).toEqual({ age: 0, level: "current" });
  });

  it("one business day on is behind, two is stale", () => {
    expect(verdict("2026-07-27T06:00:00Z")).toEqual({ age: 1, level: "behind" });
    expect(verdict("2026-07-28T06:00:00Z")).toEqual({ age: 2, level: "stale" });
  });
});
