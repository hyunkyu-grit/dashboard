'use client';

/* 차트에 **겹쳐 그리는 것들**의 취향 — Setting 이 정하고 차트가 읽는다
 * [OWNER, 2026-08-26 — "당연히 껏다 켰다 가능하게 … 색도 회색이 아니라
 * 컬러토큰에서 가져와서 배정해주고 OR 내가 색상 지정할 수 있게" · 그리고
 * "기준금리랑 CD금리도 MA처럼 껏다 켰다 가능하게"].
 *
 * 처음엔 `state/ma.ts` 였다. 기준선 둘이 **같은 질문**(겹쳐 그릴까)을 갖게 되면서
 * 파일 이름이 내용보다 좁아졌다 — 이름을 넓히는 편이 두 번째 저장소를 만드는
 * 것보다 낫다(캐논 «같은 것은 한 번만 만든다»).
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

export interface OverlayPrefs {
  /** 켜 둔 창. 서버가 주는 창 중 여기 든 것만 그린다. */
  shown: number[];
  /** 창 -> 색 토큰. 없는 창은 `DEFAULT_COLOR` 로 떨어진다. */
  colors: Record<number, MaColorToken>;
  /**
   * 기준선 둘 [OWNER, 2026-08-26 — "기준금리랑 CD금리도 MA처럼"].
   *
   * **색은 여기 없다.** CD·기준금리의 두 색은 오너가 3차까지 보고 확정한 값이라
   * (`theme/direction.css` 의 `--sr-ref-cd`/`--sr-ref-policy`) 고르는 대상이
   * 아니다. 여기서 정하는 것은 «그릴까» 하나다.
   *
   * 기본은 **둘 다 켬** — v1 부터의 규약이 "CD와 기준금리는 항상 같이 그린다"
   * [OWNER 2026-07-31] 이고, 이 변경은 그 규약을 끄는 손잡이를 더한 것이지
   * 규약을 뒤집은 것이 아니다.
   */
  refs: { cd: boolean; policy: boolean };
}

const DEFAULT_COLOR: MaColorToken = 'accentBoldGray';

/**
 * 이동평균은 **하나도 안 켜고 시작한다** [OWNER, 2026-08-26 — "ma20도 남기지 마.
 * 기본값이라는게 없어야 함"].
 *
 * 처음엔 20·120 둘, 다음엔 20 하나였다. 그 둘 다 «이 데스크가 읽는 창» 을 내가
 * 골라 준 것이었고, 그건 취향을 기본값으로 위장한 것이다. 지표는 **부르는 사람이
 * 부를 때 뜬다** — 안 부른 선이 차트에 있으면 그것도 데이터인 줄 읽는다.
 *
 * `colors` 는 그대로 둔다. 그건 «켤 때 무슨 색이냐» 이지 «켜져 있느냐» 가
 * 아니고, 다섯 창 전부 미리 배정돼 있어 칩을 누르면 바로 제 색으로 선다.
 *
 * `refs`(CD 91일·기준금리)는 **다르다.** "CD와 기준금리는 항상 같이 그린다"
 * [OWNER 2026-07-31] 가 이 제품의 규약이고, 이번 변경은 MA 에 대한 것이다 —
 * 규약을 끄는 손잡이는 2026-08-26 에 생겼지만 기본은 켜짐 그대로다.
 */
export const OVERLAY_DEFAULT: OverlayPrefs = {
  shown: [],
  colors: {
    5: 'accentBoldPurple',
    10: 'accentBoldRed',
    20: 'accentBoldGreen',
    60: 'accentBoldBlue',
    120: 'accentBoldGray',
  },
  refs: { cd: true, policy: true },
};

/** 저장 열쇠. `sr-ma` 에서 옮겼다 — 옛 열쇠에 든 값은 «MA 만 아는» 모양이라
 *  기준선 항목이 없다. 새 열쇠로 시작하면 기본값(둘 다 켬)에서 출발한다. */
const KEY = 'sr-overlays';

function load(): OverlayPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return OVERLAY_DEFAULT;
    const v = JSON.parse(raw) as Partial<OverlayPrefs>;
    const shown = Array.isArray(v.shown)
      ? v.shown.filter((n): n is number => Number.isFinite(n))
      : OVERLAY_DEFAULT.shown;
    const colors: Record<number, MaColorToken> = { ...OVERLAY_DEFAULT.colors };
    if (v.colors && typeof v.colors === 'object') {
      for (const [k, c] of Object.entries(v.colors)) {
        const w = Number(k);
        if (Number.isFinite(w) && (MA_COLOR_TOKENS as readonly string[]).includes(c as string)) {
          colors[w] = c as MaColorToken;
        }
      }
    }
    const refs = {
      cd: v.refs?.cd !== false,
      policy: v.refs?.policy !== false,
    };
    return { shown, colors, refs };
  } catch {
    // 저장소가 막혔거나 옛 모양이 남아 있다 — 기본값이 안전하다
    return OVERLAY_DEFAULT;
  }
}

const listeners = new Set<() => void>();
let snapshot: OverlayPrefs | null = null;

function read(): OverlayPrefs {
  if (snapshot === null) snapshot = load();
  return snapshot;
}

function write(next: OverlayPrefs) {
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

export function useOverlayPrefs(): [
  OverlayPrefs,
  {
    toggle: (w: number) => void;
    setColor: (w: number, c: MaColorToken) => void;
    toggleRef: (k: 'cd' | 'policy') => void;
    reset: () => void;
  },
] {
  /* 서버 스냅샷은 **항상 기본값**이고 하이드레이션에서 교정된다 — 서버는 이
     취향을 알 방법이 없다(`useFunding` 과 같은 처리). */
  const prefs = useSyncExternalStore(subscribe, read, () => OVERLAY_DEFAULT);
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
      toggleRef: (k) => {
        const cur = read();
        write({ ...cur, refs: { ...cur.refs, [k]: !cur.refs[k] } });
      },
      reset: () => write(OVERLAY_DEFAULT),
    },
  ];
}

/** 그 창의 색 토큰 — 안 정해졌으면 기본. */
export function maColorOf(prefs: OverlayPrefs, w: number): MaColorToken {
  return prefs.colors[w] ?? OVERLAY_DEFAULT.colors[w] ?? DEFAULT_COLOR;
}
