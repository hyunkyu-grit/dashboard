import fs from 'node:fs';
import path from 'node:path';

import { ThemeProvider } from '@coinbase/cds-web';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CurveBanner } from '../src/ui/CurveBanner';

/**
 * 커브 배너 (§I) — 세 가지가 틀리면 조용히 틀리는 자리라 셋 다 못박는다.
 *
 *   1. `kind: null` 일 때 아무것도 안 그린다. 빈 줄이 남으면 표가 한 줄 밀려
 *      내려가고, "커브가 평범하다"는 문장을 공백으로 말하는 셈이 된다.
 *   2. 저점권은 **하락색**이다. v1 은 `text-up` 을 하드코딩해서 저점권 문장을
 *      상승색으로 그렸다 — 색이 문장과 반대되는 말을 하고 있었다.
 *   3. 이 줄은 카드 안에 산다. 방향색은 `--sr-page` 위에서 4.19/4.31 로 떨어진다
 *      (DESIGN §3.2), 그러니 페이지 바탕에 올라가면 대비 미달이다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');

function draw(kind: 'curve_high' | 'curve_low' | null) {
  const { container } = render(
    <ThemeProvider theme={defaultTheme} activeColorScheme="light">
      <CurveBanner banner={{ kind }} />
    </ThemeProvider>,
  );
  return container;
}

describe('커브 배너', () => {
  it('평범한 커브에는 아무것도 그리지 않는다', () => {
    expect(draw(null).textContent).toBe('');
    // `banner` 자체가 없는 경우(옛 페이로드)도 같다
    const { container } = render(
      <ThemeProvider theme={defaultTheme} activeColorScheme="light">
        <CurveBanner />
      </ThemeProvider>,
    );
    expect(container.textContent).toBe('');
  });

  it('고점권은 상승색으로 한 줄', () => {
    const c = draw('curve_high');
    expect(c.textContent).toContain('52주 고점권');
    expect(c.querySelector('.sr-up')).not.toBeNull();
    expect(c.querySelector('.sr-down')).toBeNull();
  });

  it('저점권은 하락색으로 — v1 이 상승색으로 그리던 자리', () => {
    const c = draw('curve_low');
    expect(c.textContent).toContain('52주 저점권');
    expect(c.querySelector('.sr-down')).not.toBeNull();
    expect(c.querySelector('.sr-up')).toBeNull();
  });

  it('두 문장이 동시에 나오지 않는다', () => {
    for (const kind of ['curve_high', 'curve_low'] as const) {
      const t = draw(kind).textContent ?? '';
      expect(t.includes('고점권') && t.includes('저점권')).toBe(false);
    }
  });
});

describe('배너가 서는 면', () => {
  it('카드 안에 렌더된다 — 페이지 바탕이면 방향색이 4.5:1 을 못 넘는다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app/page.tsx'), 'utf8');
    const card = src.indexOf('className="sr-card"');
    const banner = src.indexOf('<CurveBanner');
    const table = src.indexOf('<InstrumentTable');
    expect(card, 'sr-card 카드를 못 찾음').toBeGreaterThan(-1);
    expect(banner, '배너가 페이지에 없음').toBeGreaterThan(card);
    expect(banner, '배너는 표 위에 온다').toBeLessThan(table);
  });

  it('아웃라이트 탭에서만 — 판정 입력이 아웃라이트 커브뿐이다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app/page.tsx'), 'utf8');
    expect(src).toMatch(/group === 'outright' \? <CurveBanner/);
  });
});
