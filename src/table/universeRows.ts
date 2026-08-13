import type { BasisKey, Unit } from '@/lib/api';
import { API_BASE } from '@/lib/staticPaths';

import type { Row } from './rows';

/**
 * The expanded universe, mapped into the row shape the table already speaks.
 *
 * The backend finishes every number (`backend/app/universe.py`) — level, the three
 * deltas, the 52-week statistics and the percentile. This file does no arithmetic on
 * market data, which is the §16 boundary the swap monitor already holds to; a second
 * place that computes bp would be a second place to disagree.
 */

export type UniverseKind = 'govt' | 'credit' | 'bss' | 'futures';

export type AbsentClass = {
  id: string;
  label: string;
  /** Why it is empty, in the reader's terms. An empty section that cannot say why
   * reads as a bug; one that can, reads as a fact about the data. */
  reason: string;
};

type UniverseRow = {
  id: string;
  label: string;
  kind: UniverseKind;
  unit: Unit;
  now: number | null;
  deltas: Record<BasisKey, number | null>;
  range1y: { min: number | null; max: number | null; avg: number | null; pct: number | null };
  sortKey: number[];
  quoted: boolean;
  movePct: number | null;
  key: boolean;
};

export type UniversePayload = {
  asof: string;
  rows: UniverseRow[];
  sources: Record<string, { table: string; asof: string | null }>;
  absent: AbsentClass[];
};

export async function fetchUniverse(): Promise<UniversePayload> {
  const r = await fetch(`${API_BASE}/api/universe`);
  if (!r.ok) throw new Error(`universe: HTTP ${r.status}`);
  return r.json();
}

/** Straight field mapping — no derivation. `seriesId` is null because these rows have
 * no stage-2 history route yet; the table renders `—` rather than pretending. */
export function toRows(p: UniversePayload): Row[] {
  return p.rows.map((u) => ({
    id: u.id,
    label: u.label,
    group: u.kind,
    unit: u.unit,
    now: u.now,
    changes: { ...u.deltas },
    pct: u.range1y.pct,
    seriesId: null,
    rangeHigh: u.range1y.max,
    rangeLow: u.range1y.min,
    rangeAvg: u.range1y.avg,
    sortKey: u.sortKey,
    movePct: u.movePct,
    quoted: u.quoted,
    key: u.key,
  })) as Row[];
}
