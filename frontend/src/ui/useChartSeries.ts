"use client";

/* 한 종목의 차트 데이터, 종류에 맞춰 [OWNER, 2026-08-13].
 *
 * 선이면 일별 종가 전체(`full`), 주봉·월봉이면 서버에서 묶은 OHLC 막대
 * (`?interval=w|m`). 두 표면(하단 3열 차트·사이드 미리보기)이 같은 훅을 쓰므로
 * "선일 때 무엇을 받고 캔들일 때 무엇을 받나" 의 답이 하나다 — 이 리포가 반복해
 * 만든 결함이 정확히 그 답이 두 벌이 되는 것이었다(해상도별 캐시 키가 갈려
 * 같은 종목이 두 벌 캐시되던 것, 2026-08-13 오전).
 *
 * 키는 **종류별로 다르다**. 같은 키에 선 데이터와 막대 데이터를 넣으면 서로를
 * 덮어쓴다(Session 14 의 preview/full 충돌과 같은 실패). 선 키가 `"full"` 인
 * 것은 우연이 아니라 `PreviewPane`·`DetailChart` 와 **같은 항목을 공유**하기
 * 위해서다 — 차트를 옮겨 다녀도 재요청이 없다.
 *
 * 캔들에는 52주 통계가 없다. `CandlesPayload` 가 안 실어 오고, 실을 이유도
 * 없다 — 캔들 툴팁은 시가·고가·저가·종가·등락률이라 통계 자리가 아예 다르다.
 */

import { useQuery } from "@tanstack/react-query";

import {
  fetchCandles,
  fetchSeries,
  type HistoryPoint,
  type Interval,
  type OhlcBar,
  type SeriesStats,
} from "@/lib/api";

import { type ChartType, isCandleType } from "./chartType";

export interface ChartSeries {
  /** 선 모드의 일별 점. 캔들 모드에서는 undefined. */
  points?: HistoryPoint[];
  /** 캔들 모드의 주/월 막대. 선 모드에서는 undefined. */
  bars?: OhlcBar[];
  /** 52주 통계 — 선 모드에만 있다(캔들 툴팁은 이 자리를 안 쓴다). */
  stats: SeriesStats | null;
  isLoading: boolean;
  isError: boolean;
  /** 재시도가 도는 중인가 — `ErrorState` 의 스피너용. */
  isFetching: boolean;
  refetch: () => void;
}

export function useChartSeries(
  seriesId: string | null | undefined,
  chartType: ChartType,
): ChartSeries {
  const candle = isCandleType(chartType);
  const on = !!seriesId;

  /* 훅 둘이 **항상** 호출된다 — 종류로 갈라 하나만 부르면 훅 순서가 렌더마다
   * 바뀐다. 요청을 막는 것은 `enabled` 이고, 안 켜진 쿼리는 네트워크를 타지
   * 않으면서 `isLoading: false` 로 남는다. */
  const line = useQuery({
    queryKey: ["series", seriesId, "full"],
    queryFn: () => fetchSeries(seriesId!, "full"),
    enabled: on && !candle,
    staleTime: 30_000,
  });
  const bars = useQuery({
    queryKey: ["series", seriesId, chartType],
    queryFn: () => fetchCandles(seriesId!, chartType as Interval),
    enabled: on && candle,
    staleTime: 30_000,
  });

  const q = candle ? bars : line;
  return {
    points: candle ? undefined : line.data?.points,
    bars: candle ? bars.data?.bars : undefined,
    stats: candle ? null : (line.data?.stats ?? null),
    isLoading: q.isLoading,
    isError: q.isError,
    isFetching: q.isFetching,
    refetch: () => void q.refetch(),
  };
}
