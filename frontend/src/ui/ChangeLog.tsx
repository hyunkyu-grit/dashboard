"use client";

/* Change-log popover (§12; closing session part 2, Pass D). The events rule
 * (backend/app/events.py, candidate (c): band transition ∪ own-Δ percentile,
 * correlation-collapsed) was designed and 500-day-replayed in Session 11, then
 * orphaned when the list-first redesign removed its surface — computed every
 * request, rendered nowhere. This is that surface: a compact popover off the
 * header chrome, NOT a permanent strip (the list-first shell gives its vertical
 * space to the table). Each line is click-to-focus — it pins + scrolls the
 * table to that instrument via the tile registry (§3), the same routing the
 * command bar uses. The log is frequently empty by design (~31% of days); an
 * empty state is itself information ("조용한 하루"), so the trigger is always
 * present and shows the count. */

import { useEffect, useState } from "react";

import type { ChangeEvent, EventCluster, RegretEntry } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";
import { directionLabel, fmtKrw } from "./BacktestWindow";

const REASON_LABEL: Record<"transition" | "move", string> = {
  transition: "구간 전환", // crossed into/out of the extreme percentile band
  move: "큰 변동", // today's |Δ| is extreme vs the series' own 10y change history
};

function EventLine({
  e,
  onFocus,
}: {
  e: ChangeEvent;
  onFocus: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onFocus(e.id)}
      className="flex w-full items-baseline gap-2 rounded-[6px] px-2 py-1 text-left hover:bg-page"
      title={`${e.label} — ${e.reasons.map((r) => REASON_LABEL[r]).join(", ")}`}
    >
      <span className="min-w-0 flex-1 truncate text-[13px]">{e.label}</span>
      {e.reasons.map((r) => (
        <span
          key={r}
          className="shrink-0 rounded-full border border-edge px-1.5 text-[11px] opacity-70"
        >
          {REASON_LABEL[r]}
        </span>
      ))}
      <span className={`shrink-0 text-[13px] tabular-nums ${dirClass(e.deltaBp)}`}>
        {fmtBp(e.deltaBp)}
      </span>
    </button>
  );
}

function Cluster({
  c,
  onFocus,
}: {
  c: EventCluster;
  onFocus: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-edge py-1 last:border-0">
      <EventLine e={c.leading} onFocus={onFocus} />
      {c.count > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="ml-2 mt-0.5 text-[11px] opacity-55 hover:opacity-90"
          >
            {open ? "관련 숨기기" : `연관 ${c.count}건`}
          </button>
          {open && (
            <div className="ml-3 border-l border-edge pl-1">
              {c.related.map((r) => (
                <EventLine key={r.id} e={r} onFocus={onFocus} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** "M.D" from an ISO date — the regret list is a recent-memory list, so the
 * year is noise (the lookback is 20 business days by construction). */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}.${Number(d)}`;
}

/* 라고 할 때 살걸 — one past log line, priced. Line 1 is the log's own
 * grammar (date, label, Δbp); line 2 is what following it meant (the
 * backtest's direction words — imported from BacktestWindow so the two
 * surfaces cannot drift into two vocabularies) and what it is worth now.
 * The click is the log's click: focus the instrument.
 * Exported for guards/regret-list.test.ts. */
export function RegretLine({
  r,
  onFocus,
}: {
  r: RegretEntry;
  onFocus: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onFocus(r.id)}
      className="w-full rounded-[6px] px-2 py-1 text-left hover:bg-page"
      title={`${r.date} ${r.label} — ${r.entry}에 ${directionLabel(r.id, r.direction)}, 100억`}
    >
      <span className="flex items-baseline gap-2">
        <span className="shrink-0 text-[12px] tabular-nums opacity-45">
          {shortDate(r.date)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{r.label}</span>
        <span
          className={`shrink-0 text-[12px] tabular-nums ${dirClass(r.deltaBp)}`}
        >
          {fmtBp(r.deltaBp)}
        </span>
      </span>
      <span className="flex items-baseline gap-2 pl-[34px]">
        <span className="min-w-0 flex-1 truncate text-[12px] opacity-55">
          {directionLabel(r.id, r.direction)}
        </span>
        <span
          className={`shrink-0 text-[13px] tabular-nums ${dirClass(r.pnl)}`}
        >
          {fmtKrw(r.pnl)}
        </span>
      </span>
    </button>
  );
}

export function ChangeLog({
  events,
  regret,
  onFocus,
}: {
  events: EventCluster[];
  regret: RegretEntry[];
  onFocus: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const n = events.length;
  const focus = (id: string) => {
    onFocus(id);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-[8px] px-2 py-0.5 text-[12px] opacity-60 hover:opacity-100"
        title="어제 대비 오늘 기록된 변화 (D-1 고정)"
      >
        {n > 0 ? `변화 ${n}` : "변화 없음"}
      </button>
      {open && (
        <>
          {/* click-away scrim */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 max-h-[70vh] w-[320px] overflow-y-auto rounded-[12px] border border-edge bg-popover p-2 shadow-lg">
            <div className="px-2 pb-1 text-[11px] opacity-45">
              어제 대비 변화 · D-1 고정
            </div>
            {n === 0 ? (
              <p className="px-2 py-3 text-[13px] opacity-55">
                오늘 기록된 변화가 없습니다 — 조용한 하루입니다.
              </p>
            ) : (
              events.map((c, i) => (
                <Cluster key={`${c.leading.id}-${i}`} c={c} onFocus={focus} />
              ))
            )}
            <div className="mt-2 border-t border-edge pt-1">
              <div className="px-2 pb-1 text-[11px] opacity-45">
                라고 할 때 살걸 · 다음 영업일에 방향대로 100억, 현재까지
              </div>
              {regret.length === 0 ? (
                <p className="px-2 py-3 text-[13px] opacity-55">
                  지난 20영업일에 기록된 변화가 없습니다.
                </p>
              ) : (
                regret.map((r, i) => (
                  <RegretLine key={`${r.date}-${r.id}-${i}`} r={r} onFocus={focus} />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
