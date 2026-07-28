/* Guard: the policy-meeting calendar (calendar session).
 *
 * Two failures this exists to prevent:
 *   1. A file that STOPS. Left alone it leaves the screen looking correct
 *      while the countdown is wrong, so the horizon is a hard gate — under 60
 *      days and this fails, which is how the file's keeper learns to add the
 *      next year.
 *   2. A file that is WRONG. The previous one shipped ~23 of 182 dates on the
 *      wrong weekday behind `verified: false`, and the flag did nothing. Now
 *      an unverified entry renders NOWHERE and does not count toward the
 *      horizon — proved below against a live unverified row. */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import raw from "../src/data/calendar.json";
import {
  CALENDAR_FROM,
  countdown,
  COUNTDOWN_KINDS,
  daysBetween,
  horizonDays,
  lprDate,
  lprInRange,
  MEETINGS,
  meetingsInRange,
  nextMeeting,
  PRC_HOLIDAYS,
  shortDate,
  todayISO,
  UNVERIFIED_COUNT,
} from "../src/ui/calendar";

const MIN_HORIZON_DAYS = 60;
const SOURCES = ["bok.or.kr", "federalreserve.gov", "boj.or.jp", "ecb.europa.eu"];

describe("the file does not go stale silently", () => {
  it(`still reaches at least ${MIN_HORIZON_DAYS} days out`, () => {
    const left = horizonDays(todayISO());
    const listed = MEETINGS.filter((e) => e.kind !== "lpr");
    expect(
      left,
      `\n\ncalendar.json runs out in ${left} days (last verified entry ${
        listed[listed.length - 1]?.date
      }).\n` +
        "Check whether each bank has published its next year's schedule, read\n" +
        "the dates off the source, and add them with verified: true:\n" +
        `  금통위  ${SOURCES[0]}\n  FOMC   ${SOURCES[1]}\n` +
        `  BOJ    ${SOURCES[2]}\n  ECB    ${SOURCES[3]}\n` +
        "The FOMC usually publishes about two years ahead and the others about\n" +
        "one, so the next year will likely arrive piecemeal — add what exists.\n",
    ).toBeGreaterThanOrEqual(MIN_HORIZON_DAYS);
  });

  it("a truncated file is caught — the gate is not vacuous", () => {
    const truncated = MEETINGS.filter((e) => e.date <= "2026-03-01");
    const last = truncated[truncated.length - 1];
    expect(daysBetween(todayISO(), last.date)).toBeLessThan(MIN_HORIZON_DAYS);
  });

  it("the GENERATED LPR cannot silence the guard", () => {
    // lpr runs forever by construction; if it counted, the horizon would be
    // infinite and this gate could never fire again
    expect(MEETINGS.every((e) => e.kind !== "lpr")).toBe(true);
    const far = lprInRange("2030-01-01", "2030-12-31");
    expect(far.length).toBe(12);
    expect(horizonDays(todayISO())).toBeLessThan(daysBetween(todayISO(), "2030-01-01"));
  });
});

