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
    expect(preview).toMatch(/refetch/);
    expect(preview).toMatch(/<ErrorState[\s\S]{0,120}onRetry=\{onRetry\}/);
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
    expect(app).toMatch(/region="popup"[\s\S]{0,200}<EnlargedView/);
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

describe("an unknown ?tile= is cleared and said", () => {
  it("the parameter is replaced, and the id survives into the notice", () => {
    expect(app).toMatch(/router\.replace\(`\/\?missing=\$\{encodeURIComponent\(tileParam\)\}`/);
    expect(app).toMatch(/missingTile &&/);
  });

  it("clearing waits for the COMPLETE row set, not merely for rows", () => {
    /* `rows.length === 0` was the old condition and it shipped a bug. The
     * summary lands first and contributes only outrights and spreads, so in
     * the window before the forwards and volatility payloads arrive, `rows` is
     * non-empty while every forward and vol id in it is still unknown — and a
     * cold `?tile=series:vol:10Y` cleared itself every time. Pinned as the
     * completeness flag rather than the row count so the distinction cannot
     * quietly revert. */
    expect(app).toMatch(/if \(!tileParam \|\| !rowsComplete \|\| enlargedRow\) return;/);
    expect(app).not.toMatch(/rows\.length === 0 \|\| enlargedRow/);
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

  it("NO module outside lib/ builds an API path by hand", () => {
    /* This listed three components and missed the one that mattered.
     * `DetailChart.tsx` had its own `fetch(`${API_BASE}/api/series/${id}?res=full`)`
     * for the line mode; the static conversion turned that into a 404 while the
     * candle modes kept working, because those already went through
     * `fetchCandles`. A partial list of files is not a guard — it is a guess. */
    const hasApiPath = (text: string) =>
      text.includes("/api/") || text.includes("localhost:8100");
    const offenders = walk(".", "code")
      .filter(([p]) => !p.startsWith("lib/"))
      .filter(([, text]) => hasApiPath(text))
      .map(([p]) => p);
    expect(offenders).toEqual([]);

    // and the check bites: the exact line that shipped the bug must trip it
    expect(
      hasApiPath('fetch(`${API_BASE}/api/series/${encodeURIComponent(id)}?res=full`)'),
    ).toBe(true);
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
