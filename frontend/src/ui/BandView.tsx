"use client";

/* Level 2 — band view (DESIGN §2). Stacked tiles (Now + selected basis only),
 * a "표로 보기" table toggle (collapsed by default), and for spreads the 8
 * largest movers with a "전체 보기" expansion to all 35. */

import { motion } from "motion/react";
import { useMemo, useState } from "react";

import type { BasisKey, ForwardsPayload, WallSummary } from "@/lib/api";
import { type TimeBasis } from "@/theme/ramp";
import { CurveOverlayTile } from "@/wall/CurveOverlayTile";
import { ForwardMatrix, KeyForwardBlock } from "@/wall/ForwardMatrix";
import { ForwardTile } from "@/wall/ForwardTile";

import { BAND_NAME, type BandId } from "./bands";
import { VOL_PLACEHOLDER } from "./copy";
import { PRESS_SCALE } from "./motion";
import { SeriesTable } from "./SeriesTable";
import { SeriesTile } from "./SeriesTile";

const FWD_TENORS = ["SPOT", "3MF", "6MF", "9MF", "1YF", "2YF", "3YF", "5YF"];
const SPREAD_TOP = 8;

function TableToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[16px] bg-tile p-5 shadow-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[13px] opacity-60 hover:opacity-100"
      >
        {open ? "▾ 표 접기" : "▸ 표로 보기"}
      </button>
      {open && <div className="mt-3 overflow-x-auto">{children}</div>}
    </div>
  );
}

function Tappable({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      whileTap={{ scale: PRESS_SCALE }}
      className="cursor-pointer rounded-[16px]"
    >
      {children}
    </motion.div>
  );
}

export function BandView({
  band,
  summary,
  forwards,
  basis,
  onBack,
  onOpenTile,
}: {
  band: BandId;
  summary: WallSummary;
  forwards?: ForwardsPayload;
  basis: BasisKey;
  onBack: () => void;
  onOpenTile: (target: string) => void;
}) {
  const twoBases = useMemo<TimeBasis[]>(() => ["now", basis], [basis]);
  const [showAllSpreads, setShowAllSpreads] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 px-1">
        <button
          type="button"
          onClick={onBack}
          className="rounded-[8px] px-2 py-1 text-[15px] opacity-60 hover:bg-tile hover:opacity-100"
        >
          ← 홈
        </button>
        <h1 className="text-[17px] font-semibold">{BAND_NAME[band]}</h1>
      </div>

      {band === "curve" && (
        <>
          <Tappable onClick={() => onOpenTile("curve")}>
            <div className="rounded-[16px] bg-tile p-4 shadow-card">
              <CurveOverlayTile
                summary={summary}
                width={888}
                height={360}
                bases={twoBases}
              />
            </div>
          </Tappable>
          <TableToggle>
            <SeriesTable
              rows={summary.outrights}
              basis={basis}
              onOpen={(id) => onOpenTile(`series:${id}`)}
            />
          </TableToggle>
        </>
      )}

      {band === "vol" && (
        <div className="rounded-[16px] bg-tile p-10 text-center shadow-card">
          <p className="text-[15px] opacity-60">{VOL_PLACEHOLDER}</p>
        </div>
      )}

      {band === "forwards" && forwards && (
        <>
          {FWD_TENORS.map((tenor) => (
            <Tappable key={tenor} onClick={() => onOpenTile(`fwd:${tenor}`)}>
              <ForwardTile
                tenor={tenor}
                payload={forwards}
                width={920}
                height={220}
                bases={twoBases}
              />
            </Tappable>
          ))}
          <TableToggle>
            <div className="flex items-start gap-6">
              <ForwardMatrix payload={forwards} />
              <KeyForwardBlock payload={forwards} />
            </div>
          </TableToggle>
        </>
      )}

      {band === "outrights" && (
        <>
          {summary.outrights.map((s) => (
            <SeriesTile
              key={s.id}
              s={s}
              basis={basis}
              onOpen={() => onOpenTile(`series:${s.id}`)}
            />
          ))}
          <TableToggle>
            <SeriesTable
              rows={summary.outrights}
              basis={basis}
              onOpen={(id) => onOpenTile(`series:${id}`)}
            />
          </TableToggle>
        </>
      )}

      {band === "spreads" && (
        <>
          {[...summary.derived]
            .filter((d) => d.deltas[basis] != null)
            .sort(
              (a, b) => Math.abs(b.deltas[basis]!) - Math.abs(a.deltas[basis]!),
            )
            .slice(0, showAllSpreads ? undefined : SPREAD_TOP)
            .map((s) => (
              <SeriesTile
                key={s.id}
                s={s}
                basis={basis}
                onOpen={() => onOpenTile(`series:${s.id}`)}
              />
            ))}
          {!showAllSpreads && (
            <button
              type="button"
              onClick={() => setShowAllSpreads(true)}
              className="rounded-[16px] bg-tile p-4 text-[15px] opacity-70 shadow-card hover:opacity-100"
            >
              전체 보기 (35개)
            </button>
          )}
          <TableToggle>
            <SeriesTable
              rows={summary.derived}
              basis={basis}
              onOpen={(id) => onOpenTile(`series:${id}`)}
            />
          </TableToggle>
        </>
      )}
    </div>
  );
}
