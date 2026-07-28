/* Guard: the policy-meeting calendar (strip session, Pass D).
 *
 * THE failure this exists to prevent: a hand-maintained file that stops at
 * last December leaves the screen looking correct while the countdown is
 * wrong. So the horizon is a HARD gate — when the file's last entry is less
 * than 60 days out, this test fails, and that failure is how the file's
 * keeper learns it needs topping up.
 *
 * What it cannot catch: dates that are present but WRONG. The file carries a
 * `verified` flag for exactly that reason; the seed shipped unverified. */

import { describe, expect, it } from "vitest";

import {
  CALENDAR_VERIFIED,
  countdown,
  daysBetween,
  horizonDays,
  MEETINGS,
  meetingsInRange,
  nextMeeting,
  shortDate,
  todayISO,
} from "../src/ui/calendar";
import raw from "../src/data/calendar.json";

const MIN_HORIZON_DAYS = 60;

describe("the file does not go stale silently", () => {
  it(`still reaches at least ${MIN_HORIZON_DAYS} days out`, () => {
    const today = todayISO();
    const left = horizonDays(today);
    expect(
      left,
      `calendar.json runs out in ${left} days (last entry ${
        MEETINGS[MEETINGS.length - 1]?.date
      }). Top it up from bok.or.kr / federalreserve.gov.`,
    ).toBeGreaterThanOrEqual(MIN_HORIZON_DAYS);
  });

  it("a truncated file is caught — the guard is not vacuous", () => {
    // simulate the failure mode: everything before this session's data edge
    const truncated = MEETINGS.filter((e) => e.date <= "2024-01-01");
    const last = truncated[truncated.length - 1];
    expect(daysBetween(todayISO(), last.date)).toBeLessThan(MIN_HORIZON_DAYS);
  });
});

describe("shape: date, kind, label and nothing else", () => {
  it("every entry parses and carries exactly the three fields", () => {
    for (const e of MEETINGS) {
      expect(Object.keys(e).sort()).toEqual(["date", "kind", "label"]);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["mpc", "fomc"]).toContain(e.kind);
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it("only the two agreed kinds — no CPI, no auctions", () => {
    expect(new Set(MEETINGS.map((e) => e.kind))).toEqual(new Set(["mpc", "fomc"]));
  });

  it("is sorted and free of duplicates", () => {
    const keys = MEETINGS.map((e) => `${e.date}|${e.kind}`);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the dataset's range, including the 2020 emergency cut", () => {
    expect(MEETINGS[0].date <= "2016-12-31").toBe(true);
    // the unscheduled meeting that matters most in this dataset
    expect(MEETINGS.some((e) => e.date === "2020-03-16" && e.kind === "mpc")).toBe(true);
  });

  it("declares honestly whether a human has checked the dates", () => {
    expect(typeof CALENDAR_VERIFIED).toBe("boolean");
    if (!CALENDAR_VERIFIED) {
      // an unverified file must SAY it is a seed, so the flag cannot be a
      // silent default nobody notices
      expect(raw.note).toMatch(/seed|verified/i);
    }
  });
});

describe("the nearest future event, and the countdown", () => {
  it("picks the next event on or after today", () => {
    expect(nextMeeting("2026-08-01")?.date).toBe("2026-08-27");
  });

  it("the meeting day itself still counts — D-0, not next month", () => {
    const e = nextMeeting("2026-08-27");
    expect(e?.date).toBe("2026-08-27");
    expect(countdown("2026-08-27", e!.date)).toBe("D-0");
  });

  it("counts calendar days, including across a weekend", () => {
    // 2026-08-27 is a Thursday; from the Friday before it is 6 days
    expect(countdown("2026-08-21", "2026-08-27")).toBe("D-6");
    expect(daysBetween("2026-08-21", "2026-08-27")).toBe(6);
  });

  it("returns null rather than a stale date once the file runs out", () => {
    expect(nextMeeting("2099-01-01")).toBeNull();
  });

  it("formats the strip's date form", () => {
    expect(shortDate("2026-08-27")).toBe("8월 27일");
  });
});

describe("range query for the chart's meeting rules", () => {
  it("returns only events inside the window, inclusive", () => {
    const got = meetingsInRange("2026-01-01", "2026-06-30");
    expect(got.length).toBeGreaterThan(0);
    for (const e of got) {
      expect(e.date >= "2026-01-01" && e.date <= "2026-06-30").toBe(true);
    }
  });
});
