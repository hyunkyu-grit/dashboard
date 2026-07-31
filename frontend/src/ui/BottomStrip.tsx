"use client";

/* Bottom strip (strip session, Pass C) — chrome pinned to the bottom of the
 * viewport, above everything, on every tab.
 *
 * WHY: five tabs and two hundred rows. Deep in the forward tab a reader has no
 * idea where 10Y is, and 10Y is the reference every other number is judged
 * against. Three ANCHORS carry that: a level (10Y), a slope (3s10s) and a
 * forward (1Yx1Y), so all three curve modes are represented. Every figure
 * already exists in the summary payload — nothing was added to the backend.
 * The anchors ARE the reason the strip exists.
 *
 * The right side used to hold the next policy meeting and its countdown. The
 * calendar was disconnected from the UI (removal session, Pass B) — the data
 * and its logic remain in ui/calendar.ts, unreferenced by design. Re-wiring
 * it means restoring this slot, the chart rules, AND the staleness guard
 * together; see DESIGN. The right end now carries only the collapse control,
 * which keeps the bar anchored at both ends rather than trailing off.
 *
 * Same register as everywhere else: terse labels, tabular numerals, no prose.
 * Collapsible, remembered; collapsed leaves a thin handle. */

import { useSyncExternalStore } from "react";

import { dirClass, fmtDelta, fmtLevel } from "@/lib/format";

import { PAGE_X } from "./pageGutter";
import type { Row } from "./rows";

/** A level, a slope, a forward — one of each mode. Ids as the row builder
 * makes them (spreads keep their leg id; the label is trader shorthand). */
export const ANCHOR_IDS = ["10Y", "3Y-10Y", "1Yx1Y"];

/** Heights the app root pads by, so the last row is never underneath the
 * strip in either state. */
export const STRIP_H = { open: 34, collapsed: 12 };

const STORE_KEY = "bw-strip";

function Anchor({ row, onPin }: { row: Row; onPin: (row: Row) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPin(row)}
      className="flex items-baseline gap-1.5 rounded-[6px] px-1.5 py-0.5 hover:bg-page"
      title={`${row.label} 고정`}
    >
      <span className="opacity-55">{row.label}</span>
      <span className="font-semibold tabular-nums">
        {fmtLevel(row.now, row.unit)}
      </span>
      <span className={`tabular-nums ${dirClass(row.changes.d1)}`}>
        {fmtDelta(row.changes.d1, row.unit)}
      </span>
    </button>
  );
}

export function BottomStrip({
  rows,
  onPin,
  collapsed,
  onCollapsed,
}: {
  rows: Row[];
  onPin: (row: Row) => void;
  collapsed: boolean;
  onCollapsed: (v: boolean) => void;
}) {
  const anchors = ANCHOR_IDS.map((id) => rows.find((r) => r.id === id)).filter(
    (r): r is Row => !!r,
  );

  if (collapsed) {
    // The whole bar is the target: at 12px tall a centred 32px pill is a
    // cruel hit area, and with nothing else on the row there is no reason
    // for anything else to be clickable. The pill stays centred because that
    // is the grabber shape used by the sheets elsewhere in the product — it
    // reads as something folded away, not as an artefact.
    return (
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-tile"
        style={{ height: STRIP_H.collapsed }}
      >
        <button
          type="button"
          onClick={() => onCollapsed(false)}
          className="flex h-full w-full items-center justify-center"
          title="지표 바 펼치기"
        >
          <span className="block h-[3px] w-8 rounded-full bg-edge" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 border-t border-edge bg-tile text-[12px] ${PAGE_X}`}
      style={{ height: STRIP_H.open }}
    >
      {anchors.map((r) => (
        <Anchor key={r.id} row={r} onPin={onPin} />
      ))}
      {/* The collapse control sits WITH the anchors, not at the far edge.
          With the calendar's slot gone the bar has no right-hand content, and
          a lone chevron marooned ~1,700px from the thing it controls read as
          an artefact. Everything the strip offers is now one group at the
          left; the rest of the bar is quiet chrome. */}
      <button
        type="button"
        onClick={() => onCollapsed(true)}
        className="ml-1 px-1 opacity-45 hover:opacity-100"
        title="지표 바 접기"
      >
        ▾
      </button>
    </div>
  );
}

/* Collapsed state lives in localStorage and is read as an external store —
 * the value survives a reload, and writing it notifies every subscriber. */
let listeners: (() => void)[] = [];

function subscribeCollapsed(cb: () => void): () => void {
  listeners = [...listeners, cb];
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === "1";
  } catch {
    return false; // storage unavailable — the strip just won't remember
  }
}

/** Collapsed state, remembered across reloads. */
export function useStripCollapsed(): [boolean, (v: boolean) => void] {
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false, // server: always open, corrected on hydration
  );
  const set = (v: boolean) => {
    try {
      localStorage.setItem(STORE_KEY, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    for (const l of listeners) l();
  };
  return [collapsed, set];
}
