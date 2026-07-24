"use client";

/* App shell — the single centered column and its three levels (DESIGN §2).
 * URL owns navigation: ?band=<band> is Level 2, ?tile=<target> is Level 3. */

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

import { fetchForwards, fetchWallSummary, type BasisKey } from "@/lib/api";
import { syncUiFromDom, useUiStore } from "@/state/ui";
import { BASIS_LABELS, TIME_BASES } from "@/theme/ramp";
import { CommandBar } from "@/wall/CommandBar";

import { BAND_ORDER, type BandId } from "./bands";
import { BandView } from "./BandView";
import { ERROR_SENTENCE, LOADING_SENTENCE } from "./copy";
import { DetailSheet } from "./DetailSheet";
import { Home } from "./Home";
import { SPRING } from "./motion";

const SELECTOR_BASES = TIME_BASES.filter((b) => b !== "now") as BasisKey[];

function isBand(v: string | null): v is BandId {
  return !!v && (BAND_ORDER as string[]).includes(v);
}

function Header() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const basis = useUiStore((s) => s.basis);
  const setBasis = useUiStore((s) => s.setBasis);
  return (
    <header className="sticky top-0 z-20 bg-page/90 backdrop-blur">
      <div className="mx-auto flex max-w-[960px] items-center gap-4 px-6 py-3">
        <span className="text-[17px] font-bold text-brand">braveworld</span>
        <span className="text-[13px] opacity-45">KRW IRS</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-[13px]">
          <span className="opacity-45">Δ</span>
          <span className="flex overflow-hidden rounded-[8px] border border-edge">
            {SELECTOR_BASES.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBasis(b)}
                className={
                  b === basis
                    ? "bg-brand px-2 py-0.5 text-page"
                    : "px-2 py-0.5 opacity-50 hover:opacity-90"
                }
              >
                {BASIS_LABELS[b]}
              </button>
            ))}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="rounded-[8px] px-2 py-0.5 text-[13px] opacity-60 hover:opacity-100"
        >
          {theme === "dark" ? "밝게" : "어둡게"}
        </button>
      </div>
    </header>
  );
}

export function App() {
  const router = useRouter();
  const params = useSearchParams();
  const basis = useUiStore((s) => s.basis);

  const bandParam = params.get("band");
  const tileParam = params.get("tile");
  const band = isBand(bandParam) ? bandParam : null;

  const { data: summary, isError } = useQuery({
    queryKey: ["wall-summary"],
    queryFn: fetchWallSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: forwards } = useQuery({
    queryKey: ["forwards"],
    queryFn: fetchForwards,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    syncUiFromDom();
  }, []);

  const push = useCallback(
    (qs: string) => router.push(qs || "/", { scroll: false }),
    [router],
  );
  const openBand = useCallback((b: BandId) => push(`/?band=${b}`), [push]);
  const openTile = useCallback(
    (target: string) =>
      push(`/?${band ? `band=${band}&` : ""}tile=${encodeURIComponent(target)}`),
    [push, band],
  );
  const openSeries = useCallback(
    (id: string) => openTile(`series:${id}`),
    [openTile],
  );
  const closeTile = useCallback(
    () => push(band ? `/?band=${band}` : "/"),
    [push, band],
  );
  const back = useCallback(() => push("/"), [push]);

  const scrollTo = useCallback((el: HTMLElement) => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen">
        <Header />

        <main className="mx-auto max-w-[960px] px-6 pb-24 pt-6">
          {isError && (
            <p className="p-10 text-center text-[15px] opacity-60">
              {ERROR_SENTENCE}
            </p>
          )}
          {!summary && !isError && (
            <p className="p-10 text-center text-[15px] opacity-50">
              {LOADING_SENTENCE}
            </p>
          )}
          {summary && (
            // Level 1 ⇄ 2 is an animated content transition, not a hard swap.
            <AnimatePresence mode="wait">
              <motion.div
                key={band ?? "home"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={SPRING}
              >
                {band ? (
                  <BandView
                    band={band}
                    summary={summary}
                    forwards={forwards}
                    basis={basis}
                    onBack={back}
                    onOpenTile={openTile}
                  />
                ) : (
                  <Home
                    summary={summary}
                    forwards={forwards}
                    basis={basis}
                    onOpenBand={openBand}
                    onOpenSeries={openSeries}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </main>

        <AnimatePresence>
          {tileParam && summary && (
            <DetailSheet
              target={tileParam}
              summary={summary}
              forwards={forwards}
              onClose={closeTile}
            />
          )}
        </AnimatePresence>

        <CommandBar onJump={scrollTo} />
      </div>
    </MotionConfig>
  );
}
