"use client";

/* Bottom strip (strip session, Pass C) — chrome pinned to the bottom of the
 * viewport, above everything, on every tab.
 *
 * WHY: five tabs and two hundred rows. Deep in the forward tab a reader has no
 * idea where 10Y is, and 10Y is the reference every other number is judged
 * against. Three ANCHORS carry that: a level (10Y), a slope (3s10s) and a
 * forward (1Yx1Y), so all three curve modes are represented. Every figure
 * already exists in the summary payload — nothing was added to the backend.
 *
 * Right: the next policy meeting and its countdown (ui/calendar.ts). When the
 * calendar file has run out the strip SAYS SO rather than showing nothing or a
 * stale date — a file that stops leaves the screen looking correct.
 *
 * Same register as everywhere else: terse labels, tabular numerals, no prose.
 * Collapsible, remembered; collapsed leaves a thin handle. */

import { useSyncExternalStore } from "react";

import { dirClass, fmtDelta, fmtLevel } from "@/lib/format";

import { countdown, nextMeeting, shortDate, todayISO } from "./calendar";
import type { Row } from "./rows";

/* Both client-only reads below go through useSyncExternalStore rather than
 * an effect: the wall clock and localStorage are external systems with a
 * server snapshot (null / false) and a client snapshot, which is exactly
 * what it is for. Setting state in an effect instead is what the compiler
 * lint rejects, and it would cascade a render on every mount. */

const noopSubscribe = () => () => {};

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
  // the wall clock is client-only: the server snapshot is null, so the strip
  // renders its event side after hydration and never mismatches
  const today = useSyncExternalStore(
    noopSubscribe,
    () => todayISO(),
    () => null,
  );

  const anchors = ANCHOR_IDS.map((id) => rows.find((r) => r.id === id)).filter(
    (r): r is Row => !!r,
  );
  const next = today ? nextMeeting(today) : null;

  if (collapsed) {
    return (
      <div
        className="fixed inset-x-0 bottom-0 z-40 flex justify-center border-t border-edge bg-tile"
        style={{ height: STRIP_H.collapsed }}
      >
        <button
          type="button"
          onClick={() => onCollapsed(false)}
          className="h-full px-6"
          title="지표 바 펼치기"
        >
          <span className="block h-[3px] w-8 rounded-full bg-edge" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 border-t border-edge bg-tile px-3 text-[12px]"
      style={{ height: STRIP_H.open }}
    >
      {anchors.map((r) => (
        <Anchor key={r.id} row={r} onPin={onPin} />
      ))}
      <span className="flex-1" />
      {today && (
        <span className="whitespace-nowrap opacity-55">
          {next ? (
            <>
              {next.label} {shortDate(next.date)}
              <span className="opacity-45"> · </span>
              {countdown(today, next.date)}
            </>
          ) : (
            // the file has run out: say so plainly (Pass D) — never a stale
            // date, never a blank where a countdown belongs
            "일정 파일 갱신 필요"
          )}
        </span>
      )}
      <button
        type="button"
        onClick={() => onCollapsed(true)}
        className="ml-2 px-1 opacity-45 hover:opacity-100"
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
