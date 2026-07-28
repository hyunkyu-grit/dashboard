/* Guard: the guards themselves (stability session, Pass D).
 *
 * The recurring defect this exists to stop, in full:
 *
 *   1. a guard bans a token
 *   2. the thing is removed, and someone writes a comment saying why
 *   3. the comment contains the token
 *   4. the guard fails on the explanation of its own success
 *
 * Four occurrences on record — pane-still, carry-copy, calendar,
 * bottom-strip — and each was fixed in place with a hand-rolled regex pair,
 * so the next guard started the cycle over. `guards/_source.ts` is the single
 * reader; these tests make sure it works and that guards actually use it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { code, identifiers, stripAll, stripComments, walk } from "./_source";

describe("a comment mentioning a banned token does not trip its guard", () => {
  it("block comments are removed", () => {
    const src = `
      /* carry & roll was removed; do not reintroduce CarryPanel */
      export const x = 1;
    `;
    expect(stripComments(src)).not.toContain("CarryPanel");
    expect(stripComments(src)).toContain("export const x = 1");
  });

  it("line comments are removed, INCLUDING trailing ones", () => {
    // the old hand-rolled regex only matched whole-line comments, so a
    // trailing `// ...CarryPanel` survived every one of them
    const src = `export const x = 1; // was CarryPanel, now nothing\n`;
    expect(stripComments(src)).not.toContain("CarryPanel");
    expect(stripComments(src)).toContain("export const x = 1;");
  });

  it("a URL is not mistaken for a comment", () => {
    // `//` inside a string is why this is a scanner and not a regex
    const src = `const API = "http://localhost:8100/api";\nconst y = 2;`;
    expect(stripComments(src)).toContain("http://localhost:8100/api");
    expect(stripComments(src)).toContain("const y = 2");
  });

  it("a quote inside a comment does not swallow the code after it", () => {
    const src = `/* the reader's view */\nconst kept = 1;`;
    expect(stripComments(src)).toContain("const kept = 1");
  });

  it("line numbers survive both strippers", () => {
    const src = `a\n/* two\nline */\nb\n`;
    expect(stripComments(src).split("\n")).toHaveLength(src.split("\n").length);
    expect(stripAll(src).split("\n")).toHaveLength(src.split("\n").length);
  });
});

describe("string literals: dropped for identifiers, kept for values", () => {
  const src = `const label = "useState is banned here"; useEffect(() => {});`;

  it("`identifiers` drops string CONTENTS — a mention is not a use", () => {
    expect(stripAll(src)).not.toContain("useState");
    expect(stripAll(src)).toContain("useEffect");
  });

  it("`code` keeps them — a raw hex in a string IS the violation", () => {
    expect(stripComments(`const c = "#f58220";`)).toContain("#f58220");
  });

  it("template literals are handled too", () => {
    expect(stripAll("const t = `useState`;")).not.toContain("useState");
  });

  it("an escaped quote does not end the literal early", () => {
    const s = `const a = "he said \\"useState\\" once"; const b = 1;`;
    expect(stripAll(s)).not.toContain("useState");
    expect(stripAll(s)).toContain("const b = 1");
  });
});

describe("stripping does not eat the code it is meant to leave behind", () => {
  // The danger of an over-eager stripper is silent: a guard stops seeing
  // violations and passes forever. Check against real files.
  const files = ["ui/App.tsx", "ui/InstrumentTable.tsx", "ui/rows.ts"];

  it.each(files)("%s keeps its declarations", (f) => {
    const stripped = code(f);
    expect(stripped).toMatch(/export (function|const|type|interface)/);
    // the file is not gutted: comments are a minority of any of these
    expect(stripped.trim().length).toBeGreaterThan(raw(f).length * 0.3);
  });

  it.each(files)("%s keeps its line count", (f) => {
    expect(code(f).split("\n")).toHaveLength(raw(f).split("\n").length);
    expect(identifiers(f).split("\n")).toHaveLength(raw(f).split("\n").length);
  });

  function raw(f: string) {
    return readFileSync(join(__dirname, "..", "src", f), "utf8");
  }
});

describe("every guard reads source through the shared reader", () => {
  const dir = __dirname;
  const guards = readdirSync(dir).filter((f) => f.endsWith(".test.ts"));

  it("there are guards to check", () => {
    expect(guards.length).toBeGreaterThan(10);
  });

  it.each(guards)("%s does not hand-roll a stripper", (f) => {
    const text = readFileSync(join(dir, f), "utf8");
    // this file demonstrates the old regexes on purpose
    if (f === "guard-hygiene.test.ts") return;
    expect(text).not.toMatch(/replace\(\/\\\/\\\*\[\\s\\S\]\*\?\\\*\\\/\/g/);
    expect(text).not.toMatch(/replace\(\/\^\\s\*\\\/\\\/\.\*\$\/gm/);
  });

  it.each(guards)("%s reads app source only through _source", (f) => {
    const text = readFileSync(join(dir, f), "utf8");
    if (f === "guard-hygiene.test.ts") return;
    // A guard may still reach for readFileSync — calendar.test.ts walks the
    // tree itself to find importers. What it must not do is scan that text
    // unstripped, so any guard that reads files at all must ALSO be pulling
    // the stripper from here.
    if (!text.includes("readFileSync")) return;
    expect(
      text.includes('from "./_source"'),
      `${f} reads files without importing the shared stripper from ./_source`,
    ).toBe(true);
  });
});

describe("the reader covers the whole tree", () => {
  it("walk finds the components", () => {
    const files = walk("ui").map(([p]) => p);
    expect(files).toContain("App.tsx");
    expect(files.length).toBeGreaterThan(10);
  });
});
