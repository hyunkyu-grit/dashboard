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
 * 2026-08-13: `ui/EnlargedView` is UNREFERENCED (the 크게 보기 entrance was
 * removed [OWNER]), so `wall/DetailChart` and the library with it are off the
 * bundle entirely rather than merely off the first chunk. The edge rule is
 * asserted unchanged: the file stays on disk under the restoration rule, and
 * re-wiring it must not be the day the 196 KB walks back onto first load.
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

/* The simulation brought a second and third importer with it (2026-08-07).
 * The RULE did not change — the library must not sit on the first-load path —
 * but there are now two ways it is kept off, and both are pinned below:
 *
 *   wall/DetailChart.tsx   reached only via dynamic() from ui/EnlargedView
 *   sim/ui/LineChart.tsx   \ reached only via dynamic() from ui/InstrumentTable,
 *   sim/ui/TermStructureChart.tsx  which loads the whole 시뮬레이션 tab lazily
 *
 * Listing the simulation's two charts individually would have been the
 * "partial list of files" this suite already rejects once. What is pinned
 * instead is the ENTRANCE: every importer must live under a subtree whose one
 * doorway is a dynamic import, and that doorway is asserted to exist. */
const SIM_SUBTREE = "sim/";
const SIM_DOORWAY = "ui/InstrumentTable.tsx";

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

  it("is imported only by the popup chart and inside the simulation subtree", () => {
    const owners = files
      .filter(([, text]) => valueImports(text, LIB))
      .map(([path]) => path);
    const strays = owners.filter((p) => p !== OWNER && !p.startsWith(SIM_SUBTREE));
    expect(strays).toEqual([]);
    // and the popup chart is still an importer — if it stopped being one, the
    // filter above would pass vacuously with the library anywhere it liked
    expect(owners).toContain(OWNER);
  });

  it("the simulation subtree is entered ONLY through a dynamic import", () => {
    /* This is what earns sim/ its blanket allowance above. If any module
     * outside the subtree imports into it for a value, the subtree is on the
     * first-load path and so is the library, whatever the doorway does. */
    const doorway = code(SIM_DOORWAY);
    expect(doorway).toMatch(/dynamic\(/);
    expect(doorway).toMatch(/import\(\s*["']@\/sim\/ui\/SimulationFlow["']\s*\)/);
    expect(doorway).toMatch(/ssr:\s*false/);
    // a blank rectangle where the tab will be is the failure Pass B was about
    expect(doorway).toMatch(/loading:/);
    expect(doorway).toMatch(/LoadingState/);

    const intruders = files
      .filter(([path]) => !path.startsWith(SIM_SUBTREE))
      .filter(([, text]) => /import\s+(?!type\b)[^;]*?from\s*["']@\/sim\//s.test(text))
      .map(([path]) => path);
    expect(intruders).toEqual([]);
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

  it("ChartType comes from the library-free module, not from the chart", () => {
    /* It used to be declared in `wall/DetailChart` and type-imported from
     * there — safe, because a type import is erased, but backwards: the
     * toolbar control and the ui STORE need this union too, and neither has
     * any business naming the popup's chart file. It lives in `ui/chartType`
     * since the candle session (2026-08-13): that module has no values at all
     * beyond its labels, so anything may import it any way it likes.
     *
     * The rule this protects is unchanged and is the next assertion: nothing
     * but the popup may VALUE-import DetailChart. */
    const text = code("ui/EnlargedView.tsx");
    expect(text).toMatch(/import\s*\{[^}]*type ChartType[^}]*\}\s*from\s*["']\.\/chartType["']/);
    expect(valueImports(text, "@/wall/DetailChart")).toBe(false);
    // and the chart itself now consumes the shared definition rather than
    // exporting its own — two unions named ChartType would drift
    const chart = code("wall/DetailChart.tsx");
    expect(chart).toMatch(/import type \{ ChartType \} from "@\/ui\/chartType"/);
    expect(chart, "DetailChart re-declares ChartType").not.toMatch(
      /export type ChartType/,
    );
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
