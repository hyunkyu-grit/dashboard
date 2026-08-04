/* Guard: the palette is RED / BLUE / GREY (§9, palette cut) plus the two
 * SANCTIONED reference hues [OWNER, 2026-08-04]: muted teal (`ref-cd`) and
 * muted amber (`ref-policy`), used ONLY for the CD / 기준금리 reference lines
 * — their dash patterns stay the grayscale encoding (§5). Red = up, blue =
 * down, blue = the (signless) chart stroke; everything else is ink/grey.
 * Orange and navy were each reintroduced twice, so a written rule is not
 * enough — this fails any COMPONENT that references a RETIRED hue token
 * (interactive / brand / on-interactive / the hue-* sub-palette), whether as a
 * Tailwind utility (`bg-interactive`) or a CSS var (`var(--bw-brand)`).
 *
 * Scope: component source only. The token module defines the retired values
 * (unreferenced) and the Tailwind bridge names them in comments — both are the
 * palette's definition layer, so `src/theme/**` and `src/app/globals.css` are
 * excluded, along with tests. Raw hex in components is already banned by
 * no-raw-hex.test.ts; this guards the token references. */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { css as cssOf, stripComments } from "./_source";

const SRC = join(__dirname, "..", "src");

// the palette's definition layer — allowed to name the retired tokens
const EXCLUDE_DIRS = ["theme"]; // src/theme/** : tokens.css, bridge.ts, ramp.ts
const EXCLUDE_FILES = [join("app", "globals.css")];

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name)) yield p;
  }
}

// retired hues as Tailwind utilities and as CSS vars. Direction (up/down) and
// the chart line are NOT matched — they are the sanctioned red/blue.
const UTIL =
  /\b(?:bg|text|border|fill|stroke|outline|ring|from|via|to|decoration|divide|accent|caret)-(?:interactive|brand|on-interactive|hue-(?:curve|vol|fwd|outright|spread))\b/;
const VAR =
  /var\(\s*--(?:bw|color)-(?:interactive|brand|on-interactive|hue-[a-z]+)\s*\)/;

describe("palette: components carry only red/blue/grey (§9)", () => {
  it("no component references a retired hue token", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (
        EXCLUDE_DIRS.some((d) => rel.startsWith(d + sep)) ||
        EXCLUDE_FILES.includes(rel)
      ) {
        continue;
      }
      // comments stripped, strings kept (Pass D): a note naming a retired
      // token is not a use of it, but a class name in a string is
      stripComments(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (UTIL.test(line) || VAR.test(line)) {
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

// ── the ink fill/pill must stay legible (spec: verify against the contrast
// guard in both themes — a dark pill in dark mode is the obvious failure) ──

const css = cssOf("theme/tokens.css");
const DARK_AT = css.indexOf('[data-theme="dark"]');
const lightBlock = css.slice(0, DARK_AT);
const darkBlock = css.slice(DARK_AT);

function hex(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`missing ${name}`);
  return m[1];
}
function chan(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function relLum(h: string): number {
  return (
    0.2126 * chan(parseInt(h.slice(1, 3), 16)) +
    0.7152 * chan(parseInt(h.slice(3, 5), 16)) +
    0.0722 * chan(parseInt(h.slice(5, 7), 16))
  );
}
function contrast(a: string, b: string): number {
  const la = relLum(a);
  const lb = relLum(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("ink pill / fill (bg-ink + text-page) is legible in both themes", () => {
  // an ink pill inverts with the theme, so its light-page label sits on the ink
  // fill on both surfaces — must clear the 4.5:1 text floor either way.
  it("light: page label on ink fill", () => {
    expect(
      contrast(hex(lightBlock, "--bw-page"), hex(lightBlock, "--bw-ink")),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it("dark: page label on ink fill", () => {
    expect(
      contrast(hex(darkBlock, "--bw-page"), hex(darkBlock, "--bw-ink")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
