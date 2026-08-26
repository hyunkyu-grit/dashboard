/* 보이는 구간의 고·저 — 창이 움직이면 표식도 움직인다.
 *
 * v1 패리티 레인 P1-1 (LANE-v1-parity-2026-08-20.md). v1 의 `visible-extremes`
 * 와 `window-extremes` 둘을 합친 자리.
 *
 * ## 진단에서 정정한 것
 *
 * 레인 문서는 "v2 에 기능 자체가 없다" 고 적었는데 **과장이었다**. v2 는 이미
 * 줌된 조각에서 고·저를 내어 리드아웃에 찍고 있었다. 없던 것은 셋이다:
 *
 *   1. **자리** — 값만 훑어서 "어느 날이 최고인가" 를 아무도 몰랐다
 *   2. **차트 위의 표식** — 그래서 찍을 수도 없었다
 *   3. **규칙** — 동점을 누가 이기는지 아무 데도 안 적혀 있었다
 *
 * ## 한 번 스캔, 두 소비자
 *
 * 차트의 y 도메인과 표식이 같은 결과에서 나온다. 두 곳에서 각자 훑으면
 * 언젠가 갈리고, 그때 "이게 최고" 라고 찍은 점이 축의 천장과 다른 값이 된다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { windowExtremes, yDomain } from '../src/chart/extremes';
import { sliceRange } from '../src/chart/zoom';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('창의 성질이다 — 시리즈의 것이 아니다', () => {
  const series = [3.0, 3.5, 2.0, 4.0, 2.5, 3.2];

  it('전체 창은 전역 극값을 찾는다', () => {
    const e = windowExtremes(series)!;
    expect(e.hi).toBe(4.0);
    expect(e.lo).toBe(2.0);
    expect(e.hiIdx).toBe(3);
    expect(e.loIdx).toBe(2);
  });

  it('창이 다르면 답도 다르다 — 남아 있는 표식이 곧 실패다', () => {
    const win = sliceRange(series, { i0: 4, i1: 5 });
    const e = windowExtremes(win)!;
    expect(e.hi).toBe(3.2);
    expect(e.lo).toBe(2.5);
    // 전역 극값(4.0 / 2.0)은 이 창에 없다.
    expect(e.hi).not.toBe(4.0);
    expect(e.lo).not.toBe(2.0);
  });

  it('창을 좁히면 표식의 자리가 움직인다', () => {
    const wide = windowExtremes(sliceRange(series, { i0: 0, i1: 5 }))!;
    const narrow = windowExtremes(sliceRange(series, { i0: 2, i1: 4 }))!;
    expect(wide.hiIdx).toBe(3);
    // 좁은 창에서는 인덱스가 창 기준으로 다시 매겨진다(3 → 1).
    expect(narrow.hiIdx).toBe(1);
    expect(narrow.hi).toBe(4.0);
  });

  it('극값이 창의 가장자리에 있어도 잘려 나가지 않는다', () => {
    const e = windowExtremes(sliceRange(series, { i0: 3, i1: 5 }))!;
    expect(e.hiIdx).toBe(0); // 창의 첫 점이 최고
    expect(e.hi).toBe(4.0);
  });
});

describe('동점 규칙은 하나다 — 가장 최근이 이긴다', () => {
  it('같은 최고를 두 번 찍으면 나중 것을 가리킨다', () => {
    const e = windowExtremes([1, 5, 3, 5, 2])!;
    expect(e.hi).toBe(5);
    expect(e.hiIdx).toBe(3);
  });

  it('최저도 같은 규칙이다', () => {
    const e = windowExtremes([4, 1, 3, 1, 2])!;
    expect(e.lo).toBe(1);
    expect(e.loIdx).toBe(3);
  });

  it('평평한 창은 마지막 점 하나를 가리킨다', () => {
    const e = windowExtremes([2, 2, 2])!;
    expect(e.hi).toBe(2);
    expect(e.lo).toBe(2);
    expect(e.hiIdx).toBe(2);
    expect(e.loIdx).toBe(2);
  });
});

describe('그릴 것이 없으면 아무것도 안 그린다', () => {
  it('빈 창은 null', () => {
    expect(windowExtremes([])).toBeNull();
  });

  it('전부 null 인 창은 null — 0 으로 읽지 않는다', () => {
    expect(windowExtremes([null, null, undefined])).toBeNull();
  });

  it('구멍은 건너뛴다 — 없는 바닥을 만들지 않는다', () => {
    const e = windowExtremes([3, null, 5, null, 4])!;
    expect(e.lo).toBe(3);
    expect(e.hi).toBe(5);
  });

  it('유한하지 않은 값은 값이 아니다', () => {
    const e = windowExtremes([3, NaN, Infinity, 5])!;
    expect(e.hi).toBe(5);
    expect(e.lo).toBe(3);
  });
});

describe('y 도메인과 표식은 같은 결과에서 나온다', () => {
  it('도메인이 극값을 담는다 — 찍은 점이 축 밖으로 나가지 않는다', () => {
    const e = windowExtremes([3.0, 4.0, 2.0])!;
    const d = yDomain(e);
    expect(d.min).toBeLessThan(e.lo);
    expect(d.max).toBeGreaterThan(e.hi);
  });

  it('평평한 창에서도 폭이 0 이 아니다 — 선이 축에 눌리지 않는다', () => {
    const e = windowExtremes([2, 2, 2])!;
    const d = yDomain(e);
    expect(d.max).toBeGreaterThan(d.min);
  });

  it('창이 바뀌면 도메인도 같이 바뀐다', () => {
    const wide = yDomain(windowExtremes([1, 9, 5])!);
    const narrow = yDomain(windowExtremes([5])!);
    expect(wide.max).not.toBe(narrow.max);
  });
});

describe('화면이 그 결과를 쓴다', () => {
  const PANE = 'src/ui/PreviewPane.tsx';

  it('미리보기가 스캔을 직접 하지 않고 모듈을 지난다', () => {
    const src = read(PANE);
    expect(src).toMatch(/windowExtremes\(/);
    /* 옛 인라인 루프가 돌아오면 두 소비자가 다시 갈린다. */
    expect(src).not.toMatch(/let hi = -Infinity;/);
  });

  it('차트가 고·저 두 점을 찍는다', () => {
    /* **재는 자리가 옮겨졌다** [2026-08-26 이관]: CDS `Point dataX/dataY` 대신
       `TimeChart` 의 `markers`(순번 + 색)다. y 는 안 준다 — 그 점의 값은
       계열이 이미 알고 있어서 순번만으로 자리가 정해진다(값을 따로 주면
       두 곳에서 갈릴 수 있는 것이 하나 줄었다). */
    const src = read(PANE);
    expect(src).toMatch(/index: view\.ext\.hiIdx/);
    expect(src).toMatch(/index: view\.ext\.loIdx/);
    expect(src).toMatch(/markers=\{chartMarkers\}/);
  });

  it('리드아웃의 숫자도 같은 결과를 읽는다', () => {
    /* 점과 숫자가 다른 스캔에서 나오면 그때가 이 가드가 막는 순간이다. */
    const src = read(PANE);
    expect(src).toMatch(/label="최고" value=\{view \? fmtLevel\(view\.hi/);
    expect(src).toMatch(/label="최저" value=\{view \? fmtLevel\(view\.lo/);
  });
});

describe('판정기 자신 — 심어서 실패하는지', () => {
  it('먼저 오는 것을 고르는 스캔은 다른 답을 낸다', () => {
    const first = (vs: number[]) => {
      let hi = -Infinity;
      let idx = -1;
      vs.forEach((v, i) => {
        if (v > hi) {
          hi = v;
          idx = i;
        }
      });
      return idx;
    };
    const vs = [1, 5, 3, 5, 2];
    expect(first(vs)).toBe(1);
    expect(windowExtremes(vs)!.hiIdx).toBe(3); // ← 규칙이 실제로 갈린다
  });

  it('창을 안 자르면 표식이 남는다 — 그 실패를 재현한다', () => {
    const series = [3.0, 3.5, 2.0, 4.0, 2.5, 3.2];
    const stale = windowExtremes(series)!; // 전체를 훑음
    const fresh = windowExtremes(sliceRange(series, { i0: 4, i1: 5 }))!;
    expect(stale.hi).not.toBe(fresh.hi);
  });
});
