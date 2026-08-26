'use client';

/* 시계열 한 장 — 아홉 화면이 같이 쓴다 [2026-08-26 이관].
 *
 * 쓰는 곳: Main 미리보기 · 백테스트(짝 차트 둘 포함) · 밴드 · 전략 실험 창 셋 ·
 * rv 추이.
 *
 * ── 왜 커브·숫자축과 몸통이 다른가 ─────────────────────────────────────────
 * 저쪽은 축의 «뜻» 을 우리가 정해야 해서 `IHorzScaleBehavior` 를 직접 짰다.
 * 날짜 축은 다르다 — 라이브러리가 **월·년 경계에 더 큰 무게를 주는** 눈금 규칙을
 * 이미 갖고 있고, 그건 우리가 다시 만들 이유가 없는 좋은 규칙이다.
 *
 * 그리고 걱정할 것이 하나 없다: 라이브러리의 가로축은 **인덱스 간격**이라
 * 주말·휴일이 자리를 차지하지 않는다. CDS 의 범주 축과 같은 간격이 그대로 나온다.
 * 선을 세우는 일은 `series.ts` 가 커브·숫자축과 **공유한다**.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LineStyle, createSeriesMarkers } from 'lightweight-charts';
import type {
  ISeriesApi,
  ISeriesMarkersPluginApi,
  LineData,
  Time,
  WhitespaceData,
} from 'lightweight-charts';

import type { AreaFill } from './dottedArea';
import type { LwPalette } from './palette';
import { VerticalLines } from './verticalLines';
import type { ScalePriceLine } from './ScaleChart';
import { addLine, removeLines, type LineAxis, type PlacedLine } from './series';
import { useLwChart } from './useLwChart';

export type TimeLine = {
  id: string;
  /** `dates` 와 **같은 길이**. `null` 은 그날 값이 없다는 뜻이고 선이 끊긴다. */
  values: readonly (number | null)[];
  color: (p: LwPalette) => string;
  width?: 1 | 2;
  dash?: boolean;
  /** 선 아래 면 — 캐논은 점무늬. 주선에만. */
  area?: AreaFill;
  areaColor?: (p: LwPalette) => string;
  /** 종목은 오른쪽(`main`), 기준선은 왼쪽(`aux`) [OWNER 2026-08-14]. */
  axis?: LineAxis;
  /** 그 축의 눈금 글자. 축마다 다르므로 계열이 진다(`series.ts` 주석). */
  format?: (v: number) => string;
};

/** 보이는 구간의 고·저 같은 표시점. CDS `Point` 의 자리. */
export type TimeMarker = {
  /** `dates` 의 순번. */
  index: number;
  color: (p: LwPalette) => string;
};

