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
 *   `time`    `createChart`      x = 날짜.                     시계열 9개
 *   `curve`   `createChartEx`    x = **√만기**(`tenorScale.ts`)  커브 3개
 *   `scale`   `createChartEx`    x = 숫자(경과일·분기)           시뮬 3개
 *   `numeric` `createOptionsChart` x = 숫자.                    시뮬 일수·분기 3개
 *
 * 커브를 시계열로 위장하지 않는 것이 요점이다. 만기 3M·6M·1Y·…·10Y 는 날짜가
 * 아니고, 가짜 날짜를 넣으면 크로스헤어·스케일·`fitContent` 가 전부 없는 시간을
 * 기준으로 돈다.
 *
 * 처음에는 `createYieldCurveChart`(선형 월수)를 썼다. 그 축은 만기 축의 정석이나
 * 짧은 쪽이 뭉쳐서 오너가 **√만기**를 골랐다 — 그 결정과 «왜 값만 바꿔서는 안
 * 되는가» 는 `chart/tenorScale.ts` 머리에 적혀 있다.
 *
 * ── 이 앱이 스크롤·줌을 라이브러리에서 뺏는 이유 ────────────────────────────
 * 보이는 구간은 **이 제품이 정한다** — SPANS 프리셋(1M·3M·6M·1Y·전체)과 휠 확대가
 * 이미 있고, 표·리드아웃·「이 구간」 통계가 전부 그 구간을 읽는다. 라이브러리가
 * 제 마음대로 스크롤하면 화면의 숫자와 차트가 갈린다. 그래서 `handleScroll`·
 * `handleScale` 을 끈다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createChartEx,
  createOptionsChart,
} from 'lightweight-charts';
import type { DeepPartial, IChartApiBase, ChartOptions } from 'lightweight-charts';

import { pixelColorParser, useLwPalette, type LwPalette } from './palette';
import { LabelledHorzScale } from './horzScale';

export type ChartKind = 'time' | 'curve' | 'numeric';

/** 커브 차트에만 있는 설정. */
export type CurveSetup = {
  /** 이 커브의 가로축. **참조가 안정해야 한다** — 바뀌면 차트가 새로 만들어진다. */
  scale: LabelledHorzScale;
};

export type LwHandle<H> = {
  chart: IChartApiBase<H>;
  palette: LwPalette;
  /**
   * 차트가 아직 살아 있는가.
   *
   * **정리 순서 때문에 필요하다.** 이 훅의 생성 효과가 호출부의 시리즈 효과보다
   * 먼저 선언되므로, 언마운트에서도 **먼저 정리된다** — 차트가 이미 `remove()`
   * 된 뒤에 호출부가 `removeSeries` 를 부르면 라이브러리가 `Value is undefined`
   * 로 던지고 화면이 에러 경계로 떨어진다(실측 2026-08-26: 커브에서 종목 차트로
   * 넘어가는 순간 재현).
   *
   * 차트가 통째로 사라질 때는 시리즈를 따로 지울 일이 없다 — `remove()` 가
   * 전부 걷어간다. 그래서 호출부는 이 깃발이 서 있을 때만 지운다.
   */
  alive: { current: boolean };
};

/**
 * 캐논 룩. **이 함수가 이 앱 차트의 «생김새» 다** — 개별 차트가 여기서 벗어나면
 * 왜인지 주석으로 남긴다(CLAUDE.md 캐논 규칙 3).
 */
/**
 * 가로축 눈금 글자 — **ISO**.
 *
 * 라이브러리는 `BusinessDay | UTCTimestamp` 로 준다. 우리가 넣은 것은 `'YYYY-MM-DD'`
 * 문자열이고 그건 `BusinessDay` 로 파싱돼 돌아온다.
 */
