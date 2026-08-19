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
export function CandleLayerA({
  bars,
  xValue = (b) => Date.parse(b.t),
  xAxisId,
  yAxisId,
}: {
  bars: Bar[];
  /** 한 봉이 x 축에서 갖는 **값**. 기본은 epoch 밀리초(선형 축, `/chart` 하니스).
   *
   * 미리보기 pane 은 **인덱스**를 준다. 그쪽 축은 날짜 문자열 배열(`xAxis.data`)
   * 이라 스케일이 인덱스를 받기 때문이고, 주/월봉은 간격이 고른 묶음이라 달력
   * 간격이 필요하지 않다 — 불규칙한 간격 때문에 epoch 이 필요했던 것은 **일별**
   * 점을 그리던 하니스 쪽 사정이다. 두 호출부가 같은 레이어를 쓰되 축에 대한
   * 가정만 각자 준다. */
  xValue?: (bar: Bar, i: number) => number;
  /** 축 id. **축에 이름이 있으면 여기도 그 이름을 줘야 한다** — 이 함정의 세 번째
   * 재발이 이 자리다(실측 2026-08-18): 미리보기 pane 의 y 축은 `main` 이라
   * `getYScale()` 인자 없는 조회가 `undefined` 를 돌려줬고, 이 레이어가 **조용히
   * 아무것도 안 그려서** 주봉 화면에 기준선만 남았다. `/chart` 하니스는 축이
   * 무명이라 통과했다 — 그래서 하니스만 믿으면 안 된다. */
  xAxisId?: string;
  yAxisId?: string;
}) {
  const { getXScale, getYScale, drawingArea } = useCartesianChartContext();
  const x = getXScale(xAxisId);
  const y = getYScale(yAxisId);
  if (!x || !y || bars.length === 0) return null;

  // Bar width from the median calendar gap, not from `width / count`: with real
  // dates the gaps are uneven (holidays), and dividing by the count would draw
  // a uniform grid over a non-uniform axis — the exact defect B1 tests for.
  const first = xValue(bars[0], 0);
  const last = xValue(bars[bars.length - 1], bars.length - 1);
  const span = Math.max(1, x(last) - x(first));
  const w = Math.max(1, Math.min(12, (span / bars.length) * 0.7));

  return (
    <g data-sr-candles="a" pointerEvents="none">
      {bars.map((b, i) => {
        const cx = x(xValue(b, i));
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
