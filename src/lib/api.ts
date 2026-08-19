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
  cashbondBacktestUrl,
  cashbondInstrumentsUrl,
  cashbondSeriesUrl,
  dv01Url,
  forwardsUrl,
  fundingSettingsUrl,
  healthUrl,
  IS_STATIC,
  manifestUrl,
  seriesUrl,
  summaryUrl,
  surfaceUrl,
  volatilityUrl,
} from "./staticPaths";
import {
  type DataSource,
  type Freshness,
  freshnessFrom,
  type FreshnessLevel,
  type Manifest,
} from "./freshness";

export type { DataSource, Freshness, FreshnessLevel, Manifest };

/* THE change bases. Three [OWNER, 2026-07-31]: WTD and QTD were dropped —
 * between 어제 and MTD a week is rarely the interval anyone reasons in, and
 * QTD differs from MTD in only two months of three. A day, a month, a year;
 * the 52주 statistics carry the longer view. Mirrors `derive.BASIS_KEYS`. */
export type BasisKey = "d1" | "mtd" | "ytd";

/** Level/change unit. `ratio` is the dimensionless volatility ratio (§ vol):
 * shown to two decimals, its change is a ratio difference, never bp. */
/* V2-LOCAL: "가격" added for KTB futures. Price and 저평가 are quoted in price
 * points, not bp — printing them through the bp formatter rounded 저평가 −0.028 to
 * "-0.0", which is a number that says the basis is flat when it is not. */
export type Unit = "%" | "bp" | "ratio" | "가격";

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
  /** 세타 [OWNER, 2026-08-13] — outright swap tenors, spreads and flies.
   * Absent (or null) on 1D/3M, forwards and volatility; the column draws an
   * em dash there. Every convention behind these numbers is stated in
   * `backend/app/theta.py` — do not re-derive any of them here (§16). */
  theta?: Theta | null;
}

/** Carry + rolldown over a frozen curve, in won, for the instrument's own +1
 * direction (페이 / 스티프너 / 벨리 페이). The column reads `perDv01`; the
 * rest is the cell's tooltip.
 *
 * `cash`/`carry`/`roll`/`dv01` stand on `thetaBasis.notional` (100억) — for a
 * package that is the REFERENCE leg's notional (the long leg, or the belly),
 * with the others weighted DV01-neutral against it. `perDv01` does not depend
 * on the notional at all. */
export interface Theta {
  perDv01: number; // 원, per 1,000,000원 of DV01 — what the column prints
  cash: number; // 원, at the basis notional
  carry: number; // 원, the coupon-differential accrual
  roll: number; // 원, the frozen-curve mark change
  /** 원/bp. An outright's own DV01; for a spread or fly the REFERENCE LEG's,
   * because the package is DV01-neutral and its net is zero — see
   * `backend/app/theta.py::theta_for_package`. */
  dv01: number;
  /** bp the row's own QUOTED VALUE must move to cancel the theta: the rate for
   * an outright, the spread for a package. Signed in the quote's direction. */
  beBp: number;
}

/** What the 세타 column means, stated once for the table rather than repeated
 * down it. `cd` null ⇒ no row carries a theta (carry cannot be invented). */
