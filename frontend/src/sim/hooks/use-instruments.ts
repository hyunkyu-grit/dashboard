"use client";

/** 고를 수 있는 상품 목록 — 모니터의 그룹 그대로.
 *
 * 백엔드가 답한다(GET /api/instruments). 프론트에 목록을 박아두지 않은 이유는
 * 그것이 곧 두 번째 진실이 되기 때문이다: 다리를 세울 수 있는 테너는 워크북에
 * 무엇이 있느냐로 정해지고(지금은 10Y까지), 그 사실을 아는 쪽은 백엔드다.
 * 목록을 여기 적어 두면 워크북이 바뀔 때 화면만 옛 세상을 계속 제안한다.
 *
 * 한 세션 안에서 바뀌지 않으므로 무기한 캐시한다. */

import { useQuery } from "@tanstack/react-query";

import { instrumentsApi } from "@/sim/lib/api-client";

export const INSTRUMENT_KEYS = {
  catalog: ["instruments", "catalog"] as const,
};

export function useInstrumentCatalog() {
  return useQuery({
    queryKey: INSTRUMENT_KEYS.catalog,
    queryFn: () => instrumentsApi.catalog(),
    staleTime: Infinity,
    retry: 1,
  });
}
