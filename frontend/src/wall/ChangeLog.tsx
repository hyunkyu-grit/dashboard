"use client";

/* Bottom change log (DESIGN §3 + §12 rule c). The log records EVENTS only —
 * transitions into/out of the extreme percentile band and outsized moves vs
 * a series' own history — computed server-side and fixed to the D-1 basis
 * (independent of the comparison-basis selector). A percentile-extreme LEVEL
 * is a STATE and lives weight-600 on the tile, never here.
 *
 * Correlated firings arrive pre-collapsed: one leading line per cluster with
 * "연관 N건" that expands to the related rows, each still clickable and each
 * panning to its tile. Visible entries are capped; older ones scroll. */

import { useMemo, useState } from "react";

import type { ChangeEvent, EventCluster, WallSummary } from "@/lib/api";
import { fmtBp, fmtRate } from "@/lib/format";

import { getTile } from "./tileRegistry";

// Visible-cluster cap, from the Pass A 500-day replay of rule (c):
// p90 = 2, max = 12 collapsed lines/day — 12 holds the worst replayed day
// without dropping an event (DESIGN §12).
const VISIBLE_CAP = 12;

const REASON_LABEL: Record<ChangeEvent["reasons"][number], string> = {
  transition: "밴드 전환",
  move: "급변",
};

function EventRow({
  e,
  onJump,
  indent,
}: {
  e: ChangeEvent;
  onJump: (el: HTMLElement) => void;
  indent?: boolean;
}) {
  const tile = getTile(e.anchor);
  return (
    <button
      type="button"
      disabled={!tile}
      onClick={() => tile && onJump(tile.el)}
      className={`flex w-full items-baseline gap-2 py-0.5 text-left enabled:hover:bg-tile disabled:opacity-60 ${
        indent ? "pl-6" : ""
      }`}
    >
      <span className="w-24 shrink-0 truncate">{e.label}</span>
      {/* weight-600 = outlier channel (§5) */}
      <span className="w-16 shrink-0 font-semibold tabular-nums">
        {e.unit === "%" ? fmtRate(e.now) : fmtBp(e.now)}
      </span>
      <span className="w-16 shrink-0 opacity-70">{fmtBp(e.deltaBp)}</span>
      <span className="w-12 shrink-0 opacity-70">
        {e.pct != null ? `${e.pct}pct` : "–"}
      </span>
      <span className="opacity-50">
        {e.reasons.map((r) => REASON_LABEL[r]).join(" + ")}
        {tile ? "" : " · no tile"}
      </span>
    </button>
  );
}

function Cluster({
  cluster,
  onJump,
}: {
  cluster: EventCluster;
  onJump: (el: HTMLElement) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-baseline">
        <EventRow e={cluster.leading} onJump={onJump} />
        {cluster.count > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="ml-1 shrink-0 rounded-sm border border-edge px-1.5 text-[12px] opacity-70 hover:opacity-100"
          >
            {open ? "▾" : "▸"} 연관 {cluster.count}건
          </button>
        )}
      </div>
      {open &&
        cluster.related.map((r) => (
          <EventRow key={r.id} e={r} onJump={onJump} indent />
        ))}
    </li>
  );
}

export function ChangeLog({
  summary,
  onJump,
}: {
  summary?: WallSummary;
  onJump: (el: HTMLElement) => void;
}) {
  const clusters = useMemo(() => summary?.events ?? [], [summary]);
  const visible = clusters.slice(0, VISIBLE_CAP);

  return (
    <footer className="flex h-24 shrink-0 flex-col border-t border-edge bg-page">
      <div className="flex items-center gap-2 px-3 py-1 text-[12px] opacity-60">
        <span className="font-semibold opacity-100">change log</span>
        <span>
          {clusters.length} event{clusters.length === 1 ? "" : "s"} · 밴드
          전환 / 자기분포 급변 (D-1 고정)
        </span>
      </div>
      <ul className="flex-1 overflow-y-auto px-3 text-[13px]">
        {clusters.length === 0 && (
          <li className="opacity-50">no events today</li>
        )}
        {visible.map((c) => (
          <Cluster key={c.leading.id} cluster={c} onJump={onJump} />
        ))}
        {clusters.length > VISIBLE_CAP && (
          <li className="py-0.5 opacity-40">
            +{clusters.length - VISIBLE_CAP} lower-priority events hidden (cap{" "}
            {VISIBLE_CAP})
          </li>
        )}
      </ul>
    </footer>
  );
}
