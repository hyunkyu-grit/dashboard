'use client';

import { useEffect, useRef, useState } from 'react';

import { VStack } from '@coinbase/cds-web/layout';
import { TextCaption, TextLabel2 } from '@coinbase/cds-web/typography';

import { fmtLevel } from '@/lib/format';
import { API_BASE } from '@/lib/staticPaths';
import type { Row } from '@/table/rows';

type Point = { t: string; v: number };

/**
 * The pane that responds to the list.
 *
 * v1's shape, carried: the right pane answers the table rather than being navigated to.
 * What is NOT carried yet is the idle curve — v1 draws the whole curve when nothing is
 * selected; here the empty state says so rather than drawing a placeholder.
 *
 * Chrome follows the rules already settled: no gridlines, no axis lines, muted value
 * labels read from the CDS token, a dot at the last point. The line is INK: the two
 * hues are reserved for direction and a line has no sign.
 */
async function loadSeries(row: Row): Promise<{ unit: string; points: Point[] }> {
  // Swap rows have a stage-2 history route; universe rows have their own. Two routes,
  // one shape — the pane does not care which produced it.
  const url = row.seriesId
    ? `${API_BASE}/api/series/${encodeURIComponent(row.seriesId)}?res=full`
    : `${API_BASE}/api/universe/series/${encodeURIComponent(row.id)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { unit?: string; points: Point[] };
  return { unit: j.unit ?? row.unit, points: j.points ?? [] };
}

export function PreviewPane({ row, height = 320 }: { row?: Row; height?: number }) {
  const host = useRef<HTMLDivElement | null>(null);
  const dispose = useRef<(() => void) | null>(null);
  const [range, setRange] = useState<{ hi: number; lo: number; n: number }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    dispose.current?.();
    dispose.current = null;
    setRange(undefined);
    setError(undefined);
    const el = host.current;
    if (!el || !row) return;

    let cancelled = false;
    void (async () => {
      let data: { unit: string; points: Point[] };
      try {
        data = await loadSeries(row);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (cancelled || !host.current || data.points.length === 0) return;

      const lw = await import('lightweight-charts');
      if (cancelled || !host.current) return;

      const cs = getComputedStyle(el);
      /* INK, not a hue. The frozen rule is two hues only — up and down — and
       * everything else is grey lightness. A line has no sign, so painting it with a
       * direction colour would claim one; the first draft referenced a token that does
       * not exist in v2 and fell back to the up-red, which is exactly that mistake. */
      const line = cs.getPropertyValue('--color-fg').trim() || cs.color;
      const muted = cs.getPropertyValue('--color-fgMuted').trim() || cs.color;

      const chart = lw.createChart(el, {
        height,
        layout: { background: { color: 'transparent' }, textColor: muted },
        grid: { horzLines: { visible: false }, vertLines: { visible: false } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.15 } },
        timeScale: { borderVisible: false, ticksVisible: false, fixLeftEdge: true, fixRightEdge: true },
        crosshair: { horzLine: { labelVisible: false } },
      });
      const series = chart.addLineSeries({ color: line, lineWidth: 2, priceLineVisible: false });
      series.setData(data.points.map((p) => ({ time: p.t as never, value: p.v })));

      const last = data.points[data.points.length - 1];
      series.setMarkers([
        { time: last.t as never, position: 'inBar', shape: 'circle', color: line },
      ]);

      /* Visible-range extremes, recomputed as the range moves — v1 draws these on every
       * chart, and they are the reason a chart is more than a shape. */
      const recompute = () => {
        const r = chart.timeScale().getVisibleLogicalRange();
        if (!r) return;
        const from = Math.max(0, Math.floor(r.from));
        const to = Math.min(data.points.length - 1, Math.ceil(r.to));
        let hi = -Infinity;
        let lo = Infinity;
        for (let i = from; i <= to; i++) {
          const v = data.points[i].v;
          if (v > hi) hi = v;
          if (v < lo) lo = v;
        }
        setRange({ hi, lo, n: to - from + 1 });
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(recompute);
      chart.timeScale().fitContent();
      recompute();

      dispose.current = () => chart.remove();
    })();

    return () => {
      cancelled = true;
      dispose.current?.();
      dispose.current = null;
    };
  }, [row, height]);

  if (!row) {
    return (
      <VStack gap={0.5} paddingY={2}>
        <TextCaption as="span" color="fgMuted">
          행을 고르면 그 종목의 history 가 여기 그려져요.
        </TextCaption>
      </VStack>
    );
  }

  return (
    <VStack gap={0.5} width="100%">
      <TextLabel2 as="span">{row.label}</TextLabel2>
      {error ? (
        <TextCaption as="span" className="sr-up">
          history 를 불러오지 못했어요 — {error}
        </TextCaption>
      ) : (
        <>
          <div ref={host} style={{ width: '100%' }} />
          {range ? (
            <TextCaption as="span" color="fgMuted">
              보이는 구간 최고 {fmtLevel(range.hi, row.unit)} · 최저 {fmtLevel(range.lo, row.unit)} ·{' '}
              {range.n}일
            </TextCaption>
          ) : null}
        </>
      )}
    </VStack>
  );
}