function isoTick(time: unknown): string {
  const b = time as { year?: number; month?: number; day?: number };
  if (typeof b?.year === 'number') {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${b.year}-${p(b.month ?? 1)}-${p(b.day ?? 1)}`;
  }
  /* 숫자 축(커브·시뮬)은 자기 축이 글자를 진다 — 여기 안 온다. */
  return String(time);
}

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
      /**
       * **눈금은 조용해야 한다.**
       *
       * 라이브러리 기본은 `2.5` 다 — 눈금 한 칸의 높이를 `글자크기 × 이 값` 으로
       * 잡고, 작을수록 촘촘하다. 그냥 두면 560px 짜리 패널에 **11칸**이 선다
       * (실측 2026-08-26 라이브). CDS 판은 같은 자리에 **5칸**이었다
       * [OWNER 2026-08-26 — "좀 개판된거 같은데"]. 축이 그림보다 눈에 띄면
       * 읽는 사람이 선이 아니라 눈금을 읽는다.
       */
      tickMarkDensity: 4,
    },
    leftPriceScale: { visible: false },
    timeScale: {
      borderVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
      /* 날짜는 **ISO 다** — 이 제품의 화면 전체가 그렇다(표 머리·신선도 칩·
         대사표·URL 인코딩, 그리고 `ui/IsoDateField.tsx` 한 레인이 통째로 그
         규칙이다). 라이브러리 기본은 「9월」·「2026년」 같은 로케일 글자라
         그냥 두면 **차트만 다른 말을 쓴다**(실측 2026-08-26 라이브). */
      tickMarkFormatter: isoTick,
    },
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
    /* 크기는 컨테이너를 따라간다.
     *
     * ── 배경 탭에서는 캔버스가 안 선다(라이브러리 성질) ─────────────────────
     * 실측 2026-08-26: 자동화 탭에서 캔버스가 전부 300×150(브라우저 기본)에
     * 머물렀다. 한동안 `autoSize` 고장으로 보고 직접 리사이즈를 짰는데,
     * **틀린 진단이었다.** 뿌리는 `document.visibilityState === 'hidden'` 이다:
     *
     *   `fancy-canvas` 는 캔버스 **비트맵** 크기를 `ResizeObserver` 의
     *   `device-pixel-content-box` 로 정하는데, 그 지원 여부를 재는 프로브가
     *   `document.body` 관찰 콜백으로 resolve 된다. 배경 탭은 프레임을 안
     *   그리므로 그 콜백이 **영영 안 온다** — true 도 false 도 아니라 아무
     *   일도 안 일어난다.
     *
     * 즉 «배경 탭에서는 차트가 비어 있다가, 탭을 보는 순간 그려진다». CDS 의
     * SVG 차트는 그렇지 않았으므로 **이관이 바꾸는 성질**이다. 직접 리사이즈로도
     * 못 고친다(비트맵은 라이브러리 것이다). 이 리포에 같은 계열 판례가 있다 —
     * "«프리즈»는 hidden 탭 인공산물(rAF 0)" [2026-08-18 Lab 감사]. */
    autoSize: true,
  };
}

/**
 * **만들 때만** 들어가는 것들. 스킴이 바뀔 때 다시 넣으면 안 된다.
 *
 * `colorParsers` 는 `applyOptions` 로 바꾸면 라이브러리가 대놓고 던진다 —
 * «colorParsers option should not be changed once the chart has been created»
 * (실측 2026-08-26: 그 문장이 그대로 에러 경계에 떴다). `attributionLogo`·
 * `autoSize` 도 생성자에서만 읽힌다. 그래서 «만들 때» 와 «다시 입힐 때» 를
 * 함수 둘로 갈라 둔다 — 한 함수에 두 시점을 담으면 이 사고가 또 난다.
 */
export function creationOptions(p: LwPalette): DeepPartial<ChartOptions> {
  const canon = canonOptions(p);
  return {
    ...canon,
    layout: {
      ...canon.layout,
      /* 라이브러리가 못 읽는 색을 픽셀로 재 주는 파서. 이게 없으면
         `color-mix` 의 계산값(`color(srgb ...)`) 하나에 차트가 통째로 던진다 —
         `chart/palette.ts::pixelColorParser` 의 그 판례. */
      colorParsers: [pixelColorParser],
    },
  };
}

/**
 * 팔레트가 읽히면 차트를 만들고, 스킴이 바뀌면 캐논을 다시 입힌다.
 *
 * ── 캐논은 **만들 때** 들어간다 ────────────────────────────────────────────
 * 처음에는 빈 옵션으로 만들고 `applyOptions` 로 캐논을 덧입혔는데, 그러면
 * **`autoSize` 와 `attributionLogo` 가 안 먹는다**(실측 2026-08-26: 캔버스가
 * 전부 300×150 — 브라우저 기본 — 이고 라이브러리 로고가 남아 있었다. 차트도
 * 시리즈도 다 붙은 상태였는데 화면은 비어 있었다). 그 둘은 생성자에서 읽는
 * 옵션이다.
 *
 * 그래서 **팔레트가 읽힐 때까지 차트를 안 만든다.** `ready` 는 한 번만
 * false -> true 로 뒤집히고 그 뒤로는 스킴을 토글해도 그대로라, 차트가
 * 다시 만들어지지 않는다 — 재생성하면 시리즈·프리미티브가 전부 날아가고
 * 화면이 깜빡인다. 스킴 변화는 `applyOptions` 가 받는다(색은 그렇게 먹는다).
 */
export function useLwChart<H>(
  kind: ChartKind,
  el: HTMLElement | null,
  curve?: CurveSetup,
): LwHandle<H> | null {
  const palette = useLwPalette(el);
  const [chart, setChart] = useState<IChartApiBase<H> | null>(null);

  /* 생성 효과가 팔레트를 **읽되 의존하지는 않게** 하는 자리. 의존시키면
     토글마다 차트가 새로 만들어진다. */
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const ready = palette != null;

  /** 위 `LwHandle.alive` 참조. */
  const alive = useRef(false);

  /* 축은 **만들 때 한 번** 들어간다. 호출부가 `useRef` 로 붙잡아 두므로
     참조가 안 바뀌고, 그래서 차트도 안 다시 만들어진다. */
  const scale = curve?.scale;

  useEffect(() => {
    const p = paletteRef.current;
    if (!el || !p) return;
    const canon = creationOptions(p);
    const made =
      kind === 'curve'
        ? scale
          ? createChartEx<number, LabelledHorzScale>(el as HTMLElement, scale, canon)
          : null
        : kind === 'numeric'
          ? createOptionsChart(el as HTMLElement, canon)
          : createChart(el as HTMLElement, canon);
    if (!made) return;

    alive.current = true;
    setChart(made as unknown as IChartApiBase<H>);
    return () => {
      alive.current = false;
      setChart(null);
      made.remove();
    };
  }, [el, kind, scale, ready]);

  useEffect(() => {
    if (!chart || !palette) return;
    chart.applyOptions(canonOptions(palette));
  }, [chart, palette]);


  /* **참조가 매 렌더 바뀌면 안 된다** — 이 값은 호출부 효과의 의존성으로
     쓰이므로, 새 객체를 매번 주면 시리즈를 렌더마다 지웠다 다시 만든다. */
  return useMemo(
    () => (chart && palette ? { chart, palette, alive } : null),
    [chart, palette],
  );
}
