import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ── Active-control grammar — one dictionary across screens ───────────────────
 *
 * 2026-08-19, whole-app critique: the active state spoke three dialects — the
 * nav's grey stadium, SegmentedTabs' black pill, and PeriodSelector's
 * Coinbase-blue "primary wash". The blue one is not just inconsistent, it is a
 * COLLISION: in this product blue is the frozen down-direction hue, so a blue
 * active chip under a rising chart reads as a falling market.
 *
 * The repair keeps CDS's PeriodSelector but redefines the two CDS variables it
 * actually consumes (`--color-fgPrimary` on the label's atomic class,
 * `--color-bgPrimaryWash` on the indicator's inline style):
 *
 *   · `.sr-spans` (Main preview) — active tab takes THE CHART'S SIGN, the
 *     reference's trick, now actually delivered. Flat charts fall back to the
 *     neutral grey pill.
 *   · `.sr-tabs-neutral` (Lab's pool/issuer/tenor/camera) — no data sign, so
 *     the neutral ink grammar.
 *
 * Why variables and not a colour rule: measured 2026-08-19 — the tab's inner
 * span carries CDS's `fgPrimary` atomic class, so an inherited `color` on the
 * button never reaches the label, and the wash arrives as an inline style no
 * stylesheet rule can beat. These pins keep a future cleanup from "simplifying"
 * back to the rule that silently never worked.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('active-control grammar', () => {
  const css = read('src/theme/type.css');

  it('sr-spans redefines BOTH CDS variables, for both signs and the flat base', () => {
    // Base scope: neutral fallback for flat charts.
    const base = css.match(/\.sr-spans\s*\{[^}]*\}/);
    expect(base?.[0]).toContain('--color-fgPrimary: var(--color-fg)');
    expect(base?.[0]).toContain('--color-bgPrimaryWash: var(--color-bgSecondary)');

    for (const dir of ['up', 'down'] as const) {
      const block = css.match(new RegExp(`\\.sr-spans\\[data-dir='${dir}'\\]\\s*\\{[^}]*\\}`));
      expect(block?.[0], `sr-spans[data-dir='${dir}']`).toContain(
        `--color-fgPrimary: var(--sr-${dir})`,
      );
      expect(block?.[0]).toContain(`color-mix(in srgb, var(--sr-${dir}) 10%, transparent)`);
    }
  });

  it('the broken inheritance-only rule stays dead', () => {
    // The first version set `color` on [aria-selected='true'] and the label's
    // own fgPrimary class won. If this selector reappears the fix regressed.
    expect(css).not.toMatch(/\.sr-spans\[data-dir='(?:up|down)'\]\s*\[aria-selected/);
  });

  it('sr-tabs-neutral exists and speaks the neutral ink grammar', () => {
    const block = css.match(/\.sr-tabs-neutral\s*\{[^}]*\}/);
    expect(block?.[0]).toContain('--color-fgPrimary: var(--color-fg)');
    expect(block?.[0]).toContain('--color-bgPrimaryWash: var(--color-bgSecondary)');
  });

  it('every Lab PeriodSelector wrapper carries the neutral scope', () => {
    const src = read('src/ui/Surface3D.tsx');
    const selectors = src.match(/<PeriodSelector/g) ?? [];
    const scoped = src.match(/className="sr-tabs-neutral"/g) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    expect(scoped.length).toBe(selectors.length);
  });

  it('the Main preview PeriodSelector stays inside the signed sr-spans scope', () => {
    const src = read('src/ui/PreviewPane.tsx');
    expect(src).toMatch(/className="sr-spans"[\s\S]{0,200}<PeriodSelector/);
  });
});
