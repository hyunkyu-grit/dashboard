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
  backtestUrl,
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

/* THE change bases. Three [OWNER, 2026-07-31]: WTD and QTD were dropped —
 * between 어제 and MTD a week is rarely the interval anyone reasons in, and
 * QTD differs from MTD in only two months of three. A day, a month, a year;
 * the 52주 statistics carry the longer view. Mirrors `derive.BASIS_KEYS`. */
export type BasisKey = "d1" | "mtd" | "ytd";

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
  /** 주요 membership — the tab's 주요/전체 divider (§3). The owner's lists
   * live in `derive.py`; the browser reads the verdict and never re-derives
   * it, so there is exactly one place to change which rows sit on top. */
  key: boolean;
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

/** 라고 할 때 살걸 — one past change-log line, priced in hindsight: the
 * event's own direction followed the NEXT business day with 100억, valued to
 * the as-of date by the backtest engine (backend/app/regret.py — every
 * convention is stated there). */
export interface RegretEntry {
  date: string; // the day the log line fired (its close is the signal)
  id: string;
  label: string;
  kind: "outright" | "spread" | "fly";
  unit: "%" | "bp";
  deltaBp: number;
  reasons: ("transition" | "move")[];
  direction: 1 | -1; // sign of deltaBp — the follow trade
  entry: string; // the next business day, when the follow trade strikes
  matured: boolean;
  pnl: number; // KRW, signed; served rounded, never differenced here (§16)
}

/** The BOK base rate as a STEP, drawn on every %-unit AND bp-unit chart —
 * CD and the base rate are always drawn together [OWNER, 2026-07-31], and the
 * 3M node IS CD91. On a bp chart (spread, butterfly) the pair keeps its OWN
 * labelled % scale beside the instrument's [OWNER, 2026-08-03] — never forced
 * onto the bp axis, which would be a rescale, not a comparison. Ratio charts
 * (volatility) are still excluded. See `ui/policyLine.ts::policyAxisMode`.
 *
 * `steps` are the CORNERS only — the date each decision took effect. Draw with
 * square corners; never interpolate between two of them, and never extend the
 * last level past `through`. `through` is NOT the chart's axis end: it is the
 * last date the backend can vouch for, and it stops short of the as-of date
 * when the workbook has not been refreshed through a Board meeting (see
 * `backend/app/policy.py`). Running the line to the axis end instead would
 * reintroduce exactly the silent error that bound exists to prevent. */
export interface PolicyStep {
  unit: "%";
  asof: string;
  through: string;
  steps: { date: string; rate: number }[];
  latest: number | null;
  warnings: string[];
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
  regret: RegretEntry[];
  policy: PolicyStep;
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

/** CD 91d — the 3M curve node IS the CD fixing (`dataset._tenor_id`), so the
 * outright series `3M` is the CD history. Named here so the reference-line
 * callers do not each hard-code the string, and so the coupling to that
 * mapping has one place to be found. */
export const CD_SERIES_ID = "3M";

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

/** Relative-ATR across tenors. Was the volatility tab's idle right pane; since
 * pass M the idle pane is the IRS par curve on every tab, so this field is
 * SERVED AND RENDERED BY NOTHING. Kept deliberately (removing it is a
 * SCHEMA_VERSION bump + a static-tree rebuild, not a component edit) and
 * tracked as an open item in HANDOFF — do not treat it as live. */
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

/* ── Backtest (§backtest) ───────────────────────────────────────────────────
 * Enter a position on a past date and revalue it every day since. Full
 * revaluation on each day's own curve plus settled cash — NOT Δrate × DV01,
 * which is blind to time passing. Legs are DV01-neutral at the entry curve.
 *
 * LIVE BACKEND ONLY: the answer depends on the reader's inputs so it cannot be
 * a static file. `BacktestUnavailable` is thrown when none is configured, and
 * the UI says so instead of showing a broken chart. */

export class BacktestUnavailable extends Error {
  constructor() {
    super("백테스트는 실행 중인 백엔드가 필요합니다");
    this.name = "BacktestUnavailable";
  }
}

export interface BacktestLeg {
  tenor: string;
  side: "pay" | "receive";
  notional: number;
  entryRate: number; // percent
  dv01: number;      // per unit notional, at the entry curve
}

/** One line of the book, as the server priced it. */
export interface BacktestPosition {
  id: string;
  direction: number;
  notional: number;
  entry: string;
  exit: string;
  /** true when the position stopped before the data ends — after that its P&L
   * is frozen and still counted, so a closed winner keeps contributing. */
  closed: boolean;
  /** true when it stopped because the SWAP MATURED rather than because it was
   * closed out. A different fact, and the one the period column used to get
   * wrong — a 9M entered in 2020 was reported as held for six years. */
  matured: boolean;
  legs: BacktestLeg[];
  entryValue: number | null;
  exitValue: number | null;
  pnl: number;
  /** The two halves of `pnl`, which they sum to exactly:
   *   평가 = mark-to-market on the clean price — the rate move and roll-down
   *   캐리 = interest actually earned or paid, settled plus still accruing
   * An identity, not an attribution model (see backend/app/backtest.py). */
  valuation: number;
  carry: number;
  /** settled cash alone, the part of `carry` that has actually been paid */
  cash: number;
}

export interface BacktestResult {
  positions: BacktestPosition[];
  from: string;
  to: string;
  /** The BOOK total per date, each with its ONE-BUSINESS-DAY change (`d`,
   * null on the first). Always a day, however far apart the points are drawn:
   * the server values the day before each sample for exactly this. Served
   * rather than differenced here (§16) — subtracting a series already rounded
   * to the won gives a figure that disagrees with the two on screen. */
  points: { t: string; pnl: number; d: number | null }[];
  /** whether every business day in the window is DRAWN. Nothing to do with
   * `d`, which is one day either way; it describes the line's resolution. */
  complete: boolean;
  pnl: number;
  maxProfit: number;
  maxLoss: number;
}

/** What the user typed, before the server prices it. */
export interface PositionInput {
  id: string;
  direction: number;
  /** in 억 — nobody types eleven zeros */
  eok: number;
  entry: string;
  exit: string;
}

/** `id,direction,notional,entry[,exit]` joined by `;` — see the endpoint.
 * A book is a URL somebody can paste to a colleague, which is the same
 * property `?tile=` gives the rest of the product. */
export function encodePositions(rows: PositionInput[]): string {
  return rows
    .map((r) =>
      [r.id, r.direction, r.eok * 1e8, r.entry, r.exit].
        filter((v, i) => i < 4 || v !== "").join(","),
    )
    .join(";");
}

export async function fetchBacktest(
  rows: PositionInput[],
): Promise<BacktestResult> {
  const url = backtestUrl(encodePositions(rows));
  if (url === null) throw new BacktestUnavailable();
  const r = await fetch(url);
  /* 404 means the route is not there, which on a deployed site means no
   * backend is proxied behind it (see `backtestUrl` and the rewrite in
   * next.config.ts). That is a different thing from a rejected request and
   * gets the "백엔드가 필요한 화면이에요" panel rather than a raw error. */
  if (r.status === 404) throw new BacktestUnavailable();
  if (!r.ok) {
    // the backend returns 422 with a readable reason; surface it verbatim
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.detail ?? `backtest: HTTP ${r.status}`);
  }
  return r.json();
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
