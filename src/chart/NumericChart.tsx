'use client';

/* 숫자 가로축 한 장 — 경과일·분기 [2026-08-26 이관].
 *
 * 쓰는 곳: `sim/CurvePreview`(시나리오 **경로** — D+0·D+7·D+30·…) ·
 * `sim/ResultsWindow`(시뮬 일수) · `lab/model/model/BasisIrf`(충격반응 분기).
 *
 * 커브와 다른 것은 «자리를 어떻게 정하느냐» 뿐이라 그리는 일은 `ScaleChart` 가
 * 그대로 진다. 여기서 정하는 것 둘:
 *
 *   자리 = 그 숫자 그대로. 표본이 듬성해도(D+0·D+7·D+30) **간격이 실제 간격**이
 *          된다 — 등간격으로 세우면 D+30 의 꺾임이 엉뚱한 자리에 선다.
 *   무게 = 둥근 수일수록 크게. 좁아지면 100·50·10·5 순으로 살아남는다.
 */

import { useCallback, useMemo } from 'react';

import { ScaleChart, type ScaleLine, type ScalePriceLine } from './ScaleChart';
import type { ScaleNode } from './horzScale';
import type { LwPalette } from './palette';

export type NumericLine = {
  id: string;
  values: readonly (number | null)[];
  color: (p: LwPalette) => string;
  width?: 1 | 2;
  dash?: boolean;
};

/** 둥근 수 사다리. 라이브러리 축들이 «배수 관계» 로 무게를 매기는 것과 같은 꼴. */
export function roundWeight(v: number): number {
  const n = Math.abs(Math.round(v));
  if (n === 0) return 10;
  if (n % 100 === 0) return 9;
  if (n % 50 === 0) return 8;
  if (n % 30 === 0) return 7;
  if (n % 10 === 0) return 6;
  if (n % 5 === 0) return 5;
  return 4;
}

export function NumericChart({
  nodes,
  lines,
  priceLines,
  label,
  weight = roundWeight,
  height,
  onHoverIndex,
  tickFormat,
  precision = 1,
  accessibilityLabel,
  hoverLabel,
}: {
  /** 가로 자리들 — **오름차순 정수**. 경과일이면 `[0, 7, 30, 90]`. */
  nodes: readonly number[];
  lines: readonly NumericLine[];
  priceLines?: readonly ScalePriceLine[];
  /** 축에 설 글자. 예: `(d) => \`D+${d}\``. */
  label: (x: number) => string;
  /** 좁아질 때 살아남는 순서. 기본은 둥근 수 사다리. */
  weight?: (x: number) => number;
  height?: number;
  onHoverIndex?: (i: number | null) => void;
  tickFormat?: (v: number) => string;
  precision?: number;
  accessibilityLabel: string;
  hoverLabel?: (i: number) => string;
}) {
  const scaleNodes = useMemo<ScaleNode[]>(
    () => nodes.map((x) => ({ x: Math.round(x), label: label(x), weight: weight(x) })),
    [nodes, label, weight],
  );

  const scaleLines = useMemo<ScaleLine[]>(
    () =>
      lines.map((ln) => ({
        id: ln.id,
        color: ln.color,
        width: ln.width,
        dash: ln.dash,
        values: ln.values,
      })),
    [lines],
  );

  const onNode = useCallback((k: number | null) => onHoverIndex?.(k), [onHoverIndex]);

  return (
    <ScaleChart
      nodes={scaleNodes}
      lines={scaleLines}
      priceLines={priceLines}
      height={height}
      onHoverNode={onNode}
      tickFormat={tickFormat}
      precision={precision}
      accessibilityLabel={accessibilityLabel}
      hoverLabel={hoverLabel}
    />
  );
}
