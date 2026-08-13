/* Guard: the client fails VISIBLY (stability session, Pass B).
 *
 * Pass A's diagnosis: with the backend stopped, a 500, or a 200 carrying a
 * truncated body, the screen said `불러오는 중입니다` and kept saying it —
 * 24s, then 81s. Three failures, one appearance, none of them actionable, and
 * a single throw anywhere under the root took the entire tree with it. These
 * tests pin the four things that fixed it. See docs/diagnostics/failure-modes.md.
 *
 * Source-scanning, so every read STRIPS COMMENTS FIRST — prose about the old
 * behaviour would otherwise trip the guard against the old behaviour. */

import { describe, expect, it } from "vitest";

import { code, stripComments, walk } from "./_source";

const app = code("ui/App.tsx");
const preview = code("ui/PreviewPane.tsx");
const state = code("ui/DataState.tsx");

describe("a failure looks different from a wait", () => {
  it("the two states are distinct components, not one sentence", () => {
    expect(state).toMatch(/export function LoadingState/);
    expect(state).toMatch(/export function ErrorState/);
  });

  it("the shell renders the error state on isError, not the loading one", () => {
    expect(app).toMatch(/!summary && isError[\s\S]{0,200}<ErrorState/);
    expect(app).toMatch(/!summary && !isError[\s\S]{0,80}<LoadingState/);
  });

  it("the failure is announced to assistive tech", () => {
    expect(state).toContain('role="alert"');
  });
});

describe("the failure is retryable, and stays on screen", () => {
  it("the error state carries a button, not a toast", () => {
    expect(state).toMatch(/<button[\s\S]*?onClick=\{onRetry\}/);
    // a toast would need a timer to take itself away; there must be none
    expect(state).not.toMatch(/setTimeout|autoClose|duration/);
  });

  it("the first fetch retries by refetching the query it failed", () => {
    expect(app).toMatch(/refetch: refetchSummary/);
    expect(app).toMatch(/onRetry=\{\(\) => void refetchSummary\(\)\}/);
  });

  it("stage-2 detail has its own retry — not only the first fetch", () => {
    // the retry comes off the ChartSeries hook now (candle session): whichever
    // query the current chart type ran is the one the button re-runs
    expect(preview).toMatch(/refetch/);
    expect(preview).toMatch(/<ErrorState[\s\S]{0,120}onRetry=\{refetch\}/);
  });

  it("the overview's three charts retry the same way (candle session)", () => {
    // they used to hold their own useQuery; both surfaces share the hook, so a
    // retry cannot exist on one and be missing on the other
    const overview = code("ui/OverviewColumns.tsx");
    expect(overview).toMatch(/useChartSeries/);
    expect(overview).toMatch(/<ErrorState[\s\S]{0,160}onRetry=\{\(\) => void refetch\(\)\}/);
  });

  it("the button says it is working, so a slow retry is not a dead click", () => {
    expect(state).toMatch(/disabled=\{retrying\}/);
  });
});

describe("one failing region does not blank the app", () => {
  const boundaries = app.match(/<ErrorBoundary/g) ?? [];

  it("table, pane, popup and strip are bounded independently", () => {
    expect(boundaries.length).toBeGreaterThanOrEqual(4);
    for (const region of ["table", "pane", "popup", "strip"]) {
      expect(app).toContain(`region="${region}"`);
    }
  });

  it("the boundaries wrap the regions, not the whole tree", () => {
    // if one boundary wrapped everything, a table throw would still blank
    // the strip; each named region must sit inside its own
    expect(app).toMatch(/region="table"[\s\S]{0,200}<InstrumentTable/);
    expect(app).toMatch(/region="strip"[\s\S]{0,120}<BottomStrip/);
    // ONE popup since 2026-08-13: the floating backtest window. The enlarged
    // view was the second and retired with its entrance [OWNER] — its
    // boundary went with it rather than being left wrapping nothing.
    expect(app).toMatch(/region="popup"[\s\S]{0,600}<BacktestWindow/);
    expect(app).not.toMatch(/<EnlargedView/);
  });

  it("the strip's fallback is bar-sized, not a centred block", () => {
    expect(app).toMatch(/region="strip" compact/);
    expect(code("ui/ErrorBoundary.tsx")).toMatch(/compact[\s\S]{0,400}fixed/);
  });

  it("each boundary names its region in the console line", () => {
    // "detail view error" was a lie in three of the four
    expect(code("ui/ErrorBoundary.tsx")).toMatch(/region \?\? "render"/);
  });
});

