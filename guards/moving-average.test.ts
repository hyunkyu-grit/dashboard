import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 이동평균 오버레이 [OWNER 2026-08-26 — "차트 회사들에서 제공하는 표준 MA로"].
 *
 * 재는 것은 셋이고, 셋 다 **조용히** 틀리는 종류다:
 *
 *   ① 창을 화면이 정하지 않는다 — 서버(`derive.MA_WINDOWS`)가 유일한 목록이다.
 *      두 곳에 적으면 「MA120」이 서로 다른 수를 가리키는 날이 온다.
 *   ② MA 는 **점에 얹혀** 다닌다. 이 파일은 점 배열을 두 번 자르는데(구간 알약
 *      → 확대), MA 를 따로 들고 있으면 그 두 자르기를 두 번째 자리에서 흉내내야
 *      하고 언젠가 한쪽만 고쳐진다. 그러면 다른 날의 평균이 이 날 옆에 그려진다.
 *   ③ MA 는 **색을 안 받는다.** 이 제품에서 색은 이미 두 사전을 갖고 있다 —
 *      방향(--sr-up/--sr-down)과 기준선(--sr-ref-cd/--sr-ref-policy). 거기에
 *      다섯 색을 더하면 「빨간 선」이 상승인지 MA5 인지 화면이 못 정한다.
 */

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const pane = read('src/ui/PreviewPane.tsx');
const derive = read('backend/app/derive.py');

describe('① 창은 서버가 정한다', () => {
  it('백엔드 목록은 벤더 표준이다 — 5·10·20·60·120', () => {
    expect(derive).toMatch(/MA_WINDOWS: tuple\[int, \.\.\.\] = \(5, 10, 20, 60, 120\)/);
  });

  it('프런트는 창 목록을 **자기가 적지 않는다**', () => {
    /* 응답의 `maWindows` 를 그대로 쓴다. 하드코딩된 숫자 배열이 생기면 그 순간
       두 개의 진실이 된다. */
    expect(pane).toMatch(/data\?\.maWindows \?\? \[\]/);
    /* 창 목록 자체가 프런트에 복제되지 않았는지. (굵기·불투명도 사다리에는
       숫자가 있어야 하므로 «숫자 금지» 로는 못 잰다 — 재는 것은 **목록**이다.) */
    expect(pane).not.toMatch(/\[\s*5\s*,\s*10\s*,\s*20\s*,\s*60\s*,\s*120\s*\]/);
  });
});

describe('② MA 는 점에 얹혀 잘린다', () => {
  it('로더가 응답의 ma 를 각 점에 붙인다', () => {
    expect(pane).toMatch(/points\[i\]\.ma = windows\.map/);
  });

  it('차트 시리즈는 **잘린 창의 점**에서 MA 를 읽는다 — 별도 배열이 아니라', () => {
    expect(pane).toMatch(/view\.win\.map\(\(pt\) => pt\.ma\?\.\[k\] \?\? null\)/);
  });

  it('MA 를 두 번째로 자르는 코드가 없다', () => {
    /* `slice(-days)` 나 `sliceRange` 가 MA 배열에 걸리면 그 자리가 곧 어긋남의
       근원이다 — 자르기는 `view` 한 곳만 한다. */
    expect(pane).not.toMatch(/ma[A-Za-z]*\.slice\(-/);
    expect(pane).not.toMatch(/sliceRange\([^)]*ma/i);
  });

  it('워밍업 구간을 잇지 않는다 — 없던 평균을 직선으로 메우면 안 된다', () => {
    const maLine = pane.slice(pane.indexOf('{maWindows.map((w, k) => ('));
    expect(maLine.slice(0, 400)).toMatch(/connectNulls=\{false\}/);
  });
});

describe('③ MA 는 잉크 위계 안에 있다', () => {
  it('색은 `fgMuted` 하나 — 방향색도 기준선 색도 안 쓴다', () => {
    const block = pane.slice(pane.indexOf('...maWindows.map((w, k) => ({'));
    const series = block.slice(0, 320);
    expect(series).toMatch(/color: 'var\(--color-fgMuted\)'/);
    expect(series).not.toMatch(/--sr-up|--sr-down|--sr-ref-/);
  });

  it('무게 사다리는 창이 길수록 무겁다 — 눈이 층을 그렇게 읽는다', () => {
    const raw = pane.slice(pane.indexOf('const MA_INK'), pane.indexOf('/** 시리즈 id'));
    const widths = [...raw.matchAll(/width: ([\d.]+)/g)].map((m) => Number(m[1]));
    const ops = [...raw.matchAll(/opacity: ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(5);
    expect(ops).toHaveLength(5);
    for (let i = 1; i < 5; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
      expect(ops[i]).toBeGreaterThan(ops[i - 1]);
    }
    /* 가장 무거운 MA 도 종목 선(기본 2px·불투명)보다 가볍다 — 주선이 주인공이다. */
    expect(widths[4]).toBeLessThan(2);
    expect(ops[4]).toBeLessThan(1);
  });

  it('스크러버는 MA 를 안 짚는다 — 구슬 다섯이 더 뜨면 커서가 뭘 읽는지 모른다', () => {
    const scrub = pane.slice(pane.indexOf('<Scrubber'), pane.indexOf('</CartesianChart>'));
    expect(scrub).not.toMatch(/maSeriesId|maWindows/);
  });

  it('MA 는 종목 선 **앞**에 그려진다 — SVG 는 나중 것이 위다', () => {
    /* 줄바꿈으로 찾지 않는다 — 이 리포는 CRLF 라 `\n` 으로 이어붙인 패턴이 안
       맞고, 그건 코드가 아니라 시험의 결함이다(2026-08-26 실측). */
    const maAt = pane.indexOf('{maWindows.map((w, k) => (');
    const mainAt = pane.indexOf('seriesId={row.id}');
    expect(maAt).toBeGreaterThan(-1);
    expect(mainAt).toBeGreaterThan(maAt);
  });
});
