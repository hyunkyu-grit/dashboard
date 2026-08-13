import path from "node:path";

import type { NextConfig } from "next";

/* Cache policy for the committed data tree (Pass F).
 *
 * `no-cache` on BOTH the manifest and every artifact. Not `immutable`, not
 * `stale-while-revalidate`, no positive `max-age`, no content-hashed names.
 *
 * The reason is tearing, and it is specific. These URLs are stable while their
 * contents change on every data refresh, so any positive `max-age` admits a
 * window in which the reader holds a FRESH manifest and a STALE series: the
 * header says today's date and the line is last week's. `stale-while-
 * revalidate` has the same defect and serves the stale copy on first paint,
 * which is the one paint that matters. Content-hashed filenames would fix the
 * tearing but add a full artifact set (~31 MB) to the repo per refresh and open
 * a 404 race for a reader still holding the previous manifest.
 *
 * `no-cache` does not mean "do not store" — it means "revalidate before use".
 * Measured: revalidation returns 304 with a 0-byte body, so the price of
 * correctness is one conditional request per artifact, not a re-download.
 *
 * This lives in next.config rather than vercel.json because Next applies these
 * headers to `public/` both under `next start` and on Vercel, so local and
 * deployed behaviour cannot diverge. vercel.json carried a DIFFERENT policy
 * until this pass and `next start` ignored it entirely — the two could not be
 * compared, which is how the mismatch survived. One source now;
 * `guards/cache-policy.test.ts` reads this file.
 */
export const DATA_CACHE_CONTROL = "no-cache";

/** Path pattern covering every committed artifact. Exported so the guard can
 * derive its scope from the config instead of restating it. */
export const DATA_SOURCE_PATTERN = "/api/:path*";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // the dark floating dev indicator is not part of the product and sat over
  // the bottom-left of the table during layout checks (carry session, Pass D)
  devIndicators: false,
  /* The LIVE routes to a deployed backend (§backtest, 시뮬레이션).
   *
   * Most endpoints are a committed JSON file the deployed site serves itself.
   * These cannot be: their answers depend on inputs the reader chooses, so
   * they need the live FastAPI app. That app is not on Vercel — Vercel runs
   * the frontend and a backend runs behind it [OWNER].
   *
   * The simulation's four joined this list on 2026-08-07 and it is worth
   * saying why they were missing: `/api/backtest` was the only live route when
   * this was written, and the simulation arrived working — in DEV, where
   * `.env.development.local` sets NEXT_PUBLIC_API_BASE to an absolute
   * localhost:8100 and no rewrite is involved at all. Deployed, API_BASE is
   * the empty string by design, every simulation call goes same-origin, and
   * without a rule here all four would have 404'd on a site that looked fine
   * locally. Nothing would have said so except an error panel in the tab.
   *
   * A REWRITE, not `NEXT_PUBLIC_API_BASE`. The env var would be inlined into
   * the browser bundle, and `guards/production-env.test.ts` exists to forbid
   * exactly that: a build once shipped `http://localhost:8100` baked in, so
   * every deployed request went to the READER's own machine and failed as
   * mixed content. That guard stays green here because `BACKEND_ORIGIN` is
   * read at build time on the SERVER and never reaches the client — the
   * browser only ever calls `/api/backtest` on its own origin.
   *
   * It also removes CORS from the picture: the backend allows only
   * localhost:3100, and a proxied request is not a cross-origin one.
   *
   * Unset emits no rule at all: `/api/backtest` 404s and the sheet says a
   * backend is needed rather than drawing an empty chart. That is the local
   * default.
   *
   * WHETHER THE DEPLOYMENT SETS IT IS NOT KNOWABLE FROM THIS REPO — it is a
   * Vercel project environment variable. This comment used to assert "and the
   * current deployment" was unset, and that went stale without anything being
   * able to notice: a Tailscale Funnel now proxies the public internet into
   * `127.0.0.1:8100`, which exists for no other purpose than to be this
   * rewrite's target, and a dead backend has been observed surfacing as a 502
   * on the deployed site — both of which require the rule to be emitted, i.e.
   * the variable to be set.
   *
   * So do not restate the deployment's value here. Read it from the Vercel
   * project settings, or infer it from the funnel; see DEPLOY_CHECKLIST.
   */
  async rewrites() {
    const origin = process.env.BACKEND_ORIGIN?.replace(/\/$/, "");
    if (!origin) return [];
    return [
      { source: "/api/backtest", destination: `${origin}/api/backtest` },
      // 시뮬레이션. `/api/market-data/:path*` covers both `range` and the
      // per-date snapshot; `/api/positions` is the book, which is optional now
      // (its failure is a notice, not a gate) but must still be REACHABLE or
      // the notice reports a missing backend as missing data.
      { source: "/api/simulate", destination: `${origin}/api/simulate` },
      { source: "/api/market-data/:path*", destination: `${origin}/api/market-data/:path*` },
      { source: "/api/positions", destination: `${origin}/api/positions` },
      { source: "/api/positions/:path*", destination: `${origin}/api/positions/:path*` },
      // 상품 목록과 다리 전개. `expand`는 기준일 커브에서 DV01 중립 가중을
      // 잡으므로 정적 쌍둥이를 만들 수 없다 — 백테스트와 같은 이유로 LIVE다.
      { source: "/api/instruments", destination: `${origin}/api/instruments` },
      { source: "/api/instruments/:path*", destination: `${origin}/api/instruments/:path*` },
      // `/api/credit-curve/*` is deliberately ABSENT. Its workbook (Credit
      // Matrix Data.xlsx) was deleted with the data consolidation, nothing in
      // the frontend calls it any more, and a rule pointing at an endpoint
      // that would 500 is worse than no rule: it turns "we do not ask this"
      // into "we ask this and it breaks".
    ];
  },
  async headers() {
    return [
      {
        // manifest, summary, forwards, volatility, series/**, dv01/** — one
        // rule at the tree's root rather than a list of paths that would drift
        // from what the build actually emits.
        source: DATA_SOURCE_PATTERN,
        headers: [{ key: "Cache-Control", value: DATA_CACHE_CONTROL }],
      },
    ];
  },
};

export default nextConfig;
