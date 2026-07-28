/* Date labels under the charts (dates session, Pass B) — pure, unit-tested.
 *
 * The charts carried no date axis. These are ORIENTATION labels, not a full
 * axis: three or four across the width, at round boundaries (year starts,
 * month starts, round days), no tick marks, no rule. Format follows the
 * span: years alone for a multi-year view, year+month inside a single year,
 * month+day when zoomed further. Secondary ink at caption size — they
 * orient; they do not compete. Consumed by PreviewChart (fixed 10y span)
 * and DetailChart (visible range; follows the candle interval implicitly,
 * since bucketed bars shrink the span's resolution). */

export interface DateLabel {
  iso: string; // yyyy-mm-dd, a round boundary within [from, to]
  text: string;
}

const LADDER: { unit: "year" | "month" | "day"; step: number }[] = [
  { unit: "year", step: 10 },
  { unit: "year", step: 5 },
  { unit: "year", step: 2 },
  { unit: "year", step: 1 },
  { unit: "month", step: 6 },
  { unit: "month", step: 3 },
  { unit: "month", step: 2 },
  { unit: "month", step: 1 },
  { unit: "day", step: 10 },
  { unit: "day", step: 5 },
  { unit: "day", step: 2 },
  { unit: "day", step: 1 },
];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function label(unit: "year" | "month" | "day", y: number, m: number, d: number): DateLabel {
  if (unit === "year") return { iso: iso(y, m, d), text: `${y}년` };
  if (unit === "month") return { iso: iso(y, m, d), text: `${y}년 ${m}월` };
  return { iso: iso(y, m, d), text: `${m}월 ${d}일` };
}

// round day-of-month per stride: 1/11/21 for 10d, 1/6/…/26 for 5d, odd for 2d
function dayMatches(d: number, step: number): boolean {
  if (step === 10) return d === 1 || d === 11 || d === 21;
  if (step === 5) return d % 5 === 1 && d <= 26;
  if (step === 2) return d % 2 === 1;
  return true;
}

function candidates(
  from: string,
  to: string,
  unit: "year" | "month" | "day",
  step: number,
): DateLabel[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty] = to.split("-").map(Number);
  const out: DateLabel[] = [];
  const inRange = (s: string) => s >= from && s <= to;

  if (unit === "year") {
    for (let y = fy; y <= ty; y++) {
      if (y % step === 0 && inRange(iso(y, 1, 1))) out.push(label("year", y, 1, 1));
    }
    return out;
  }
  if (unit === "month") {
    for (let y = fy, m = fm; iso(y, m, 1) <= to; m === 12 ? ((m = 1), y++) : m++) {
      if ((m - 1) % step === 0 && inRange(iso(y, m, 1))) out.push(label("month", y, m, 1));
    }
    return out;
  }
  // day rung is only reached for short spans; walk with a bounded UTC cursor
  const cur = new Date(Date.UTC(fy, fm - 1, fd));
  for (let i = 0; i < 400; i++) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth() + 1;
    const d = cur.getUTCDate();
    const s = iso(y, m, d);
    if (s > to) break;
    if (dayMatches(d, step) && inRange(s)) out.push(label("day", y, m, d));
    cur.setUTCDate(d + 1);
  }
  return out;
}

/** Evenly thin a too-dense list down to ≤ 4, keeping the first pick's phase. */
function thin(list: DateLabel[]): DateLabel[] {
  const stride = Math.ceil(list.length / 4);
  return list.filter((_x, i) => i % stride === 0);
}

/** 3–4 sparse labels at round boundaries within [fromISO, toISO]; falls back
 * to fewer only when the span is too short to hold three round marks. */
export function dateLabels(fromISO: string, toISO: string): DateLabel[] {
  if (!fromISO || !toISO || fromISO >= toISO) return [];
  for (const { unit, step } of LADDER) {
    const c = candidates(fromISO, toISO, unit, step);
    if (c.length >= 3) return c.length <= 5 ? c : thin(c);
  }
  return candidates(fromISO, toISO, "day", 1);
}