export interface ThetaBasis {
  /** 하루 [OWNER, 2026-08-14 — "세타 전부 다 하루치로"]. 계산 창은 분기이고
   * 표기만 일 단위다 — 백엔드 `app/theta.py:HORIZON_Y` 에 실측 근거가 있다. */
  horizonDays: number;
  notional: number;
  side: 'pay';
  cd: number | null;
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
  /** 앞으로 남은 금통위 날짜 [V2-LOCAL, 2026-08-14]. 시뮬레이션의 기준금리
   * 이벤트가 날짜 칸을 이걸로 채운다 — 브라우저가 회의 일정을 들고 있지 않다.
   * 옵셔널인 이유는 이 필드 이전에 구워진 정적 트리도 읽히기 때문이다. */
  upcoming?: string[];
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
  /** 세타 열의 기준 — 표 전체에 한 번. `cd` 가 null 이면 어떤 행도 세타를
   * 지지 않는다(캐리를 지어낼 수 없다). 옵셔널인 이유는 이 필드 이전에 구워진
   * 정적 트리도 읽히기 때문이다. */
  thetaBasis?: ThetaBasis;
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
  /** 데이터 출처 — "sql" 이 아니면 엑셀이 섞였고, DataFreshness 가 칩으로
   * 말한다 [OWNER, 2026-08-11]. 옵셔널: 이 필드 이전의 백엔드/트리도 읽힌다. */
  source?: DataSource;
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
      source: m.source,
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

/** 3D 커브 표면 — 국고·크레딧·스왑 3풀 (Lab, `app/surface3d.py`). 전작
 * `SurfacePayload`(단일 IRS, `app/surface.py`)는 화면 교체 [OWNER 2026-08-18]와
 * 함께 은퇴했다 — 백엔드 `/api/surface` 라우트는 v1 과의 대사를 위해 남아 있다. */
export interface SurfacePool {
  label: string;
  /** "%"(아웃라이트) 또는 "bp"(스프레드 풀 — BSS·신용). 축·리드아웃이 읽는다. */
  unit: Unit;
  asof: string;
  /** 실측 노드만 — 라벨과 실제 연수. x 축은 연수다(등간격이 아니다). */
  tenors: { t: string; years: number }[];
  dates: string[];
  /** [테너][날짜]. 구멍은 null — 0 으로 메우면 절벽이 시장으로 읽힌다. */
  z: (number | null)[][];
  inversionPair: string;
  inversionBp: (number | null)[];
  /** 전부 결측이라 빠진 노드 — 격자가 조용히 좁아지는 것은 눈으로 안 잡힌다. */
  missingNodes: string[];
  start: string;
}

export interface Surface3DPayload {
  unit: Unit;
  /** 능선 사이의 영업일 수. 화면이 "주별" 이라고 적을 때 읽는 값이다. */
  stride: number;
  creditTypes: { id: string; label: string }[];
  creditDefault: string;
  /** CD91 일별 — hover 리드아웃의 "CD 얼마". 프론트는 짚은 날짜 이하의 마지막
   * 값을 고를 뿐 계산하지 않는다(§16). 기준금리는 PolicyStep 이 진다. */
  cd: { dates: string[]; values: (number | null)[] } | null;
  /** "govt" | "swap" | "credit:<타입>" → 풀. 풀마다 자기 달력이다 [OWNER]. */
  pools: Record<string, SurfacePool>;
}

export async function fetchSurface3D(): Promise<Surface3DPayload> {
  const res = await fetch(surfaceUrl());
  if (!res.ok) throw new Error(`surface3d: HTTP ${res.status}`);
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
    super("백테스트는 실행 중인 백엔드가 필요해요");
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
  /** The three parts of `pnl`, which they sum to exactly [OWNER, 2026-08-11
   * — 교과서 3분해]:
   *   평가   = what the curve MOVING did (clean change minus the roll chain)
   *   롤다운 = clean change from aging alone on the unchanged curve
   *            (Tuckman unchanged-term-structure, chained day by day)
   *   캐리   = interest actually earned or paid, settled plus still accruing
   * An identity, not an attribution model (see backend/app/backtest.py).
   * `rolldown` is optional only for results restored from an older session's
   * memory — the server always sends it now. */
  valuation: number;
  rolldown?: number;
  carry: number;
  /** 개시 — 거래일→발효일 한 밤 [OWNER, 2026-08-14]. 스팟 시작 스왑은 그 밤에
   * 경과이자가 없어 캐리가 구조적으로 0 이고, 그 밤의 세타 전부가 롤다운으로
   * 떨어지던 것을 네 번째 칸으로 뺐다(backend/app/backtest.py 의 개시 주석).
   * 화면에서는 평가에 접는다(`splitKrw`) — 총손익 대비 0.005% 라 자기 열을
   * 갖지 않는다 [OWNER, 2026-08-14]. 옛 세션에서 복원한 결과에만 없다. */
  startup?: number;
  /** settled cash alone, the part of `carry` that has actually been paid */
  cash: number;
}

/** 일별 대사 [OWNER, 2026-08-11] — one business day of the book: the
 * start-of-day per-tenor KRD (the very sensitivities the estimate
 * multiplied — krd × dbp = est closes inside the row [OWNER, 같은 날]), the
 * ACTUAL market Δbp (this is history, not a scenario), the P&L-explain
 * estimate, and the day's actual P&L split 평가/롤다운/캐리. `dbp` is null
 * where the tenor had no quote on one of the two days — unknown, not zero.
 * The last row is the carry-over anchor (`carryover: true`): the final
 * day's CLOSE KRD — tomorrow's risk — with every P&L field null (a day
 * that hasn't happened has no P&L; 공란 정책) and empty `dbp`/`est`. */
export interface BacktestReconRow {
  t: string;
  krd: Record<string, number>;
  dbp: Record<string, number | null>;
  est: Record<string, number>;
  estTotal: number | null;
  actual: number | null;
  valuation: number | null;
  rolldown: number | null;
  carry: number | null;
  /** 개시 — 그 포지션의 진입일 행에만 0 이 아니다 [OWNER, 2026-08-14].
   * 화면에서는 평가에 접는다(BacktestWindow 의 backtestDays). */
  startup?: number | null;
  /** 조달 — 현금채권 대사에만 있다 [OWNER, 2026-08-14]. IRS 에는 조달 개념이
   * 없어 필드 자체가 안 온다. */
  funding?: number | null;
  residual: number | null;
  carryover?: boolean;
}

export interface BacktestRecon {
  /** every tenor label, ascending — columns; the table hides all-zero ones */
  tenors: string[];
  rows: BacktestReconRow[];
  /** true when the window was cut to the last ~250 business days */
  truncated: boolean;
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
  /** 일별 대사 — optional only for results restored from an older session's
   * memory; the live endpoint always sends it. */
  recon?: BacktestRecon;
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
  return r.json().catch(() => {
    throw new Error(TRUNCATED_RESPONSE_MSG);
  });
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

/* ── Cash Bond [OWNER, 2026-08-14] ─────────────────────────────────────────
 *
 * 민평(SQL `credit_matrix`)에서 par 로 발행한 3개월 이표채. 이 블록의 라우트는
 * **전부 라이브**다 — 정적 쌍둥이가 없는 이유는 `staticPaths.liveUrl` 주석에
 * 있다. §16 은 여기서도 그대로다: 수준·변화·백분위·손익 칸을 전부 서버가 내고
 * 브라우저는 그리기만 한다.
 */

export type CashBondKind = "CB" | "ASW";

export interface CashBondRow {
  id: string;             // "CB:KTB:3Y" | "ASW:KTB:3Y"
  kind: CashBondKind;
  bondType: string;       // "KTB"
  tenor: string;          // "3Y"
  label: string;          // "국고채 3Y"
  /** 현금채권은 수익률(%), 자산스왑은 스프레드(bp). IRS 행과 같은 어휘라
   * 같은 포매터를 탄다. */
  unit: Unit;
  now: number;
  changes: Record<BasisKey, number | null>;
  pct: number | null;
  rangeHigh: number | null;
  rangeLow: number | null;
  rangeAvg: number | null;
  sortKey: number[];
  /** 세타 — **하루** 캐리+롤다운, DV01 백만원당 [OWNER, 2026-08-14].
   *
   * IRS 표의 같은 열과 정의를 맞췄다: **조달을 빼지 않는다** [OWNER — "채권에서는
   * 조달 차감하지 않는 걸로"]. 시장 관행(carry = y − 레포)과는 다르다는 사실이
   * 백엔드 `app/cashbond.py` 의 세타 주석에 외부 출처와 함께 적혀 있다.
   * 부호는 **매수** 기준(스왑 표는 페이 기준) — 이 표의 행은 살 수만 있다.
   * 자산스왑 행은 두 다리의 합이고, 분모는 채권 다리의 DV01 이다. */
  theta: Theta | null;
}

export interface CashBondInstruments {
  asof: string;
  from: string;
  types: { id: string; label: string }[];
  rows: CashBondRow[];
  /** 세타 열이 무엇을 뜻하는지 — 표 아래에 한 번 적는다. 조달은 여기 없다:
   * 세타가 그것을 안 뺀다(Setting 의 값은 백테스트의 조달 칸이 쓴다). */
  thetaBasis: {
    horizonDays: number;
    notional: number;
    side: "buy";
  };
}

/** 조달 기준의 출처 — 화면이 "이 숫자가 어디서 왔는가" 를 말할 수 있게. */
export interface FundingProvenance {
  basis: string;
  basisLabel: string;
  spreadBp: number;
  label: string;
  from: string;
  to: string;
  latest: number;
}

export interface FundingSettings extends FundingProvenance {
  options: { id: string; label: string }[];
  default: { basis: string; spreadBp: number };
}

export interface CashBondPosition {
  id: string;
  kind: CashBondKind;
  bondType: string;
  label: string;
  tenor: string;
  direction: number;
  notional: number;
  entry: string;
  exit: string;
  closed: boolean;
  matured: boolean;
  coupon: number;
  entryYield: number;
  exitYield: number;
  /** 다섯 칸. 더하면 `pnl` 이다 (§backtest, 현금채권 판).
   *   평가   민평 수익률이 움직인 몫
   *   캐리   쿠폰 — 경과이자 증가분 + 이미 받은 이표
   *   롤다운 커브가 멈춰도 잔존만기가 줄며 생기는 몫
   *   조달   원금을 조달한 비용 (이미 음수다)
   *   개시   자산스왑의 스왑 다리가 싣고 오는 거래일→발효일 한 밤. 현금채권
   *          단독은 0 — 진입일에 발행돼 셀 밤이 없다. */
  valuation: number;
  carry: number;
  rolldown: number;
  funding: number;
  startup: number;
  pnl: number;
  /** 자산스왑에만: 스왑 다리 손익과 진입 스프레드(bp). */
  swapPnl: number | null;
  swapEntryRate?: number;
  aswSpread?: number;
}

export interface CashBondBacktest {
  positions: CashBondPosition[];
  from: string;
  to: string;
  complete: boolean;
  /** 북 총계와 그 날의 **1영업일** 변화(`d`, 첫 점은 null). 점이 며칠씩
   * 떨어져 그려져도 `d` 는 늘 하루다 — 서버가 발행점마다 전영업일을 따로
   * 평가한다(IRS 백테스트와 같은 규약). 브라우저에서 차분하지 않는다(§16). */
  points: { t: string; pnl: number; d: number | null }[];
  pnl: number;
  maxProfit: number;
  maxLoss: number;
  funding: FundingProvenance;
  /** 일별 대사 [OWNER, 2026-08-14 — "현금채권/자산스왑 백테스트에서도 대사
   * 가능하게"]. IRS 쪽과 같은 모양이고 조달 열이 하나 더 있다. 흔드는 커브는
   * 현금채권이면 민평, 자산스왑이면 그 스프레드다(backend/app/cashbond.py). */
  recon?: BacktestRecon;
}

/** 실행 응답은 스트리밍이라(엔진이 도는 동안 공백을 흘린다) 엔진이 도중에 죽으면
 * 상태는 200 인 채 본문만 잘린다 — 그 실패의 유일한 증상이 JSON 파싱 실패고,
 * 파서의 문장("Unexpected end of JSON input")은 읽는 사람의 말이 아니다. */
export const TRUNCATED_RESPONSE_MSG = "서버가 응답을 끝내지 못했어요, 다시 실행해 보세요";

/** 실행 버튼의 catch 가 화면에 올릴 문장. fetch 거절(TypeError)의 브라우저
 * 문장("Failed to fetch")만 바꾸면 나머지는 이미 사람 말이다 — 422 detail,
 * Unavailable 패널, 그리고 위의 TRUNCATED_RESPONSE_MSG. */
export function runErrorMessage(e: unknown): string {
  if (e instanceof TypeError) return "서버에 닿지 못했어요, 백엔드가 살아 있는지 봐 주세요";
  return e instanceof Error ? e.message : String(e);
}

async function liveJson<T>(url: string, what: string): Promise<T> {
  const r = await fetch(url);
  // 404 = 그 라우트가 없다 = 뒤에 백엔드가 없다 (backtest 와 같은 규약)
  if (r.status === 404) throw new BacktestUnavailable();
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.detail ?? `${what}: HTTP ${r.status}`);
  }
  return r.json().catch(() => {
    throw new Error(TRUNCATED_RESPONSE_MSG);
  });
}

