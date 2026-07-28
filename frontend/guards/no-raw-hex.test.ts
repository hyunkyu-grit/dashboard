/* Guard: zero raw hex in component code — design spec §9.
 * Every color must flow through the semantic custom properties in
 * src/theme/tokens.css (the single allowlisted file).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./_source";

const SRC = join(__dirname, "..", "src");
const ALLOWLIST = new Set([["theme", "tokens.css"].join(sep)]);
const HEX = /#[0-9a-fA-F]{3,8}\b/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(entry.name)) yield p;
  }
}

describe("no raw hex outside the token layer", () => {
  it("finds no hex literals in src/", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWLIST.has(rel)) continue;
      // Comments stripped first (Pass D): naming a hex while explaining why
      // it is banned is not a use of it. STRINGS are kept — a hex in a
      // string literal is exactly the violation this guard is looking for.
      // The stripper preserves line positions, so the numbers below are real.
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (HEX.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
