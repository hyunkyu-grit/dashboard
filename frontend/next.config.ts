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
