'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

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
export function Providers({ children }: { children: React.ReactNode }) {
  const [scheme, setScheme] = useState<ColorScheme>('light');

  const toggleScheme = useCallback(
    () => setScheme((s) => (s === 'light' ? 'dark' : 'light')),
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
