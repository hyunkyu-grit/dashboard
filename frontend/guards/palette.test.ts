/* Guard: the palette is RED / BLUE / GREY / ORANGE (§9) plus the two SANCTIONED
 * reference tokens [OWNER, 2026-08-04, revised same day]: grey (`ref-cd`) and
 * translucent red (`ref-policy`), solid lines, used ONLY for the CD / 기준금리
 * references and their legend. Red = up, blue = down; everything else is
 * ink/grey, and the orange is the accent.
 *
 * THE ACCENT IS BACK [OWNER, 2026-08-07 — 오너가 목업으로 간다고 확정].
 * This guard used to enforce the opposite: "액센트는 은퇴했다 — 빨강 하나,
 * 파랑 하나" (the palette cut). The mockups win, and the mockup's orange is the
 * kit's own System Colors / 2 Orange, so re-adding it is not a reintroduction
 * of the old brand orange — that one (#f58220) stays retired and stays banned
 * below. There is one orange in this product and it comes from the kit.
 *
 * What replaces the ban is the FILL / FOREGROUND SPLIT, which is the part that
 * is easy to get wrong and expensive to notice:
 *
 *   --bw-accent      #FF8D28  a FILL. 2.31:1 on white — fails even the 3:1
 *                             graphical floor, so it may never carry a glyph
 *                             or a thin mark.
 *   --bw-accent-fg   #b85e00  the same hue darkened for INK. 4.53:1 on the
 *                             tile. Chart strokes, sidebar glyphs, sort arrows.
 *   --bw-on-accent   ink 85%  the only thing that may sit ON the fill (7.61:1;
 *                             white would be 2.31:1).
 *
 * sauron.html holds this split exactly — chart stroke, sort arrow and status
 * dot are all `--accent-fg`, while the six chrome fills (focus ring, sidebar
 * selection, pressed chip, selected row, menu hover, prominent button) are
 * `--accent`. defense.html is looser and strokes its sparkline in the fill;
 * where the two mockups disagree the monitor is the one being built, so the
 * monitor's reading is the rule.
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
import { GRAPHIC_FLOOR, TEXT_FLOOR, TIERS, ratio, resolve, tier } from "./_tokens";

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

/** Comments stripped, strings kept (Pass D): a note naming a banned token is
 * not a use of it, but a class name inside a string is. */
function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    if (EXCLUDE_DIRS.some((d) => rel.startsWith(d + sep)) || EXCLUDE_FILES.includes(rel)) {
      continue;
    }
    stripComments(readFileSync(file, "utf8"))
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  return hits;
}

// retired hues as Tailwind utilities and as CSS vars. Direction (up/down), the
// chart line and the accent are NOT matched — they are the live palette.
// `interactive` is the OLD orange (#f58220): the accent's return does not
// revive it, because two oranges is exactly the fork this guard exists to stop.
const UTIL =
  /\b(?:bg|text|border|fill|stroke|outline|ring|from|via|to|decoration|divide|accent|caret)-(?:interactive|brand|on-interactive|hue-(?:curve|vol|fwd|outright|spread))\b/;
const VAR =
  /var\(\s*--(?:bw|color)-(?:interactive|brand|on-interactive|hue-[a-z]+)\s*\)/;

