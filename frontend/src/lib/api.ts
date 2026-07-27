/* Server-state types + fetchers. All derived series come from the backend;
 * the browser never computes a series (design spec §4). */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8100";

export type BasisKey = "d1" | "wtd" | "mtd" | "qtd" | "ytd";

/** Level/change unit. `ratio` is the dimensionless volatility ratio (§ vol):
 * shown to two decimals, its change is a ratio difference, never bp. */
export type Unit = "%" | "bp" | "ratio";

export interface SparkPoint {
  t: string;
  v: number;
}

/** The `한 줄` classification (§16 exception): the backend decides WHAT is true,
 * the frontend renders the Korean sentence. Levels/deltas stay in their
 * columns — this only carries what no column shows. */
export type OneLinerKind =
  | "move_extreme" // today's move in the top N% of the series' own daily moves
  | "extreme" // level percentile in an extreme band
  | "solo_up" // moved up against a falling peer group
  | "solo_down" // moved down against a rising peer group
  | "none";
export interface OneLiner {
  kind: OneLinerKind;
  value: number | null;
}

export interface SeriesSummary {
  id: string;
  label: string;
  kind: "outright" | "spread" | "fly" | "vol";
  unit: Unit;
  now: number | null;
  deltas: Record<BasisKey, number | null>;
  basisValues: Record<BasisKey, number | null>;
  range10y: { min: number | null; max: number | null; pct: number | null };
  // §16: computed server-side, read straight through by the row builder.
  sortKey: number[];
  quoted: boolean | null;
  movePct: number | null; // own-history percentile of today's |D-1| move
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

/** Whole-curve extreme, stated once above the table (§I). */
export interface CurveBanner {
  kind: "curve_high" | "curve_low" | null;
}

export interface WallSummary {
  asof: string;
  basisDates: Record<BasisKey, string | null>;
  specNodeOrder: string[];
  displayTenors: string[];
  missingNodes: string[];
  curveBanner: CurveBanner;
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
  movePct: number | null; // own-history percentile of |D-1| — drives the matrix tint (§J)
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

/** Relative-ATR across tenors for the volatility tab's idle right pane. */
export interface VolCurveNode {
  label: string;
  now: number | null;
  prev: number | null; // D-1 comparison
}

export interface VolatilityPayload {
  asof: string;
  basisDates: Record<BasisKey, string | null>;
  rows: SeriesSummary[]; // SeriesSummary-shaped so the table never branches
  curve: VolCurveNode[];
}

export async function fetchVolatility(): Promise<VolatilityPayload> {
  const res = await fetch(`${API_BASE}/api/volatility`);
  if (!res.ok) throw new Error(`volatility: HTTP ${res.status}`);
  return res.json();
}

/** Tenor × date curve heatmap (§D). Rows = nodes (short→long), cols = date
 * buckets; each cell is the node's change + its own-history percentile. */
export interface HeatCell {
  d: number;
  pct: number | null;
}
export interface CurveHeatmapPayload {
  nodes: string[];
  dates: string[];
  cells: (HeatCell | null)[][];
}

export async function fetchCurveHeatmap(): Promise<CurveHeatmapPayload> {
  const res = await fetch(`${API_BASE}/api/curve-heatmap`);
  if (!res.ok) throw new Error(`curve-heatmap: HTTP ${res.status}`);
  return res.json();
}

/** Per-leg DV01 + the DV01-neutral notional ratio (§B). */
export interface Dv01Leg {
  tenor: string;
  dv01: number; // par-swap annuity / PV01 per unit notional
  notional: number | null; // ratio, normalised to 100; null for an outright
}
export interface Dv01Payload {
  id: string;
  kind: "outright" | "spread" | "fly" | null;
  legs: Dv01Leg[];
  residual: number | null;
}

export async function fetchDv01(id: string): Promise<Dv01Payload> {
  const res = await fetch(`${API_BASE}/api/dv01/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`dv01 ${id}: HTTP ${res.status}`);
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
  unit: Unit;
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

/** Weekly/monthly OHLC candles, aggregated server-side from closes (§G). */
export type Interval = "w" | "m";
export interface OhlcBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
}
export interface CandlesPayload {
  id: string;
  asof: string;
  unit: Unit;
  interval: Interval;
  bars: OhlcBar[];
}

export async function fetchCandles(id: string, interval: Interval): Promise<CandlesPayload> {
  const url = `${API_BASE}/api/series/${encodeURIComponent(id)}?res=full&interval=${interval}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`candles ${id}: HTTP ${r.status}`);
  return r.json();
}
