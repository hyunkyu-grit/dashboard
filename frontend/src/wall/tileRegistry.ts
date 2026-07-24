"use client";

/* Tile registry — the single lookup that turns a series name or an outlier
 * event into a pannable DOM element (design spec §3: change log line →
 * pan; command bar name → pan).
 *
 * Tiles register themselves on mount with an anchor id, a human label, and
 * the search tokens that should resolve to them. When Band 3's per-series
 * tiles arrive they register precise anchors here and the command bar +
 * change log route to them automatically — no consumer changes.
 */

export interface TileEntry {
  anchor: string;
  label: string;
  tokens: string[]; // lowercase search terms
  el: HTMLElement;
}

const registry = new Map<string, TileEntry>();
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version += 1;
  listeners.forEach((l) => l());
}

/** Monotonic counter for useSyncExternalStore (a stable primitive snapshot;
 * allTiles() returns a fresh array so it can't be a snapshot itself). */
export function getVersion(): number {
  return version;
}

export function registerTile(entry: TileEntry): () => void {
  registry.set(entry.anchor, entry);
  bump();
  return () => {
    if (registry.get(entry.anchor)?.el === entry.el) {
      registry.delete(entry.anchor);
      bump();
    }
  };
}

export function getTile(anchor: string): TileEntry | undefined {
  return registry.get(anchor);
}

export function allTiles(): TileEntry[] {
  return [...registry.values()];
}

/** Rank tiles by a query against label + tokens (prefix > substring). */
export function searchTiles(query: string): TileEntry[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return allTiles();
  const scored: { entry: TileEntry; score: number }[] = [];
  for (const entry of registry.values()) {
    const hay = [entry.label.toLowerCase(), ...entry.tokens];
    let best = Infinity;
    for (const h of hay) {
      const norm = h.replace(/\s+/g, "");
      if (norm === q) best = Math.min(best, 0);
      else if (norm.startsWith(q)) best = Math.min(best, 1);
      else if (norm.includes(q)) best = Math.min(best, 2);
    }
    if (best < Infinity) scored.push({ entry, score: best });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.entry);
}

export function subscribeTiles(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
