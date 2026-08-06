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

import type { ChangeEvent, EventCluster } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";

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
      /* Menu item, resolved through the kit's instance references
         (Menus - Regular - Menu with Selection - Items): the highlight is a
         rounded rect at r=8 filled with ink at 7 percent, and it is WIDER than
         the item, bleeding 11px into the menu's own padding on each side.
         -mx-1 reproduces that bleed against this menu's p-2. */
      className="kit-menu-item -mx-1 flex w-full items-baseline gap-2 rounded-control-lg px-3 py-1 text-left"
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
    <div className="border-b border-edge py-1.5 last:border-0">
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

export function ChangeLog({
  events,
  onFocus,
}: {
  events: EventCluster[];
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
        /* same kit Bordered button as the theme toggle: 24px, ink 8 percent,
           Medium 13, no border, no shadow */
        className="kit-button flex items-center rounded-full px-3 transition-colors"
        title="어제 대비 오늘 기록된 변화 (D-1 고정)"
      >
        {n > 0 ? `변화 ${n}` : "변화 없음"}
      </button>
      {open && (
        <>
          {/* click-away scrim */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          {/* Floating surface, kit values (Popovers - South-Center): the body is
              translucent rather than opaque, and the shadow is a single large
              soft drop at 0,18 blur 46 black 25 percent — far softer and lower
              than the Tailwind shadow-lg it replaces. backdrop-blur is what
              makes the translucency legible; unlike the header band, content
              really does pass under this one. */}
          <div className="absolute right-0 z-40 mt-1 max-h-[70vh] w-[320px] overflow-y-auto rounded-popover border border-edge bg-popover/70 p-2 shadow-popover backdrop-blur-xl">
            <div className="px-2 pb-1 text-[11px] opacity-45">
              어제 대비 변화 · D-1 고정
            </div>
            {n === 0 ? (
              <p className="px-2 py-3 text-[13px] opacity-55">
                오늘 기록된 변화가 없어요.
              </p>
            ) : (
              events.map((c, i) => (
                <Cluster key={`${c.leading.id}-${i}`} c={c} onFocus={focus} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
