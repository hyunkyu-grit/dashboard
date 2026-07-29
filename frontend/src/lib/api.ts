/* Server-state types + fetchers. All derived series come from the backend;
 * the browser never computes a series (design spec §4).
 *
 * "The backend" is now either a static tree of JSON under `/api/…` (the
 * deployed case) or the live FastAPI app (local development, set
 * `NEXT_PUBLIC_API_BASE`). Only the URLs differ — every body is byte-identical,
 * because both come from `backend/app/payloads.py`. URL construction lives in
 * `staticPaths.ts`; nothing below knows which mode it is in, and no component
 * changed for this. */

import {
  dv01Url,
  forwardsUrl,
  healthUrl,
  IS_STATIC,
  manifestUrl,
  seriesUrl,
  summaryUrl,
  volatilityUrl,
} from "./staticPaths";
import {
  type Freshness,
  freshnessFrom,
  type FreshnessLevel,
  type Manifest,
} from "./freshness";

export { API_BASE } from "./staticPaths";
export type { Freshness, FreshnessLevel, Manifest };

export type BasisKey = "d1" | "wtd" | "mtd" | "qtd" | "ytd";

/** Level/change unit. `ratio` is the dimensionless volatility ratio (§ vol):
 * shown to two decimals, its change is a ratio difference, never bp. */
export type Unit = "%" | "bp" | "ratio";

/* A `SparkPoint`/`spark` field used to ride along on every summary row — 150
 * points per row, 92.3% of the stage-1 payload — and no component read it. It
 * was left from the retired band-card layout, whose tiles drew a sparkline.
 * Removed in the stability session (docs/diagnostics/perf-baseline.md). A line
 * comes from `fetchSeries` at stage 2; do not put history back on the row. */

/* A `한 줄` classification (`{kind, value}`) used to ride on every summary row
 * and every forward cell, and the frontend phrased it into Korean. The last
 * column now shows the 52-week high/low/mean instead (pass L), so the field and
 * its three backend rungs are gone. `range1y` below is what that column reads.
 * The §16 phrase-in-the-frontend exception still stands — its subjects are the
 * instrument gloss (`ui/gloss.ts`, from kind + legs) and `CurveBanner`. */

export interface SeriesSummary {
  id: string;
  label: string;
  kind: "outright" | "spread" | "fly" | "vol";
  unit: Unit;
  now: number | null;
  deltas: Record<BasisKey, number | null>;
  basisValues: Record<BasisKey, number | null>;
  // 52-week LEVEL stats (annual-stats session): trailing 252 observations.
  // The 10y window straddled the 2020-21 regime break and pinned every level
  // at the 99th-100th percentile — do not widen it back. CHANGE statistics
  // (movePct, tint) stay full-history on purpose. min/max/avg are the table's
  // last column (pass L); pct drives the 고점권/저점권 chips.
  range1y: {
    min: number | null;
    max: number | null;
    avg: number | null;
    pct: number | null;
  };
  // §16: computed server-side, read straight through by the row builder.
  sortKey: number[];
  quoted: boolean | null;
  movePct: number | null; // own-history percentile of today's |D-1| move
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
  const res = await fetch(summaryUrl());
  if (!res.ok) throw new Error(`wall summary: HTTP ${res.status}`);
  return res.json();
}

/** Dataset freshness (§ Pass C). `level` drives how loud the header says it:
 * current = quiet, behind = visible, stale = unmissable in words. Age is in KR
 * business days.
 *
 * Static conversion: this is the ONE value that cannot be precomputed — it is a
 * question about now, not about the data — so against a static tree it is
 * derived from the manifest against the browser's clock. Against a live backend
 * the server still answers it. The shape is identical either way, which is why
 * `DataFreshness` in App.tsx did not change. */
export interface Health {
  status: string;
  asof: string;
  rows: number;
  missingNodes: string[];
  freshness: Freshness;
}

export async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(manifestUrl());
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  return res.json();
}

export async function fetchHealth(): Promise<Health> {
  if (IS_STATIC) {
    const m = await fetchManifest();
    return {
      status: "ok",
      asof: m.asof,
      rows: m.rows,
      missingNodes: m.missingNodes,
      freshness: freshnessFrom(m),
    };
  }
  const res = await fetch(healthUrl());
  if (!res.ok) throw new Error(`health: HTTP ${res.status}`);
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
  keyForward: boolean;
  movePct: number | null; // own-history percentile of |D-1| — drives the matrix tint (§J)
  /** 52-week LEVEL high/low/mean in percent — the table's last column (pass L).
   * NO `pct` here, unlike every other `range1y`: nothing reads a forward's
   * level percentile, and the type is where that stays enforced. `KeyForward`
   * below does read it, so it carries the full record. */
  range1y: {
    min: number | null;
    max: number | null;
    avg: number | null;
  };
}

export interface KeyForward {
  label: string;
  values: Record<AnyBasis, number>;
  deltas: Record<BasisKey, number>;
  // 52-week LEVEL range + average + percentile (Pass E gauge; annual-stats
  // session); min/max/avg/pct in percent.
  range1y: {
    min: number | null;
    max: number | null;
    avg: number | null;
    pct: number | null;
  };
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
  const res = await fetch(forwardsUrl());
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
  const res = await fetch(volatilityUrl());
  if (!res.ok) throw new Error(`volatility: HTTP ${res.status}`);
  return res.json();
}

/* Carry & roll lived here and is gone (see DESIGN): the headline repeated the
 * breakeven's figure, and the components did not sum to the total at the
 * displayed precision. If it returns it is a sortable table COLUMN, not a
 * popup block. */

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
  const res = await fetch(dv01Url(id));
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
  const r = await fetch(seriesUrl(id, res));
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
  const r = await fetch(seriesUrl(id, interval));
  if (!r.ok) throw new Error(`candles ${id}: HTTP ${r.status}`);
  return r.json();
}
