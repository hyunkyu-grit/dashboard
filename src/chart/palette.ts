'use client';

/* 캔버스에 넘길 색 — **산 DOM 에서 읽는다** [2026-08-26 라이트웨이트 이관].
 *
 * ── 왜 이 파일이 있는가 ──────────────────────────────────────────────────────
 * CDS `CartesianChart` 는 SVG 라 `stroke="var(--sr-up)"` 한 줄이면 끝이었다.
 * `lightweight-charts` 는 **캔버스**다 — `strokeStyle` 에 넣을 **문자열**을
 * 달라고 하고, 캔버스는 `var(...)` 를 못 푼다. 그래서 토큰과 캔버스 사이에
 * 다리가 필요하다.
 *
 * ── 실측 판례: 이 다리를 잘못 놓으면 조용히 얼어붙는다 ──────────────────────
 * 하니스 `src/chart/CandidateB.tsx` 가 마운트할 때 색을 한 번 읽어 옵션에
 * 박아 뒀다. 그래서 **다크로 토글해도 차트만 라이트 색으로 남았다**. 에러는
 * 없다 — 캔버스는 시킨 색을 그릴 뿐이다. 이 리포가 `guards/color-source.test.ts`
 * 로 «hex 는 direction.css 에만» 을 지켜 온 이유가 그 종류의 침묵이고,
 * 캔버스는 그 가드의 사각지대다(그릴 때 색이 문자열이라 grep 으로는 멀쩡하다).
 *
 * 그래서 규칙 둘:
 *   ① **읽는 시점**은 마운트가 아니라 **스킴이 바뀔 때마다**다(`useLwPalette`).
 *   ② **읽는 대상**은 `document.documentElement` 가 아니라 **차트가 실제로 선
 *      그 엘리먼트**다. CDS `ThemeProvider` 는 팔레트를 루트가 아니라 자기
 *      래퍼의 **인라인 스타일**로 뿌리므로(그 사실은 providers.tsx 주석에도
 *      적혀 있다), 루트에서 읽으면 빈 문자열이 나온다. 컨테이너에서 읽으면
 *      상속으로 전부 보인다 — `--color-*`(CDS)도 `--sr-*`(direction.css)도.
 *
 * ── 변환하지 않는다 ─────────────────────────────────────────────────────────
 * `getPropertyValue` 는 `rgb(9, 133, 81)` 이나 `#0a0b0d` 를 준다. 캔버스의
 * `strokeStyle`·`fillStyle`·`createLinearGradient` 는 그 둘을 그대로 받는다.
 * 그래서 hex 파싱을 **안 한다** — 파싱하는 순간 이 파일이 색을 «만드는» 것이
 * 되고, 그건 규칙 3(hex 는 direction.css 에만)을 캔버스로 우회하는 것이다.
 */

import { useEffect, useState } from 'react';

import { useScheme } from '@/app/providers';

/** 이 앱이 캔버스에 넘기는 색 전부. 늘리려면 여기 한 줄을 더한다 —
 *  그 한 줄이 «그 변수 이름이 정말 있는지 확인했다» 는 뜻이다
 *  (`guards/css-token-names.test.ts` 와 같은 규율). */
export type LwPalette = {
  /** 글자·눈금 */
  fg: string;
  fgMuted: string;
  /** 바탕(투명으로 두면 캔버스가 검게 나온다 — 아래 `background` 참조) */
  bg: string;
  /** 격자·테두리 */
  line: string;
  lineHeavy: string;
  /** 방향 쌍 — 주선이 쓴다 */
  up: string;
  down: string;
  /** 기준선 넷 */
  refCd: string;
  refPolicy: string;
  refFut: string;
  refRoll: string;
  /** 축 글자체. 캔버스는 `font-family` 도 상속을 못 받는다 — 안 주면
   *  라이브러리 기본(Trebuchet MS)이 나와 화면에서 그 축만 다른 글자가 된다. */
  fontFamily: string;
  /** `fgMuted` 를 반쯤 지운 것. 커브의 **전일 선**이 쓴다 — CDS 판이
   *  `color=fgMuted` 에 `strokeOpacity={0.5}` 를 겹쳐 쓰던 그 색이다.
   *  캔버스에는 불투명도 손잡이가 따로 없어 색 자체가 반투명이어야 한다. */
  fgMutedSoft: string;
};

/** 읽을 변수 이름 ↔ 결과 키. 이름을 틀리면 빈 문자열이 나오고 캔버스는
 *  **검게** 그린다 — CSS 라면 선언이 무효가 되어 안 그려질 뿐이지만
 *  캔버스에서는 틀린 색이 **그려진다**. 그래서 아래 `readPalette` 가
 *  빈 값을 잡아 `fallback` 으로 떨어뜨린다. */
