/* Unified instrument rows for the list-first table (DESIGN §2). One row per
 * instrument across all groups; every field comes from data already served
 * (summary + forwards). Instrument labels are technical, never translated. */

import type {
  BasisKey,
  ForwardsPayload,
  SeriesSummary,
  WallSummary,
} from "@/lib/api";

export type Group = "outright" | "spread" | "forward" | "vol";

export const BASIS_ORDER: BasisKey[] = ["d1", "wtd", "mtd", "qtd", "ytd"];

export const GROUP_LABEL: Record<Group, string> = {
  outright: "아웃라이트",
  spread: "스프레드",
  forward: "포워드",
  vol: "변동성",
};

export interface Row {
  id: string;
  label: string; // display instrument name
  group: Group;
  unit: "%" | "bp";
  now: number | null;
  changes: Record<BasisKey, number | null>; // bp vs each basis
  pct: number | null; // 10y percentile, null if none
  seriesId: string | null; // stage-2 history id, null = no history
  oneLiner: string;
  /** explicit ascending sort key so no series lacks one (§6): tenor in years
   * for outrights, leg tuple for spreads/forwards. */
  sortKey: number[];
  /** true only for the six quoted key forwards (pinned to the top, §3). */
  keyForward?: boolean;
  /** forward start point label, for the secondary start filter (§3). */
  startLabel?: string;
  /** true for live-quoted (non-interpolated) outright nodes (§6). */
  quoted?: boolean;
}

/** "1Y-10Y" → "1s10s", "2Y-5Y-10Y" → "2s5s10s" (trader shorthand). */
export function traderName(id: string): string {
  return id.split("-").map((t) => t.replace("Y", "")).join("s") + "s";
}

/** 한 줄 — must never restate a value already visible in the row (§6). The
 * level and the five change columns are on screen; a sentence that says
 * "연초 26bp 상승" only re-prints the YTD cell. So the sentence carries ONLY:
 *   1. an extreme-band percentile — a number shown in no column, so it is new;
 *   2. the SHAPE of the move (a reversal → 되돌림), never a bp magnitude;
 *   3. nothing. An empty 한 줄 beats a restatement. */
export function oneLiner(
  pct: number | null,
  changes: Record<BasisKey, number | null>,
  hasData: boolean,
): string {
  if (!hasData) return "";
  if (pct != null && (pct >= 90 || pct <= 10)) {
    return `백분위 ${Math.round(pct)}`;
  }
  // Shape only. A sign flip between adjacent bases reads as a retracement —
  // today against the week, or the week against the month. No bp figure: those
  // ARE the columns.
  const { d1, wtd, mtd } = changes;
  const flipped = (a: number | null, b: number | null) =>
    a != null && b != null && Math.abs(a) >= 0.5 && Math.abs(b) >= 0.5 &&
    Math.sign(a) !== Math.sign(b);
  if (flipped(d1, wtd)) return "주간 되돌림";
  if (flipped(wtd, mtd)) return "월중 되돌림";
  return "";
}

/** Tenor → years, for explicit numeric sort keys (§6). Unknown → Infinity so a
 * missing key sorts to the end loudly rather than silently mid-list. */
const YEARS: Record<string, number> = {
  "1D": 1 / 365, "3M": 0.25, "6M": 0.5, "9M": 0.75, "1Y": 1, "1.5Y": 1.5,
  "2Y": 2, "3Y": 3, "4Y": 4, "5Y": 5, "6Y": 6, "7Y": 7, "8Y": 8, "9Y": 9,
  "10Y": 10,
};
export function tenorYears(t: string): number {
  return YEARS[t] ?? Number.POSITIVE_INFINITY;
}

/** Live-quoted outright nodes (the curve node set); the rest are interpolated
 * (§6). */
const QUOTED = new Set(["1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"]);

function fromSummary(s: SeriesSummary, group: Group, label: string): Row {
  const legs = s.id.split("-");
  return {
    id: s.id,
    label,
    group,
    unit: s.unit,
    now: s.now,
    changes: {
      d1: s.deltas.d1,
      wtd: s.deltas.wtd,
      mtd: s.deltas.mtd,
      qtd: s.deltas.qtd,
      ytd: s.deltas.ytd,
    },
    pct: s.range10y.pct,
    seriesId: s.id,
    oneLiner: oneLiner(s.range10y.pct, s.deltas, s.now != null),
    sortKey: legs.map(tenorYears),
    quoted: group === "outright" ? QUOTED.has(s.id) : undefined,
  };
}

const VOL_TENORS = ["1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"];

export function buildRows(
  summary: WallSummary,
  forwards: ForwardsPayload | undefined,
): Row[] {
  const rows: Row[] = [];

  for (const o of summary.outrights) {
    rows.push(fromSummary(o, "outright", o.id));
  }
  for (const d of summary.derived) {
    rows.push(fromSummary(d, "spread", traderName(d.id)));
  }
  if (forwards) {
    const startYears: Record<string, number> = {};
    for (const sp of forwards.startPoints) startYears[sp.label] = sp.t;
    const keyLabels = new Set(forwards.keyForwards.map((k) => k.label));
    // every forward in the matrix (21 starts × 8 tenors), start-major (§3)
    for (const sp of forwards.startPoints) {
      for (const tenor of forwards.tenors) {
        const clean = tenor.replace("F", ""); // "1YF"→"1Y", "SPOT" stays
        const name = `${sp.label}x${clean}`;
        const cell = forwards.grid[tenor].find((c) => c.start === sp.label);
        if (!cell) continue;
        rows.push({
          id: name,
          label: name,
          group: "forward",
          unit: "%",
          now: cell.values.now,
          changes: { ...cell.deltas },
          pct: null,
          seriesId: name, // stage-2 forward history (Session 13)
          oneLiner: oneLiner(null, cell.deltas, cell.values.now != null),
          sortKey: [startYears[sp.label] ?? Infinity, YEARS[clean] ?? 0],
          keyForward: keyLabels.has(name),
          startLabel: sp.label,
        });
      }
    }
  }
  // Volatility rows are placeholders until a formula arrives (§13).
  for (const t of VOL_TENORS) {
    rows.push({
      id: `vol:${t}`,
      label: `${t} σ`,
      group: "vol",
      unit: "bp",
      now: null,
      changes: { d1: null, wtd: null, mtd: null, qtd: null, ytd: null },
      pct: null,
      seriesId: null,
      oneLiner: "아직 준비 중이에요",
      sortKey: [tenorYears(t)],
    });
  }
  return rows;
}
