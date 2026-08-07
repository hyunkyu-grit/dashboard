/* Shared token reading for the colour guards (2026-08-07).
 *
 * Three guards — band-hue-contrast, palette, tint-contrast — each grew their
 * own copy of the same two things: a slice of tokens.css per theme, and the
 * WCAG relative-luminance formula. The slice was written the same wrong way in
 * all three:
 *
 *   const DARK_AT = css.indexOf('[data-theme="dark"]');
 *   const darkBlock = css.slice(DARK_AT);          // ← to the END OF FILE
 *
 * which swallows the `prefers-contrast: more` overrides and the second `:root`.
 * It stayed harmless only while every token resolved to a literal hex near the
 * top of the slice, and stopped being harmless the moment a token became an
 * alias: `--bw-line: var(--bw-accent-fg)` resolved into the boost block and
 * measured a colour no screen ever shows in that theme.
 *
 * So: one reader, one formula, used by every colour guard. `_source.ts` made
 * the same argument for source text and it has held; this is that argument for
 * the token layer.
 *
 * The maths matches designcodex/lib/contrast.mjs deliberately — the kit's own
 * gate and this repo's guards must not disagree about what 4.5:1 means.
 */

import { css as cssOf } from "./_source";

export type Theme = "light" | "dark";
export type RGBA = [number, number, number, number];

const tokensCss = cssOf("theme/tokens.css");
/* The kit is one flat `:root` carrying explicit -light-/-dark- names, so the
 * theme is already in the name by the time a token points here. */
const kitCss = cssOf("theme/kit.css");

type Block = { selector: string; body: string };

/** Rule blocks at one nesting level, cut on brace balance. A nested rule stays
 * inside its parent's body, so an `@media` arrives whole and can be re-cut. */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    const selector = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") depth -= 1;
      j += 1;
    }
    out.push({ selector, body: text.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

const TOP = blocks(tokensCss);

const applies = (selector: string, theme: Theme) =>
  selector === ":root" || (theme === "dark" && selector === '[data-theme="dark"]');

/** Everything the cascade applies for one theme, concatenated in SOURCE ORDER.
 * `:root` and `[data-theme="dark"]` are both (0,1,0), so source order is the
 * whole tie-break and reproducing it is the whole job. With `boost`, the
 * `prefers-contrast: more` rules join at their real position — which is why
 * they override the base tier and not the other way round. */
export function tier(theme: Theme, boost = false): string {
  const parts: string[] = [];
  for (const b of TOP) {
    if (b.selector.startsWith("@")) {
      if (!boost || !b.selector.includes("prefers-contrast")) continue;
      for (const inner of blocks(b.body)) {
        if (applies(inner.selector, theme)) parts.push(inner.body);
      }
      continue;
    }
    if (applies(b.selector, theme)) parts.push(b.body);
  }
  return parts.join("\n");
}

/** The four tiers that can reach a screen. A guard that measures colour should
 * loop over all four: a user who asks the OS for more contrast gets the boost
 * tier and nothing else, so it carries the same floors. */
export const TIERS: [string, string][] = [
  ["light", tier("light")],
  ["dark", tier("dark")],
  ["light + prefers-contrast", tier("light", true)],
  ["dark + prefers-contrast", tier("dark", true)],
];

/** '#rrggbb' | '#rgb' | 'rgb(r g b / a)' | 'rgba(r, g, b, a)' | 'transparent' */
export function parse(color: string): RGBA {
  const s = color.trim();
  if (s === "transparent") return [0, 0, 0, 0];
  const long = /^#([0-9a-f]{6})$/i.exec(s);
  if (long) {
    const n = parseInt(long[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const short = /^#([0-9a-f]{3})$/i.exec(s);
  if (short) {
    const [r, g, b] = [...short[1]].map((c) => parseInt(c + c, 16));
    return [r, g, b, 1];
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*\/\s*|[\s,]+)?([\d.]+)?\s*\)$/i.exec(s);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]];
  throw new Error(`unreadable colour: ${color}`);
}

/** Composites a translucent foreground onto an opaque background. */
export function over(fg: string | RGBA, bg: string | RGBA): RGBA {
  const [fr, fgn, fb, fa] = Array.isArray(fg) ? fg : parse(fg);
  const [br, bgn, bb] = Array.isArray(bg) ? bg : parse(bg);
  return [
    fr * fa + br * (1 - fa),
    fgn * fa + bgn * (1 - fa),
    fb * fa + bb * (1 - fa),
    1,
  ];
}

const chan = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function luminance(color: string | RGBA): number {
  const [r, g, b] = Array.isArray(color) ? color : parse(color);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** Contrast ratio. A translucent foreground is composited onto the background
 * first — which is the only honest way to measure ink on glass. */
export function contrast(fg: string | RGBA, bg: string | RGBA): number {
  const front = Array.isArray(fg) ? fg : parse(fg);
  const l1 = luminance(front[3] < 1 ? over(front, bg) : front);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** The value a token resolves to in one tier, as a colour literal.
 *
 * Takes the LAST declaration — the one the cascade lands on — and follows
 * `var()` hops and `color-mix(in srgb, A p%, B)`. Throws rather than guessing:
 * a guard that silently measures the wrong colour is the defect this module
 * exists to end. */
export function resolve(scope: string, name: string, depth = 0): string {
  const re = new RegExp(`(?<![-\\w])${name}:\\s*([^;]+);`, "g");
  let v: string | null = null;
  for (const m of scope.matchAll(re)) v = m[1].trim();
  if (v === null) throw new Error(`missing ${name}`);
  if (depth > 6) throw new Error(`${name}: alias loop`);

  const alias = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(v);
  if (alias) {
    return resolve(alias[1].startsWith("--kit-") ? kitCss : scope, alias[1], depth + 1);
  }

  const mix = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/.exec(v);
  if (mix) {
    const p = +mix[2] / 100;
    const a = parse(literal(scope, mix[1], depth));
    const b = parse(literal(scope, mix[3], depth));
    /* srgb mixing is premultiplied by weight, alpha included — which is how
     * `color-mix(… var(--bw-ink) 12%, transparent)` becomes a 12% hairline. */
    return `rgb(${[0, 1, 2].map((i) => a[i] * p + b[i] * (1 - p)).join(" ")} / ${
      a[3] * p + b[3] * (1 - p)
    })`;
  }

  try {
    parse(v);
    return v;
  } catch {
    throw new Error(`unresolvable ${name}: ${v}`);
  }
}

/** One operand of a color-mix: a literal, or a var() that has to be chased. */
function literal(scope: string, operand: string, depth: number): string {
  const alias = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(operand.trim());
  if (!alias) return operand.trim();
  return resolve(alias[1].startsWith("--kit-") ? kitCss : scope, alias[1], depth + 1);
}

/** Contrast between two TOKENS in one tier. The common case. */
export function ratio(scope: string, fg: string, bg: string): number {
  return contrast(resolve(scope, fg), resolve(scope, bg));
}

export const TEXT_FLOOR = 4.5;
export const GRAPHIC_FLOOR = 3;
