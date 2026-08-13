'use client';

import { useEffect, useRef } from 'react';

import type { Bar } from './CandleLayerA';

/**
 * Candidate B — `lightweight-charts` mounted inside the CDS shell. The control.
 *
 * It is the only new dependency this session may add. Colours come from the
 * frozen direction pair through `getComputedStyle`, because the library takes
 * hex strings and cannot read a CSS custom property — this is the one place a
 * colour leaves `direction.css`, and it leaves it by *reading* the token rather
 * than by restating the value, so `guards/color-source.test.ts` still holds.
 */
export function CandidateB({ bars, height = 420 }: { bars: Bar[]; height?: number }) {
  const host = useRef<HTMLDivElement | null>(null);
  const disposed = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || bars.length === 0) return;

    let cancelled = false;

    void (async () => {
      const lw = await import('lightweight-charts');
      if (cancelled || !host.current) return;

      const cs = getComputedStyle(el);
      const up = cs.getPropertyValue('--sr-up').trim();
      const down = cs.getPropertyValue('--sr-down').trim();

      /* D4.3 — chrome removal. No gridlines, no axis lines; value labels float
       * right in muted ink; date captions are sparse and unticked. The muted ink
       * is READ from the CDS token rather than restated, same as the direction
       * pair — the library takes strings and cannot resolve a custom property. */
      const muted = cs.getPropertyValue('--color-fgMuted').trim() || cs.color;

      const chart = lw.createChart(el, {
        height,
        layout: { background: { color: 'transparent' }, textColor: muted },
        grid: { horzLines: { visible: false }, vertLines: { visible: false } },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: { top: 0.12, bottom: 0.12 },
        },
        timeScale: {
          borderVisible: false,
          ticksVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        crosshair: { horzLine: { labelVisible: false } },
      });

      const series = chart.addCandlestickSeries({
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
      });

      series.setData(
        bars.map((b) => ({ time: b.t as never, open: b.o, high: b.h, low: b.l, close: b.c })),
      );

      /* A dot at the last point — the "where are we now" marker. It is the only
       * mark on the chart that is not a bar, which is the point of it. */
      const last = bars[bars.length - 1];
      if (last) {
        series.setMarkers([
          {
            time: last.t as never,
            position: 'inBar',
            shape: 'circle',
            color: last.c >= last.o ? up : down,
          },
        ]);
      }

      chart.timeScale().fitContent();

      /* B4 evidence: recompute visible-range high/low whenever the range moves.
       * The library hands the visible logical range straight over — no
       * hit-testing, no manual index maths. The result is written to a data
       * attribute so the probe can read it without a screenshot. */
      const recompute = () => {
        const r = chart.timeScale().getVisibleLogicalRange();
        if (!r) return;
        const from = Math.max(0, Math.floor(r.from));
        const to = Math.min(bars.length - 1, Math.ceil(r.to));
        let hi = -Infinity;
        let lo = Infinity;
        for (let i = from; i <= to; i++) {
          if (bars[i].h > hi) hi = bars[i].h;
          if (bars[i].l < lo) lo = bars[i].l;
        }
        el.dataset.srVisibleHigh = String(hi);
        el.dataset.srVisibleLow = String(lo);
        el.dataset.srVisibleCount = String(to - from + 1);
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(recompute);
      recompute();

      disposed.current = () => chart.remove();
    })();

    return () => {
      cancelled = true;
      disposed.current?.();
      disposed.current = null;
    };
  }, [bars, height]);

  return <div ref={host} data-sr-candles="b" style={{ width: '100%' }} />;
}
