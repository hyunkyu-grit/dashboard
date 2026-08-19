import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The TradingView attribution mark must not appear on any chart.
 *
 * It is painted inside the canvas, so no stylesheet can hide it and no screenshot
 * review reliably catches it — it sits bottom-left, small, and reads as a watermark
 * until someone notices it on a screen that is meant to be this desk's own.
 * `LayoutOptions.attributionLogo` is the only switch, and it is per-chart: a new chart
 * that forgets it ships the logo.
 *
 * So this asserts on the call sites rather than on a render: every `createChart` in
 * the product must pass it.
 */

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const CALL_SITES = walk(path.join(ROOT, 'src')).filter((f) =>
  fs.readFileSync(f, 'utf8').includes('createChart('),
);

describe('no TradingView attribution logo', () => {
  it('there are chart call sites to check', () => {
    expect(CALL_SITES.length).toBeGreaterThan(0);
  });

  it.each(CALL_SITES.map((f) => path.relative(ROOT, f)))(
    '%s passes attributionLogo: false',
    (rel) => {
      const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const charts = (body.match(/createChart\(/g) ?? []).length;
      const disabled = (body.match(/attributionLogo:\s*false/g) ?? []).length;
      expect(
        disabled,
        `${rel} calls createChart ${charts}x but disables the logo ${disabled}x`,
      ).toBeGreaterThanOrEqual(charts);
    },
  );
});
