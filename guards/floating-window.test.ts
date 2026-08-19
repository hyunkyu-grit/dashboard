import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  clampWindowPos,
  defaultWindowPos,
  forgetWindowPos,
  initialWindowPos,
  rememberWindowPos,
  WINDOW_HEADER_H,
  WINDOW_W,
} from '../src/ui/window/geometry';
import {
  isTopLayer,
  layerDepth,
  popLayer,
  pushLayer,
  resetLayers,
} from '../src/ui/window/escapeStack';

/**
 * 떠 있는 창의 기구 (레인 3) — **되돌릴 수 없는 상태**를 만들지 않는지.
 *
 * 이 파일이 지키는 것은 편의가 아니라 회복 가능성이다. 창은 헤더로만 끌리므로
 * 헤더가 화면 밖으로 나가면 그 창은 **다시 끌어올 방법이 없다** — 리로드 말고는.
 * 겹도 같다: Esc 가 두 겹을 한 번에 닫으면 작업하던 것까지 잃고, 안쪽이 이벤트를
 * 삼키면 바깥은 영영 못 닫는다.
 */

const VIEW = { w: 1920, h: 1080 };

describe('클램프 — 손잡이는 화면을 못 벗어난다', () => {
  it('오른쪽으로 밀어도 창이 통째로 안쪽에 남는다', () => {
    const p = clampWindowPos({ left: 5000, top: 100 }, VIEW);
    expect(p.left).toBe(VIEW.w - WINDOW_W);
  });

  it('왼쪽·위로 밀어도 0 밑으로 안 간다', () => {
    expect(clampWindowPos({ left: -500, top: -500 }, VIEW)).toEqual({ left: 0, top: 0 });
  });

  it('아래로 밀면 **헤더 높이만큼**은 남는다 — 본문은 접혀 나가도 된다', () => {
    const p = clampWindowPos({ left: 0, top: 99999 }, VIEW);
    expect(p.top).toBe(VIEW.h - WINDOW_HEADER_H);
    // 이 한 줄이 이 파일의 이유다: 이 값이 뷰포트 높이가 되면 손잡이가 사라진다.
    expect(p.top + WINDOW_HEADER_H).toBeLessThanOrEqual(VIEW.h);
  });

  it('뷰포트가 창보다 좁으면 왼쪽에 앵커된다 — 음수로 밀지 않는다', () => {
    const narrow = { w: 600, h: 800 };
    expect(clampWindowPos({ left: 300, top: 10 }, narrow).left).toBe(0);
  });

  it('기본 자리는 가로 가운데, 위쪽', () => {
    const d = defaultWindowPos(VIEW);
    expect(d.left).toBe(Math.round((VIEW.w - WINDOW_W) / 2));
    expect(d.top).toBe(72);
  });
});

