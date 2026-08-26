import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 캔버스 차트의 **색 다리** [2026-08-26 — 라이트웨이트 이관].
 *
 * ── 왜 이 가드가 따로 필요한가 ─────────────────────────────────────────────
 * `color-source.test.ts` 는 «hex 는 direction.css 에만» 을 잰다. 그 가드는
 * 이 이관에 **눈이 없다**: 캔버스에 넘기는 색은 `'rgb(9, 133, 81)'` 같은
 * **문자열**이라 hex 검사를 그냥 통과하고, 그리고 나서 조용히 틀린다.
 *
 * 실측 판례가 이 리포 안에 있었다 — 종전 하니스 `CandidateB.tsx` 가 마운트할
 * 때 색을 한 번 읽어 옵션에 박아 뒀고, **다크로 토글해도 차트만 라이트로
 * 남았다**. 에러도 경고도 없다.
 *
 * 그래서 여기서 재는 것은 «hex 를 안 썼는가» 가 아니라 **«색을 언제 읽는가»**다.
 *
 * 라이브 실측(2026-08-26, dev :3200, /chart 벤치, 캔버스 픽셀 직접 샘플):
 *
 *     다크    --sr-up  #e86c76   캔버스 rgb(233,107,119)   일치
 *     라이트  --sr-up  #de2b39   캔버스 rgb(223, 42, 57)   일치
 *
 * 두 번 다 **재마운트 없이** 바뀌었다.
 */

const CHART = path.resolve(import.meta.dirname, '../src/chart');
const read = (f: string) => fs.readFileSync(path.join(CHART, f), 'utf8');
/** 주석을 걷은 판 — 이 파일들의 주석에는 «왜 안 하는가» 를 적느라 금지어가
 *  그대로 들어 있다. 그걸 세면 근거를 적을수록 빨개진다. */
const codeOf = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('① 색은 스킴이 바뀔 때마다 다시 읽는다', () => {
  const palette = read('palette.ts');

  it('`useLwPalette` 의 의존성에 스킴이 들어 있다', () => {
    /* 이 한 줄이 빠지면 마운트 때 읽은 색이 영원히 남는다 — 그 고장이다. */
    expect(codeOf(palette)).toMatch(/useEffect\([\s\S]*?\}, \[el, scheme\]\)/);
  });

  it('스킴을 앱의 단일 출처에서 받는다 — 미디어쿼리를 따로 안 읽는다', () => {
    expect(palette).toMatch(/useScheme/);
    /* `matchMedia('(prefers-color-scheme')` 로 따로 읽으면 사용자가 고른 값
       (localStorage)이 아니라 OS 설정을 따라가 앱과 차트가 갈린다. */
    expect(codeOf(palette)).not.toMatch(/matchMedia/);
  });
});

describe('② 읽는 대상은 차트가 실제로 선 엘리먼트다', () => {
  const palette = read('palette.ts');

  it('`getComputedStyle` 에 그 엘리먼트를 넘긴다', () => {
    expect(codeOf(palette)).toMatch(/getComputedStyle\(el\)/);
  });

  it('`documentElement`·`document.body` 에서 읽지 않는다', () => {
    /* CDS `ThemeProvider` 는 팔레트를 루트가 아니라 자기 래퍼의 **인라인
       스타일**로 뿌린다. 루트에서 읽으면 전부 빈 문자열이 온다. */
    expect(codeOf(palette)).not.toMatch(/documentElement|document\.body/);
  });
});

