/* Unified instrument rows for the list-first table (DESIGN §2). One row per
 * instrument across all groups; every field comes from data already served
 * (summary + forwards). Instrument labels are technical, never translated. */

import type {
  BasisKey,
  ForwardsPayload,
  SeriesSummary,
  WallSummary,
} from "@/lib/api";

export type Group = "outright" | "spread" | "forward" | "vol";

export const BASIS_ORDER: BasisKey[] = ["d1", "wtd", "mtd", "qtd", "ytd"];

export const GROUP_LABEL: Record<Group, string> = {
  outright: "아웃라이트",
  spread: "스프레드",
  forward: "포워드",
  vol: "변동성",
};

export interface Row {
  id: string;
  label: string; // display instrument name
  group: Group;
  unit: "%" | "bp";
  now: number | null;
  changes: Record<BasisKey, number | null>; // bp vs each basis
  pct: number | null; // 10y percentile, null if none
  seriesId: string | null; // stage-2 history id, null = no history
  oneLiner: string;
}

/** "1Y-10Y" → "1s10s", "2Y-5Y-10Y" → "2s5s10s" (trader shorthand). */
export function traderName(id: string): string {
  return id.split("-").map((t) => t.replace("Y", "")).join("s") + "s";
}

const SHORT_BASIS: Record<BasisKey, string> = {
  d1: "어제",
  wtd: "주간",
  mtd: "월간",
  qtd: "분기",
  ytd: "연초",
};

/** 한 줄 — ≤~12 chars, from percentile then the largest change (§2/§15). */
export function oneLiner(
  pct: number | null,
  changes: Record<BasisKey, number | null>,
  hasData: boolean,
): string {
  if (!hasData) return "아직 준비 중이에요";
  if (pct != null && pct >= 95) return "10년 고점권";
  if (pct != null && pct <= 5) return "10년 저점권";
  let best: BasisKey | null = null;
  let mag = 0;
  for (const b of BASIS_ORDER) {
    const v = changes[b];
    if (v != null && Math.abs(v) > mag) {
      mag = Math.abs(v);
      best = b;
    }
  }
  if (!best || mag < 0.5) return "오늘은 조용해요";
  const dir = (changes[best] ?? 0) > 0 ? "상승" : "하락";
  return `${SHORT_BASIS[best]} ${mag.toFixed(0)}bp ${dir}`;
}

function fromSummary(s: SeriesSummary, group: Group, label: string): Row {
  return {
    id: s.id,
    label,
    group,
    unit: s.unit,
    now: s.now,
    changes: {
      d1: s.deltas.d1,
      wtd: s.deltas.wtd,
      mtd: s.deltas.mtd,
      qtd: s.deltas.qtd,
      ytd: s.deltas.ytd,
    },
    pct: s.range10y.pct,
    seriesId: s.id,
    oneLiner: oneLiner(s.range10y.pct, s.deltas, s.now != null),
  };
}

const VOL_TENORS = ["1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"];

export function buildRows(
  summary: WallSummary,
  forwards: ForwardsPayload | undefined,
): Row[] {
  const rows: Row[] = [];

  for (const o of summary.outrights) {
    rows.push(fromSummary(o, "outright", o.id));
  }
  for (const d of summary.derived) {
    rows.push(fromSummary(d, "spread", traderName(d.id)));
  }
  if (forwards) {
    for (const kf of forwards.keyForwards) {
      const changes = { ...kf.deltas };
      rows.push({
        id: `fwd:${kf.label}`,
        label: kf.label,
        group: "forward",
        unit: "%",
        now: kf.values.now,
        changes,
        pct: null,
        seriesId: null, // forwards have no stage-2 history
        oneLiner: oneLiner(null, changes, kf.values.now != null),
      });
    }
  }
  // Volatility rows are placeholders until a formula arrives (§13).
  for (const t of VOL_TENORS) {
    rows.push({
      id: `vol:${t}`,
      label: `${t} σ`,
      group: "vol",
      unit: "bp",
      now: null,
      changes: { d1: null, wtd: null, mtd: null, qtd: null, ytd: null },
      pct: null,
      seriesId: null,
      oneLiner: "아직 준비 중이에요",
    });
  }
  return rows;
}