describe("palette: components carry only the live hues (§9)", () => {
  it("no component references a retired hue token", () => {
    const hits = offenders(new RegExp(`${UTIL.source}|${VAR.source}`));
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

describe("accent: the FILL never carries ink (§9, 2026-08-07)", () => {
  /* Utilities that paint a glyph or a thin mark. `bg-`, `ring-`, `border-` and
   * `outline-` are absent on purpose: those are the chrome fills and the focus
   * ring, which the mockup draws in the fill orange. */
  const INK_UTIL = /\b(?:text|fill|stroke|decoration|caret|divide)-accent\b(?!-fg)/;
  const INK_VAR = /(?:color|fill|stroke)\s*:\s*var\(\s*--(?:bw|color)-accent\s*\)/;

  it("no component strokes or letters in the fill orange", () => {
    const hits = offenders(new RegExp(`${INK_UTIL.source}|${INK_VAR.source}`));
    expect(hits, `${hits.join("\n")}\n→ use accent-fg: the fill is 2.31:1 on white`).toEqual([]);
  });

  /* The split must stay a split. In DARK the two are deliberately the same
   * value — the kit's dark orange is already 6.17–7.47:1 on the dark surfaces,
   * so there is nothing to darken — but in LIGHT they must differ, and this is
   * what fails if someone "tidies" the two tokens into one. */
  it("light keeps the fill and the foreground apart", () => {
    expect(resolve(tier("light"), "--bw-accent-fg")).not.toBe(
      resolve(tier("light"), "--bw-accent"),
    );
  });

  for (const [name, scope] of TIERS) {
    // 7.61 light / 7.84 dark [측정 2026-08-07]. White on this fill is 2.31:1,
    // which is why on-accent is ink and not the page.
    it(`${name}: the label on an accent fill is legible`, () => {
      expect(ratio(scope, "--bw-on-accent", "--bw-accent")).toBeGreaterThanOrEqual(TEXT_FLOOR);
    });

    // accent-fg carries sidebar glyphs, sort arrows and the chart stroke —
    // marks, so the 3:1 floor. It clears the TEXT floor on the light tile too
    // (4.53), but not on the light page (4.26), so it is a mark token.
    it(`${name}: accent-fg clears the mark floor on both surfaces`, () => {
      expect(ratio(scope, "--bw-accent-fg", "--bw-tile")).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
      expect(ratio(scope, "--bw-accent-fg", "--bw-page")).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
    });
  }
});

// ── the selection blue [OWNER, 2026-08-06 — "같은 파랑해도 돼"] ──
//
// The kit paints a selected segment, a highlighted menu row and a focus ring in
// its accent. The palette cut used to force those to ink, on the ground that a
// blue state sits beside blue change numbers; the owner ruled that acceptable.
// What is NOT negotiable is that there stays exactly ONE blue and that a label
// on it can be read: the kit's own accent (#0088ff / #0091ff) carries a white
// 13px label at 3.52:1, which is why the generator rewrites it to --bw-down.
//
// SCHEDULED TO FLIP [OWNER, 2026-08-07]. In the mockup these three states are
// the accent orange, not a blue — selection, menu hover and the focus ring all
// take `--accent`. This block still describes kit.generated.css, which is being
// retired onto the vendored kit.css; when its nine call sites move, this
// section moves with them and the "one blue" rule goes back to meaning the
// direction blue only.

const kit = cssOf("theme/kit.generated.css");

describe("selection blue: one blue, and legible on both themes", () => {
  it("the generated kit CSS carries no second blue", () => {
    // any raw hex that is more blue than it is red/green — the kit accent and
    // the menu highlight both match, ink and the greys do not
    const hits = [...kit.matchAll(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})\b/gi)]
      .filter((m) => {
        const [r, g, b] = m.slice(1, 4).map((h) => parseInt(h, 16));
        return b - Math.max(r, g) > 24;
      })
      .map((m) => m[0]);
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("the selected fill IS the direction blue, in both themes", () => {
    // two blocks, one rule each: light (line-initial) and dark (theme-scoped)
    expect(kit.match(/^\.kit-seg-on \{[^}]*background: var\(--bw-down\)/m)).not.toBeNull();
    expect(
      kit.match(/^\[data-theme="dark"\] \.kit-seg-on \{[^}]*background: var\(--bw-down\)/m),
    ).not.toBeNull();
  });

  for (const [name, scope] of TIERS) {
    it(`${name}: page label on the blue fill`, () => {
      expect(ratio(scope, "--bw-page", "--bw-down")).toBeGreaterThanOrEqual(TEXT_FLOOR);
    });
    it(`${name}: the focus ring clears the 3:1 non-text floor on its own page`, () => {
      // an outline is a mark, not text — 3:1 against what it sits on
      expect(ratio(scope, "--bw-page", "--bw-down")).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
    });
  }
});

describe("ink pill / fill (bg-ink + text-page) is legible in both themes", () => {
  // an ink pill inverts with the theme, so its light-page label sits on the ink
  // fill on both surfaces — must clear the 4.5:1 text floor either way.
  for (const [name, scope] of TIERS) {
    it(`${name}: page label on ink fill`, () => {
      expect(ratio(scope, "--bw-page", "--bw-ink")).toBeGreaterThanOrEqual(TEXT_FLOOR);
    });
  }
});
