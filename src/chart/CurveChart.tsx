'use client';

/* 만기 커브 한 장 — 세 화면이 같이 쓴다 [2026-08-26 이관].
 *
 * 쓰는 곳: `ui/PreviewPane`(IRS 파 커브) · `sim/CurvePreview`(시나리오 커브) ·
 * `lab/scenario/ModelChart`(모형 커브).
 *
 * 이 파일이 하는 일은 **만기 어휘를 축 좌표로 옮기는 것** 하나다. 그리는 일은
 * `ScaleChart` 가, 자리·글자·무게의 규칙은 `tenorScale.ts` 가 진다.
 *
 * ── 가로축이 **√만기**다 ────────────────────────────────────────────────────
 * CDS 판은 `xAxis={{ data: curve.tenors }}` 였다. 그건 **범주 축**이라 3M 과 6M
 * 사이 간격이 10Y 와 20Y 사이 간격과 같았다. 선형 월수 축(라이브러리의 커브
 * 차트)은 반대로 짧은 쪽을 뭉갠다. 오너가 √만기를 골랐다 — 순서는 그대로고
 * 짧은 쪽이 펴진다 [OWNER 2026-08-26 — 「√만기 축 — 짧은 쪽에 자리」].
 */

import { useCallback, useMemo } from 'react';

import { ScaleChart, type ScaleLine } from './ScaleChart';
import type { AreaFill } from './dottedArea';
import type { LwPalette } from './palette';
import { tenorMonths } from './tenor';
import { tenorNodes } from './tenorScale';

export type CurveLine = {
  id: string;
  /** `nodes` 와 **같은 길이**. `null` 은 그 만기에 값이 없다는 뜻이다. */
  values: readonly (number | null)[];
  color: (p: LwPalette) => string;
  width?: 1 | 2;
  /** 선 아래 면(캐논은 점무늬). 주선에만. */
  area?: AreaFill;
};

export function CurveChart({
  nodes,
  lines,
  height,
  onHoverIndex,
  tickFormat,
  precision = 2,
  accessibilityLabel,
  hoverLabel,
}: {
  /** 만기 이름들 — `3M`·`1Y`·`10Y`. 순서는 아무래도 좋다(안에서 정렬한다). */
  nodes: readonly string[];
  lines: readonly CurveLine[];
  height?: number;
  /** 커서가 문 노드의 **원래 인덱스**(`nodes` 기준). 벗어나면 `null`. */
  onHoverIndex?: (i: number | null) => void;
  tickFormat?: (v: number) => string;
  precision?: number;
  accessibilityLabel: string;
  /** 그 노드의 낭독 문장(원래 인덱스). */
  hoverLabel?: (i: number) => string;
}) {
  /* 만기 순으로 세우되 **원래 인덱스를 들고 다닌다** — 리드아웃이 제 노드를
     읽으려면 그 짝이 필요하다. 못 읽는 이름은 버린다(축에 세울 자리가 없다). */
  const order = useMemo(() => {
    const rows = nodes
      .map((id, i) => ({ i, m: tenorMonths(id) }))
      .filter((r): r is { i: number; m: number } => r.m != null);
    rows.sort((a, b) => a.m - b.m);
    return rows;
  }, [nodes]);

  /* 같은 자리로 떨어지는 만기는 `tenorNodes` 가 앞엣것만 남긴다 — 값도 같은
     규칙으로 맞춰야 길이가 안 어긋난다. */
  const scaleNodes = useMemo(() => tenorNodes(order.map((r) => r.m)), [order]);
  const kept = useMemo(() => order.slice(0, scaleNodes.length), [order, scaleNodes]);

  const scaleLines = useMemo<ScaleLine[]>(
    () =>
      lines.map((ln) => ({
        id: ln.id,
        color: ln.color,
        width: ln.width,
        area: ln.area,
        values: kept.map((r) => ln.values[r.i] ?? null),
      })),
    [lines, kept],
  );

  const onNode = useCallback(
    (k: number | null) => onHoverIndex?.(k == null ? null : (kept[k]?.i ?? null)),
    [onHoverIndex, kept],
  );

  const label = useCallback(
    (k: number) => {
      const i = kept[k]?.i;
      return i == null || !hoverLabel ? '' : hoverLabel(i);
    },
    [kept, hoverLabel],
  );

  return (
    <ScaleChart
      nodes={scaleNodes}
      lines={scaleLines}
      height={height}
      onHoverNode={onNode}
      tickFormat={tickFormat}
      precision={precision}
      accessibilityLabel={accessibilityLabel}
      hoverLabel={hoverLabel ? label : undefined}
    />
  );
}
