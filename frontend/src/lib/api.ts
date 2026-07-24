/* Server-state types + fetchers. All derived series come from the backend;
 * the browser never computes a series (design spec §4). */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8100";

export type BasisKey = "d1" | "wtd" | "mtd" | "qtd" | "ytd";

export interface SparkPoint {
  t: string;
  v: number;
}

export interface SeriesSummary {
  id: string;
  label: string;
  kind: "outright" | "spread" | "fly";
  unit: "%" | "bp";
  now: number | null;
  deltas: Record<BasisKey, number | null>;
  basisValues: Record<BasisKey, number | null>;
  range10y: { min: number | null; max: number | null; pct: number | null };
  spark: SparkPoint[];
}

export interface ChangeEvent {
  id: string;
  label: string;
  kind: "outright" | "spread" | "fly";
  unit: "%" | "bp";
  now: number | null;
  pct: number | null;
  deltaBp: number | null; // always D-1 (event basis is fixed, DESIGN §12)
  reasons: ("transition" | "move")[];
  anchor: string;
}

export interface EventCluster {
  leading: ChangeEvent;
  related: ChangeEvent[];
  count: number;
}

export interface WallSummary {
  asof: string;
  basisDates: Record<BasisKey, string | null>;
  specNodeOrder: string[];
  displayTenors: string[];
  missingNodes: string[];
  outrights: SeriesSummary[];
  derived: SeriesSummary[];
  events: EventCluster[];
}

export async function fetchWallSummary(): Promise<WallSummary> {
  const res = await fetch(`${API_BASE}/api/wall/summary`);
  if (!res.ok) throw new Error(`wall summary: HTTP ${res.status}`);
  return res.json();
}

export type AnyBasis = "now" | BasisKey;

export interface ForwardCell {
  start: string;
  live: boolean;
  values: Record<AnyBasis, number>;
  deltas: Record<BasisKey, number>;
}

export interface KeyForward {
  label: string;
  values: Record<AnyBasis, number>;
  deltas: Record<BasisKey, number>;
}

export interface ForwardsPayload {
  asof: string;
  basisDates: Record<BasisKey, string | null>;
  startPoints: { label: string; t: number; date: string }[];
  tenors: string[];
  grid: Record<string, ForwardCell[]>;
  keyForwards: KeyForward[];
}

export async function fetchForwards(): Promise<ForwardsPayload> {
  const res = await fetch(`${API_BASE}/api/forwards`);
  if (!res.ok) throw new Error(`forwards: HTTP ${res.status}`);
  return res.json();
}