describe('자리 기억 — 창마다, 세션만', () => {
  beforeEach(() => forgetWindowPos());

  it('놓아둔 자리로 돌아온다', () => {
    rememberWindowPos({ left: 120, top: 200 }, 'chart');
    expect(initialWindowPos(VIEW, 'chart')).toEqual({ left: 120, top: 200 });
  });

  it('창마다 따로 기억한다 — 하나를 옮겨도 다른 창이 따라가지 않는다', () => {
    // v1 이 모듈 변수 하나로 두었다가 겪은 것: 두 번째 창이 생기자 첫 창의
    // 자리를 물려받아 열렸다.
    rememberWindowPos({ left: 120, top: 200 }, 'chart');
    expect(initialWindowPos(VIEW, 'backtest')).toEqual(defaultWindowPos(VIEW));
  });

  it('기억된 자리도 **다시 클램프**된다 — 그 사이 창을 줄였을 수 있다', () => {
    rememberWindowPos({ left: 1800, top: 1000 }, 'chart');
    const small = { w: 1280, h: 720 };
    const p = initialWindowPos(small, 'chart');
    expect(p.left).toBe(small.w - WINDOW_W);
    expect(p.top).toBe(small.h - WINDOW_HEADER_H);
  });

  it('localStorage 를 쓰지 않는다 — 다른 모니터의 자리는 못 찾는 창이 된다', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/ui/window/geometry.ts'),
      'utf8',
    );
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(body).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe('Esc 는 한 겹만', () => {
  beforeEach(() => resetLayers());

  it('맨 위 겹만 자기 차례라고 답한다', () => {
    pushLayer('window');
    pushLayer('dialog');
    expect(isTopLayer('dialog')).toBe(true);
    expect(isTopLayer('window')).toBe(false);
  });

  it('위엣 것이 닫히면 아래가 맨 위가 된다', () => {
    pushLayer('window');
    pushLayer('dialog');
    popLayer('dialog');
    expect(isTopLayer('window')).toBe(true);
    expect(layerDepth()).toBe(1);
  });

  it('가운데 겹이 ×로 닫혀도 스택이 깨지지 않는다', () => {
    // 창은 Esc 말고 닫기 버튼으로도 닫히고, 그때 순서는 지켜지지 않는다.
    pushLayer('a');
    pushLayer('b');
    pushLayer('c');
    popLayer('b');
    expect(layerDepth()).toBe(2);
    expect(isTopLayer('c')).toBe(true);
  });

  it('같은 겹을 다시 열면 두 개가 되지 않고 맨 위로 올라간다', () => {
    pushLayer('a');
    pushLayer('b');
    pushLayer('a');
    expect(layerDepth()).toBe(2);
    expect(isTopLayer('a')).toBe(true);
  });

  it('아무것도 안 열려 있으면 누구의 차례도 아니다', () => {
    expect(isTopLayer('a')).toBe(false);
  });
});

describe('창의 구조 규칙', () => {
  const ROOT = path.resolve(import.meta.dirname, '..');
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/window/FloatingWindow.tsx'), 'utf8');

  it('끌기 핸들러는 **헤더에만** 붙는다', () => {
    expect(src).toMatch(/className="sr-window-head"[\s\S]{0,120}\{\.\.\.dragHandlers\}/);
    // 본문에 붙으면 차트 위 드래그가 스크럽인지 이동인지 모호해진다
    expect(src).not.toMatch(/className="sr-window-body"[\s\S]{0,120}dragHandlers/);
  });

  it('닫기 버튼은 드래그를 시작시키지 않는다', () => {
    expect(src).toMatch(/sr-window-close[\s\S]{0,200}onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  });

  it('닫힘이 애니메이션에 의존하지 않는다', () => {
    /* 이 리포는 "안 닫히는 창" 을 두 번 겪었고 원인은 둘 다 exit 완료 보고를
     * 잃은 것이었다. 열림은 상태 하나이고 그 상태가 곧 DOM 이어야 한다.
     *
     * 주석을 먼저 걷는다 — 이 규칙을 **적어둔 문장**에 규칙이 걸려 이 리포에서
     * 벌써 세 번째로 빨갛게 됐다(`SCREENERS`, `toFixed`, 그리고 여기). */
    const strip = (t: string) =>
      t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(strip(src)).not.toMatch(/AnimatePresence|motion\./);
    const drawer = fs.readFileSync(path.join(ROOT, 'src/ui/window/WindowDrawer.tsx'), 'utf8');
    expect(strip(drawer)).not.toMatch(/AnimatePresence|motion\./);
  });

  it('창은 크롬 위, 모달 아래 — 층은 한 파일이 정한다', () => {
    expect(src).toMatch(/zIndex: Z_WINDOW/);
    const layers = fs.readFileSync(path.join(ROOT, 'src/ui/window/layers.ts'), 'utf8');
    const num = (name: string) =>
      Number(new RegExp(`${name} = (\\d+)`).exec(layers)?.[1] ?? NaN);
    expect(num('Z_CHROME')).toBeLessThan(num('Z_WINDOW'));
    expect(num('Z_WINDOW')).toBeLessThan(num('Z_MODAL'));
    expect(num('Z_NAV')).toBeLessThan(num('Z_WINDOW'));
  });
});

describe('서랍', () => {
  const drawer = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/ui/window/WindowDrawer.tsx'),
    'utf8',
  );

  it('기본은 접힘 — 대사는 매번 하는 일이 아니다', () => {
    expect(drawer).toMatch(/useState\(false\)/);
  });

  it('빈 탭도 **누를 수 있다** — 왜 비었는지는 열어야 읽힌다', () => {
    expect(drawer).not.toMatch(/disabled/);
    expect(drawer).toMatch(/unavailable/);
  });
});

describe('창은 화면 아래를 넘지 않는다 — 스크롤러는 하나 `[검증됨]` 2026-08-14', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', p), 'utf8');

  it('창 높이 상한이 **자기 자리**에서 계산된다', () => {
    /* 조각마다 상한을 둬도 합은 안 지켜진다: 머리 44 + 몸통 70vh + 서랍(탭 32 +
     * 몸통 38vh) = 108vh + 76px. 실측 2026-08-14: 백테스트에서 일별 대사를 펴자
     * 창이 1,014px 이 됐고 화면은 911 이었다 — 표의 아래 175px 이 화면 밖이고
     * 클램프가 top ≥ 0 이라 끌어올릴 수도 없었다. `top` 을 빼는 이유는 아래로
     * 끌어둔 창일수록 남는 높이가 적기 때문이다. */
    const src = read('src/ui/window/FloatingWindow.tsx');
    expect(src).toMatch(/maxHeight: `calc\(100vh - \$\{pos\.top\}px - 24px\)`/);
  });

  it('상한에 닿으면 **몸통이** 준다 — 서랍이 아니라', () => {
    // 서랍은 방금 사람이 편 것이다. 줄어야 하는 쪽은 이미 보고 있던 몸통이다.
    const css = read('src/theme/type.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const body = css.slice(css.indexOf('.sr-window-body {'));
    expect(body.slice(0, body.indexOf('}'))).toMatch(/min-height:\s*0/);
  });

  it('스크롤 사슬이 서랍 → 대사 스택까지 이어진다', () => {
    /* 사슬의 고리가 하나라도 블록이면 안쪽 스크롤러가 안 줄고 서랍 밖으로
     * 삐져나간다(실측: 서랍 219px 안에서 스택이 273px). 그러면 스크롤러가 둘이
     * 되고 — 그 순간 스택의 사방 고정 범례가 깨진다. */
    const css = read('src/theme/type.css').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.sr-drawer-body {', '.sr-recon-root {', '.sr-recon-scroll {']) {
      const block = css.slice(css.indexOf(sel));
      expect(block.slice(0, block.indexOf('}'))).toMatch(/min-height:\s*0/);
    }
  });
});

describe('화면은 뷰포트에 묶인다 — 재는 값이 되먹임을 안 만든다 `[검증됨]` 2026-08-14', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', p), 'utf8');

  it('페이지는 `height: 100vh` 다 — `minHeight` 가 아니다', () => {
    /* `minHeight` 로는 flex 가 나눌 **정해진** 높이가 없다. 재서 내려준 높이가
     * 내용을 키우고 그 내용이 다시 더 큰 측정값을 만드는 되먹임이 생긴다 —
     * 실측 2026-08-14: 오버뷰 카드가 1,214 화면에서 **2,106px** 까지 자랐다. */
    const src = read('src/app/page.tsx');
    expect(src).toMatch(/className="sr-page" height="100vh" overflow="hidden"/);
    expect(src).not.toMatch(/className="sr-page" minHeight="100vh"/);
  });

  it('높이 측정은 **콜백 ref** 다 — 늦게 생기는 요소를 잰다', () => {
    /* `useRef` + `useLayoutEffect([ref])` 는 한 번도 안 쟀다: 이 페이지는 데이터가
     * 오기 전에 마운트되므로 그때 카드가 없고(`ref.current` null), 카드가 나중에
     * 생겨도 의존성이 안 바뀌어 효과가 다시 안 돈다. */
    const body = read('src/ui/useFillHeight.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(body).toMatch(/useCallback\(\(node: HTMLElement \| null\)/);
    expect(body).not.toMatch(/useLayoutEffect|RefObject/);
  });

  it('`ResizeObserver` 만 믿지 않는다 — 즉시 한 번 잰다', () => {
    // 렌더링이 멈춘 탭에서는 관찰자 콜백이 한 번도 안 온다(rAF 와 같은 자리).
    const src = read('src/ui/useFillHeight.ts');
    expect(src).toMatch(/measure\(\);\n\n/);
    expect(src).toMatch(/new ResizeObserver\(measure\)/);
  });
});

describe('상단 내비 — 글자가 상자 가운데에 선다 `[검증됨]` 2026-08-14', () => {
  const css = () =>
    fs.readFileSync(path.resolve(import.meta.dirname, '../src/theme/type.css'), 'utf8');
  const block = (sel: string) => {
    const s = css().replace(/\/\*[\s\S]*?\*\//g, '');
    const i = s.indexOf(sel);
    return i < 0 ? '' : s.slice(i, s.indexOf('}', i));
  };

  it('내비 항목이 flex 로 가운데 정렬한다', () => {
    /* 없으면 안쪽 글자가 상자 위에 붙는다 — 버튼 40px 에 CDS 타이포 span 의
     * 줄상자가 24px 이라, 글자 중심이 상자 중심보다 **8px 위**로 간다.
     * 실측: 브랜드는 중심 32, 내비 항목은 24 였다.
     * 두 참조가 같은 방법이다 — Coinbase(44px, display:flex) 34==34,
     * 토스(36px, inline-flex+align-items:center) 26==26. */
    const b = block('.sr-navitem {');
    expect(b).toMatch(/display:\s*inline-flex/);
    expect(b).toMatch(/align-items:\s*center/);
  });

  it('화면 모드는 **아이콘 버튼**이지 라벨 알약이 아니다', () => {
    // 글리프 문자("☾")를 라벨과 같은 알약에 넣으면 시각 중심도 크기도 어긋난다.
    // 토스 실측: 32×32, radius 8, 옅은 틴트. CDS 에 `sun`/`moon` 아이콘이 있다.
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/ui/TopNav.tsx'),
      'utf8',
    );
    expect(src).toMatch(/className="sr-naviconbtn"/);
    expect(src).toMatch(/name=\{scheme === 'dark' \? 'sun' : 'moon'\}/);
    expect(src).not.toMatch(/'☀'|'☾'/);
  });

  it('메가 패널은 뒤를 **덮는다**', () => {
    /* 덮개가 없으면 패널이 "패널" 로 안 읽힌다 — 흰 시트 위 글자와 그 아래 표가
     * 같은 평면에 있는 것처럼 보인다. Coinbase 실측: `rgba(50,53,61,0.33)` 가
     * 바 아래 전체를 덮는다. 다크는 같은 값이 안 보여서 더 진한 검정을 쓴다. */
    expect(block('.sr-megascrim {')).toMatch(/position:\s*fixed/);
    expect(block('.sr-megascrim {')).toMatch(/background:\s*var\(--sr-scrim\)/);
    // 색 리터럴은 `direction.css` 에만 산다(`guards/color-source.test.ts`).
    const dir = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/theme/direction.css'),
      'utf8',
    );
    expect(dir).toMatch(/\[data-sr-scheme='dark'\] \{[^}]*--sr-scrim/);
  });

  it('패널 안쪽 줄은 `width: 100%` 다', () => {
    /* `.sr-mega` 는 CDS `Box` 이고 **CDS Box 는 기본이 `display: flex`**(§5.4 함정 1).
     * 그래서 안쪽 줄이 flex 아이템이 되어 내용만큼만 넓어졌다 — 실측: 패널 2,560 에
     * 안쪽 **631**. 오른쪽 설명 카드가 항목 바로 옆에 붙어 있었다. */
    expect(block('.sr-mega-inner {')).toMatch(/width:\s*100%/);
  });
});
