/* Unified instrument rows for the list-first table (DESIGN §2). One row per
 * instrument across all groups.
 *
 * §16 computation boundary: this builder turns the API's numbers into a row
 * shape — it does NOT compute any of them. Levels, deltas, percentiles, sort
 * keys, the quoted flag, and the 한 줄 classification all arrive precomputed
 * from the backend. The only work here is presentation: choosing a display
 * label, routing a series into its group, and rendering the classification into
 * a Korean sentence. `ROW_FIELD_SOURCE` records every field's provenance and
 * `guards/row-vm-source.test.ts` fails the build if a new field appears that
 * isn't declared — a field that needs arithmetic has no honest declaration and
 * belongs in the backend. */

import type {
  BasisKey,
  ForwardsPayload,
  OneLiner,
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
  pct: number | null; // 10y percentile, null if none
  seriesId: string | null; // stage-2 history id, null = no history
  oneLiner: string; // rendered from the backend classification (§16)
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
  oneLiner: "format", // rendered string built from the dto classification
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

/** "1Y-10Y" → "1s10s", "2Y-5Y-10Y" → "2s5s10s" (trader shorthand). */
export function traderName(id: string): string {
  return id.split("-").map((t) => t.replace("Y", "")).join("s") + "s";
}

/** Render the backend's 한 줄 classification into a Korean fragment (§16). The
 * backend decided WHAT is true; this only decides HOW to say it, so wording can
 * change without a backend deploy. Never restates a visible column (§6). */
export function renderOneLiner(o: OneLiner): string {
  switch (o.kind) {
    case "move_extreme":
      return `일간 변동 상위 ${o.value}%`;
    case "extreme":
      return `백분위 ${o.value}`;
    case "solo_up":
      return "단독 상승";
    case "solo_down":
      return "단독 하락";
    default:
      return "";
  }
}

function fromSummary(s: SeriesSummary, group: Group, label: string): Row {
  return {
    id: s.id,
    label,
    group,
    unit: s.unit,
    now: s.now,
    changes: { ...s.deltas },
    pct: s.range10y.pct,
    seriesId: s.id,
    oneLiner: renderOneLiner(s.oneLiner),
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
          oneLiner: renderOneLiner(cell.oneLiner),
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
