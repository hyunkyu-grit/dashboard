'use client';

/* 우리 가로축 위에 선 몇 개를 그리는 한 장 — 커브·시뮬·충격반응이 같이 쓴다
 * [2026-08-26 이관].
 *
 * 축의 «뜻» 은 호출부가 정한다(`ScaleNode` 로 자리·글자·무게를 준다). 이 파일은
 * 그 축 위에 선을 세우고, 커서를 노드로 붙이고, 캐논 룩을 지키는 일만 한다.
 * 만기축은 `CurveChart`, 숫자축은 `NumericChart` 가 얇게 감싼다 —
 * 화면마다 이걸 다시 만들면 격자·여백·크로스헤어가 갈린다(CLAUDE.md 「얼라인」 8).
 *
 * ── 마디는 **직선**으로 잇는다 ──────────────────────────────────────────────
 * 우리가 아는 것은 노드의 값뿐이라 노드 사이를 지어내지 않는다. `LineSeries` 의
 * 기본이 직선 세그먼트라 따로 끌 손잡이가 없다 — 스플라인(`lineType`)을 켜지
 * 않는 것으로 지킨다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LineStyle } from 'lightweight-charts';
import type { LineData, WhitespaceData } from 'lightweight-charts';

import { LabelledHorzScale, fillWhitespace, nearestIndex, type ScaleNode } from './horzScale';
import type { AreaFill } from './dottedArea';
import type { LwPalette } from './palette';
import { addLine, removeLines, type PlacedLine } from './series';
import { useLwChart } from './useLwChart';

/**
 * 양 끝 여백 — 축 폭의 **비례**로 준다.
 *
 * `fixLeftEdge`/`fixRightEdge` 때문에 여백이 없으면 첫·끝 노드가 모서리에 딱
 * 붙어 점 표시가 반쯤 잘린다(CDS `CHART_INSET{left,right}` 의 자리). 처음에는
 * 고정 4칸이었는데, 그건 축마다 뜻이 달라진다 — 만기 축(35~219)에서는 2% 지만
 * 충격반응의 20분기 축에서는 **20%** 다(실측 2026-08-26). 같은 «조금» 이 되도록
 * 폭에 비례시키고, 아주 짧은 축에서도 최소 한 칸은 준다.
 */
function edgePad(span: number): number {
  return Math.max(1, Math.round(span * 0.02));
}

export type ScaleLine = {
  id: string;
  /** `nodes` 와 **같은 길이**. `null` 은 그 자리에 값이 없다는 뜻이고 선이 끊긴다. */
  values: readonly (number | null)[];
  /** 색은 팔레트에서 고른다 — 문자열을 직접 주지 않는다(`guards/chart-palette`).
   *  화면 고유색은 `p.resolve('var(--sr-…)')` 로 푼다. */
  color: (p: LwPalette) => string;
  width?: 1 | 2;
  /** 선 아래를 점무늬로 채운다 — 캐논의 `showArea areaType="dotted"`.
   *  주선에만 준다(참조선까지 채우면 어느 것이 잉크인지 안 보인다). */
  area?: AreaFill;
  areaColor?: (p: LwPalette) => string;
  /** 점선으로. CDS `Line type="dotted"` 의 자리 — «지난 판» 처럼 뒤로 물러난
   *  계열이 쓴다. */
  dash?: boolean;
};

/** 가로로 눕는 상수선 — CDS `ReferenceLine dataY={…}` 의 자리. */
export type ScalePriceLine = {
  value: number;
  color: (p: LwPalette) => string;
  dash?: boolean;
};