export function TimeChart({
  dates,
  lines,
  markers,
  priceLines,
  markLines,
  syncIndex,
  height,
  onHoverIndex,
  precision = 2,
  accessibilityLabel,
  hoverLabel,
}: {
  /** ISO 날짜들, **오름차순**. */
  dates: readonly string[];
  lines: readonly TimeLine[];
  markers?: readonly TimeMarker[];
  /** 가로로 눕는 상수선 — 손익 차트의 0선. */
  priceLines?: readonly ScalePriceLine[];
  /** 세로로 서는 선들 — «그 날 들어갔다» 같은 **사실**을 긋는다.
   *  CDS `ReferenceLine dataX={…} label={…}` 의 자리. 겹침 회피(근접 마크
   *  합치기)는 **호출부가** 한다 — 라벨을 아는 쪽이 거기다. */
  markLines?: readonly { index: number; label?: string }[];
  /**
   * 바깥에서 짚어 주는 자리 — **짝 차트**가 쓴다(백테스트의 위/아래 차트).
   *
   * CDS 판은 `<ReferenceLine dataX={hover.i}>` 로 세로선을 그렸다. 여기서는
   * 라이브러리의 크로스헤어를 그 자리에 세운다 — 커서가 실제로 그 위에 있을
   * 때와 **같은 그림**이라 두 차트가 한 커서를 공유하는 것으로 읽힌다.
   */
  syncIndex?: number | null;
  height?: number;
  onHoverIndex?: (i: number | null) => void;
  precision?: number;
  accessibilityLabel: string;
  hoverLabel?: (i: number) => string;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const handle = useLwChart<Time>('time', el);

  /** 날짜 -> 순번. 크로스헤어가 주는 것은 날짜뿐이다. */
  const indexOf = useMemo(() => new Map(dates.map((d, i) => [d, i])), [dates]);

  const notify = useCallback(
    (i: number | null) => {
      setHover(i);
      onHoverIndex?.(i);
    },
    [onHoverIndex],
  );

  /** 왼쪽 축은 **쓸 때만** 선다 — 빈 축이 서면 플롯이 그만큼 좁아진다. */
  const hasAux = useMemo(() => lines.some((l) => l.axis === 'aux'), [lines]);
  useEffect(() => {
    if (!handle) return;
    handle.chart.applyOptions({
      leftPriceScale: { visible: hasAux, borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.04 } },
    });
  }, [handle, hasAux]);

  const markerApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  /** 크로스헤어를 세울 계열 — 첫 줄(주선)이다. */
  const anchor = useRef<ISeriesApi<'Line', Time> | null>(null);
  const vlines = useRef<VerticalLines<Time> | null>(null);

  useEffect(() => {
    if (!handle || dates.length === 0) return;
    const { chart, palette, alive } = handle;

    const placed: PlacedLine<Time>[] = lines.map((ln) =>
      addLine(
        chart,
        palette,
        {
          id: ln.id,
          color: ln.color,
          width: ln.width,
          dash: ln.dash,
          area: ln.area,
          areaColor: ln.areaColor,
          axis: ln.axis,
          format: ln.format,
          data: dates.map((t, k) => {
            const v = ln.values[k];
            return (v == null ? { time: t as Time } : { time: t as Time, value: v }) as
              | LineData<Time>
              | WhitespaceData<Time>;
          }),
        },
        precision,
      ),
    );

    /* 고·저 표시점 — CDS `Point` 자리. 주선(첫 계열)에 매단다. */
    if (markers?.length && placed[0]) {
      markerApi.current = createSeriesMarkers(
        placed[0].series,
        markers
          .filter((m) => dates[m.index] != null)
          .map((m) => ({
            time: dates[m.index] as Time,
            position: 'inBar' as const,
            shape: 'circle' as const,
            color: m.color(palette),
            size: 0.6,
          })),
      );
    }

    /* 가로 상수선. 첫 계열에 매단다 — 값 축이 하나뿐이라 어디 붙어도 같다. */
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

    anchor.current = placed[0]?.series ?? null;

    if (markLines?.length && placed[0]) {
      const v = new VerticalLines<Time>();
      placed[0].series.attachPrimitive(v);
      v.update(
        markLines
          .filter((m) => dates[m.index] != null)
          .map((m) => ({ time: dates[m.index] as Time, label: m.label })),
        palette.fgMuted,
        palette.fontFamily,
      );
      vlines.current = v;
    }

    chart.timeScale().fitContent();

    return () => {
      /* 차트가 이미 사라졌으면 지울 것이 없다 — `LwHandle.alive` 주석. */
      markerApi.current = null;
      anchor.current = null;
      if (alive.current && vlines.current && placed[0]) {
        placed[0].series.detachPrimitive(vlines.current);
      }
      vlines.current = null;
      if (alive.current) removeLines(chart, placed);
    };
  }, [handle, lines, markers, priceLines, markLines, dates, precision]);

  /* 짝 차트가 짚어 준 자리. 값은 주선의 그날 값을 쓴다 — 크로스헤어는 가로
     자리만 보이면 되지만 API 가 값을 요구한다. */
  useEffect(() => {
    if (!handle) return;
    const { chart } = handle;
    const s = anchor.current;
    const t = syncIndex == null ? null : dates[syncIndex];
    const v = syncIndex == null ? null : (lines[0]?.values[syncIndex] ?? null);
    if (s && t != null && v != null) chart.setCrosshairPosition(v, t as Time, s);
    else chart.clearCrosshairPosition();
  }, [handle, syncIndex, dates, lines]);

  useEffect(() => {
    if (!handle) return;
    const { chart } = handle;
    const onMove = (param: { time?: Time }) => {
      const t = param.time;
      notify(t == null ? null : (indexOf.get(String(t)) ?? null));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [handle, indexOf, notify]);

  return (
    <>
      <div
        ref={setEl}
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
      <span className="sr-a11y-only" aria-live="polite">
        {hoverLabel && hover != null ? hoverLabel(hover) : ''}
      </span>
    </>
  );
}
