/* Server-state types + fetchers. All derived series come from the backend;
 * the browser never computes a series (design spec §4). */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8100";

export type BasisKey = "d1" | "wtd" | "mtd" | "qtd" | "ytd";

export interface SparkPoint {
  t: string;
  v: number;
}

/** The `한 줄` classification (§16 exception): the backend decides WHAT is true,
 * the frontend renders the Korean sentence. Levels/deltas stay in their
 * columns — this only carries what no column shows. */
export type OneLinerKind = "extreme" | "retrace_week" | "retrace_month" | "none";
export interface OneLiner {
  kind: OneLinerKind;
  value: number | null;
}

export interface SeriesSummary {
  id: string;
  label: string;
  kind: "outright" | "spread" | "fly";
  unit: "%" | "bp";
  now: number | null;
  deltas: Record<BasisKey, number | null>;
  basisValues: Record<BasisKey, number | null>;
  range10y: { min: number | null; max: number | null; pct: number | null };
  // §16: computed server-side, read straight through by the row builder.
  sortKey: number[];
  quoted: boolean | null;
  oneLiner: OneLiner;
  spark: SparkPoint[];
}

export interface ChangeEvent {
  id: string;
  label: string;
  kind: "outright" | "spread" | "fly";
  unit: "%" | "bp";
  now: number | null;
  pct: number | null;
  deltaBp: number | null; // always D-1 (event basis is fixed, DESIGN §12)
  reasons: ("transition" | "move")[];
  anchor: string;
}

export interface EventCluster {
  leading: ChangeEvent;
  related: ChangeEvent[];
  count: number;
}

export interface WallSummary {
  asof: string;
  basisDates: Record<BasisKey, string | null>;
  specNodeOrder: string[];
  displayTenors: string[];
  missingNodes: string[];
  outrights: SeriesSummary[];
  derived: SeriesSummary[];
  events: EventCluster[];
}

export async function fetchWallSummary(): Promise<WallSummary> {
  const res = await fetch(`${API_BASE}/api/wall/summary`);
  if (!res.ok) throw new Error(`wall summary: HTTP ${res.status}`);
  return res.json();
}

export type AnyBasis = "now" | BasisKey;

export interface ForwardCell {
  start: string;
  live: boolean;
  values: Record<AnyBasis, number>;
  deltas: Record<BasisKey, number>;
  // §16: computed server-side, read straight through by the row builder.
  sortKey: number[];
  oneLiner: OneLiner;
  keyForward: boolean;
}

export interface KeyForward {
  label: string;
  values: Record<AnyBasis, number>;
  deltas: Record<BasisKey, number>;
}

export interface ForwardsPayload {
  asof: string;
  basisDates: Record<BasisKey, string | null>;
  startPoints: { label: string; t: number; date: string }[];
  tenors: string[];
  grid: Record<string, ForwardCell[]>;
  keyForwards: KeyForward[];
}

export async function fetchForwards(): Promise<ForwardsPayload> {
  const res = await fetch(`${API_BASE}/api/forwards`);
  if (!res.ok) throw new Error(`forwards: HTTP ${res.status}`);
  return res.json();
}

/** One point of a history line. `d` = true daily change in bp (from the
 * previous trading day), precomputed server-side (§16) so the browser never
 * differences a series; null on the first point. */
export interface HistoryPoint {
  t: string;
  v: number;
  d: number | null;
}

export interface SeriesStats {
  min: number;
  max: number;
  avg: number;
}

export interface CalendarChange {
  t: string;
  d: number; // daily change in bp
}

export type SeriesResolution = "preview" | "full";

export interface SeriesDetail {
  id: string;
  asof: string;
  unit: "%" | "bp";
  points: HistoryPoint[];
  stats: SeriesStats | null;
  calendar: CalendarChange[];
}

export async function fetchSeries(
  id: string,
  res: SeriesResolution = "full",
): Promise<SeriesDetail> {
  const url = `${API_BASE}/api/series/${encodeURIComponent(id)}?res=${res}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`series ${id}: HTTP ${r.status}`);
  return r.json();
}
