/* Guard (§G): every `position: sticky` element must resolve to a
 * non-transparent background token, or rows bleed through it while scrolling.
 * Two ways that breaks, both checked here mechanically (this is the defect that
 * reappears the moment someone adds a pinned row):
 *   1. a sticky element with no bg token at all;
 *   2. an `opacity-*` utility ON the sticky element (or on a <tr> wrapping
 *      sticky cells) — element opacity sinks the opaque bg to translucent.
 * A muted look must come from a text-colour alpha (text-ink/50), never element
 * opacity. Source-scan (jsdom has no layout), the project's guard style. */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["ui", "wall"];
const BG = /bg-(tile|page|popover)/;
const OPACITY = /\bopacity-\d/;

function sources(): [string, string][] {
  const out: [string, string][] = [];
  for (const r of ROOTS) {
    const dir = join(__dirname, "..", "src", r);
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".tsx")) out.push([`${r}/${f}`, readFileSync(join(dir, f), "utf8")]);
    }
  }
  return out;
}

function classNames(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/className="([^"]*)"/g)) out.push(m[1]);
  for (const m of src.matchAll(/className=\{`([^`]*)`\}/g)) out.push(m[1]);
  return out;
}

const all = sources();

describe("every sticky element is opaque (§G)", () => {
  for (const [name, src] of all) {
    const sticky = classNames(src).filter((c) => /\bsticky\b/.test(c));
    if (sticky.length === 0) continue;
    it(`${name}: sticky classes carry a bg token and no element opacity`, () => {
      for (const c of sticky) {
        expect(BG.test(c), `sticky element has no opaque bg token: "${c}"`).toBe(true);
        expect(
          OPACITY.test(c),
          `opacity-* on a sticky element sinks its bg to translucent: "${c}"`,
        ).toBe(false);
      }
    });
  }

  it("no <tr> carries element opacity (it would sink its sticky cells' bgs)", () => {
    for (const [name, src] of all) {
      const rows = [
        ...[...src.matchAll(/<tr[^>]*className="([^"]*)"/g)].map((m) => m[1]),
        ...[...src.matchAll(/<tr[^>]*className=\{`([^`]*)`\}/g)].map((m) => m[1]),
      ];
      for (const c of rows) {
        expect(
          OPACITY.test(c),
          `${name}: a <tr> element opacity sinks sticky header/column bgs: "${c}"`,
        ).toBe(false);
      }
    }
  });
});
