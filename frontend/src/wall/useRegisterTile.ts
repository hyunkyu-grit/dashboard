"use client";

/* Ref callback that registers a tile's DOM element in the tile registry
 * for the lifetime it's mounted (design spec §3 — command bar + change log
 * resolve names/anchors to these elements). */

import { useCallback, useRef } from "react";

import { registerTile } from "./tileRegistry";

export function useRegisterTile(
  anchor: string,
  label: string,
  tokens: string[],
) {
  const cleanup = useRef<(() => void) | null>(null);
  // tokens is a fresh array each render; a joined string is a stable dep.
  const tokensKey = tokens.join("|");
  return useCallback(
    (el: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (el) {
        cleanup.current = registerTile({
          anchor,
          label,
          tokens: tokensKey.split("|").filter(Boolean).map((t) => t.toLowerCase()),
          el,
        });
      }
    },
    [anchor, label, tokensKey],
  );
}
