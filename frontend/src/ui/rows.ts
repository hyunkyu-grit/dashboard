/* Unified instrument rows for the list-first table (DESIGN §2). One row per
 * instrument across all groups.
 *
 * §16 computation boundary: this builder turns the API's numbers into a row
 * shape — it does NOT compute any of them. Levels, deltas, the 52-week
 * high/low/mean, percentiles, sort keys and the quoted flag all arrive
 * precomputed from the backend. The only work here is presentation: choosing a
 * display label and routing a series into its group. `ROW_FIELD_SOURCE` records
 * every field's provenance and `guards/row-vm-source.test.ts` fails the build
 * if a new field appears that isn't declared — a field that needs arithmetic
 * has no honest declaration and belongs in the backend. */

import type {
  BasisKey,
  ForwardsPayload,
  SeriesSummary,
  Unit,
  VolatilityPayload,
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
  unit: Unit;
  now: number | null;
  changes: Record<BasisKey, number | null>; // bp vs each basis
  pct: number | null; // 52-week LEVEL percentile, null if none
  seriesId: string | null; // stage-2 history id, null = no history
  /** 52-week LEVEL high / low / mean, in the row's own unit — the last column
   * (pass L). Straight from `range1y`; rendered with the SAME formatter the
   * 현재 column uses, never a second rounding. */
  rangeHigh: number | null;
  rangeLow: number | null;
  rangeAvg: number | null;
  /** explicit ascending sort key, supplied by the backend (§6/§16). */
  sortKey: number[];
  /** own-history move percentile (§D screener); null where unavailable. */
  movePct: number | null;
  /** true only for the six quoted key forwards (pinned to the top, §3). */
  keyForward?: boolean;
  /** forward start point label, for the secondary start filter (§3). */
  startLabel?: string;
  /** true for live-quoted (non-interpolated) outright nodes (§6). */
  quoted?: boolean;
}

/** Provenance of every Row field (§16). `dto` = read straight from the API;
 * `format` = pure presentation (label, routing, rendered copy). There is no
 * `compute` value on purpose: a field that would need arithmetic on market
 * data has no home here and must be produced by the backend. The guard fails
 * when a built row carries a key absent from this map. */
export const ROW_FIELD_SOURCE: Record<keyof Row, "dto" | "format"> = {
  id: "format",
  label: "format",
  group: "format",
  unit: "dto",
  now: "dto",
  changes: "dto",
  pct: "dto",
  seriesId: "format",
  rangeHigh: "dto",
  rangeLow: "dto",
  rangeAvg: "dto",
  sortKey: "dto",
  movePct: "dto",
  keyForward: "dto",
  startLabel: "format",
  quoted: "dto",
};

/** lexicographic compare of numeric sort keys (§6). */
export function cmpKey(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? -1;
    const bv = b[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** THE row ordering. Two states and no others, because `sortCol` is a
 * `BasisKey | null`:
 *
 *   a change column is sorted → by |change| in that column, nulls last;
 *   nothing is sorted        → the backend's explicit sort key, ascending
 *                              (§6), key forwards pinned to the top.
 *
 * Only a CHANGE column can occupy the first state. The 52주 column carries no
 * sort key of its own — three statistics do not rank rows — so clicking its
 * header cannot reach here and the order does not move (pass L). That is a
 * property of the COLUMN and is silent by design; a ROW with no sort key is a
 * different and LOUD condition, non-finite so it lands at the end where it can
 * be seen (guards/sort-key.test.ts).
 *
 * Lifted out of the component so it is testable without a DOM. */
export function orderRows(
  rows: Row[],
  sortCol: BasisKey | null,
  sortAsc: boolean,
  keyForwardFirst: boolean,
): Row[] {
  if (sortCol) {
    const withVal = rows.filter((r) => r.changes[sortCol] != null);
    const without = rows.filter((r) => r.changes[sortCol] == null);
    withVal.sort((a, b) => {
      const d = Math.abs(b.changes[sortCol]!) - Math.abs(a.changes[sortCol]!);
      return sortAsc ? -d : d;
    });
    return [...withVal, ...without];
  }
  return [...rows].sort((a, b) => {
    if (keyForwardFirst) {
      const ak = a.keyForward ? 0 : 1;
      const bk = b.keyForward ? 0 : 1;
      if (ak !== bk) return ak - bk;
    }
    return cmpKey(a.sortKey, b.sortKey);
  });
}

/** "1Y-10Y" → "1s10s", "2Y-5Y-10Y" → "2s5s10s" (trader shorthand). */
export function traderName(id: string): string {
  return id.split("-").map((t) => t.replace("Y", "")).join("s") + "s";
}

/* `renderOneLiner` phrased the backend 한 줄 classification into Korean and is
 * gone with the column (pass L). It was the §16 exception's most visible
 * subject; the exception itself still has two (`ui/gloss.ts` and the curve
 * banner) — see DESIGN §16. */

function fromSummary(s: SeriesSummary, group: Group, label: string): Row {
  return {
    id: s.id,
    label,
    group,
    unit: s.unit,
    now: s.now,
    changes: { ...s.deltas },
    pct: s.range1y.pct,
    seriesId: s.id,
    rangeHigh: s.range1y.max,
    rangeLow: s.range1y.min,
    rangeAvg: s.range1y.avg,
    sortKey: s.sortKey,
    movePct: s.movePct,
    quoted: s.quoted ?? undefined,
  };
}

export function buildRows(
  summary: WallSummary,
  forwards: ForwardsPayload | undefined,
  volatility?: VolatilityPayload,
): Row[] {
  const rows: Row[] = [];

  for (const o of summary.outrights) {
    rows.push(fromSummary(o, "outright", o.id));
  }
  for (const d of summary.derived) {
    rows.push(fromSummary(d, "spread", traderName(d.id)));
  }
  if (forwards) {
    // every non-degenerate forward in the matrix, start-major (§3)
    for (const sp of forwards.startPoints) {
      // ONx* is the spot curve wearing a forward's name (carry session,
      // Pass A): an overnight start IS today, so every ON-start "forward"
      // equals the outright of its tenor by construction and the whole row
      // duplicates the outright tab. The ON row stays in the matrix (표로
      // 보기) as the grid's spot anchor, relabelled 현물 — never in the list.
      if (sp.label === "ON") continue;
      for (const tenor of forwards.tenors) {
        const clean = tenor.replace("F", ""); // "1YF"→"1Y", "SPOT" stays
        // {start}xSPOT is a spot-starting par rate — the outright at that
        // start, with no forward period — so it is a duplicate in the forward
        // LIST (§I). It stays in the matrix (표로 보기) as the spot reference
        // column, but is dropped from the row list here.
        if (clean === "SPOT") continue;
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
          rangeHigh: cell.range1y.max,
          rangeLow: cell.range1y.min,
          rangeAvg: cell.range1y.avg,
          sortKey: cell.sortKey,
          movePct: null, // forwards have no cheap daily-move history
          keyForward: cell.keyForward,
          startLabel: sp.label,
        });
      }
    }
  }
  // Volatility rows — the relative-ATR ratio per tenor, precomputed server-side
  // (§16) and shaped like every other summary, so this reuses fromSummary.
  if (volatility) {
    for (const v of volatility.rows) {
      rows.push(fromSummary(v, "vol", v.label));
    }
  }
  return rows;
}
