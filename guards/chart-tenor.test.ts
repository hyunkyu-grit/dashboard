import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { monthsLabel, tenorMonths } from '../src/chart/tenor';

/**
 * 커브 차트의 가로축 [2026-08-26 — 라이트웨이트 이관].
 *
 * `createYieldCurveChart` 는 x 를 **월수**로 받는다. 그래서 이 앱의 만기
 * 어휘가 정수 월로 정확히 떨어져야 하고, 눈금 글자는 다시 그 어휘로 돌아와야
 * 한다. 둘 중 하나만 틀려도 **커브가 그려지긴 한다** — 노드 자리만 조용히
 * 어긋난다. 캔버스라 DOM 으로는 못 잡으므로 여기서 잡는다.
 */

describe('만기 → 월수', () => {
  it('이 데스크가 쓰는 열두 만기가 전부 정수 월이다', () => {
    const got = ['3M', '6M', '9M', '1Y', '18M', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'].map(
      (t) => tenorMonths(t),
    );
    expect(got).toEqual([3, 6, 9, 12, 18, 24, 36, 60, 84, 120, 240, 360]);
  });

  it('순서가 만기 순서다 — 축이 선형이라 이게 곧 자리다', () => {
    const ms = ['3M', '1Y', '3Y', '10Y', '30Y'].map((t) => tenorMonths(t)!);
    expect(ms).toEqual([...ms].sort((a, b) => a - b));
  });

  it('0 개월로 뭉치지 않는다 — 축의 원점이라 데이터가 설 자리가 아니다', () => {
    expect(tenorMonths('1D')).toBe(1);
    expect(tenorMonths('7D')).toBe(1);
  });

  it('못 읽는 꼴은 `null` 이다 — 0 을 지어내지 않는다', () => {
    for (const bad of ['', 'KTB3', '3', 'Y3', '아무거나']) {
      expect(tenorMonths(bad)).toBeNull();
    }
  });
});

describe('월수 → 눈금 글자', () => {
  it('축에 「120」이 아니라 「10Y」가 선다', () => {
    expect(monthsLabel(120)).toBe('10Y');
    expect(monthsLabel(36)).toBe('3Y');
    expect(monthsLabel(360)).toBe('30Y');
  });

  it('1년 미만은 개월로 읽는다', () => {
    expect(monthsLabel(3)).toBe('3M');
    expect(monthsLabel(9)).toBe('9M');
  });

  it('안 떨어지는 것은 개월로 — 「1.5Y」 같은 글자를 만들지 않는다', () => {
    expect(monthsLabel(18)).toBe('18M');
  });

  it('왕복이 항등이다', () => {
    for (const t of ['3M', '9M', '1Y', '18M', '3Y', '10Y', '30Y']) {
      expect(monthsLabel(tenorMonths(t)!)).toBe(t);
    }
  });
});

describe('sim 의 같은 산술과 갈리지 않는다', () => {
  it('`tenorYears` 와 12배 관계다 — 두 벌이 있다는 사실을 여기서 잰다', () => {
    /* 값 임포트가 금지라(2026-08-11) 소스를 읽어 대조한다. 규칙을 어기지 않고
       두 벌이 갈리는 것을 잡는 유일한 방법이다. */
    const sim = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/sim/scenario.ts'),
      'utf8',
    );
    const m = /export function tenorYears[\s\S]*?\n}/.exec(sim);
    expect(m).not.toBeNull();
    /* 그쪽도 Y/M/D 세 단위를 같은 규칙으로 읽는가. */
    expect(m![0]).toMatch(/\[YMD\]/);
    expect(m![0]).toMatch(/n \/ 12/);
    expect(m![0]).toMatch(/n \/ 365/);
  });
});