export function ScaleChart({
  nodes,
  lines,
  priceLines,
  height,
  onHoverNode,
  tickFormat,
  precision = 2,
  accessibilityLabel,
  hoverLabel,
}: {
  /** 자리·글자·무게. **x 오름차순**이어야 한다. */
  nodes: readonly ScaleNode[];
  lines: readonly ScaleLine[];
  /** 가로 상수선들. 첫 계열에 붙는다 — 값 축이 하나라 어디 붙어도 같은 자리다. */
  priceLines?: readonly ScalePriceLine[];
  height?: number;
  /** 커서가 붙은 **노드의 순번**. 벗어나면 `null`. */
  onHoverNode?: (k: number | null) => void;
  /** 세로축 눈금 글자. */
  tickFormat?: (v: number) => string;
  precision?: number;
  accessibilityLabel: string;
  /** 그 노드의 낭독 문장 — CDS `Scrubber` 의 `accessibilityLabel` 자리다. */
  hoverLabel?: (k: number) => string;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  /* 축은 이 차트가 살아 있는 동안 **하나**다 — 매 렌더 새로 만들면 참조가
     바뀌어 차트가 통째로 다시 만들어진다. */
  const scaleRef = useRef<LabelledHorzScale | null>(null);
  if (scaleRef.current === null) scaleRef.current = new LabelledHorzScale();
  const scale = scaleRef.current;

  const handle = useLwChart<number>('curve', el, { scale });

  const xs = useMemo(() => nodes.map((n) => n.x), [nodes]);

  const notify = useCallback(
    (k: number | null) => {
      setHover(k);
      onHoverNode?.(k);
    },
    [onHoverNode],
  );

  useEffect(() => {
    if (!handle || nodes.length === 0) return;
    const { chart, palette, alive } = handle;

    /* 축에 «어느 자리가 진짜인지» 를 알려 준다 — 눈금 글자와 가중치가 거기서
       나온다. `setData` **전에** 해야 첫 그리기부터 맞다. */
    scale.setNodes(nodes);

    const pad = edgePad((xs[xs.length - 1] ?? 0) - (xs[0] ?? 0));
    const placed: PlacedLine<number>[] = lines.map((ln) => {
      const valueAt = new Map<number, number | null>();
      nodes.forEach((n, k) => valueAt.set(n.x, ln.values[k] ?? null));
      return addLine(
        chart,
        palette,
        {
          id: ln.id,
          color: ln.color,
          width: ln.width,
          dash: ln.dash,
          area: ln.area,
          areaColor: ln.areaColor,
          format: tickFormat,
          data: fillWhitespace(xs, (x) => valueAt.get(x), pad) as (
            | LineData<number>
            | WhitespaceData<number>
          )[],
        },
        precision,
      );
    });

    /* 가로 상수선. 첫 계열에 매단다 — 이 앱의 차트는 값 축이 하나뿐이라
       어느 계열에 붙어도 같은 높이에 선다. */
    for (const pl of priceLines ?? []) {
      placed[0]?.series.createPriceLine({
        price: pl.value,
        color: pl.color(palette),
        lineWidth: 1,
        lineStyle: pl.dash ? LineStyle.Dotted : LineStyle.Solid,
        axisLabelVisible: false,
        title: '',
      });
    }

    chart.timeScale().fitContent();

    /* 차트가 이미 사라졌으면 지울 것이 없다 — `LwHandle.alive` 주석. */
    return () => {
      if (alive.current) removeLines(chart, placed);
    };
  }, [handle, lines, priceLines, nodes, xs, precision, scale, tickFormat]);

  useEffect(() => {
    if (!handle) return;
    const { chart } = handle;
    const onMove = (param: { time?: number }) => {
      const t = param.time;
      notify(t == null ? null : nearestIndex(xs, t));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [handle, xs, notify]);

  return (
    <>
      <div
        ref={setEl}
        /* 캔버스에는 읽을 DOM 이 없다. 컨테이너가 그림 하나로 서고 이름을 진다. */
        role="img"
        aria-label={accessibilityLabel}
        /* **부모가 가로 flex 든 세로 flex 든 맞아야 한다.**
           CDS `Box` 는 flex row, `VStack` 은 flex column 이라 이 div 는 둘 다에
           놓인다. 실측 2026-08-26 에 양쪽으로 한 번씩 틀렸다:
             · 아무 것도 안 주면 가로 부모에서 **폭 0** 이 된다(캔버스는 안에서
               절대 배치라 «내용» 이 없다 — 부모 874px 에 이 div 0px).
             · `flexBasis: 0` 을 주면 세로 부모에서 **높이 0** 이 된다(그 축의
               main-size 가 0 이 되고, 부모에 정해진 높이가 없어 안 자란다).
           `flexBasis: 'auto'` 는 «그 축의 크기 속성을 쓰라» 는 뜻이라 가로에서는
           `width`, 세로에서는 `height` 를 본다. 둘 다 주고 `flexGrow` 로 남는
           자리를 받는다. `minWidth/minHeight: 0` 이 없으면 flex 아이템의 최소
           크기가 내용이라 줄지 않는다. */
        style={{
          flexGrow: 1,
          flexBasis: 'auto',
          minWidth: 0,
          minHeight: 0,
          width: '100%',
          height: height != null ? height : '100%',
        }}
      />
      {/* 스크러버의 낭독을 대신하는 줄. 화면에는 없고 낭독기에만 있다. */}
      <span className="sr-a11y-only" aria-live="polite">
        {hoverLabel && hover != null ? hoverLabel(hover) : ''}
      </span>
    </>
  );
}
