import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * **CSS 안의 `var(--color-*)` 이름이 실제로 존재하는가.**
 *
 * `color-source.test.ts` 는 «색이 토큰에서 오는가» 를 잰다 — 접두사만 본다.
 * 그래서 **이름을 틀리면 그 가드를 그대로 통과한다.** 그리고 없는 변수는
 * 조용히 빈 문자열로 풀려서 선언 전체를 무효로 만든다:
 *
 *     border-top: 2px solid var(--color-line);   ->  계산값 `0px none`
 *
 * 즉 테두리가 **아예 사라지고** 콘솔에는 한 줄도 안 남는다. 2026-08-26 에 실제로
 * 두 건이 그 상태였다(`--color-line` · `--color-lineHeavy`, 각각 `bg` 가 빠진
 * 이름이다). 등록부·원장의 행 구분선이 그동안 안 그려지고 있었다.
 *
 * 라이브 실측(2026-08-26, dev :3200, ThemeProvider 루트에서 getComputedStyle):
 *
 *     --color-bgLine       rgba(138,145,158,0.2)   OK
 *     --color-bgLineHeavy  rgba(138,145,158,0.66)  OK
 *     --color-line         ""                      없음
 *     --color-lineHeavy    ""                      없음
 *     프로브: `.sr-eqreg > * + *` 의 border-top 이 `0px none` -> 이름 고치면
 *             `2px solid rgba(138,145,158,0.2)`
 *
 * 목록은 **실측해서 못 박은 화이트리스트**다. 새 토큰을 쓰려면 여기 한 줄을
 * 더해야 하고, 그 한 줄이 «그 이름이 정말 있는지 확인했다» 는 뜻이다 —
 * 자동으로 넓히면 이 가드가 재는 것이 없어진다.
 */

/** ThemeProvider 가 실제로 뿌리는 색 토큰 중 이 리포가 쓰는 것들. */
const KNOWN = new Set([
  'bg',
  'bgAlternate',
  'bgElevation1',
  'bgElevation2',
  'bgLine',
  'bgLineHeavy',
  'bgOverlay',
  'bgPrimaryWash',
  'bgSecondary',
  'fg',
  'fgMuted',
  'fgPrimary',
  // 이동평균이 쓰는 강조 토큰 [2026-08-26]. 실측: light rgb(9,133,81) ->
  // dark rgb(39,173,117) 로 테마를 따라간다.
  'accentBoldGreen',
  'accentBoldGray',
  'accentBoldPurple',
  'accentBoldRed',
  'accentBoldBlue',
  'accentBoldYellow',
]);

const dir = path.resolve(import.meta.dirname, '../src/theme');
const cssFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.css'));

describe('CSS 가 부르는 CDS 색 토큰은 실재해야 한다', () => {
  it('잴 파일을 실제로 찾았다', () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it.each(cssFiles)('%s — 모르는 토큰 이름이 없다', (file) => {
    const css = fs.readFileSync(path.join(dir, file), 'utf8');
    const used = [...css.matchAll(/var\(--color-([A-Za-z0-9]+)/g)].map((m) => m[1]);
    const unknown = [...new Set(used)].filter((n) => !KNOWN.has(n));
    expect(unknown).toEqual([]);
  });

  it('`line`·`lineHeavy` 는 **없는 이름**이다 — 그 둘로 돌아가지 않는다', () => {
    /* CDS 이름에는 `bg` 접두사가 있다. 이 둘이 다시 나타나면 그 선은 안 그려진다. */
    for (const f of cssFiles) {
      const css = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(css).not.toMatch(/var\(--color-line(Heavy)?\)/);
    }
  });

  it('인라인 스타일에서도 같다 — tsx 의 `var(--color-*)` 도 실재해야 한다', () => {
    const src = path.resolve(import.meta.dirname, '../src');
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(d, e.name);
        if (e.isDirectory()) return walk(full);
        return e.name.endsWith('.tsx') || e.name.endsWith('.ts') ? [full] : [];
      });
    const bad: string[] = [];
    for (const f of walk(src)) {
      const t = fs.readFileSync(f, 'utf8');
      for (const m of t.matchAll(/var\(--color-([A-Za-z0-9]+)/g)) {
        /* `${t}` 로 조립되는 자리는 이름이 코드에 없다 — 그건 `state/overlays.ts`
           의 토큰 목록이 지고, `chart-overlays.test.ts` 가 그걸 잰다. */
        if (!KNOWN.has(m[1]) && m[1] !== 'undefined') {
          bad.push(`${path.relative(src, f)}: --color-${m[1]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