const VARS: Record<keyof LwPalette, string> = {
  fg: '--color-fg',
  fgMuted: '--color-fgMuted',
  bg: '--color-bg',
  line: '--color-bgLine',
  lineHeavy: '--color-bgLineHeavy',
  up: '--sr-up',
  down: '--sr-down',
  refCd: '--sr-ref-cd',
  refPolicy: '--sr-ref-policy',
  refFut: '--sr-ref-fut',
  refRoll: '--sr-ref-roll',
  /* 아래 둘은 변수 하나로 안 떨어진다 — `readPalette` 가 따로 만든다. */
  fontFamily: '',
  fgMutedSoft: '',
};

/**
 * 색을 반투명하게 — **계산은 브라우저가 한다.**
 *
 * 직접 섞으려면 `rgb(...)`/`#hex` 를 파싱해 알파를 붙여야 하고, 그 순간 이
 * 파일이 색을 «만드는» 것이 되어 «색 리터럴은 direction.css 한 곳» 규칙을
 * 캔버스로 우회하게 된다. 대신 문서 안에 잠깐 프로브를 세워 `color-mix` 를
 * 시키고 계산값(`rgba(...)`)을 받아 온다. 우리 코드에는 색 산술이 없다.
 */
function soften(host: Element, color: string, percent: number): string {
  const probe = document.createElement('span');
  probe.style.color = `color-mix(in srgb, ${color} ${percent}%, transparent)`;
  probe.style.display = 'none';
  host.appendChild(probe);
  const out = getComputedStyle(probe).color;
  host.removeChild(probe);
  return out || color;
}

/** 그 엘리먼트가 상속받은 계산값으로 팔레트를 읽는다.
 *
 * ── 못 읽었을 때 ────────────────────────────────────────────────────────────
 * 폴백은 **그 엘리먼트의 글자색**(`cs.color`)이다. 회색 하나를 여기 적어 두는
 * 판을 먼저 썼는데 `guards/color-source.test.ts` 가 잡았고, 그게 옳다 — 이
 * 리포의 색 리터럴은 `direction.css` 한 곳에만 산다. 그리고 규칙을 지키는 쪽이
 * 실제로 더 낫다:
 *
 *   · `cs.color` 는 **언제나 있다**(계산값이라 상속으로라도 채워진다).
 *   · 테마를 따라간다 — 회색 상수와 달리 다크에서도 읽힌다.
 *   · 그런데 **틀린 것이 눈에 띈다**: 토큰이 빠지면 주선·기준선·면이 전부
 *     글자색 한 가지로 그려져 «색이 죽었다» 는 사실이 화면에 그대로 보인다.
 *     그럴듯한 색을 넣으면 다리가 끊어진 줄 아무도 모른다.
 */
export function readPalette(el: Element): LwPalette {
  const cs = getComputedStyle(el);
  const fallback = cs.color;
  const out = {} as LwPalette;
  for (const key of Object.keys(VARS) as (keyof LwPalette)[]) {
    const v = cs.getPropertyValue(VARS[key]).trim();
    out[key] = v || fallback;
  }
  /* 변수가 아니라 **계산된 상속값**이다 — `--sr-font-sans` 를 읽으면 폴백
     사슬의 원문이 오지만, `font-family` 를 읽으면 이 엘리먼트가 실제로 쓰는
     사슬이 온다. 캔버스에 넘길 것은 후자다. */
  out.fontFamily = cs.fontFamily || 'sans-serif';
  out.fgMutedSoft = soften(el, out.fgMuted, 50);
  return out;
}

/**
 * 차트가 선 엘리먼트의 팔레트. **스킴이 바뀌면 다시 읽는다.**
 *
 * `el` 이 아직 `null` 인 첫 렌더에서는 `null` 을 준다 — 그때 그리면 안 된다는
 * 뜻이고, 호출부는 그 사실로 마운트를 미룬다(색 없이 그린 프레임이 한 장
 * 스치는 것보다 낫다).
 */
export function useLwPalette(el: Element | null): LwPalette | null {
  const { scheme } = useScheme();
  const [palette, setPalette] = useState<LwPalette | null>(null);

  useEffect(() => {
    if (!el) return;
    /* 효과는 DOM 갱신 **뒤에** 돈다 — CDS 가 인라인 변수를 새 스킴으로 바꾼
       다음이라 여기서 읽은 값이 곧 화면의 값이다. */
    setPalette(readPalette(el));
  }, [el, scheme]);

  return palette;
}
