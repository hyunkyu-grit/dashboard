import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 이동평균 오버레이 [OWNER 2026-08-26 — "차트 회사들에서 제공하는 표준 MA로",
 * 그리고 "당연히 껏다 켰다 가능하게 … 색도 컬러토큰에서"].
 *
 * 재는 것은 다섯이고, 전부 **조용히** 틀리는 종류다:
 *
 *   ① 창을 화면이 정하지 않는다 — 서버(`derive.MA_WINDOWS`)가 유일한 목록이다.
 *      두 곳에 적으면 「MA120」이 서로 다른 수를 가리키는 날이 온다.
 *   ② MA 는 **점에 얹혀** 다닌다. 이 파일은 점 배열을 두 번 자르는데(구간 알약
 *      → 확대), MA 를 따로 들고 있으면 그 두 자르기를 두 번째 자리에서 흉내내야
 *      하고 언젠가 한쪽만 고쳐진다. 그러면 다른 날의 평균이 이 날 옆에 그려진다.
 *   ③ 색은 **CDS 시맨틱 토큰**에서만 온다. hex 를 박으면 다크에서 안 따라간다
 *      (실측 2026-08-26: accentBoldGray 가 light rgb(50,53,61) → dark
 *      rgb(193,198,207)). 이 제품에는 이미 뜻을 가진 색이 넷 있어(방향 둘·
 *      기준선 둘) 겹치는 선택지에는 경고를 단다 — 막지는 않는다.
 *   ④ 껏다 켰다 — 취향은 `state/overlays.ts` 한 곳이고 차트와 Setting 이 같이
 *      읽는다. MA 다섯과 **기준선 둘**이 같은 저장소·같은 칩 문법을 쓴다.
 *   ⑤ 색이 생겨도 잉크 위계는 남는다 — 주선이 주인공이다.
 */

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const pane = read('src/ui/PreviewPane.tsx');
const store = read('src/state/overlays.ts');
const derive = read('backend/app/derive.py');

