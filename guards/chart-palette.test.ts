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
      if (/#[0-9a-fA-F]{3,8}\b/.test(code)) bad.push(f);
      if (/rgba?\(/.test(code)) bad.push(f);
    }
    /* **예외가 없다.** 이 층은 색을 읽고 넘길 뿐 만들지 않는다 — 폴백은
       엘리먼트의 글자색이고(위), 라이브러리에 넘기는 것도 문자열이 아니라
       채널 넷이다(`pixelColorParser`). 판별용 씨앗은 `'black'`·`'white'` 라
       이름이지 리터럴이 아니다. */
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

  it('**눈금이 조용하다** — 밀도를 라이브러리 기본에 안 맡긴다', () => {
    /* 기본은 `2.5` 이고 작을수록 촘촘하다. 그냥 두면 560px 패널에 눈금이
       **11칸** 선다(실측 2026-08-26 라이브) — CDS 판은 같은 자리에 5칸이었고,
       축이 그림보다 눈에 띄면 읽는 사람이 선이 아니라 눈금을 읽는다
       [OWNER 2026-08-26 — "좀 개판된거 같은데"]. 4 에서 4~7칸이다. */
    expect(hook).toMatch(/tickMarkDensity: 4/);
  });

  it('**날짜는 ISO 다** — 라이브러리 기본 로케일 글자가 아니다', () => {
    /* 그냥 두면 「9월」·「2026년」 이 선다(실측). 이 제품의 날짜 어휘는 화면
       전체가 ISO 다 — 표 머리·신선도 칩·대사표·URL 인코딩, 그리고
       `ui/IsoDateField.tsx` 한 레인이 통째로 그 규칙이다. 차트만 다른 말을
       쓰면 안 된다. */
    expect(hook).toMatch(/tickMarkFormatter: isoTick/);
    expect(hook).toMatch(/function isoTick/);
    expect(codeOf(hook)).toMatch(/\$\{b\.year\}-\$\{p\(b\.month \?\? 1\)\}-\$\{p\(b\.day \?\? 1\)\}/);
  });
});

describe('④-2 라이브러리가 못 읽는 색은 파서가 받는다', () => {
  const palette = read('palette.ts');
  const hook = read('useLwChart.ts');

  it('색 파서를 라이브러리에 **등록**한다', () => {
    /* 없으면 `color-mix` 의 계산값(`color(srgb ...)`) 하나에 차트가 통째로
       던진다 — 2026-08-26 에 실제로 «이 종목의 차트를 그리지 못했어요» 가 떴다. */
    expect(palette).toMatch(/export const pixelColorParser: CustomColorParser/);
    expect(hook).toMatch(/colorParsers: \[pixelColorParser\]/);
  });

  it('파서는 **문자열이 아니라 채널**을 돌려준다 — 색을 만들지 않는다', () => {
    expect(codeOf(palette)).toMatch(/return \[r, g, b, a \/ 255\] as Rgba/);
  });

  it('픽셀을 칠해서 읽는다 — `fillStyle` getter 로는 안 된다', () => {
    /* 크롬은 `color(srgb ...)` 를 넣으면 **그대로 돌려준다**(실측). 그래서
       첫 수리가 안 먹었다. */
    expect(codeOf(palette)).toMatch(/getImageData\(0, 0, 1, 1\)/);
  });

  it('`colorParsers` 는 **생성 전용 함수**에만 있다', () => {
    /* `applyOptions` 로 바꾸면 라이브러리가 던진다 —
       «colorParsers option should not be changed once the chart has been created».
       그 문장이 그대로 에러 경계에 떴다(실측 2026-08-26). */
    expect(hook).toMatch(/export function creationOptions/);
    /* `canonOptions` 의 본문 = 그 선언부터 `creationOptions` 선언 전까지를
       **주석 걷은 판에서** 자른 것. 두 가지를 피한다 — 중괄호를 세는 정규식은
       주석 안 중괄호에 걸리고, 주석을 안 걷으면 `creationOptions` 의 머리
       주석(«왜 생성에만 넣는가» 를 설명하느라 그 낱말을 쓴다)이 딸려 온다. */
    const code = codeOf(hook);
    const from = code.indexOf('export function canonOptions');
    const to = code.indexOf('export function creationOptions');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(code.slice(from, to)).not.toMatch(/colorParsers/);
  });

  it('만들 때는 `creationOptions`, 다시 입힐 때는 `canonOptions` 다', () => {
    /* 생성 옵션에 «만들 때만 읽히는 것» 이 하나 더 얹혀서(`uniformDistribution`
       — 그것도 생성자 전용이다) 받는 이름이 `base` 로 바뀌었다 [2026-08-27].
       재는 것은 **어느 함수를 부르는가** 이지 지역 변수의 이름이 아니다. */
    expect(hook).toMatch(/creationOptions\(p\)/);
    expect(hook).toMatch(/chart\.applyOptions\(canonOptions\(palette\)\)/);
  });
});

describe('⑤ 스킴이 바뀌어도 차트를 다시 만들지 않는다', () => {
  const hook = read('useLwChart.ts');

  it('생성 효과의 의존성에 팔레트가 없다', () => {
    /* 있으면 토글마다 시리즈·프리미티브가 날아가고 화면이 깜빡인다.
       **주석을 걷고 잰다** — 안 걷으면 이 파일의 이력 주석(«처음에는
       createYieldCurveChart 를 썼다»)에 걸려 가드가 **우연히** 통과한다.
       2026-08-26 에 실제로 그랬다. */
    const code = codeOf(hook);
    const create = /createChartEx[\s\S]*?\}, \[([^\]]*)\]\)/.exec(code);
    expect(create).not.toBeNull();
    expect(create![1]).not.toMatch(/palette/);
    /* `uniform` 이 2026-08-27 에 들어왔다 — 생성자 전용 옵션이라 값이 바뀌면
       차트를 정말 다시 만들어야 한다(만기축 대 숫자축). 그래서 이 목록에 있는
       것이 맞다. 재는 것은 **팔레트가 없다**는 것 하나다. */
    expect(create![1]).toMatch(/el, kind, scale, uniform, ready/);
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
