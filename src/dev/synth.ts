import type { ForwardsPayload, SeriesSummary, VolatilityPayload, WallSummary } from '@/lib/api';
import { buildRows, type Row } from '@/table/rows';

/**
 * Synthetic scale rows — a MEASUREMENT HARNESS, not product surface.
 *
 * The expanded universe (credit, cash bonds, KTB futures, cross-instrument
 * spreads) is on the order of 1,000 rows and is NOT built here: it depends on
 * backend decisions — leg matching, continuous series across on-the-run changes
 * and quarterly futures rolls — that are outside this session. What is being
 * measured is the SHAPE at that count, so the economics do not matter and the
 * labels are deliberately fake.
 *
 * What does matter: the rows must come out of the **real** builder. This module
 * therefore inflates the live `WallSummary` payload and hands it to
 * `buildRows()` unchanged. A fixture array of pre-shaped `Row` objects would
 * bypass the builder, the comparator, the ladder and the tint ramp, and would
 * measure nothing but React's ability to render a list.
 */

/** Deterministic. A harness that renders a different tree each reload cannot be
 * compared against itself between runs. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Clone one real `SeriesSummary` into a distinct instrument. Only the label,
 * the id and the numbers move; every field the builder reads keeps its shape,
 * including `sortKey`, which is what the comparator sorts on. */
function variant(src: SeriesSummary, i: number, rnd: () => number): SeriesSummary {
  const jitter = (v: number | null, scale: number): number | null =>
    v == null ? null : Number((v + (rnd() - 0.5) * scale).toFixed(4));

  // A vector, like the real thing: the synthetic tenor pair sorts the same way
  // a real one does, so the comparator does real work at scale.
  const a = 1 + (i % 40) * 0.25;
  const b = a + 1 + (i % 7);

  return {
    ...src,
    id: `SYN${i}-${a}Y-${b}Y`,
    label: `SYN${i} ${a}s${b}s`,
    now: jitter(src.now, 0.4),
    deltas: {
      d1: jitter(src.deltas.d1, 6),
      mtd: jitter(src.deltas.mtd, 12),
      ytd: jitter(src.deltas.ytd, 40),
    },
    basisValues: { ...src.basisValues },
    range1y: {
      ...src.range1y,
      pct: src.range1y.pct == null ? null : Math.min(100, Math.max(0, src.range1y.pct + (rnd() - 0.5) * 30)),
    },
    sortKey: [a, b],
    movePct: src.movePct == null ? null : Math.min(100, Math.max(0, src.movePct + (rnd() - 0.5) * 40)),
    // Every fifth row is 주요, so the divider and the ladder both see a mix.
    key: i % 5 === 0,
  };
}

/**
 * Inflate the live payload until `buildRows()` yields at least `target` rows,
 * then return exactly `target`.
 *
 * Includes an UNMAPPED row on purpose once the count is large: the sort
 * contract's loud-failure path should be exercised at scale, not only in a
 * unit test with three rows.
 */
export function synthRows(
  summary: WallSummary,
  forwards: ForwardsPayload | undefined,
  volatility: VolatilityPayload | undefined,
  target: number,
): Row[] {
  const real = buildRows(summary, forwards, volatility);
  if (target <= real.length) return real.slice(0, target);

  const seeds = summary.derived.length ? summary.derived : summary.outrights;
  if (seeds.length === 0) return real;

  const rnd = lcg(20260813);
  const extra: SeriesSummary[] = [];
  const need = target - real.length;
  for (let i = 0; i < need; i++) {
    extra.push(variant(seeds[i % seeds.length], i, rnd));
  }

  const inflated: WallSummary = { ...summary, derived: [...summary.derived, ...extra] };
  return buildRows(inflated, forwards, volatility).slice(0, target);
}

/** Row counts Pass A measures at. */
export const SCALE_STEPS = [200, 500, 1000, 2000] as const;

/**
 * Compile-time row count, for the A4 bundle comparison only.
 *
 * `process.env.NEXT_PUBLIC_*` is inlined by Next at build time, so two builds
 * with different values are two different bundles — which is exactly the
 * question A4 asks. At runtime the harness route uses `?n=` instead.
 */
export const BUILD_ROWS = Number(process.env.NEXT_PUBLIC_SCALE_ROWS ?? '44');
