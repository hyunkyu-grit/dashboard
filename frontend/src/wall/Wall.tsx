"use client";

/* The Wall — design spec §2.
 * One vertically pannable surface. Fixed layout, no rearrangement, no
 * virtualization. Column headers pinned top; band labels pinned left.
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

import {
  fetchForwards,
  fetchWallSummary,
  type ForwardsPayload,
  type WallSummary,
} from "@/lib/api";
import { syncUiFromDom, useUiStore } from "@/state/ui";
import { BASIS_LABELS, TIME_BASES } from "@/theme/ramp";

import {
  BAND_GAP,
  COL_GAP,
  COL_W,
  HEADER_H,
  LEFT_RAIL_W,
  N_COLS,
  WALL_W,
} from "./constants";
import { ChangeLog } from "./ChangeLog";
import { CommandBar } from "./CommandBar";
import { CurveOverlayTile } from "./CurveOverlayTile";
import { DetailOverlay } from "./DetailOverlay";
import { DetailPanel } from "./DetailPanel";
import { ForwardMatrix, KeyForwardBlock } from "./ForwardMatrix";
import { ForwardTile } from "./ForwardTile";
import { useRegisterTile } from "./useRegisterTile";
import { useWallPan } from "./usePan";

const NO_TOKENS: string[] = [];

/** Forward tile that registers itself in the tile registry (§3). */
function RegisteredForwardTile({
  tenor,
  payload,
  width,
  height,
}: {
  tenor: string;
  payload: ForwardsPayload;
  width: number;
  height: number;
}) {
  const refCb = useRegisterTile(`fwd:${tenor}`, tenor, [
    tenor,
    tenor.replace("F", "").toLowerCase() + "f",
  ]);
  return (
    <ForwardTile
      tenor={tenor}
      payload={payload}
      width={width}
      height={height}
      refCb={refCb}
    />
  );
}

const GRID_STYLE: React.CSSProperties = {
  width: WALL_W,
  display: "grid",
  gridTemplateColumns: `repeat(${N_COLS}, ${COL_W}px)`,
  gap: COL_GAP,
};

function Band({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex" style={{ marginBottom: BAND_GAP }}>
      <div
        className="shrink-0 pt-1 text-[15px] font-semibold"
        style={{ width: LEFT_RAIL_W }}
      >
        {label}
      </div>
      <div style={GRID_STYLE}>{children}</div>
    </div>
  );
}

function Tile({
  title,
  span,
  height,
  onOpen,
  refCb,
  children,
}: {
  title: string;
  span: number;
  height: number;
  onOpen?: () => void;
  refCb?: (el: HTMLElement | null) => void;
  children?: React.ReactNode;
}) {
  return (
    <section
      ref={refCb}
      className="rounded-sm border border-edge bg-tile p-3"
      style={{ gridColumn: `span ${span}`, height }}
      onClick={onOpen}
    >
      <h2 className="mb-1 text-[14px] font-semibold">{title}</h2>
      <div style={{ height: height - 24 - 24 }}>{children}</div>
    </section>
  );
}

/** Search tokens for the curve tile: outright tenors + every derived id in
 * plain, dash-free, and trader ("3s10s") forms so the command bar resolves
 * them (all point at the curve tile until Band 3 owns per-series tiles). */
function curveTokens(summary: WallSummary): string[] {
  const tokens = ["curve", "irs", ...summary.outrights.map((o) => o.id)];
  for (const d of summary.derived) {
    const legs = d.id.split("-");
    tokens.push(d.id, legs.join(""));
    tokens.push(legs.map((l) => l.replace("Y", "s").replace(".", "")).join(""));
  }
  return tokens;
}

function StubBand({ label, note, height }: { label: string; note: string; height: number }) {
  return (
    <Band label={label}>
      <div
        className="flex items-center justify-center rounded-sm border border-dashed border-edge opacity-60"
        style={{ gridColumn: `span ${N_COLS}`, height }}
      >
        {note}
      </div>
    </Band>
  );
}

function BasisSelector({ summary }: { summary?: WallSummary }) {
  const basis = useUiStore((s) => s.basis);
  const setBasis = useUiStore((s) => s.setBasis);
  const basisDate =
    summary && basis !== "now" ? summary.basisDates[basis] : summary?.asof;
  return (
    <span className="flex items-center gap-2">
      <span className="opacity-60">Δ vs</span>
      <span className="flex overflow-hidden rounded-sm border border-edge">
        {TIME_BASES.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBasis(b)}
            className={
              b === basis
                ? "bg-tile px-2 py-0.5"
                : "px-2 py-0.5 opacity-50 hover:opacity-80"
            }
          >
            {BASIS_LABELS[b]}
          </button>
        ))}
      </span>
      {basisDate && <span className="opacity-70">{basisDate}</span>}
    </span>
  );
}

