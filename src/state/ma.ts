'use client';

/* 이동평균 취향 — Setting 이 정하고 차트가 읽는다
 * [OWNER, 2026-08-26 — "당연히 껏다 켰다 가능하게 … 색도 회색이 아니라
 * 컬러토큰에서 가져와서 배정해주고 OR 내가 색상 지정할 수 있게"].
 *
 * `state/funding.ts` 와 **같은 기계**다(useSyncExternalStore + localStorage +
 * 모듈 리스너). 좌표가 아니라 취향이고 어느 화면에서도 같은 뜻이라 저장 매체도
 * 같다 — 새 관례를 만들지 않는다.
 *
 * ── 창은 여기 없다 ─────────────────────────────────────────────────────────
 * 5·10·20·60·120 은 **서버가 정한다**(`backend/app/derive.py::MA_WINDOWS`,
 * 키움 HTS 공장 기본값). 이 파일은 «그 창을 보여줄까» 와 «무슨 색으로» 만
 * 기억한다. 창 목록을 여기 적으면 「MA120」이 두 수를 가리키는 날이 온다.
 */

import { useSyncExternalStore } from 'react';

/**
 * 고를 수 있는 색 — **CDS 시맨틱 토큰만**이다 [OWNER: "컬러토큰에서"].
 * hex 를 여기 적으면 `guards/color-source.test.ts` 가 잡고, 무엇보다 다크에서
 * 안 따라간다. 토큰은 `ThemeProvider` 가 테마마다 다시 칠해 준다.
 *
 * ── 왜 여섯이고 왜 이 순서인가 (실측 2026-08-26, light) ────────────────────
 * 이 제품에는 이미 뜻을 가진 색이 넷 있다. 겹치면 화면이 한 색으로 두 말을 한다:
 *
 *     accentBoldRed    #CF202F  ~ `--sr-up`         #de2b39  (상승)
 *     accentBoldBlue   #0052FF  ~ `--sr-down`       #2171eb  (하락)
 *     accentBoldPurple #5A30AD  ~ `--sr-ref-policy` #7c3aed  (기준금리)
 *     accentBoldYellow #F7D21A  — 흰 배경 대비 ~1.5:1, WCAG 1.4.11(3:1) 미달
 *
 * 남는 것은 **초록과 진회색 둘**이다. 그래서 기본으로 켜 두는 둘이 그 둘을
 * 가져간다. 나머지 셋도 고를 수 있다 — 겹치는 색을 쓸지는 읽는 사람이 정할
 * 일이지, 목록에서 지워 버릴 일이 아니다.
 */
export const MA_COLOR_TOKENS = [
  'accentBoldGreen',
  'accentBoldGray',
  'accentBoldPurple',
  'accentBoldRed',
  'accentBoldBlue',
  'accentBoldYellow',
] as const;

export type MaColorToken = (typeof MA_COLOR_TOKENS)[number];

/** 화면에 적을 이름. 토큰 이름을 그대로 보여주면 읽는 사람이 색을 못 고른다. */
export const MA_COLOR_LABEL: Record<MaColorToken, string> = {
  accentBoldGreen: '초록',
  accentBoldGray: '진회색',
  accentBoldPurple: '보라',
  accentBoldRed: '빨강',
  accentBoldBlue: '파랑',
  accentBoldYellow: '노랑',
};

/** 토큰 -> 차트가 먹는 CSS 값. CDS `Line` 은 색을 SVG 속성으로 그대로 넘기므로
 *  토큰 이름이 아니라 변수 참조가 필요하다(`--color-<token>` 은 ThemeProvider
 *  가 뿌린다 — 실측: `div.sauron-v2.light` 에 선언돼 있다). */
export const maColorVar = (t: MaColorToken) => `var(--color-${t})`;

