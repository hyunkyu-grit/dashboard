'use client';

import { useEffect, useMemo, useState } from 'react';

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TextCaption, TextTitle3 } from '@coinbase/cds-web/typography';
import { CartesianChart } from '@coinbase/cds-web/visualizations/chart';

import { CandidateB } from '@/chart/CandidateB';
import { CandleLayerA, type Bar } from '@/chart/CandleLayerA';
import { seriesUrl } from '@/lib/staticPaths';

/**
 * PASS B harness. `?c=a|b` picks the candidate, `?n=` caps the bar count,
 * `?i=w|d` picks weekly (real OHLC from the backend) or daily.
 *
 * Daily OHLC is NOT served — the backend gives daily closes and only w/m
 * candles. B2b needs 2,500 daily BARS, and the node count depends on the bar
 * count, not on the values, so daily bars are derived from the daily closes
 * (o = previous close, h/l = the max/min of o and c). Stated plainly because it
 * is synthetic: it is a rendering benchmark, not a price series.
 */
async function loadBars(interval: 'w' | 'd'): Promise<Bar[]> {
  if (interval === 'w') {
    const r = await fetch(seriesUrl('3Y', 'w'));
    const j = (await r.json()) as { bars: Bar[] };
    return j.bars;
  }
  const r = await fetch(seriesUrl('3Y', 'full'));
  const j = (await r.json()) as { points: { t: string; v: number }[] };
  const out: Bar[] = [];
  let prev = j.points[0]?.v ?? 0;
  for (const p of j.points) {
    if (p.v == null) continue;
    const o = prev;
    const c = p.v;
    out.push({ t: p.t, o, c, h: Math.max(o, c), l: Math.min(o, c) });
    prev = c;
  }
  return out;
}

export default function ChartHarness() {
  const [bars, setBars] = useState<Bar[]>([]);
  const [candidate, setCandidate] = useState<'a' | 'b'>('a');
  const [limit, setLimit] = useState(520);
  const [interval, setInterval] = useState<'w' | 'd'>('w');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get('c');
    if (c === 'a' || c === 'b') setCandidate(c);
    const i = q.get('i');
    if (i === 'w' || i === 'd') setInterval(i);
    const n = Number(q.get('n'));
    if (Number.isFinite(n) && n > 0) setLimit(n);
  }, []);

  useEffect(() => {
    let live = true;
    loadBars(interval).then((b) => {
      if (live) setBars(b);
    });
    return () => {
      live = false;
    };
  }, [interval]);

  const shown = useMemo(() => bars.slice(-limit), [bars, limit]);

  const series = useMemo(
    () => [
      {
        id: 'close',
        // The series must name the axis, or CDS looks up DEFAULT_AXIS_ID, finds
        // nothing, and renders an empty <svg> with no error at all.
        xAxisId: 'x',
        data: shown.map((b) => [Date.parse(b.t), b.c] as [number, number]),
      },
    ],
    [shown],
  );

  /* THE B1 ATTEMPT, made explicitly rather than left to inference.
   * CDS has no time scale, but `scaleType: 'linear'` over an epoch-millisecond
   * domain is the same thing for a chart that draws no date ticks. Without the
   * explicit domain the x scale falls back to the data INDEX, which is exactly
   * the compressed-index spacing B1 rejects — measured: bar gaps came back as
   * ~2.7e9 px, i.e. the scale was never mapping the epoch values at all. */
  const xAxis = useMemo(() => {
    if (shown.length === 0) return undefined;
    return {
      id: 'x',
      scaleType: 'linear' as const,
      domainLimit: 'strict' as const,
      domain: {
        min: Date.parse(shown[0].t),
        max: Date.parse(shown[shown.length - 1].t),
      },
    };
  }, [shown]);

  return (
    <VStack background="bg" minHeight="100vh" gap={1} padding={2}>
      <HStack alignItems="baseline" gap={2}>
        <TextTitle3 as="h1">chart harness</TextTitle3>
        <TextCaption as="span" color="fgMuted" data-sr-probe="meta">
          {`candidate=${candidate} interval=${interval} bars=${shown.length}`}
        </TextCaption>
      </HStack>

      {shown.length === 0 ? (
        <TextCaption as="span" color="fgMuted">
          loading
        </TextCaption>
      ) : candidate === 'a' ? (
        <div data-sr-chart="a" style={{ width: '100%', height: 420 }}>
          <CartesianChart series={series} xAxis={xAxis} height={420} enableScrubbing>
            <CandleLayerA bars={shown} />
          </CartesianChart>
        </div>
      ) : (
        <div data-sr-chart="b" style={{ width: '100%' }}>
          <CandidateB bars={shown} />
        </div>
      )}
    </VStack>
  );
}
