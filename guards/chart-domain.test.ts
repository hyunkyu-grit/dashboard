/* 요청한 창이 **그대로** 그려진다 — 조용히 잘리지 않는다.
 *
 * v1 패리티 레인 P1-3 (LANE-v1-parity-2026-08-20.md). v1 의 `domain-guard`.
 *
 * ## v1 의 병과 v2 의 모양이 다르다
 *
 * v1 은 lightweight-charts 를 썼고, 좁은 컨테이너가 앞쪽 연도를 먹었다. 그래서
 * v1 의 가드는 "요청 범위와 실제 렌더 범위" 를 비교해 던졌다.
 *
 * v2 는 CDS `CartesianChart` 에 `xAxis.data` 로 인덱스 도메인을 준다. 컨테이너
 * 폭은 눈금 라벨을 솎을 뿐 도메인을 자르지 않는다 — 그 병은 여기 없다
 * (2026-08-20 확인).
 *
 * 대신 v2 에는 **같은 결과를 내는 다른 길** 셋이 있고, 셋 다 조용하다:
 *
 *   1. 시리즈와 x축이 **다른 배열**에서 나오면 날짜가 통째로 밀린다
 *   2. 히스토리 차트가 `preview` 해상도를 요청하면 서버가 150점으로 솎는다
 *      (`derive.py:PREVIEW_POINTS`) — 선은 멀쩡해 보이고 점만 사라진다
 *   3. 창을 자르는 함수가 경계를 하나 흘리면 끝점이 조용히 빠진다
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sliceRange, type ViewRange } from '../src/chart/zoom';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('창을 자르면 요청한 만큼 정확히 나온다', () => {
  const items = Array.from({ length: 100 }, (_, i) => i);

  it('양 끝을 포함한다 — 폭이 i1 − i0 + 1', () => {
    const cases: ViewRange[] = [
      { i0: 0, i1: 0 },
      { i0: 0, i1: 99 },
      { i0: 10, i1: 20 },
      { i0: 98, i1: 99 },
    ];
    for (const r of cases) {
      const win = sliceRange(items, r);
      expect(win.length, JSON.stringify(r)).toBe(r.i1 - r.i0 + 1);
      expect(win[0]).toBe(r.i0);
      expect(win[win.length - 1]).toBe(r.i1);
    }
  });

  it('null 은 전체다 — 하나도 안 잃는다', () => {
    expect(sliceRange(items, null)).toHaveLength(items.length);
    expect(sliceRange(items, null)[0]).toBe(0);
    expect(sliceRange(items, null)[99]).toBe(99);
  });

  it('마지막 점이 살아남는다 — 오늘이 빠지면 차트가 거짓말한다', () => {
    const win = sliceRange(items, { i0: 50, i1: 99 });
    expect(win[win.length - 1]).toBe(99);
  });
});

describe('시리즈와 x축은 같은 배열에서 나온다', () => {
  /* 길이가 갈리면 CDS 는 짧은 쪽에 맞춰 그리고, 날짜가 통째로 밀린다. 화면은
   * 멀쩡해 보인다 — 값도 날짜도 각각은 진짜니까. */

  /* **재는 자리가 옮겨졌다** [2026-08-26 라이트웨이트 이관]: `xAxis.data` 대신
     `TimeChart` 의 `dates`, `series.data` 대신 `lines[].values` 다. 규칙은 그대로 —
     둘이 같은 배열에서 나와야 한다. */

  it('미리보기: 값과 날짜가 둘 다 view.win 에서 나온다', () => {
    const src = read('src/ui/PreviewPane.tsx');
    expect(src).toMatch(/values: view\.win\.map\(\(p\) => p\.v\)/);
    expect(src).toMatch(/dates=\{view\.win\.map\(\(p\) => p\.t\)\}/);
  });

  it('백테스트 연결 차트: 둘 다 points 에서 나온다', () => {
    const src = read('src/backtest/LinkedCharts.tsx');
    expect(src).toMatch(/const dates = useMemo\(\(\) => points\.map\(\(p\) => p\.t\)/);
    expect(src).toMatch(/values: points\.map\(\(p\) => p\.v\)/);
  });

  it('길이가 갈리면 어떻게 되는지 — 그 실패를 재현한다', () => {
    const win = [
      { t: '2026-08-17', v: 1 },
      { t: '2026-08-18', v: 2 },
      { t: '2026-08-19', v: 3 },
    ];
    const values = win.map((p) => p.v);
    const truncatedDates = win.slice(0, 2).map((p) => p.t);
    /* 마지막 값이 가리킬 날짜가 없다 — 그리는 쪽은 조용히 둘만 그린다. */
    expect(values.length).not.toBe(truncatedDates.length);
  });
});

describe('히스토리는 솎이지 않은 해상도를 요청한다', () => {
  it('미리보기 pane 이 full 을 부른다 — preview 가 아니다', () => {
    const src = read('src/ui/PreviewPane.tsx');
    expect(src).toMatch(/seriesUrl\([^)]*'full'\)/);
    expect(src).not.toMatch(/seriesUrl\([^)]*'preview'\)/);
  });

  it('서버의 솎기는 preview 해상도에만 걸린다', () => {
    /* 이 조건이 느슨해지면 full 요청도 150점으로 줄어든다. */
    const src = read('backend/app/derive.py');
    expect(src).toMatch(/downsample_triples\(triples\) if resolution == "preview" else triples/);
  });

  it('솎기의 목표점 수가 실제로 작다 — 이 검사가 공허하지 않다', () => {
    const src = read('backend/app/derive.py');
    const m = src.match(/PREVIEW_POINTS = (\d+)/);
    expect(m, 'PREVIEW_POINTS 를 못 찾았다').toBeTruthy();
    expect(Number(m![1])).toBeLessThan(500);
  });
});