/** 겹치는 뜻이 있는 색 — 화면이 고를 때 그 사실을 **말해 준다**(막지는 않는다). */
export const MA_COLOR_WARNING: Partial<Record<MaColorToken, string>> = {
  accentBoldRed: '상승 방향색과 비슷해요',
  accentBoldBlue: '하락 방향색과 비슷해요',
  accentBoldPurple: '기준금리 선과 비슷해요',
  accentBoldYellow: '밝아서 흰 배경에서 잘 안 보여요',
};

export interface MaPrefs {
  /** 켜 둔 창. 서버가 주는 창 중 여기 든 것만 그린다. */
  shown: number[];
  /** 창 -> 색 토큰. 없는 창은 `DEFAULT_COLOR` 로 떨어진다. */
  colors: Record<number, MaColorToken>;
}

const DEFAULT_COLOR: MaColorToken = 'accentBoldGray';

/**
 * 기본값 — **20·120 둘만 켠다.**
 *
 * 다섯을 다 켜고 시작하면 금리 차트에 선이 일곱(종목·CD·기준금리·MA 다섯)이
 * 된다. 20=1개월 · 120=반기가 이 데스크가 실제로 읽는 둘이고, 둘 다 위에서
 * «겹치는 뜻이 없는» 두 색을 받는다. 나머지는 켜는 순간 읽는 사람이 고른 것이다.
 */
export const MA_DEFAULT: MaPrefs = {
  shown: [20, 120],
  colors: {
    5: 'accentBoldPurple',
    10: 'accentBoldRed',
    20: 'accentBoldGreen',
    60: 'accentBoldBlue',
    120: 'accentBoldGray',
  },
};

const KEY = 'sr-ma';

function load(): MaPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return MA_DEFAULT;
    const v = JSON.parse(raw) as Partial<MaPrefs>;
    const shown = Array.isArray(v.shown)
      ? v.shown.filter((n): n is number => Number.isFinite(n))
      : MA_DEFAULT.shown;
    const colors: Record<number, MaColorToken> = { ...MA_DEFAULT.colors };
    if (v.colors && typeof v.colors === 'object') {
      for (const [k, c] of Object.entries(v.colors)) {
        const w = Number(k);
        if (Number.isFinite(w) && (MA_COLOR_TOKENS as readonly string[]).includes(c as string)) {
          colors[w] = c as MaColorToken;
        }
      }
    }
    return { shown, colors };
  } catch {
    // 저장소가 막혔거나 옛 모양이 남아 있다 — 기본값이 안전하다
    return MA_DEFAULT;
  }
}

const listeners = new Set<() => void>();
let snapshot: MaPrefs | null = null;

function read(): MaPrefs {
  if (snapshot === null) snapshot = load();
  return snapshot;
}

function write(next: MaPrefs) {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장소가 막힌 환경 — 선택이 기억되지 않을 뿐이다 */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useMaPrefs(): [
  MaPrefs,
  {
    toggle: (w: number) => void;
    setColor: (w: number, c: MaColorToken) => void;
    reset: () => void;
  },
] {
  /* 서버 스냅샷은 **항상 기본값**이고 하이드레이션에서 교정된다 — 서버는 이
     취향을 알 방법이 없다(`useFunding` 과 같은 처리). */
  const prefs = useSyncExternalStore(subscribe, read, () => MA_DEFAULT);
  return [
    prefs,
    {
      toggle: (w) => {
        const cur = read();
        const shown = cur.shown.includes(w)
          ? cur.shown.filter((x) => x !== w)
          : [...cur.shown, w].sort((a, b) => a - b);
        write({ ...cur, shown });
      },
      setColor: (w, c) => {
        const cur = read();
        write({ ...cur, colors: { ...cur.colors, [w]: c } });
      },
      reset: () => write(MA_DEFAULT),
    },
  ];
}

/** 그 창의 색 토큰 — 안 정해졌으면 기본. */
export function maColorOf(prefs: MaPrefs, w: number): MaColorToken {
  return prefs.colors[w] ?? MA_DEFAULT.colors[w] ?? DEFAULT_COLOR;
}
