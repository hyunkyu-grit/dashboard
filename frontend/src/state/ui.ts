"use client";

/* Client UI state (design spec §11: Zustand). Drag/pan state deliberately
 * does NOT live here — it is refs-only (design spec §2). */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import type { BasisKey } from "@/lib/api";
import { TIME_BASES } from "@/theme/ramp";
import { asChartType, CHART_TYPE_KEY, type ChartType } from "@/ui/chartType";

export type Theme = "light" | "dark";

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Global comparison basis — one of the five non-"now" bases (§12). */
  basis: BasisKey;
  setBasis: (b: BasisKey) => void;
  /** 선 · 주봉 · 월봉, 화면의 모든 시계열 차트에 걸린다 [OWNER, 2026-08-13].
   * `basis` 와 같은 성질의 상태다 — 읽는 사람의 환경설정이고, 기억되며,
   * 어느 차트도 자기만의 사본을 갖지 않는다. */
  chartType: ChartType;
  setChartType: (t: ChartType) => void;
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
    chartType: "line",
    setChartType: (t) => {
      try {
        localStorage.setItem(CHART_TYPE_KEY, t);
      } catch {
        /* storage unavailable — the choice just won't persist */
      }
      set({ chartType: t });
    },
    fwdHover: null,
    setFwdHover: (h) => set({ fwdHover: h }),
  })),
);

/** Adopt the theme the pre-hydration <head> script already applied, and
 * the persisted comparison basis + chart type. */
export function syncUiFromDom(): void {
  const t: Theme =
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  if (useUiStore.getState().theme !== t) useUiStore.setState({ theme: t });
  try {
    const b = localStorage.getItem("bw-basis");
    // "now" is not a selector option (§12) — accept only the five bases.
    if (b && b !== "now" && TIME_BASES.includes(b as (typeof TIME_BASES)[number]) &&
        useUiStore.getState().basis !== b) {
      useUiStore.setState({ basis: b as BasisKey });
    }
    /* Chart type is adopted HERE and not from a pre-hydration script, unlike
     * the theme: a wrong theme for one frame is a flash of the wrong colour,
     * while a wrong chart type for one frame is a line that becomes candles —
     * and both states are legitimate pictures of the same data. Line first,
     * corrected on hydration, is the honest order. */
    const c = asChartType(localStorage.getItem(CHART_TYPE_KEY));
    if (c && useUiStore.getState().chartType !== c) {
      useUiStore.setState({ chartType: c });
    }
  } catch {
    /* storage unavailable */
  }
}
