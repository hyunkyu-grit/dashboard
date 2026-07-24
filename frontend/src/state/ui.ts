"use client";

/* Client UI state (design spec §11: Zustand). Drag/pan state deliberately
 * does NOT live here — it is refs-only (design spec §2). */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export type Theme = "light" | "dark";

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const useUiStore = create<UiState>()(
  subscribeWithSelector((set) => ({
    theme: "light",
    setTheme: (t) => {
      if (t === "dark") {
        document.documentElement.dataset.theme = "dark";
      } else {
        delete document.documentElement.dataset.theme;
      }
      try {
        localStorage.setItem("bw-theme", t);
      } catch {
        /* storage unavailable — theme just won't persist */
      }
      set({ theme: t });
    },
  })),
);

/** Adopt the theme the pre-hydration <head> script already applied. */
export function syncThemeFromDom(): void {
  const t: Theme =
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  if (useUiStore.getState().theme !== t) useUiStore.setState({ theme: t });
}
