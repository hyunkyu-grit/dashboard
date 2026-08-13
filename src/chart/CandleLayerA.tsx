'use client';

import { useCartesianChartContext } from '@coinbase/cds-web/visualizations/chart';

export type Bar = { t: string; o: number; h: number; l: number; c: number };

/**
 * Candidate A's candle layer — drawn as a child of CDS `CartesianChart`, using
 * the documented escape hatch (`getXScale()`, `getYScale()`, `drawingArea`).
 *
 * CDS ships no candlestick. It does ship the scales, and `Series.data` accepts
 * `[number, number]` pairs, so **epoch milliseconds on a linear x scale** is a
 * legitimate route to calendar spacing — the x value is a number and the scale
 * does not care that the number is a date. What CDS genuinely does not supply
 * is date tick generation and formatting, which this product does not use: it
 * draws 3–4 unticked date captions.
 *
 * Node budget: two elements per bar (a wick line and a body rect). At 520
 * weekly bars that is 1,040 plus the chart's own chrome — the B2 cap of 2,000
 * is the reason the body is a `<rect>` and not a `<path>` per bar with a
 * separate outline.
 */
export function CandleLayerA({ bars }: { bars: Bar[] }) {
  const { getXScale, getYScale, drawingArea } = useCartesianChartContext();
  const x = getXScale();
  const y = getYScale();
  if (!x || !y || bars.length === 0) return null;

  // Bar width from the median calendar gap, not from `width / count`: with real
  // dates the gaps are uneven (holidays), and dividing by the count would draw
  // a uniform grid over a non-uniform axis — the exact defect B1 tests for.
  const first = Date.parse(bars[0].t);
  const last = Date.parse(bars[bars.length - 1].t);
  const span = Math.max(1, x(last) - x(first));
  const w = Math.max(1, Math.min(12, (span / bars.length) * 0.7));

  return (
    <g data-sr-candles="a" pointerEvents="none">
      {bars.map((b) => {
        const cx = x(Date.parse(b.t));
        const yo = y(b.o);
        const yc = y(b.c);
        const up = b.c >= b.o;
        const top = Math.min(yo, yc);
        const height = Math.max(1, Math.abs(yc - yo));
        const stroke = up ? 'var(--sr-up)' : 'var(--sr-down)';
        return (
          <g key={b.t}>
            <line x1={cx} x2={cx} y1={y(b.h)} y2={y(b.l)} stroke={stroke} strokeWidth={1} />
            <rect x={cx - w / 2} y={top} width={w} height={height} fill={stroke} />
          </g>
        );
      })}
      <rect
        x={drawingArea.x}
        y={drawingArea.y}
        width={0}
        height={0}
        data-sr-drawing-area={`${Math.round(drawingArea.width)}x${Math.round(drawingArea.height)}`}
      />
    </g>
  );
}