describe('③ 색을 지어내지 않는다', () => {
  const palette = read('palette.ts');

  it('폴백은 **그 엘리먼트의 글자색**이다 — 상수 색을 안 적는다', () => {
    /* 색 리터럴은 `direction.css` 한 곳에만 산다(`color-source.test.ts`).
       `cs.color` 는 계산값이라 언제나 있고, 토큰이 빠지면 전부 한 색으로
       그려져 **틀린 것이 눈에 띈다**. */
    expect(codeOf(palette)).toMatch(/const fallback = cs\.color/);
    expect(codeOf(palette)).toMatch(/\|\| fallback/);
  });

  it('차트 층 어디에도 hex 색 리터럴이 없다', () => {
    const bad: string[] = [];
    for (const f of fs.readdirSync(CHART)) {
      if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
      const code = codeOf(read(f));
      /* 폴백 회색 하나만 예외다(위 테스트가 그 값을 못 박는다). */
      const stripped = code.replace(/rgb\(138,145,158\)/g, '');
      if (/#[0-9a-fA-F]{3,8}\b/.test(stripped)) bad.push(f);
      if (/rgba?\(/.test(stripped)) bad.push(f);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

describe('④ 캐논 룩은 한 곳에서만 정의된다', () => {
  const hook = read('useLwChart.ts');

  it('`canonOptions` 가 팔레트에서 색을 받는다 — 제 색을 안 만든다', () => {
    expect(hook).toMatch(/export function canonOptions\(p: LwPalette\)/);
    for (const field of ['p.fgMuted', 'p.fontFamily', 'p.line']) {
      expect(hook).toContain(field);
    }
  });

  it('격자 없음·세로축 오른쪽 — 캐논 그대로다', () => {
    expect(hook).toMatch(/vertLines: \{ visible: false \}/);
    expect(hook).toMatch(/horzLines: \{ visible: false \}/);
    expect(hook).toMatch(/rightPriceScale: \{[\s\S]*?visible: true/);
    expect(hook).toMatch(/leftPriceScale: \{ visible: false \}/);
  });

  it('구간은 이 제품이 정한다 — 라이브러리 스크롤·줌을 끈다', () => {
    expect(hook).toMatch(/handleScroll: false/);
    expect(hook).toMatch(/handleScale: false/);
  });

  it('라이브러리 로고를 안 그린다', () => {
    expect(hook).toMatch(/attributionLogo: false/);
  });

  it('글자체를 넘긴다 — 안 넘기면 그 축만 라이브러리 기본 글자가 된다', () => {
    expect(hook).toMatch(/fontFamily: p\.fontFamily/);
  });
});

describe('⑤ 스킴이 바뀌어도 차트를 다시 만들지 않는다', () => {
  const hook = read('useLwChart.ts');

  it('생성 효과의 의존성에 팔레트가 없다', () => {
    /* 있으면 토글마다 시리즈·프리미티브가 날아가고 화면이 깜빡인다. */
    const create = /createYieldCurveChart[\s\S]*?\}, \[([^\]]*)\]\)/.exec(hook);
    expect(create).not.toBeNull();
    expect(create![1]).not.toMatch(/palette/);
    expect(create![1]).toMatch(/el, kind/);
  });

  it('팔레트가 바뀌면 **옵션만** 덧입힌다', () => {
    expect(hook).toMatch(/chart\.applyOptions\(canonOptions\(palette\)\)/);
  });

  it('차트를 지울 때 `remove()` 를 부른다 — 캔버스는 GC 가 안 걷어간다', () => {
    expect(hook).toMatch(/made\.remove\(\)/);
  });
});

describe('⑥ 점무늬 면은 선 아래에 그려진다', () => {
  const area = read('dottedArea.ts');

  it('`zOrder` 가 `bottom` 이다 — `normal` 이면 주선을 덮는다', () => {
    expect(area).toMatch(/zOrder: \(\): PrimitivePaneViewZOrder => 'bottom'/);
  });

  it('화면 밖 점은 건너뛴다 — 0 으로 두면 면이 좌상단으로 무너진다', () => {
    expect(codeOf(area)).toMatch(/if \(xm == null \|\| ym == null\) continue/);
  });

  it('밑변은 패널 바닥이다 — 0 선이면 금리 축에서 면이 사라진다', () => {
    expect(codeOf(area)).toMatch(/const floor = scope\.bitmapSize\.height/);
  });

  it('타일을 캐시한다 — 매 프레임 캔버스를 만들면 스크러버에서 GC 가 튄다', () => {
    expect(codeOf(area)).toMatch(/PATTERN\.set\(key, made\)/);
  });

  it('색을 아직 안 줬으면 **안 그린다** — 기본색을 지어내지 않는다', () => {
    expect(codeOf(area)).toMatch(/private color: string \| null = null/);
    expect(codeOf(area)).toMatch(/!this\.color/);
  });
});
