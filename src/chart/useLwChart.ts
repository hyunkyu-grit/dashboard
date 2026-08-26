'use client';

/* 차트 하나의 수명 — 만들고, 캐논을 입히고, 지운다 [2026-08-26 이관].
 *
 * ── 왜 훅 하나로 모으는가 ──────────────────────────────────────────────────
 * 이 앱에는 차트가 **15개**다. 각자 `createChart` 를 부르면 격자·축 위치·여백·
 * 크로스헤어·글자체가 열다섯 갈래로 갈린다. CLAUDE.md 「얼라인」 8(«같은 것은
 * 한 번만 만든다») 이 정확히 그 사고를 적어 둔 절이고, 이 리포는 `Field` 가
 * 네 곳에 따로 정의돼 있던 대가를 이미 치렀다.
 *
 * ── 축이 셋이다 ─────────────────────────────────────────────────────────────
 * CDS `CartesianChart` 는 x축이 «문자열 배열» 하나였다. `lightweight-charts` 는
 * 축의 **뜻**을 셋으로 나눠 갖는다:
 *
 *   `time`    `createChart`            x = 날짜.        시계열 9개
 *   `curve`   `createYieldCurveChart`  x = **만기 월수**, 선형 배치. 커브 3개
 *   `numeric` `createOptionsChart`     x = 숫자.        시뮬 일수·분기 3개
 *
 * 커브를 시계열로 위장하지 않는 것이 요점이다. 만기 3M·6M·1Y·…·10Y 는 날짜가
 * 아니고, 가짜 날짜를 넣으면 크로스헤어·스케일·`fitContent` 가 전부 없는 시간을
 * 기준으로 돈다. `createYieldCurveChart` 는 그 축을 **월수**로 갖고
 * (`baseResolution` 1 = 1개월), `formatTime` 으로 눈금 글자를 「120」이 아니라
 * 「10Y」로 찍게 해 준다.
 *
 * ── 이 앱이 스크롤·줌을 라이브러리에서 뺏는 이유 ────────────────────────────
 * 보이는 구간은 **이 제품이 정한다** — SPANS 프리셋(1M·3M·6M·1Y·전체)과 휠 확대가
 * 이미 있고, 표·리드아웃·「이 구간」 통계가 전부 그 구간을 읽는다. 라이브러리가
 * 제 마음대로 스크롤하면 화면의 숫자와 차트가 갈린다. 그래서 `handleScroll`·
 * `handleScale` 을 끈다.
 */

import { useEffect, useState } from 'react';

import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createOptionsChart,
  createYieldCurveChart,
} from 'lightweight-charts';
import type { DeepPartial, IChartApiBase, ChartOptions } from 'lightweight-charts';

import { useLwPalette, type LwPalette } from './palette';

export type ChartKind = 'time' | 'curve' | 'numeric';

/** 커브 차트에만 있는 설정. */
export type CurveSetup = {
  /** 월수를 눈금 글자로. 예: 120 -> `10Y`. */
  formatTime?: (months: number) => string;
  /** 데이터가 짧아도 이만큼은 보여 준다(월). 기본 120 = 10년. */
  minimumTimeRange?: number;
  startTimeRange?: number;
};

export type LwHandle<H> = { chart: IChartApiBase<H>; palette: LwPalette };

/**
 * 캐논 룩. **이 함수가 이 앱 차트의 «생김새» 다** — 개별 차트가 여기서 벗어나면
 * 왜인지 주석으로 남긴다(CLAUDE.md 캐논 규칙 3).
 */
export function canonOptions(p: LwPalette): DeepPartial<ChartOptions> {
  return {
    layout: {
      /* 투명 — 바탕은 카드가 진다. 색을 박으면 다크에서 카드 위에 다른 색
         직사각형이 뜬다. */
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: p.fgMuted,
      fontFamily: p.fontFamily,
      fontSize: 11,
      /* 라이브러리 로고 — 이 제품의 화면 문법에 없는 것이다. */
      attributionLogo: false,
    },
    /* 격자 없음 — 캐논(`showGrid={false}`). */
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    /* 세로축은 **오른쪽**(캐논: `<YAxis position="right">`). */
    rightPriceScale: {
      visible: true,
      borderVisible: false,
      /* CDS 의 `CHART_INSET{top:16,bottom:8}` 자리. 라이브러리는 여백을 px 가
         아니라 **패널 높이의 비율**로 받으므로 같은 수를 그대로 옮길 수 없다 —
         200px 패널 기준으로 맞춘 값이다. 선이 위아래 테두리에 닿지 않게 하는
         것이 이 여백의 일이고, 그 목적은 같다. */
      scaleMargins: { top: 0.08, bottom: 0.04 },
    },
    leftPriceScale: { visible: false },
    timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
    crosshair: {
      /* 자석 — 커서가 값에 붙는다. 이 제품의 리드아웃은 «그 점의 값» 을
         읽어 주므로 자유 크로스헤어면 카드의 숫자와 커서가 어긋난다. */
      mode: CrosshairMode.Magnet,
      vertLine: { color: p.line, width: 1, style: LineStyle.Solid, labelVisible: false },
      horzLine: { visible: false, labelVisible: false },
    },
    /* 구간은 이 제품이 정한다 — 위 머리 주석. */
    handleScroll: false,
    handleScale: false,
    autoSize: true,
  };
}

/**
 * `el` 이 서면 차트를 만들고, 스킴이 바뀌면 캐논을 다시 입힌다.
 *
 * 차트는 **다시 안 만든다** — 스킴 토글마다 재생성하면 시리즈·프리미티브가
 * 전부 날아가고 화면이 깜빡인다. 옵션만 덧입힌다.
 */
export function useLwChart<H>(
  kind: ChartKind,
  el: HTMLElement | null,
  curve?: CurveSetup,
): LwHandle<H> | null {
  const palette = useLwPalette(el);
  const [chart, setChart] = useState<IChartApiBase<H> | null>(null);

  /* 커브 설정은 **만들 때 한 번** 들어간다(`applyOptions` 로는 못 바꾼다).
     그래서 의존성에 원시값으로 편다 — 객체를 그대로 넣으면 매 렌더 새 참조라
     차트가 계속 재생성된다. */
  const fmt = curve?.formatTime;
  const minRange = curve?.minimumTimeRange;
  const startRange = curve?.startTimeRange;

  useEffect(() => {
    if (!el) return;
    const made =
      kind === 'curve'
        ? createYieldCurveChart(el as HTMLElement, {
            yieldCurve: {
              baseResolution: 1,
              minimumTimeRange: minRange ?? 120,
              startTimeRange: startRange ?? 0,
              ...(fmt ? { formatTime: fmt } : {}),
            },
          })
        : kind === 'numeric'
          ? createOptionsChart(el as HTMLElement, {})
          : createChart(el as HTMLElement, {});

    setChart(made as unknown as IChartApiBase<H>);
    return () => {
      setChart(null);
      made.remove();
    };
  }, [el, kind, fmt, minRange, startRange]);

  useEffect(() => {
    if (!chart || !palette) return;
    chart.applyOptions(canonOptions(palette));
  }, [chart, palette]);

  return chart && palette ? { chart, palette } : null;
}
