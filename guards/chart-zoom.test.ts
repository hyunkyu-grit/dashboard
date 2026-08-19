import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIN_SPAN, panRange, sliceRange, zoomRange } from '@/chart/zoom';

/**
 * 제자리 확대 — 인덱스 공간의 순수 함수라 DOM 없이 전부 잰다.
 *
 * 가장 값나가는 계약 둘: ① **커서 아래의 점이 커서 아래에 남는다** — 가운데
 * 기준으로 확대하면 보려던 지점이 화면 밖으로 밀려난다. ② 끝까지 축소하면
 * `null` — "전체" 가 두 가지 상태로 갈라지면 되돌리기가 두 가지 뜻을 갖는다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const LEN = 260;

describe('차트 확대', () => {
  it('처음 확대는 전체에서 시작한다', () => {
    const z = zoomRange(null, LEN, 0.5, 0.8)!;
    expect(z.i1 - z.i0 + 1).toBe(Math.round(LEN * 0.8));
  });

  it('커서 아래의 점이 커서 아래에 남는다', () => {
    const frac = 0.25;
    const before = { i0: 0, i1: LEN - 1 };
    const anchorIdx = before.i0 + frac * (before.i1 - before.i0);
    const z = zoomRange(before, LEN, frac, 0.5)!;
    const after = z.i0 + frac * (z.i1 - z.i0);
    // 반올림 한 칸까지만 허용한다.
    expect(Math.abs(after - anchorIdx)).toBeLessThanOrEqual(1);
  });

  it('끝까지 축소하면 전체(`null`)로 돌아온다', () => {
    let z = zoomRange(null, LEN, 0.5, 0.5);
    for (let i = 0; i < 20 && z; i++) z = zoomRange(z, LEN, 0.5, 1.25);
    expect(z).toBeNull();
  });

  it('최소 폭 아래로는 안 좁아진다', () => {
    let z = zoomRange(null, LEN, 0.5, 0.5);
    for (let i = 0; i < 30; i++) z = zoomRange(z, LEN, 0.5, 0.5);
    expect(z!.i1 - z!.i0 + 1).toBe(MIN_SPAN);
  });

  it('구간은 데이터 안에 머문다', () => {
    const z = zoomRange(null, LEN, 1, 0.1)!; // 오른쪽 끝을 앵커로
    expect(z.i0).toBeGreaterThanOrEqual(0);
    expect(z.i1).toBeLessThanOrEqual(LEN - 1);
  });

  it('이동은 폭을 안 바꾸고 끝에서 멈춘다', () => {
    const z = zoomRange(null, LEN, 0.5, 0.5)!;
    const span = z.i1 - z.i0 + 1;
    const far = panRange(z, LEN, 10_000)!;
    expect(far.i1 - far.i0 + 1).toBe(span);
    expect(far.i1).toBe(LEN - 1);
    const back = panRange(far, LEN, -10_000)!;
    expect(back.i0).toBe(0);
    expect(back.i1 - back.i0 + 1).toBe(span);
  });

  it('전체 구간은 밀 데가 없다', () => {
    expect(panRange(null, LEN, 50)).toBeNull();
  });

  it('점이 둘 미만이면 확대가 없다', () => {
    expect(zoomRange(null, 1, 0.5, 0.5)).toBeNull();
  });

  it('자르는 자리는 하나다', () => {
    const xs = Array.from({ length: 10 }, (_, i) => i);
    expect(sliceRange(xs, null)).toEqual(xs);
    expect(sliceRange(xs, { i0: 2, i1: 4 })).toEqual([2, 3, 4]);
  });

  it('휠은 네이티브로 달린다 — React 의 onWheel 은 passive 다', () => {
    // `onWheel` 로 달면 `preventDefault()` 가 아무 일도 안 하고, 확대하려던 휠이
    // 창 본문까지 같이 스크롤한다. 이 규칙이 뒤집히면 화면에서만 티가 난다.
    const pane = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'PreviewPane.tsx'), 'utf8');
    expect(pane).toMatch(/addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
    const code = pane.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/onWheel=\{/);
  });

  it('보고 있는 것이 갈리면 확대는 초기화된다', () => {
    // 다른 종목·구간·종류의 인덱스 구간을 그대로 쓰면 없는 날짜 범위를 그린다.
    const pane = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'PreviewPane.tsx'), 'utf8');
    expect(pane).toMatch(/setZoom\(null\);\s*\}, \[row, span\]\)/);
  });
});
