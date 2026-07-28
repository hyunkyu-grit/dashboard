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

import { code, stripComments } from "./_source";

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

  it("clearing waits for rows — a cold shared link must still open", () => {
    expect(app).toMatch(/if \(!tileParam \|\| rows\.length === 0 \|\| enlargedRow\) return;/);
  });

  it("the notice is derived from the URL, not held in state", () => {
    expect(app).toMatch(/const missingTile = params\.get\("missing"\)/);
    expect(app).not.toMatch(/setMissingTile/);
  });
});

describe("the API base is configurable", () => {
  const api = code("lib/api.ts");

  it("reads an env var and defaults to the current value", () => {
    expect(api).toMatch(
      /process\.env\.NEXT_PUBLIC_API_BASE \?\? "http:\/\/localhost:8100"/,
    );
  });

  it("no other module hardcodes the port", () => {
    for (const f of ["ui/App.tsx", "ui/PreviewPane.tsx", "ui/EnlargedView.tsx"]) {
      expect(code(f)).not.toContain("localhost:8100");
    }
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