export async function fetchCashBondInstruments(): Promise<CashBondInstruments> {
  return liveJson(cashbondInstrumentsUrl(), "cashbond/instruments");
}

/** 한 종목의 전 기간 시계열. IRS 쪽 `fetchSeries` 와 **같은 몸통**이라
 * 미리보기 pane 이 그대로 먹는다 — 점마다 전일 대비(`d`, 늘 bp)와 52주
 * min/max/avg 가 붙어 있다(백엔드 `derive.series_history`). */
export interface CashBondSeries {
  id: string;
  label: string;
  unit: Unit;
  points: HistoryPoint[];
  stats: SeriesStats | null;
}

export async function fetchCashBondSeries(id: string): Promise<CashBondSeries> {
  return liveJson(cashbondSeriesUrl(id), "cashbond/series");
}

export interface CashBondPositionInput {
  id: string;
  direction: number;
  /** 억 단위 — 화면이 억으로 받는다 (IRS 백테스트와 같은 규약). */
  eok: number;
  entry: string;
  exit: string;
}

export function encodeCashBondPositions(rows: CashBondPositionInput[]): string {
  return rows
    .map((r) =>
      [r.id, r.direction, r.eok * 1e8, r.entry, r.exit]
        .filter((v, i) => i < 4 || v !== "")
        .join(","),
    )
    .join(";");
}

export async function fetchCashBondBacktest(
  rows: CashBondPositionInput[],
  funding: { basis: string; spreadBp: number },
): Promise<CashBondBacktest> {
  return liveJson(
    cashbondBacktestUrl(encodeCashBondPositions(rows), funding.basis, funding.spreadBp),
    "cashbond/backtest",
  );
}

export async function fetchFundingSettings(funding: {
  basis: string;
  spreadBp: number;
}): Promise<FundingSettings> {
  return liveJson(fundingSettingsUrl(funding.basis, funding.spreadBp), "settings/funding");
}
