/* Policy-meeting calendar (strip session, Pass D) — pure, unit-tested.
 *
 * A hand-maintained JSON file in the repo (src/data/calendar.json): no feed,
 * no API, ~16 entries a year. Two kinds only, 금통위 and FOMC — between them
 * what actually moves the KRW curve. Fields are date, kind, label and nothing
 * else; provenance and the verification state live at the file level.
 *
 * Dates are compared as ISO STRINGS in the Seoul-local sense: the file holds
 * calendar days, and a countdown must not shift because the browser is on
 * another side of UTC midnight. `todayISO()` is the single place the wall
 * clock enters, so every consumer is testable with an injected date.
 *
 * Staleness is the failure this module is built against: a file that stops at
 * last December leaves the screen looking correct while the countdown is
 * wrong. `horizonDays` exposes how far the file still reaches, the strip says
 * so plainly when nothing is left, and guards/calendar.test.ts FAILS below a
 * 60-day horizon — a failing test is the right way to learn it needs topping
 * up. Note that the guard catches a file that stops, never one that is simply
 * WRONG; the file's `verified` flag records whether a human has checked it. */

import raw from "@/data/calendar.json";

export type EventKind = "mpc" | "fomc";

export interface MeetingEvent {
  date: string; // yyyy-mm-dd
  kind: EventKind;
  label: string;
}

interface CalendarFile {
  verified: boolean;
  note: string;
  events: MeetingEvent[];
}

const file = raw as CalendarFile;

/** Every event, ascending by date (the file is written sorted; this does not
 * trust that). */
export const MEETINGS: MeetingEvent[] = [...file.events].sort((a, b) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
);

/** Whether a human has checked these dates against the official schedules. */
export const CALENDAR_VERIFIED = file.verified;

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

/** The nearest event on or after `today` — the meeting day itself still
 * counts (it shows D-0), so a reader is not told about next month's meeting
 * on the morning of this one. Null when the file has run out. */
export function nextMeeting(today: string): MeetingEvent | null {
  return MEETINGS.find((e) => e.date >= today) ?? null;
}

/** Days until the file's LAST entry — how much runway the calendar has left.
 * Negative once the whole file is in the past. */
export function horizonDays(today: string): number {
  const last = MEETINGS[MEETINGS.length - 1];
  return last ? daysBetween(today, last.date) : -1;
}

/** Events inside [from, to] inclusive, for the chart's meeting rules. */
export function meetingsInRange(from: string, to: string): MeetingEvent[] {
  return MEETINGS.filter((e) => e.date >= from && e.date <= to);
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