function StatusStrip({
  summary,
  isError,
}: {
  summary?: WallSummary;
  isError: boolean;
}) {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  return (
    <header className="flex h-10 shrink-0 items-center gap-4 border-b border-edge bg-page px-3">
      <span className="text-[15px] font-semibold">braveworld</span>
      <span className="opacity-70">KRW IRS</span>
      {summary && (
        <span>
          <span className="opacity-60">asof</span> {summary.asof}
        </span>
      )}
      <BasisSelector summary={summary} />
      {summary && summary.missingNodes.length > 0 && (
        <span className="border border-edge px-1.5 py-0.5">
          feed gap: {summary.missingNodes.join(", ")} absent
        </span>
      )}
      <span className={isError ? "font-semibold" : "opacity-70"}>
        {isError ? "DISCONNECTED" : summary ? "live" : "loading…"}
      </span>
      {/* [TBD slot] compact risk summary: total DV01, day P&L (spec §3) */}
      <span className="flex-1" />
      <button
        type="button"
        className="border border-edge px-2 py-0.5 hover:bg-tile"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? "Light" : "Dark"}
      </button>
    </header>
  );
}

export function Wall() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusedTile = searchParams.get("tile");

  const { data, isError } = useQuery({
    queryKey: ["wall-summary"],
    queryFn: fetchWallSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: fwd } = useQuery({
    queryKey: ["forwards"],
    queryFn: fetchForwards,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { viewportRef, contentRef, handlers, panToElement } = useWallPan();

  const curveRef = useRegisterTile(
    "curve",
    "IRS curve",
    data ? curveTokens(data) : NO_TOKENS,
  );
  const matrixRef = useRegisterTile("matrix", "Forward matrix", [
    "matrix",
    "forward matrix",
    "fwd",
  ]);

  useEffect(() => {
    syncUiFromDom();
  }, []);

  const openTile = useCallback(
    (id: string) => router.push(`/?tile=${id}`, { scroll: false }),
    [router],
  );
  const closeTile = useCallback(
    () => router.push("/", { scroll: false }),
    [router],
  );

  const bandTileW = 3 * COL_W + 2 * COL_GAP - 24; // half-wall tile, minus padding
  const fwdTileW = (WALL_W - 3 * COL_GAP) / 4; // ~1.5 wall-columns each (§7)

  return (
    <div className="flex h-screen flex-col">
      <StatusStrip summary={data} isError={isError} />

      <div className="relative flex-1 overflow-hidden">
        {/* pinned column headers (time bases) */}
        <div
          className="absolute inset-x-0 top-0 z-10 flex border-b border-edge bg-page"
          style={{ height: HEADER_H }}
        >
          <div style={{ width: LEFT_RAIL_W }} />
          <div style={{ ...GRID_STYLE, alignItems: "center" }}>
            {TIME_BASES.map((b) => (
              <span key={b} className="opacity-70">
                {BASIS_LABELS[b]}
              </span>
            ))}
          </div>
        </div>

        {/* pannable viewport */}
        <div
          ref={viewportRef}
          className="absolute inset-0 cursor-grab touch-none select-none"
          style={{ paddingTop: HEADER_H }}
          {...handlers}
        >
          {/* no will-change: promoting the full ~3000px wall into one GPU
              layer stalls compositing; translate3d promotes on demand */}
          <div ref={contentRef} className="pt-2">
            {/* Band 1 — tenor-axis overlays */}
            <Band label="Curve">
              <Tile
                title="IRS curve — 6 bases"
                span={3}
                height={400}
                onOpen={() => openTile("curve")}
                refCb={curveRef}
              >
                {data && (
                  <CurveOverlayTile
                    summary={data}
                    width={bandTileW}
                    height={400 - 48}
                  />
                )}
              </Tile>
              <Tile title="Volatility — formula TBD" span={3} height={400}>
                <div className="flex h-full items-center justify-center opacity-50">
                  placeholder — slot reserved (spec §6/§13)
                </div>
              </Tile>
            </Band>

            {/* Band 2 — forwards (§7/§8) */}
            <Band label="Fwd">
              <div
                className="flex flex-col gap-2"
                style={{ gridColumn: `span ${N_COLS}` }}
              >
                {fwd && (
                  <>
                    {[
                      ["SPOT", "3MF", "6MF", "9MF"],
                      ["1YF", "2YF", "3YF", "5YF"],
                    ].map((row) => (
                      <div key={row[0]} className="flex gap-2">
                        {row.map((tenor) => (
                          <RegisteredForwardTile
                            key={tenor}
                            tenor={tenor}
                            payload={fwd}
                            width={fwdTileW}
                            height={300}
                          />
                        ))}
                      </div>
                    ))}
                    <div
                      ref={matrixRef}
                      className="flex items-start gap-4 rounded-sm border border-edge bg-tile p-3"
                    >
                      <ForwardMatrix payload={fwd} />
                      <KeyForwardBlock payload={fwd} />
                    </div>
                  </>
                )}
              </div>
            </Band>

            {/* Band 3+ — time-series matrix [TBD — do not improvise (§13)] */}
            <StubBand
              label="Series"
              note="time-series matrix — spec TBD with owner"
              height={900}
            />
          </div>
        </div>
      </div>

      <ChangeLog summary={data} onJump={panToElement} />

      <CommandBar onJump={panToElement} />

      {focusedTile && data && (
        <DetailOverlay onClose={closeTile}>
          <DetailPanel target={focusedTile} summary={data} />
        </DetailOverlay>
      )}
    </div>
  );
}
