"use client";

/* Client UI state (design spec §11: Zustand). Drag/pan state deliberately
 * does NOT live here — it is refs-only (design spec §2). */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import { TIME_BASES, type TimeBasis } from "@/theme/ramp";

export type Theme = "light" | "dark";

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Global comparison basis — re-bases every delta representation (§3). */
  basis: TimeBasis;
  setBasis: (b: TimeBasis) => void;
  /** Matrix-cell hover → linked highlight in the matching forward tile (§8). */
  fwdHover: { tenor: string; startIdx: number } | null;
  setFwdHover: (h: { tenor: string; startIdx: number } | null) => void;
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
    basis: "d1",
    setBasis: (b) => {
      try {
        localStorage.setItem("bw-basis", b);
      } catch {
        /* storage unavailable — selection just won't persist */
      }
      set({ basis: b });
    },
    fwdHover: null,
    setFwdHover: (h) => set({ fwdHover: h }),
  })),
);

/** Adopt the theme the pre-hydration <head> script already applied, and
 * the persisted comparison basis. */
export function syncUiFromDom(): void {
  const t: Theme =
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  if (useUiStore.getState().theme !== t) useUiStore.setState({ theme: t });
  try {
    const b = localStorage.getItem("bw-basis") as TimeBasis | null;
    // "now" is no longer a selector option (DESIGN §12) — clamp it to d1.
    if (b && TIME_BASES.includes(b) && b !== "now" &&
        useUiStore.getState().basis !== b) {
      useUiStore.setState({ basis: b });
    }
  } catch {
    /* storage unavailable */
  }
}
