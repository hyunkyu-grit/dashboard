"use client";

/* 기준일의 CD 3M 금리 [트레이더 피드백 4, 2026-08-07: "CD금리가 포지션에서 같이
 * 나와야한다"].
 *
 * 왜 필요한가: 이 화면이 세우는 스왑은 전부 CD 3M을 받거나 준다. 고정금리는
 * 다리마다 적혀 있는데 변동 쪽 지수는 화면 어디에도 없었다 — 스프레드가 얼마인지
 * 물으려면 다른 화면을 열어야 했다.
 *
 * 어디서 오나: 모니터의 시리즈 API 그대로다(`3M` = CD 91일, `lib/api`의
 * CD_SERIES_ID). 시뮬레이션 전용 엔드포인트를 새로 만들지 않는 이유는 이 리포가
 * 반복해서 지키는 규칙이다 — 같은 사실에 두 개의 출처가 생기면 두 화면의 CD가
 * 갈릴 수 있다. 쿼리 키도 모니터가 쓰는 것과 같아서 이미 읽은 적이 있으면
 * 캐시 적중이고 두 번째 요청이 아니다.
 *
 * **그 날 유효한 값**을 고른다: 정확히 그 날짜가 있으면 그것, 없으면 그 이전의
 * 마지막 값. 이후의 첫 값을 집으면 아직 일어나지 않은 호가를 기준일의 사실인 양
 * 적게 된다. 이전 값이 아예 없으면 null이고, 화면은 숫자 대신 침묵한다.
 */

import { useQuery } from "@tanstack/react-query";

import { CD_SERIES_ID, fetchSeries } from "@/lib/api";

export function useCdRate(baseDate: string): number | null {
  const { data } = useQuery({
    queryKey: ["series", CD_SERIES_ID, "full"],
    queryFn: () => fetchSeries(CD_SERIES_ID, "full"),
    enabled: Boolean(baseDate),
    staleTime: 30_000,
  });
  if (!data || !baseDate) return null;
  let v: number | null = null;
  for (const p of data.points) {
    if (p.t > baseDate) break;
    v = p.v;
  }
  return v;
}