/** 주석을 뺀 소스 — 이 리포의 주석에는 실측한 hex 가 **근거로** 적혀 있다. */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('① 창은 서버가 정한다', () => {
  it('백엔드 목록은 벤더 표준이다 — 5·10·20·60·120', () => {
    expect(derive).toMatch(/MA_WINDOWS: tuple\[int, \.\.\.\] = \(5, 10, 20, 60, 120\)/);
  });

  it('프런트는 창 목록을 **자기가 적지 않는다**', () => {
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
    expect(pane).not.toMatch(/ma[A-Za-z]*\.slice\(-/);
    expect(pane).not.toMatch(/sliceRange\([^)]*ma/i);
  });

  it('워밍업 구간을 잇지 않는다 — 없던 평균을 직선으로 메우면 안 된다', () => {
    const maLine = pane.slice(pane.indexOf('{maWindows.map((w, k) =>'));
    expect(maLine.slice(0, 500)).toMatch(/connectNulls=\{false\}/);
  });
});

describe('③ 색은 CDS 토큰에서만 온다 [OWNER 2026-08-26]', () => {
  it('고를 수 있는 색이 전부 CDS 시맨틱 토큰이다', () => {
    const list = store.slice(store.indexOf('MA_COLOR_TOKENS = ['), store.indexOf('] as const'));
    const tokens = [...list.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(tokens.length).toBeGreaterThanOrEqual(5);
    for (const tk of tokens) expect(tk).toMatch(/^accent(Bold|Subtle)[A-Z]/);
  });

  it('저장소에도 화면에도 hex 가 없다 — 있으면 다크에서 안 따라간다', () => {
    expect(codeOf(store)).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(codeOf(read('src/ui/SettingView.tsx'))).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('차트는 토큰을 **변수 참조**로 넘긴다 — CDS `Line` 은 SVG 속성이라 이름은 못 읽는다', () => {
    expect(store).toMatch(/`var\(--color-\$\{t\}\)`/);
    expect(pane).toMatch(/color: maColorVar\(maColorOf\(prefs, w\)\)/);
  });

  it('**기본으로 켜 두는 이동평균이 없다** [OWNER 2026-08-26]', () => {
    /* "기본값이라는게 없어야 함". 지표는 부르는 사람이 부를 때 뜬다 — 안 부른
       선이 차트에 있으면 그것도 데이터인 줄 읽는다. 그래서 이 시험은 «어느 창을
       켜 두는가» 가 아니라 «하나도 안 켠다» 를 잰다. */
    expect(store).toMatch(/shown: \[\],/);
  });

  it('꺼 둔 창도 **색은 배정돼 있다** — 켜는 순간 제 색으로 선다', () => {
    const from = store.indexOf('colors: {');
    const colors = store.slice(from, store.indexOf('};', from));
    for (const w of [5, 10, 20, 60, 120]) {
      expect(colors).toMatch(new RegExp(String(w) + ": 'accentBold[A-Za-z]+'"));
    }
  });

  it('겹치는 색에는 경고 문장이 붙는다 — 막지는 않는다', () => {
    const from = store.indexOf('MA_COLOR_WARNING');
    const warn = store.slice(from, store.indexOf('};', from));
    for (const tk of ['accentBoldRed', 'accentBoldBlue', 'accentBoldPurple', 'accentBoldYellow']) {
      expect(warn).toContain(tk);
    }
  });
});

describe('④ 껏다 켰다 [OWNER 2026-08-26]', () => {
  it('켠 창만 그린다 — 끈 창은 시리즈도 선도 안 만든다', () => {
    expect(pane).toMatch(/prefs\.shown\.includes\(w\)/);
  });

  it('켠 것을 거를 때도 **서버 목록의 첨자**를 쓴다', () => {
    /* `pt.ma` 가 서버 목록 순서라, 걸러진 배열의 첨자를 쓰면 다른 창의 평균을
       그린다. 그래서 순회는 `maWindows` 위에서 돌고 걸러내기만 안쪽에서 한다. */
    expect(pane).toMatch(/maWindows\.flatMap\(\(w, k\) =>/);
    expect(pane).not.toMatch(/maShown\.map\(\(w, k\)/);
  });

  it('범례가 손잡이다 — 켠 상태가 칩에 실린다', () => {
    expect(pane).toMatch(/onClick=\{\(\) => ov\.toggle\(w\)\}/);
    /* 9.16 에서 `invertColorScheme` 이 deprecate 되고 `active` 가 캐논이 됐다
       (제거 예정 v11). 9.22 승급과 함께 개명했다. */
    expect(pane).toMatch(/active=\{on\}/);
    expect(pane).not.toMatch(/invertColorScheme/);
  });

  it('취향은 `state/overlays.ts` 한 곳이다 — Setting 과 차트가 같은 저장소를 읽는다', () => {
    expect(pane).toMatch(/useOverlayPrefs\(\)/);
    expect(read('src/ui/SettingView.tsx')).toMatch(/useOverlayPrefs\(\)/);
    expect(store).toMatch(/const KEY = 'sr-overlays'/);
  });

  it('리드아웃도 **켠 것만** 적는다 — 없는 선의 값을 읽지 않는다', () => {
    const card = pane.slice(pane.indexOf('<ReadoutCard title={hoverPoint.t}>'));
    const block = card.slice(0, card.indexOf('</ReadoutCard>'));
    expect(block).toMatch(/prefs\.shown\.includes\(w\)/);
    expect(block).toMatch(/v=\{hoverPoint\.ma\?\.\[k\]\}/);
  });
});

describe('⑤ 잉크 위계는 색이 생겨도 남는다', () => {
  it('무게 사다리는 창이 길수록 무겁다', () => {
    const raw = pane.slice(pane.indexOf('const MA_INK'), pane.indexOf('/** 시리즈 id'));
    const widths = [...raw.matchAll(/width: ([\d.]+)/g)].map((m) => Number(m[1]));
    const ops = [...raw.matchAll(/opacity: ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(5);
    for (let i = 1; i < 5; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
      expect(ops[i]).toBeGreaterThan(ops[i - 1]);
    }
    /* 가장 무거운 MA 도 종목 선(2px·불투명)보다 가볍다 — 주선이 주인공이다.
       실측(2026-08-26 라이브 SVG): 종목 stroke-width 2 / opacity 1. */
    expect(widths[4]).toBeLessThan(2);
    expect(ops[4]).toBeLessThan(1);
  });

  it('스크러버는 MA 를 안 짚는다 — 값은 리드아웃이 진다', () => {
    const scrub = pane.slice(pane.indexOf('<Scrubber'), pane.indexOf('</CartesianChart>'));
    expect(scrub).not.toMatch(/maSeriesId|maWindows/);
  });

  it('MA 는 종목 선 **앞**에 그려진다 — SVG 는 나중 것이 위다', () => {
    const maAt = pane.indexOf('{maWindows.map((w, k) =>');
    const mainAt = pane.indexOf('seriesId={row.id}');
    expect(maAt).toBeGreaterThan(-1);
    expect(mainAt).toBeGreaterThan(maAt);
  });
});

describe('⑥ 기준선도 껏다 켰다 [OWNER 2026-08-26]', () => {
  it('있음과 그림이 갈려 있다 — `refs` 는 값이 있는가, `drawn` 은 켜져 있는가', () => {
    /* 없는 기준선은 **끌 수도 없어야** 한다(칩이 안 선다). 그래서 범례는 `refs`
       를 보고, 시리즈·스크러버·리드아웃·보조축은 `drawn` 을 본다. */
    expect(pane).toMatch(/const drawn = useMemo\(/);
    expect(pane).toMatch(/cd: prefs\.refs\.cd \? refs\.cd : null/);
    expect(pane).toMatch(/policy: prefs\.refs\.policy \? refs\.policy : null/);
  });

  it('그리는 자리는 전부 `drawn` 을 읽는다 — 하나라도 `refs` 면 끈 선이 남는다', () => {
    for (const re of [
      /id: CD_LINE, data: drawn\.cd/,
      /id: BASE_LINE, data: drawn\.policy/,
      /\.\.\.\(drawn\?\.cd \? \[CD_LINE\] : \[\]\)/,
      /\.\.\.\(drawn\?\.policy \? \[BASE_LINE\] : \[\]\)/,
      /v=\{drawn\.cd\[hoverPoint\.i\]\}/,
    ]) {
      expect(pane).toMatch(re);
    }
  });

  it('둘 다 끄면 보조 %축도 내려간다 — 빈 축은 폭만 먹고 아무 말도 안 한다', () => {
    expect(pane).toMatch(/const pctAxis = !!\(drawn && \(drawn\.cd \|\| drawn\.policy\)\)/);
  });

  it('칩은 **값이 있을 때만** 선다', () => {
    const legend = pane.slice(pane.indexOf('{refs?.cd ? ('));
    expect(legend.slice(0, 200)).toMatch(/<RefChip/);
  });

  it('기준선 색은 **고르는 대상이 아니다** — 저장소에 색 항목이 없다', () => {
    /* 두 색은 오너가 3차까지 보고 확정한 값이다(`direction.css`). MA 와 다른
       점이 그 하나이고, 저장소의 `refs` 가 boolean 둘인 것이 그 사실이다. */
    expect(store).toMatch(/refs: \{ cd: boolean; policy: boolean \}/);
    expect(store).not.toMatch(/refColors|refs:\s*\{[^}]*Token/);
  });
});
