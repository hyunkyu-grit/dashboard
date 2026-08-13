'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Screen state in the query string, written with SHALLOW history only.
 *
 * ── Why `history.replaceState` and never the router ──────────────────────────
 * v1 shipped a production-only defect where a click-initiated `router.replace`
 * transition never committed and took the whole router down with it — every
 * subsequent navigation was dead. It reproduced only in a production build, which is
 * how it survived several fixes. The ruling that came out of it: overlay and filter
 * state is written with `history.replaceState` / `pushState` directly, never through
 * Next's router, because this state does not change the page — it changes what the
 * page is showing.
 *
 * `replaceState` rather than `pushState` for filters: a chip press is not a
 * destination, and forty chip presses should not be forty back-button steps. The
 * selected row uses `pushState` so Esc/back can close a selection, which is the one
 * piece of this state a reader would expect to be able to go back from.
 */

type State = Record<string, string | undefined>;

function readSearch(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function write(next: State, mode: 'replace' | 'push') {
  if (typeof window === 'undefined') return;
  const q = readSearch();
  for (const [k, v] of Object.entries(next)) {
    if (v == null || v === '') q.delete(k);
    else q.set(k, v);
  }
  const qs = q.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

/**
 * One key of URL state. Returns the current value and a setter that writes the URL.
 *
 * The URL is read once on mount and then again on `popstate`, so the back button
 * works; it is deliberately NOT the source of truth on every render, because a
 * component that re-reads `location` each render fights its own writes.
 */
export function useUrlState(
  key: string,
  fallback?: string,
  mode: 'replace' | 'push' = 'replace',
): [string | undefined, (v: string | undefined) => void] {
  const [value, setValue] = useState<string | undefined>(fallback);

  useEffect(() => {
    const fromUrl = readSearch().get(key);
    if (fromUrl != null) setValue(fromUrl);

    const onPop = () => setValue(readSearch().get(key) ?? fallback);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [key, fallback]);

  const set = useCallback(
    (v: string | undefined) => {
      setValue(v);
      write({ [key]: v }, mode);
    },
    [key, mode],
  );

  return [value, set];
}
