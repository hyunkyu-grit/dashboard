/* Where the data lives — the frontend half of the id→path rule.
 *
 * Static conversion, Pass C. `backend/app/static_paths.py` is the other half
 * and the two MUST agree; `guards/static-paths.test.ts` enumerates every id the
 * app can request and checks a byte-identical file was actually emitted, so a
 * divergence fails at gate time rather than as a production 404.
 *
 * Two shapes, because a static host cannot select a file by query string:
 *
 *   static (default)  /api/series/10Y.full.json
 *   live backend      http://localhost:8100/api/series/10Y?res=full
 *
 * The live shape is kept for local development against the FastAPI app, which
 * stays the reference implementation. Set `NEXT_PUBLIC_API_BASE` to use it.
 */

/** Set → talk to a live backend at that origin. Unset → read static files. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

/** True when no live backend is configured, i.e. the deployed case. */
export const IS_STATIC = API_BASE === "";

export type Resolution = "full" | "preview" | "w" | "m";

/** Id → path stem. The colon in `vol:1Y` is already a namespace separator, so
 * a directory is what it always meant: `vol/1Y`. It also has to go: on NTFS a
 * colon redirects the write into an alternate data stream (silently), and
 * `encodeURIComponent` turns it into `%3A`, so a literally-named file and the
 * request path would disagree even on Linux. Mirrors `static_paths.py::slug`. */
export function slug(seriesId: string): string {
  return seriesId.replace(/:/g, "/");
}

/** Path segments are already safe by construction (see slug + the backend's
 * refusal to emit anything else), so they are encoded per-segment — a whole-id
 * `encodeURIComponent` would escape the separators we just created. */
function encodePath(stem: string): string {
  return stem.split("/").map(encodeURIComponent).join("/");
}

export function seriesUrl(seriesId: string, res: Resolution): string {
  if (IS_STATIC) return `/api/series/${encodePath(slug(seriesId))}.${res}.json`;
  const id = encodeURIComponent(seriesId);
  return res === "w" || res === "m"
    ? `${API_BASE}/api/series/${id}?res=full&interval=${res}`
    : `${API_BASE}/api/series/${id}?res=${res}`;
}

export function dv01Url(seriesId: string): string {
  return IS_STATIC
    ? `/api/dv01/${encodePath(slug(seriesId))}.json`
    : `${API_BASE}/api/dv01/${encodeURIComponent(seriesId)}`;
}

export const summaryUrl = () =>
  IS_STATIC ? "/api/wall/summary.json" : `${API_BASE}/api/wall/summary`;
export const forwardsUrl = () =>
  IS_STATIC ? "/api/forwards.json" : `${API_BASE}/api/forwards`;
export const volatilityUrl = () =>
  IS_STATIC ? "/api/volatility.json" : `${API_BASE}/api/volatility`;
export const surfaceUrl = () =>
  IS_STATIC ? "/api/surface.json" : `${API_BASE}/api/surface`;

/** The manifest replaces `/api/health` when static: freshness is a "now"
 * question and the client owns the clock (§21). Against a live backend the
 * server still answers it, so the caller branches on IS_STATIC. */
/** The backtest is LIVE-ONLY. Every other endpoint has a static twin the
 * deployed site serves, but this answer depends on inputs the reader chooses,
 * so it cannot be baked. Vercel runs the frontend and a backend runs behind it
 * [OWNER, 2026-07-31]; with no `NEXT_PUBLIC_API_BASE` set there is nothing to
 * ask, and callers must say so rather than fetch a file that will never exist.
 * Returns null in that case — a URL here would 404 as HTML and surface as a
 * JSON parse error, which tells the reader nothing. */
export function backtestUrl(spec: string): string | null {
  const q = `positions=${encodeURIComponent(spec)}`;
  // Development against a live backend: the explicit origin.
  if (!IS_STATIC) return `${API_BASE}/api/backtest?${q}`;
  /* Deployed: a SAME-ORIGIN path, proxied to the backend by the Next rewrite
   * in next.config.ts when BACKEND_ORIGIN is set there. Same-origin on purpose
   * — an absolute origin in the bundle is what
   * `guards/production-env.test.ts` forbids, and it would need CORS too.
   *
   * With no rewrite configured this 404s, which `fetchBacktest` turns into the
   * "백엔드가 필요한 화면이에요" panel. That is the honest answer: the route
   * genuinely is not there. */
  return `/api/backtest?${q}`;
}

/** Cash Bond · Setting 은 **전부 LIVE** 다 [OWNER, 2026-08-14].
 *
 * `backtestUrl` 과 같은 이유와 같은 모양이다: 개발에서는 명시 오리진, 배포에서는
 * 동일 오리진 경로(next.config.ts 의 rewrite 가 백엔드로 넘긴다). 여기에 정적
 * 쌍둥이가 없는 이유는 백테스트보다 하나 더 있다 — 민평 자체가 SQL 에만 있어서
 * 굽기 산출물에 들어가지 않는다. 굽는 것을 잊은 것이 아니라 구울 수 없다.
 *
 * rewrite 가 없으면 404 이고, 호출자는 그것을 "백엔드가 필요한 화면이에요" 로
 * 바꾼다. 그게 정직한 답이다 — 그 라우트는 진짜로 없다. */
function liveUrl(path: string, query?: string): string {
  const q = query ? `?${query}` : "";
  return IS_STATIC ? `${path}${q}` : `${API_BASE}${path}${q}`;
}

export const cashbondInstrumentsUrl = () => liveUrl("/api/cashbond/instruments");

export const cashbondSeriesUrl = (id: string) =>
  liveUrl(`/api/cashbond/series/${encodeURIComponent(id)}`);

export const cashbondBacktestUrl = (spec: string, basis: string, spreadBp: number) =>
  liveUrl(
    "/api/cashbond/backtest",
    `positions=${encodeURIComponent(spec)}&basis=${encodeURIComponent(basis)}&spreadBp=${spreadBp}`,
  );

export const fundingSettingsUrl = (basis: string, spreadBp: number) =>
  liveUrl("/api/settings/funding", `basis=${encodeURIComponent(basis)}&spreadBp=${spreadBp}`);

export const manifestUrl = () => "/api/manifest.json";
export const healthUrl = () => `${API_BASE}/api/health`;