describe("an unknown stale link is cleared and said", () => {
  /* The `?tile` namespace retired with the enlarged view [OWNER, 2026-08-13].
   * `bt` is the survivor and it kept the rule AND the lesson — the wording
   * below is the tile one, applied to the namespace that still exists. */

  it("the parameter is replaced, and the id survives into the notice", () => {
    // namespace-preserving: only the bt family is stripped
    expect(app).toMatch(/missing: btiParam \?\? btKey/);
    expect(app).toMatch(/missingTile &&/);
  });

  it("clearing waits for the COMPLETE row set, not merely for rows", () => {
    /* `rows.length === 0` was the old condition and it shipped a bug. The
     * summary lands first and contributes only outrights and spreads, so in
     * the window before the forwards and volatility payloads arrive, `rows` is
     * non-empty while every forward and vol id in it is still unknown — and a
     * cold link to one of those cleared itself. Pinned as the completeness
     * flag rather than the row count so the distinction cannot quietly
     * revert. */
    expect(app).toMatch(/if \(!btKey \|\| !rowsComplete \|\| btRow\) return;/);
    expect(app).not.toMatch(/rows\.length === 0/);
  });

  it("completeness means every row-contributing payload has settled", () => {
    // settled, not merely successful: a payload that fails is never arriving,
    // and waiting forever would be worse than answering with what came back
    expect(app).toMatch(
      /rowsComplete = !forwardsPending && !volatilityPending && !!summary/,
    );
  });

  it("the notice is derived from the URL, not held in state", () => {
    expect(app).toMatch(/const missingTile = params\.get\("missing"\)/);
    expect(app).not.toMatch(/setMissingTile/);
  });
});

