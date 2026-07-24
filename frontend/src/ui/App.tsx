"use client";

/* Sauron — list-first shell (DESIGN §2). One screen, two panes: the instrument
 * table on the left, a sticky preview on the right that responds to it. URL
 * `?tile=…` opens the enlarged view. No navigation, no basis selector. */

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchForwards, fetchWallSummary } from "@/lib/api";
import { syncUiFromDom, useUiStore } from "@/state/ui";
import { CommandBar } from "@/wall/CommandBar";

import { ERROR_SENTENCE, LOADING_SENTENCE } from "./copy";
import { EnlargedView } from "./EnlargedView";
import { InstrumentTable } from "./InstrumentTable";
import { PreviewPane } from "./PreviewPane";
import { buildRows, type Row } from "./rows";

function Header() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  return (
    <header className="sticky top-0 z-20 bg-page/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-6 py-3">
        <span className="text-[17px] font-bold text-brand">Sauron</span>
        <span className="text-[13px] opacity-45">KRW IRS</span>
        <span className="flex-1" />
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
  const tileParam = params.get("tile");

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

  const [hovered, setHovered] = useState<Row | null>(null);
  const [pinned, setPinned] = useState<Row | null>(null);
  const active = hovered ?? pinned;

  const rows = useMemo(
    () => (summary ? buildRows(summary, forwards) : []),
    [summary, forwards],
  );

  useEffect(() => {
    syncUiFromDom();
  }, []);

  // Esc unpins (and the enlarged view closes itself on Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !tileParam) setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tileParam]);

  const openEnlarged = useCallback(
    (row: Row) => {
      const target = row.seriesId ? `series:${row.seriesId}` : row.id;
      router.push(`/?tile=${encodeURIComponent(target)}`, { scroll: false });
    },
    [router],
  );
  const closeEnlarged = useCallback(
    () => router.push("/", { scroll: false }),
    [router],
  );

  const enlargedRow = useMemo(() => {
    if (!tileParam) return null;
    if (tileParam.startsWith("series:")) {
      const sid = tileParam.slice("series:".length);
      return rows.find((r) => r.seriesId === sid) ?? null;
    }
    return rows.find((r) => r.id === tileParam) ?? null;
  }, [tileParam, rows]);

  const scrollTo = useCallback((el: HTMLElement) => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <div className="min-h-screen">
      <Header />

      <main className="mx-auto max-w-[1280px] px-6 pb-24 pt-4">
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
          <div className="flex gap-6">
            <div className="min-w-0 basis-[55%]">
              <InstrumentTable
                rows={rows}
                activeId={active?.id ?? null}
                pinnedId={pinned?.id ?? null}
                onHover={setHovered}
                onPin={setPinned}
              />
            </div>
            <div className="basis-[45%]">
              <div className="sticky top-20 rounded-[16px] bg-tile p-5 shadow-card">
                <PreviewPane row={active} onOpen={openEnlarged} />
              </div>
            </div>
          </div>
        )}
      </main>

      {enlargedRow && summary && (
        <EnlargedView
          row={enlargedRow}
          summary={summary}
          forwards={forwards}
          onClose={closeEnlarged}
        />
      )}

      <CommandBar onJump={scrollTo} />
    </div>
  );
}