describe("every entry is verified and sourced", () => {
  it("carries date, kind, label, source and verified", () => {
    for (const e of raw.events) {
      expect(Object.keys(e).sort()).toEqual([
        "date",
        "kind",
        "label",
        "source",
        "verified",
      ]);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["mpc", "fomc", "boj", "ecb"]).toContain(e.kind);
      expect(e.source.length).toBeGreaterThan(0);
    }
  });

  it("names the bank each date was read from", () => {
    for (const s of SOURCES) {
      expect(raw.events.some((e) => e.source.includes(s))).toBe(true);
    }
  });

  it("holds the four banks' eight 2026 meetings each", () => {
    for (const kind of ["mpc", "fomc", "boj", "ecb"]) {
      expect(MEETINGS.filter((e) => e.kind === kind)).toHaveLength(8);
    }
    expect(MEETINGS).toHaveLength(32);
  });

  it("is 2026 only — the fabricated history was deleted, not repaired", () => {
    for (const e of MEETINGS) expect(e.date.startsWith("2026-")).toBe(true);
    // NOTHING draws before the verified era — not a listed meeting and not a
    // generated LPR either, which would re-introduce invented history through
    // the side door (and would draw rules across a decade that has none)
    expect(meetingsInRange("2016-01-01", "2025-12-31")).toHaveLength(0);
    expect(lprInRange("2016-01-01", "2025-12-31")).toHaveLength(0);
    expect(CALENDAR_FROM).toBe("2026-01-01");
    // a window straddling the boundary yields only the 2026 side
    for (const e of meetingsInRange("2025-10-01", "2026-02-28")) {
      expect(e.date >= CALENDAR_FROM).toBe(true);
    }
  });

  it("is sorted and free of duplicates", () => {
    const keys = MEETINGS.map((e) => `${e.date}|${e.kind}`);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("verified is load-bearing: unverified renders NOWHERE", () => {
  const staged = { date: "2027-03-18", kind: "fomc", label: "FOMC", source: "x" };

  /* The guarantee is STRUCTURAL, not a promise each consumer keeps: the raw
   * file is reachable from exactly one module, and that module exports only
   * filtered lists. A render path therefore CANNOT see an unverified row —
   * there is no accessor that would hand it one. */
  it("only ui/calendar.ts may read the raw file", () => {
    const dir = join(__dirname, "..", "src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const rel = relative(dir, p).replace(/\\/g, "/");
          if (rel === "ui/calendar.ts") continue;
          if (/data\/calendar\.json/.test(readFileSync(p, "utf8"))) offenders.push(rel);
        }
      }
    };
    walk(dir);
    expect(offenders, offenders.join(", ")).toEqual([]);
  });

  it("the module exports no unfiltered view of the file", () => {
    // CODE only — the contract is also described in prose in that file, and
    // a comment saying "the raw file is not exported" must not trip a check
    // looking for an export of the raw file
    const mod = readFileSync(join(__dirname, "..", "src", "ui", "calendar.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // `raw` and `file` stay module-private; every export derives from MEETINGS
    expect(mod).not.toMatch(/export .*\braw\b/);
    expect(mod).not.toMatch(/export const file/);
    expect(mod).toMatch(/export const MEETINGS[\s\S]*?\.filter\(\(e\) => e\.verified === true\)/);
  });

  it("staging is allowed and counted, never fatal", () => {
    // the file's contract permits unverified rows as a staging area, so their
    // presence must NOT fail the suite — only their VISIBILITY would. The
    // count is exposed so a keeper can see what is waiting.
    expect(UNVERIFIED_COUNT).toBeGreaterThanOrEqual(0);
    expect(UNVERIFIED_COUNT).toBe(raw.events.length - MEETINGS.length);
  });

  it("an unverified row reaches no render path and no horizon", () => {
    // simulate the staging area the file's note allows
    const all = [...raw.events, { ...staged, verified: false }];
    const visible = all.filter((e) => e.verified === true);
    expect(visible.some((e) => e.date === staged.date)).toBe(false);

    // the module's own list is exactly that filter, so every consumer that
    // reads MEETINGS (strip, countdown, chart rules) inherits it
    expect(MEETINGS.every((e) => e.verified === true)).toBe(true);
    expect(MEETINGS.some((e) => e.date.startsWith("2027"))).toBe(false);
    expect(nextMeeting("2027-01-01")).toBeNull();
    expect(meetingsInRange("2027-01-01", "2027-12-31").every((e) => e.kind === "lpr")).toBe(
      true,
    );

    // and it does not extend the horizon: staging a 2027 must not silence the
    // gate, so today's horizon still ends inside 2026
    const listed = MEETINGS.filter((e) => e.kind !== "lpr");
    expect(listed[listed.length - 1].date).toBe("2026-12-18");
  });
});

describe("the countdown is scoped to what moves the KRW curve", () => {
  it("금통위, FOMC and BOJ only", () => {
    expect(COUNTDOWN_KINDS).toEqual(["mpc", "fomc", "boj"]);
  });

  it("ECB draws a rule but is never the next event", () => {
    // 2026-07-23 is an ECB date; from the day before, the next event skips it
    expect(MEETINGS.some((e) => e.date === "2026-07-23" && e.kind === "ecb")).toBe(true);
    expect(nextMeeting("2026-07-22")?.kind).not.toBe("ecb");
    expect(nextMeeting("2026-07-22")?.date).toBe("2026-07-29"); // FOMC
  });

  it("LPR never counts down", () => {
    for (let d = 1; d <= 28; d++) {
      const today = `2026-06-${String(d).padStart(2, "0")}`;
      expect(nextMeeting(today)?.kind).not.toBe("lpr");
    }
  });

  it("the meeting day itself still counts — D-0, not the next one", () => {
    const e = nextMeeting("2026-08-27");
    expect(e?.date).toBe("2026-08-27"); // 금통위
    expect(countdown("2026-08-27", e!.date)).toBe("D-0");
  });

  it("counts calendar days, including across a weekend", () => {
    expect(countdown("2026-08-21", "2026-08-27")).toBe("D-6");
  });

  it("formats the strip's date form", () => {
    expect(shortDate("2026-08-27")).toBe("8월 27일");
  });
});

describe("PBOC LPR is generated by rule, not listed", () => {
  it("the 20th when it is a business day", () => {
    expect(lprDate(2026, 1)).toBe("2026-01-20"); // Tue
    expect(lprDate(2026, 3)).toBe("2026-03-20"); // Fri
    expect(lprDate(2026, 5)).toBe("2026-05-20"); // Wed
  });

  it("rolls a weekend forward to Monday", () => {
    expect(lprDate(2026, 6)).toBe("2026-06-22"); // 20th Sat → Mon
    expect(lprDate(2026, 9)).toBe("2026-09-21"); // 20th Sun → Mon
    expect(lprDate(2026, 12)).toBe("2026-12-21"); // 20th Sun → Mon
  });

  it("chains past a holiday when one is known", () => {
    // the shipped list is empty on purpose; prove the chaining mechanism
    PRC_HOLIDAYS.push("2026-06-22");
    try {
      expect(lprDate(2026, 6)).toBe("2026-06-23");
    } finally {
      PRC_HOLIDAYS.length = 0;
    }
  });

  it("ships an EMPTY holiday list — weekend rolling only, and says so", () => {
    expect(PRC_HOLIDAYS).toHaveLength(0);
  });

  it("generates one a month inside a range", () => {
    expect(lprInRange("2026-01-01", "2026-12-31")).toHaveLength(12);
  });
});