describe("the API base is configurable", () => {
  /* Still the stability session's rule — the origin is an env var, never a
   * literal in a component — but the DEFAULT moved in the static conversion.
   * It is now the empty string, meaning "read the committed JSON tree at the
   * same origin"; setting NEXT_PUBLIC_API_BASE still points the app at a live
   * FastAPI backend for local development. URL construction moved with it,
   * into staticPaths.ts, because a static host cannot select a file by `?res=`
   * and the two URL shapes have to live somewhere. */
  const paths = code("lib/staticPaths.ts");

  it("reads the env var, defaulting to the static tree", () => {
    expect(paths).toMatch(/process\.env\.NEXT_PUBLIC_API_BASE \?\? ""/);
  });

  it("a configured base still produces live-backend URLs", () => {
    // the development path must not rot: if IS_STATIC ever became a constant
    // true, pointing at :8100 would silently keep reading files instead
    expect(paths).toMatch(/IS_STATIC = API_BASE === ""/);
    expect(paths).toMatch(/\$\{API_BASE\}\/api\//);
  });

  it("NO module outside a lib/ builds an API path by hand", () => {
    /* This listed three components and missed the one that mattered.
     * `DetailChart.tsx` had its own `fetch(`${API_BASE}/api/series/${id}?res=full`)`
     * for the line mode; the static conversion turned that into a 404 while the
     * candle modes kept working, because those already went through
     * `fetchCandles`. A partial list of files is not a guard — it is a guess.
     *
     * The crude substring check that replaced the list held until the
     * simulation arrived with a directory literally named `api/` (2026-08-07):
     * `from "../api/simulate-dto"` contains `/api/`, so a dozen modules that
     * merely import a DTO read as offenders. A guard that cries on fifteen
     * innocent files gets its expectation edited rather than its finding
     * fixed, so the check is narrowed by exactly one thing — MODULE
     * SPECIFIERS come out. Nothing else does: `walk(".", "code")` has already
     * stripped comments (that is what "code" means, see _source.ts), and
     * re-stripping them here is the hand-rolled duplication
     * guards/guard-hygiene.test.ts exists to stop. The bite assertions below
     * are what keep the narrowing honest. */
    const scannable = (text: string) =>
      text.replace(/^\s*import\s[\s\S]*?from\s*["'][^"']*["'];?$/gm, "");
    const hasApiPath = (text: string) =>
      text.includes("/api/") || text.includes("localhost:8100");
    const offenders = walk(".", "code")
      /* Transport layers, at ANY depth. `lib/` is this app's; the simulation
       * brought `sim/lib/api-client.ts` (market data, credit curve, book) and
       * `sim/api/simulation-api.ts` (the one POST). Both are the role the rule
       * already blesses at the top level — a module whose JOB is URL
       * construction, so the base stays configurable in one place.
       *
       * Tests are excluded because a test that ASSERTS a URL is not a module
       * that builds one, and nothing in a test ships. */
      .filter(([p]) => !/(^|\/)(lib|api)\//.test(p))
      .filter(([p]) => !/\.test\.tsx?$/.test(p))
      .filter(([, text]) => hasApiPath(scannable(text)))
      .map(([p]) => p);
    expect(offenders).toEqual([]);

    // and the check bites: the exact line that shipped the bug must trip it
    expect(
      hasApiPath(
        scannable('fetch(`${API_BASE}/api/series/${encodeURIComponent(id)}?res=full`)'),
      ),
    ).toBe(true);
    // ...and stripping must not have opened a hole big enough to drive the
    // second base origin through. `sim/api/simulation-api.ts` carried its own
    // NEXT_PUBLIC_SIMULATION_API_BASE_URL until the merge; a fetch is a fetch
    // whatever file it sits in.
    expect(hasApiPath(scannable('res = await fetch(`${SIM_BASE}/api/simulate`, {'))).toBe(true);
    // but a module specifier is not a call
    expect(hasApiPath(scannable('import type { X } from "@/sim/api/simulate-dto";'))).toBe(
      false,
    );
    expect(hasApiPath(scannable('import { simulationApi } from "../api/simulation-api";'))).toBe(
      false,
    );
  });

  it("there is exactly ONE base origin, and only lib/staticPaths decides it", () => {
    /* The rule above lost some bite when `api/` joined `lib/` as an allowed
     * transport layer, so the thing that actually went wrong is pinned here
     * directly rather than inferred from a path substring.
     *
     * What went wrong: `sim/api/simulation-api.ts` shipped a SECOND base —
     * `NEXT_PUBLIC_SIMULATION_API_BASE_URL ?? API_BASE` — from when the
     * simulation was its own service on :8200. Its own docblock recorded the
     * question ("single-backend vs two-backend ... confirm before S6") and it
     * was never answered, so setting this repo's documented env var moved the
     * monitor's calls and left the simulation's pointed somewhere else. One
     * backend was the answer [OWNER, 2026-08-07].
     *
     * A base is read from the environment. So: exactly one module may read an
     * API-base env var, and it is the one this suite already pins above. */
    const readers = walk(".", "code")
      .filter(([, text]) => /process\.env\.NEXT_PUBLIC_[A-Z_]*API_BASE/.test(text))
      .map(([p]) => p);
    expect(readers).toEqual(["lib/staticPaths.ts"]);

    // and no module hardcodes a backend origin instead of deriving one
    const hardcoded = walk(".", "code")
      .filter(([, text]) => /https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(text))
      .map(([p]) => p);
    expect(hardcoded).toEqual([]);
  });

  it("lib/api.ts itself goes through the URL builders", () => {
    // an inlined `${API_BASE}/api/…` would work against a live backend and
    // 404 against the static tree — a failure that only appears in production,
    // the one place it is expensive to find.
    const api = code("lib/api.ts");
    expect(api).not.toMatch(/fetch\(`\$\{API_BASE\}/);
    expect(api).not.toMatch(/fetch\("\/api\//);
  });
});

describe("the guard does not trip on prose about the thing it bans", () => {
  it("a comment naming a banned token is stripped before matching", () => {
    const sample = `
      /* historically this used setTimeout to dismiss the toast */
      const x = 1; // and a stray localhost:8100 in a trailing note
    `;
    const stripped = stripComments(sample);
    expect(stripped).not.toContain("setTimeout");
    expect(stripped).not.toContain("localhost:8100");
    expect(stripped).toContain("const x = 1");
  });
});
