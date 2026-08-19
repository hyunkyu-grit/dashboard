import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The declared face and the face the components ask for must be the SAME NAME.
 *
 * This has failed silently twice, and both times the symptom was invisible: the
 * product rendered in Malgun Gothic and looked like a font choice rather than a
 * bug.
 *
 *   1. `type.css` sourced the face with `local()` only, on the belief that
 *      Pretendard was installed on this desk. It is not, so every lookup missed.
 *   2. The face was then self-hosted under the family name `Pretendard SR` and
 *      wired into `--sr-font-sans` — but `sauronTheme.ts` kept its own stack
 *      starting `'Pretendard Variable'`, and CDS components read the THEME's
 *      `--fontFamily-*`, never that CSS variable. Two stacks, one consulted.
 *
 * Neither failure is visible in a diff, and neither breaks a render. What makes
 * them expensive is the second-order effect: Malgun ships three weights, so a
 * 500/600 pair collapses to Regular/Bold and the type quietly loses its middle
 * register — which is a design decision being reversed by a typo.
 *
 * Source-read rather than rendered, for the same reason as `ch-context`: jsdom
 * loads no CDS stylesheet and resolves no webfont, so a rendered assertion here
 * would only measure jsdom.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const TYPE_CSS = fs.readFileSync(path.join(ROOT, 'src/theme/type.css'), 'utf8');
const THEME_TS = fs.readFileSync(path.join(ROOT, 'src/theme/sauronTheme.ts'), 'utf8');

/** The family name the `@font-face` block actually declares. */
function declaredFamily(): string {
  const block = TYPE_CSS.match(/@font-face\s*\{[\s\S]*?\}/)?.[0] ?? '';
  return block.match(/font-family:\s*['"]([^'"]+)['"]/)?.[1] ?? '';
}

describe('the self-hosted face is the face the theme asks for', () => {
  it('type.css declares an @font-face with a family name', () => {
    expect(declaredFamily()).toBeTruthy();
  });

  it('the theme stack LEADS with the declared family', () => {
    // Leading, not merely present: anything ahead of it that happens to resolve
    // on some machine wins, and then two readers see two different faces — which
    // is the one thing column widths derived from format maxima cannot survive.
    // The stack is a DOUBLE-quoted string whose contents are single-quoted
    // family names, so the character class has to exclude only the delimiter.
    const stack = THEME_TS.match(/const SR_FONT_STACK\s*=\s*"([^"]+)"/)?.[1] ?? '';
    expect(stack).toBeTruthy();
    const first = stack.split(',')[0].replace(/['"]/g, '').trim();
    expect(first).toBe(declaredFamily());
  });

  it('local() is absent, so one machine cannot render a different cut', () => {
    // A locally installed Pretendard of another version has other metrics, and
    // these column widths are computed from format maxima × a measured advance.
    const block = TYPE_CSS.match(/@font-face\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(block).not.toMatch(/local\(/);
  });

  it('the file the @font-face points at exists', () => {
    const block = TYPE_CSS.match(/@font-face\s*\{[\s\S]*?\}/)?.[0] ?? '';
    const url = block.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1] ?? '';
    expect(url).toBeTruthy();
    expect(fs.existsSync(path.join(ROOT, 'public', url.replace(/^\//, '')))).toBe(true);
  });

  it('the 13px Hangul register is not left at 400', () => {
    // `legal` is the only weight this product overrides, and the reason is the
    // writing system rather than taste: Hangul strokes fill in at 13px/400.
    // Everything else is CDS's (= Coinbase's) scale untouched.
    //
    // This is tied to the face assertions above because a three-weight fallback
    // renders 500 as Bold, which is louder than the 600 it sits beside — the
    // override then makes the hierarchy WORSE than leaving it at 400.
    expect(THEME_TS).toMatch(/legal:\s*'500'/);
  });
});
