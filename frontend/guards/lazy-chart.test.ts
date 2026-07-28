/* Guard: lightweight-charts must not sit on the first-load path.
 *
 * §11 already confines the library to the popup, and it was obeyed — yet the
 * measurement (Pass E, docs/diagnostics/perf-baseline.md) found all 196 KB of
 * it in the initial chunk anyway. "Used only in the popup" and "loaded only
 * with the popup" are different claims: DetailChart was reached by a plain
 * import from EnlargedView, which App imports at module scope, so the whole
 * library rode in on the first byte of the app.
 *
 * So the rule pinned here is about the IMPORT EDGE, not about usage: exactly
 * one module may import the library, and every path reaching that module goes
 * through a dynamic import.
 *
 * Reader choice matters here and is worth stating, because getting it wrong
 * fails confusingly (it did, while this was being written). A module specifier
 * IS a string literal, so `identifiers()` — which blanks string CONTENTS —
 * erases the very thing this guard matches on. `code()` is the right strength:
 * comments gone so the paragraph you are reading cannot trip the guard it
 * explains, string literals intact so import paths survive. That is exactly
 * the split _source.ts documents.
 */

import { describe, expect, it } from "vitest";

import { code, stripComments, walk } from "./_source";

const LIB = "lightweight-charts";
const OWNER = "wall/DetailChart.tsx";

/** Does this text import `spec` for its VALUE (not merely its types)? */
function valueImports(text: string, spec: string): boolean {
  const re = new RegExp(
    String.raw`import\s+(?!type\b)[^;]*?from\s*["']${spec.replace(/\//g, "\\/")}["']`,
    "s",
  );
  return re.test(text);
}

describe("lightweight-charts stays off the first-load path", () => {
  const files = walk(".", "code");

  it("is imported by exactly one module", () => {
    const owners = files
      .filter(([, text]) => valueImports(text, LIB))
      .map(([path]) => path);
    expect(owners).toEqual([OWNER]);
  });

  it("no module statically imports the chart component", () => {
    const offenders = files
      .filter(([path]) => path !== OWNER)
      .filter(([, text]) => valueImports(text, "@/wall/DetailChart"))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("the popup reaches the chart through a dynamic import", () => {
    const text = code("ui/EnlargedView.tsx");
    expect(text).toMatch(/dynamic\(/);
    expect(text).toMatch(/import\(\s*["']@\/wall\/DetailChart["']\s*\)/);
    // ssr:false — the library needs a real canvas, which the server has not
    expect(text).toMatch(/ssr:\s*false/);
  });

  it("a type-only import is still allowed", () => {
    // erased at compile time, so it does not pull the module into the chunk;
    // banning it would push callers to re-declare the union by hand.
    const text = code("ui/EnlargedView.tsx");
    expect(text).toMatch(/import\s+type\s*\{[^}]*ChartType[^}]*\}\s*from/);
    expect(valueImports(text, "@/wall/DetailChart")).toBe(false);
  });

  it("the loading boundary shows the shared waiting state, not nothing", () => {
    // an empty `loading` leaves a blank rectangle where the chart will be —
    // the exact failure Pass B was about.
    const text = code("ui/EnlargedView.tsx");
    expect(text).toMatch(/loading:/);
    expect(text).toMatch(/LoadingState/);
  });
});

describe("the guard reads code, not prose", () => {
  const commented = [
    "/* The chart library was moved behind a dynamic import; the old line,",
    `   import { createChart } from "${LIB}"; is kept here for the record. */`,
    "export const x = 1;",
  ].join("\n");

  it("a comment quoting the banned import does not trip it", () => {
    expect(valueImports(commented, LIB)).toBe(true); // raw text: false positive
    expect(valueImports(stripComments(commented), LIB)).toBe(false); // stripped
  });

  it("but a real import is still caught", () => {
    const real = `import { createChart } from "${LIB}";`;
    expect(valueImports(stripComments(real), LIB)).toBe(true);
  });
});
