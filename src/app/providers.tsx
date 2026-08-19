'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { ColorScheme } from '@coinbase/cds-common';
import { ThemeProvider } from '@coinbase/cds-web';
import { MediaQueryProvider } from '@coinbase/cds-web/system';

import { sauronTheme } from '@/theme/sauronTheme';

type SchemeContextValue = {
  scheme: ColorScheme;
  toggleScheme: () => void;
};

const SchemeContext = createContext<SchemeContextValue | undefined>(undefined);

export function useScheme(): SchemeContextValue {
  const ctx = useContext(SchemeContext);
  if (!ctx) throw new Error('useScheme must be used inside <Providers>');
  return ctx;
}

/**
 * THE app root. One `ThemeProvider`, mounted once, never nested and never
 * overridden per route — a second provider would fork the palette and make any
 * contrast measurement meaningless about the screen you are actually looking at.
 *
 * `data-sr-scheme` is this app's own hook for the direction pair
 * (`theme/direction.css`). CDS emits its palette as inline CSS variables and
 * exposes no class or attribute to key off, so v2 owns this one rather than
 * reaching into a CDS internal.
 */
/** 고른 화면 밝기가 사는 자리 [OWNER 2026-08-19 — 보류 해제].
 *
 * **localStorage 다**, 이 리포가 창 위치·백테스트 북에 쓰는 모듈 변수가 아니다.
 * 그 둘은 "그 세션의 질문" 이라 새로고침에 사라지는 것이 규칙이지만(`geometry.ts`
 * 의 근거), 화면 밝기는 질문이 아니라 **이 사람이 이 화면을 보는 조건**이다 —
 * 창을 닫았다 열 때마다 다시 고르게 하는 것은 설정을 안 지키는 것이다. */
const SCHEME_KEY = 'sr-scheme';

export function Providers({ children }: { children: React.ReactNode }) {
  /* 첫 렌더는 **언제나 light** — 서버가 그리는 것과 같아야 한다. 저장된 값은
   * 마운트 뒤에 적용된다(아래 useEffect). 다크 사용자에게 한 프레임 밝은 화면이
   * 스치는 대신, hydration 이 어긋나지 않는다: 초기값을 localStorage 에서 읽으면
   * 서버 HTML(light)과 클라이언트 첫 렌더(dark)가 갈라지고, 그 어긋남은 이 div
   * 하나가 아니라 CDS `ThemeProvider` 가 인라인으로 뿌리는 팔레트 변수 전체로
   * 번진다. 깜빡임을 없애려면 페인트 전 스크립트가 필요하고, 그건 이 패스의
   * 크기가 아니다 — 여기 적어 둔다. */
  const [scheme, setScheme] = useState<ColorScheme>('light');

  useEffect(() => {
    try {
      if (localStorage.getItem(SCHEME_KEY) === 'dark') setScheme('dark');
    } catch {
      /* 저장소가 막힌 브라우저(사생활 모드·정책) — 기본값으로 산다. */
    }
  }, []);

  const toggleScheme = useCallback(
    () =>
      setScheme((s) => {
        const next = s === 'light' ? 'dark' : 'light';
        try {
          localStorage.setItem(SCHEME_KEY, next);
        } catch {
          /* 못 적으면 이 세션에서만 유효하다 — 화면은 그대로 바뀐다. */
        }
        return next;
      }),
    [],
  );

  const value = useMemo(() => ({ scheme, toggleScheme }), [scheme, toggleScheme]);

  return (
    <SchemeContext.Provider value={value}>
      <MediaQueryProvider>
        <ThemeProvider theme={sauronTheme} activeColorScheme={scheme}>
          <div data-sr-scheme={scheme}>{children}</div>
        </ThemeProvider>
      </MediaQueryProvider>
    </SchemeContext.Provider>
  );
}
