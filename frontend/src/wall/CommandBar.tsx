"use client";

/* Command bar (design spec §3/§10). Hidden by default; `/` or Cmd+K
 * summons it. Typing a series name ("5y", "3s10s", "1yf") pans to that
 * tile. No menu navigation anywhere else in the app. */

import { Command } from "cmdk";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getVersion,
  searchTiles,
  subscribeTiles,
  type TileEntry,
} from "./tileRegistry";

export function CommandBar({ onJump }: { onJump: (el: HTMLElement) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Re-render when tiles register/unregister so results stay current.
  useSyncExternalStore(subscribeTiles, getVersion, () => 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if ((k === "k" && (e.metaKey || e.ctrlKey)) || (k === "/" && !isTyping())) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = searchTiles(query);

  const jump = (entry: TileEntry) => {
    onJump(entry.el);
    setOpen(false);
    setQuery("");
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-page/70 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <Command
        label="명령 바"
        className="w-[420px] overflow-hidden rounded-sm border border-edge-live bg-popover"
        onClick={(e) => e.stopPropagation()}
        shouldFilter={false}
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="종목 이름을 입력하면 그리로 이동해요 — 5y, 3s10s, 1yf"
          className="w-full border-b border-edge bg-transparent px-3 py-2 text-[14px] outline-none placeholder:opacity-40"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <Command.List className="max-h-[40vh] overflow-y-auto p-1">
          <Command.Empty className="px-2 py-3 text-[13px] opacity-50">
            찾는 종목이 없어요
          </Command.Empty>
          {results.map((entry) => (
            <Command.Item
              key={entry.anchor}
              value={entry.anchor}
              onSelect={() => jump(entry)}
              className="flex cursor-pointer items-baseline justify-between rounded-sm px-2 py-1.5 text-[13px] data-[selected=true]:bg-interactive data-[selected=true]:text-on-interactive"
            >
              <span>{entry.label}</span>
              <span className="opacity-40">{entry.anchor}</span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}

function isTyping(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}
