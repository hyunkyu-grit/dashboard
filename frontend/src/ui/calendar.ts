/* Policy-meeting calendar (strip session; rebuilt on verified data, calendar
 * session) — pure, unit-tested.
 *
 * A hand-maintained JSON file in the repo (src/data/calendar.json): no feed,
 * no API. Every entry was read off the publishing central bank and carries
 * the source it came from; for two-day meetings the date is the DECISION day.
 *
 * `verified` IS LOAD-BEARING. An entry with verified false renders nowhere —
 * not in the strip, not in the countdown, not as a chart rule — and does not
 * count toward the staleness horizon. `MEETINGS` is the filtered list and is
 * the ONLY export a render path may read; the raw file is not exported. That
 * is a stronger guarantee than an "unverified" badge: bad data cannot appear
 * at all. (The file it replaced shipped `verified: false` with ~23 of 182
 * dates on the wrong weekday, and the flag did nothing.)
 *
 * Dates are compared as ISO STRINGS in the Seoul-local sense: the file holds
 * calendar days, and a countdown must not shift because the browser is on
 * another side of UTC midnight. `todayISO()` is the single place the wall
 * clock enters, so every consumer is testable with an injected date. */

import raw from "@/data/calendar.json";

/** Listed meetings, plus the generated PBOC LPR (see `lprInRange`). */
export type EventKind = "mpc" | "fomc" | "boj" | "ecb" | "lpr";

export interface MeetingEvent {
  date: string; // yyyy-mm-dd
  kind: EventKind;
  label: string;
  /** where the date was read from; generated series say so. */
  source: string;
  verified: boolean;
}

interface CalendarFile {
  note: string;
  events: MeetingEvent[];
}

const file = raw as CalendarFile;

/** THE list every render path reads: verified entries only, ascending. The
 * unfiltered file is deliberately not exported. */
export const MEETINGS: MeetingEvent[] = file.events
  .filter((e) => e.verified === true)
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** How many entries the file holds but does not show. */
export const UNVERIFIED_COUNT = file.events.length - MEETINGS.length;

/** Only these count down in the strip [calendar session, Pass E]: what moves
 * the KRW curve, in this order. ECB is a chart rule but never the next event;
 * LPR never counts down at all (it is MLF-dependent and rarely surprises, so
 * a countdown to it would train the reader to ignore the strip). */
export const COUNTDOWN_KINDS: EventKind[] = ["mpc", "fomc", "boj"];

/** Today as yyyy-mm-dd in the LOCAL calendar (the desk's day, not UTC's). */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to`, both yyyy-mm-dd. Parsed at UTC noon so a
 * DST shift can never round the difference to the wrong integer. */
export function daysBetween(from: string, to: string): number {
  const at = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d, 12);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/* ── PBOC LPR: generated, not listed [calendar session, Pass D] ──────────
 * The PBOC holds no scheduled meeting; the LPR is announced at 09:30 CST on
 * the 20th of each month. So it is computed: start at the 20th and advance a
 * day at a time until the date is a business day — Saturday and Sunday roll
 * to Monday, and a holiday on that Monday rolls to Tuesday, chaining as far
 * as needed. */

/** PRC public holidays that can fall between the 20th and the 25th of a
 * month, which is the only window the roll can reach. In practice that is
 * 춘절, 단오 and 중추절 — 원단, 청명, 노동절 and 국경절 cannot reach the 20th.
 *
 * EMPTY ON PURPOSE: no verified PRC holiday dates were available when this
 * shipped. An empty list means WEEKEND rolling works and HOLIDAY rolling does
 * not yet, so an LPR rule can sit up to a few days early in a month whose
 * roll lands on a holiday (2026-02 is the one to check first: 춘절 falls near
 * the 20th). LPR is chart-rules-only precisely because a one-day error there
 * is harmless. Add verified dates here to close the gap. */
export const PRC_HOLIDAYS: string[] = [];

const isWeekend = (iso: string): boolean => {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
};

const addDay = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
};

/** The LPR announcement date for one month: the 20th, rolled forward to the
 * first business day. */
export function lprDate(year: number, month1to12: number): string {
  let iso = `${year}-${String(month1to12).padStart(2, "0")}-20`;
  // bounded: a roll never needs more than a week of chaining
  for (let i = 0; i < 10; i++) {
    if (!isWeekend(iso) && !PRC_HOLIDAYS.includes(iso)) return iso;
    iso = addDay(iso);
  }
  return iso;
}

/** The calendar's verified era. NOTHING renders before this — not a listed
 * meeting (none exist: the fabricated 2016-2025 history was deleted rather
 * than repaired) and not a generated LPR either. Generating LPR backwards
 * would re-introduce invented history through the side door: it would draw
 * rules across a decade that has no meeting rules, inviting the reader to
 * read the ones they see as the whole story — and the LPR in its current form
 * only dates from the 2019 reform anyway. */
export const CALENDAR_FROM = "2026-01-01";

/** LPR events inside [from, to] inclusive, generated month by month, never
 * before CALENDAR_FROM. */
export function lprInRange(from: string, to: string): MeetingEvent[] {
  const out: MeetingEvent[] = [];
  if (to < CALENDAR_FROM) return out;
  const start = from < CALENDAR_FROM ? CALENDAR_FROM : from;
  const [fy, fm] = start.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((m = 1), y++) : m++) {
    const date = lprDate(y, m);
    if (date >= start && date <= to) {
      out.push({
        date,
        kind: "lpr",
        label: "LPR",
        source: "PBOC LPR — 매월 20일 09:30 CST, 영업일 조정 (generated)",
        verified: true,
      });
    }
  }
  return out;
}

/** The nearest COUNTDOWN-eligible event on or after `today` — the meeting day
 * itself still counts (it shows D-0), so a reader is not told about next
 * month's meeting on the morning of this one. Null when the file has run
 * out. */
export function nextMeeting(today: string): MeetingEvent | null {
  return (
    MEETINGS.find((e) => e.date >= today && COUNTDOWN_KINDS.includes(e.kind)) ??
    null
  );
}

/** Days until the last VERIFIED LISTED entry — how much runway the calendar
 * has left. Unverified entries are treated as absent, so staging a 2027 does
 * not silence the guard; the generated LPR is excluded too, or the horizon
 * would be infinite and the guard could never fire. */
export function horizonDays(today: string): number {
  const listed = MEETINGS.filter((e) => e.kind !== "lpr");
  const last = listed[listed.length - 1];
  return last ? daysBetween(today, last.date) : -1;
}

/** Everything that draws a chart rule inside [from, to]: the verified listed
 * meetings plus the generated LPR. */
export function meetingsInRange(from: string, to: string): MeetingEvent[] {
  return [
    ...MEETINGS.filter((e) => e.date >= from && e.date <= to),
    ...lprInRange(from, to),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** `8월 28일` — the strip's date form; the year is implied by the countdown. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

/** `D-31`, and `D-0` on the meeting day itself [recorded choice: the Korean
 * D-day convention, and it keeps the event on screen through its own day
 * rather than vanishing at midnight]. */
export function countdown(today: string, date: string): string {
  return `D-${Math.max(0, daysBetween(today, date))}`;
}
