/* 메가 패널이 자기 **덮개 위**에 그려지는지.
 *
 * 실측으로 걸린 회귀다 (2026-08-14). 패널을 돋보이게 하려고 `.sr-megascrim`
 * (`z-index: 19`)을 넣었는데, 정작 `.sr-mega` 는 `z-index` 를 안 지고 있어서
 * `auto`(=0층)였다. 둘 다 `.sr-nav`(`z-index: 20`, `position: relative`)가 만든
 * **같은 쌓임 맥락** 안에 있으므로, 19 가 0 을 덮는다 — 즉 덮개가 패널 위에
 * 얹혔다.
 *
 * 화면에서는 "패널이 안 열린다" 로 보였다. 33% 회색이 흰 시트에 얹히니 아래
 * 화면과 밝기가 붙어 경계가 흐려지고, `elementFromPoint(400, 200)` 이 패널이
 * 아니라 덮개를 반환했다 — 항목을 누를 수도 없었다.
 *
 * 이 두 숫자는 **떨어져 있으면 서로를 모른다.** 한쪽만 고치면 조용히 뒤집힌다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(process.cwd(), 'src/theme/type.css'), 'utf8')
  /* 주석을 먼저 걷어낸다 — 설명문에 적힌 숫자가 규칙으로 잡히면 가드가 자기
     주석을 검사하게 된다 (이 리포에서 네 번 겪었다). */
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** 선택자 하나의 z-index. 없으면 `auto` 로 본다 — CSS 초기값 그대로다. */
function zIndexOf(selector: string): number | 'auto' {
  const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(CSS);
  expect(rule, `${selector} 규칙이 type.css 에 없다`).not.toBeNull();
  const z = /z-index:\s*([^;]+);/.exec(rule![1]);
  if (!z) return 'auto';
  return Number(z[1].trim());
}

describe('메가 패널 쌓임 순서', () => {
  it('패널이 덮개보다 위에 있다', () => {
    const mega = zIndexOf('.sr-mega');
    const scrim = zIndexOf('.sr-megascrim');

    /* `auto` 는 0 층이다. 덮개가 숫자를 지고 패널이 안 지면 항상 덮개가 이긴다. */
    expect(mega, '.sr-mega 가 z-index 를 안 지면 덮개(19)에 가려진다').not.toBe('auto');
    expect(scrim).not.toBe('auto');
    expect(mega as number).toBeGreaterThan(scrim as number);
  });

  it('둘 다 내비의 쌓임 맥락 안에 산다', () => {
    /* `.sr-nav` 가 `position: relative` + `z-index` 를 지고 있어야 위 비교가
       국소적으로 성립한다. 이게 풀리면 두 숫자가 페이지 전체와 경쟁하게 되고,
       패널이 표나 떠 있는 창 밑으로 내려갈 수 있다. */
    const nav = /\.sr-nav\s*\{([^}]*)\}/.exec(CSS);
    expect(nav).not.toBeNull();
    expect(nav![1]).toMatch(/position:\s*relative/);
    expect(nav![1]).toMatch(/z-index:\s*\d+/);
  });
});
