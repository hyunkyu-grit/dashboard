/* Guard: a label must name the quantity under it, and a colour must mean one
 * thing. The two label items closed in the stability session, Pass F.
 *
 * 1. The 주요 포워드 block must not grow per-basis columns again. It once showed
 *    the LEVEL at each basis under Now/D-1/WTD/MTD/QTD/YTD headers — the very
 *    headers the main table uses for the CHANGE. Two quantities, one header
 *    set. It was fixed by REMOVAL (§E1): the block shows 현재 + a 52-week gauge,
 *    and the table keeps the change story. Adding those columns back is the
 *    regression this pins.
 *
 * 2. `--bw-line` must stay its own token. It currently holds the same value as
 *    `--bw-down`, which makes it tempting to dedupe into an alias — and that
 *    would weld the two meanings together permanently. Keeping the name
 *    separate is what makes "move strokes to ink" a one-token edit if the
 *    double duty is ever judged to have gone wrong (Pass F re-checked it and it
 *    has not).
 *
 * `code()`, not `identifiers()`: what is banned here is a set of VISIBLE
 * LABELS, and a label lives in a string literal — a string occurrence IS the
 * violation. Comments are still stripped, so the paragraph above (which names
 * every banned label) cannot trip its own guard.
 */

import { describe, expect, it } from "vitest";

import { code, css } from "./_source";

// the main table's change-column headers, verbatim as rendered
const BASIS_HEADERS = ["어제", "WTD", "MTD", "QTD", "YTD", "D-1"];

describe("the key-forward block states one quantity", () => {
  const block = code("wall/ForwardMatrix.tsx");

  it("renders no basis-keyed header", () => {
    const found = BASIS_HEADERS.filter((h) => block.includes(`>${h}<`));
    expect(found).toEqual([]);
  });

  it("does not read a per-basis value or delta out of a key forward", () => {
    // kf.values.now is the quoted level and is fine; kf.values.wtd etc. are not,
    // and neither is a deltas lookup — either one implies a per-basis column.
    expect(block).not.toMatch(/kf\.values\.(?!now)/);
    expect(block).not.toMatch(/kf\.deltas/);
  });

  it("still shows the level and its 52-week position", () => {
    // the positive half of the rule: removal must not have hollowed the block
    expect(block).toMatch(/현재/);
    expect(block).toMatch(/백분위/);
    expect(block).toMatch(/kf\.values\.now/);
  });
});

describe("the chart stroke keeps its own colour token", () => {
  const tokens = css("theme/tokens.css");

  it("defines --bw-line separately from --bw-down", () => {
    expect(tokens).toMatch(/--bw-line:/);
    expect(tokens).toMatch(/--bw-down:/);
  });

  it("does not alias the stroke to the direction token", () => {
    // `--bw-line: var(--bw-down)` would make the two meanings one edit apart
    // from being inseparable. Same VALUE is fine and is the current state.
    expect(tokens).not.toMatch(/--bw-line:\s*var\(\s*--bw-(down|up)\s*\)/);
    expect(tokens).not.toMatch(/--bw-down:\s*var\(\s*--bw-line\s*\)/);
  });

  it("both themes define the stroke, so neither inherits the other's", () => {
    const decls = tokens.match(/--bw-line:/g) ?? [];
    expect(decls.length).toBeGreaterThanOrEqual(2); // light + dark
  });
});
