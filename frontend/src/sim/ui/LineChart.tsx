"use client";

/**
 * 다계열 선 차트 (lightweight-charts v5).
 *
 * krw-fi-pms는 이 자리에 513줄짜리 SeriesChart와 크로스헤어 레티클·스냅·배지
 * 가족(총 1,000줄)을 두고 일곱 화면이 나눠 썼다. 이 앱은 화면이 하나고 쓰는
 * 기능은 선·크로스헤어·0선뿐이라, 그 무게를 들여올 이유가 없다.
 *
 * 공백(whitespace) 규칙: 값이 없는 날은 `{ time }`만 넣는다. 주말·공휴일에
 * 직전 값을 이어 그리면 그 이틀 동안 손익이 멈춰 있었다는 거짓말이 된다.
 */

import { useEffect, useRef } from "react";
import {
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import { getSimChartTheme } from "@/sim/lib/chart-theme";
import { onThemeChange } from "@/sim/theme/bridge";

export type LinePoint = { time: number; value: number } | { time: number };

export interface LineSeriesDef {
  id: string;
  label: string;
  color: string;
  width: 1 | 2 | 3 | 4;
  data: LinePoint[];
}

export interface CrosshairRow {
  id: string;
  label: string;
  color: string;
  value: number | null;
}

export interface LineChartProps {
  series: LineSeriesDef[];
  /** y축·툴팁 값 포맷터. */
  formatValue: (v: number) => string;
  /** y=0에 기준선을 긋는다. 손익 축에서는 켠다. */
  zeroLine?: boolean;
  /** 크로스헤어가 움직일 때 그 시점의 값들. null이면 그 계열이 그 날 공백이다. */
  onCrosshair?: (at: { time: number; rows: CrosshairRow[] } | null) => void;
}

export function LineChart({ series, formatValue, zeroLine = false, onCrosshair }: LineChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const linesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  // 크로스헤어 구독은 생성 시 한 번만 건다. 계열이 바뀔 때마다 재구독하면
  // 구독 해제를 한 번이라도 놓치는 순간 핸들러가 겹쳐 쌓인다. 최신 defs와
  // 콜백은 ref로 흘려 넣는다 (렌더 중이 아니라 커밋 단계에서).
  const defsRef = useRef(series);
  const cbRef = useRef(onCrosshair);
  const fmtRef = useRef(formatValue);
  useEffect(() => {
    defsRef.current = series;
    cbRef.current = onCrosshair;
    fmtRef.current = formatValue;
  });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const t = getSimChartTheme();
    const chart = createChart(box, {
      layout: { background: { color: t.background }, textColor: t.axis, attributionLogo: false },
      grid: { horzLines: { color: t.grid }, vertLines: { visible: false } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        // 월 경계만 라벨한다. 전폭에서는 라이브러리가 일 단위 눈금까지 붙여서
        // "16일 24일 8월 9일 17일 9일 …"처럼 같은 말이 반복되는 띠가 되는데,
        // 그 촘촘함은 아무 질문에도 답하지 않으면서 축을 읽기 어렵게 만든다.
        // 빈 문자열을 돌려주면 그 눈금은 그려지지 않는다.
        tickMarkFormatter: (time: number, tickMarkType: number) => {
          // 0 = Year, 1 = Month — 나머지(일/시각)는 버린다.
          if (tickMarkType > 1) return "";
          const d = new Date(time * 1000);
          return tickMarkType === 0 ? `${d.getUTCFullYear()}` : `${d.getUTCMonth() + 1}월`;
        },
      },
      crosshair: {
        // 세로선만 남긴다. 가로선은 다섯 계열이 교차하는 차트에서 어느 계열을
        // 가리키는지 말해 주지 못하면서 0선과 헷갈린다.
        mode: 1,
        vertLine: { color: t.zeroLine, width: 1, style: LineStyle.Solid, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      localization: { priceFormatter: (v: number) => fmtRef.current(v) },
      autoSize: true,
      handleScale: false,
      handleScroll: false,
    });
    chartRef.current = chart;

    chart.subscribeCrosshairMove((param) => {
      const cb = cbRef.current;
      if (!cb) return;
      if (param.time === undefined) {
        cb(null);
        return;
      }
      const rows: CrosshairRow[] = defsRef.current.map((d) => {
        const s = linesRef.current.get(d.id);
        const point = s ? param.seriesData.get(s) : undefined;
        const value =
          point && typeof point === "object" && "value" in point ? (point.value as number) : null;
        return { id: d.id, label: d.label, color: d.color, value };
      });
      cb({ time: param.time as number, rows });
    });

    const applyTheme = () => {
      const next = getSimChartTheme();
      chart.applyOptions({
        layout: { background: { color: next.background }, textColor: next.axis },
        grid: { horzLines: { color: next.grid } },
        crosshair: { vertLine: { color: next.zeroLine } },
      });
      // 계열 색도 테마를 따라야 한다. 잉크 램프는 테마마다 값이 다르다.
      defsRef.current.forEach((d, i) => {
        const s = linesRef.current.get(d.id);
        if (s) s.applyOptions({ color: next.seriesColors[i % next.seriesColors.length] });
      });
    };
    const stop = onThemeChange(applyTheme);

    return () => {
      stop();
      chart.remove();
      chartRef.current = null;
      linesRef.current.clear();
    };
  }, []);

  // 계열 재구축. 정체성(id)이 바뀌면 통째로 다시 만든다 — 부분 갱신은
  // 계열 순서가 뒤바뀔 때 색과 라벨이 어긋나는 버그를 부른다.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    linesRef.current.forEach((s) => chart.removeSeries(s));
    linesRef.current.clear();

    const t = getSimChartTheme();
    for (const def of series) {
      const s = chart.addSeries(LineSeries, {
        color: def.color,
        lineWidth: def.width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      s.setData(
        def.data.map((p) =>
          "value" in p
            ? { time: p.time as UTCTimestamp as Time, value: p.value }
            : { time: p.time as UTCTimestamp as Time },
        ),
      );
      if (zeroLine) {
        // 0선은 계열이 아니라 가격선으로 긋는다. 계열로 그으면 범례와
        // 크로스헤어 행에 "0"이라는 가짜 성분이 하나 생긴다.
        // 첫 계열에만 붙인다 — 다섯 번 그으면 다섯 겹으로 진해진다.
        if (def.id === series[0]?.id) {
          s.createPriceLine({
            price: 0,
            color: t.zeroLine,
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: false,
            title: "",
          });
        }
      }
      linesRef.current.set(def.id, s);
    }
    chart.timeScale().fitContent();
  }, [series, zeroLine]);

  return <div ref={boxRef} className="h-full w-full" />;
}
