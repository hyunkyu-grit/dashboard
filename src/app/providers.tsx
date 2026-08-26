'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { ColorScheme } from '@coinbase/cds-common';
import { ThemeProvider } from '@coinbase/cds-web';
import { PortalProvider } from '@coinbase/cds-web/overlays';
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
          {/* CDS 오버레이(Tooltip·Modal·Toast·Alert·Tray)가 포털할 컨테이너를
              만든다. 문서가 «required root-level provider» 라고 적어 둔 것이고,
              **없으면 조용히 틀린다** — `overlays/Portal.js` 가

                  if (disablePortal || isSSR() || !document.getElementById(containerId))
                    return <Fragment>{children}</Fragment>;

              로 떨어져 오버레이가 트리거 **안에** 렌더된다. 에러도 경고도 없다.
              이 리포가 그 대가를 이미 치렀다: rv 랭킹 표의 툴팁이 `<th>` 안에
              그려져 그 칸의 `nowrap` 을 상속했고, 패널이 한 줄 높이로 서서 긴
              문장이 밖으로 흘렀다 [OWNER 2026-08-19 — "패널 밖으로 글씨가
              빠져나가"]. 그때 CSS(.sr-rv-tiptext)로 증상을 덮었는데, 뿌리는
              이 프로바이더가 없던 것이었다.

              **ThemeProvider 안쪽**이다 — `Portal` 이 포털 트리에 테마를 다시
              세울 때 `useTheme()` 로 현재 테마를 읽으므로, 밖에 두면 다크에서
              오버레이만 라이트로 뜬다.

              층은 CDS 가 진다: 포털 루트가 `zIndex.portal`(100001)로 body 에
              붙으므로 이 앱의 `Z_MODAL`(50)·`Z_WINDOW`(45) 위다 — 떠 있는 창
              안에서 띄운 툴팁도 안 가려진다(`ui/window/layers.ts`). */}
          <PortalProvider>
            <div data-sr-scheme={scheme}>{children}</div>
          </PortalProvider>
        </ThemeProvider>
      </MediaQueryProvider>
    </SchemeContext.Provider>
  );
}
