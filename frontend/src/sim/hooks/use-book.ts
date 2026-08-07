"use client";

/**
 * 시장 데이터 브릿지 — 기준일과 그 날의 par 스냅샷을 포트에 밀어 넣는다.
 *
 * ─ 북은 더 이상 포지션의 주인이 아니다 [OWNER, 2026-08-07] ────────────────
 * `Portfolio Data.xlsx`를 한동안 안 쓴다. 알고 싶은 것이 "내 북이 어떻게
 * 되나"가 아니라 **"이 포지션을 이 금리 경로에 두면 어떻게 되나"**이기
 * 때문이다. 포지션은 이제 직접 입력에서 온다 —
 * store.manualPositions → lib/manual-position.toEnginePosition.
 *
 * 북 읽기 자체는 살려 뒀다(한동안, 이지 영원히가 아니다). 다만
 * **실패해도 화면을 막지 않는다.** 예전에는 이 훅이 포지션의 주인이었기에
 * /api/positions가 404면 탭이 "북을 읽지 못했어요"에서 멈췄는데, 이제 북이
 * 없어도 손입력만으로 완결이라 그 정지는 근거가 없다. `bookError`는 알림일
 * 뿐 게이트가 아니다.
 *
 * ─ 기준일 기본값 ─────────────────────────────────────────────────────────
 * "오늘"이 아니라 **시장 데이터가 있는 마지막 날**이다. 원본은 오늘을 기본값으로
 * 썼고, 워크북이 며칠 뒤처지는 순간 커브 프리뷰가 비고 스왑이 통째로 제외됐다.
 * 화면은 조용히 비었을 뿐이라 원인을 찾는 데 오래 걸린다.
 *
 * ─ 범위: 스왑만 [OWNER, 2026-08-06] ─────────────────────────────────────
 * 채권 행은 요청에 싣지 않는다. 실측(2026-08-06): 채권을 빼도 스왑 손익은
 * 바이트 그대로였고(+22.6억 / −25.1억), 채권 성분과 조달비용은 정확히 0이었다.
 * 직접 입력에도 그대로 적용된다 — 넣을 수 있는 것은 IRS뿐이다.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { marketDataApi, positionsApi } from "@/sim/lib/api-client";
import { isLive, parRatePct, toEnginePosition } from "@/sim/lib/manual-position";
import { useSimulationDataStore } from "@/sim/store/simulation-data-store";

export const BOOK_KEYS = {
  positions: ["positions"] as const,
  dateRange: ["market-data", "range"] as const,
  snapshot: ["market-data", "snapshot"] as const,
};

/* `irsToPosition` (백엔드 IRS 행 → 도메인 Position)이 여기 있었고 삭제했다
 * [2026-08-07]. 북이 포지션의 주인이 아니게 되면서 호출자가 사라졌다.
 *
 * 되살릴 일이 생기면 lib/manual-position.ts의 `toEnginePosition`을 보면 된다 —
 * 같은 변환을 같은 규율로 한다(계약 조건만 싣고, 시장이 정하는 값은 백엔드가
 * 채우도록 0으로 둔다). 단위 함정도 거기 적혀 있다: 백엔드의 fixed_rate는
 * 소수(0.0191)이고 도메인의 couponRate는 퍼센트다. */

export function useBook() {
  const setInputs = useSimulationDataStore((s) => s.setInputs);
  const userBaseDate = useSimulationDataStore((s) => s.userBaseDate);
  const manualPositions = useSimulationDataStore((s) => s.manualPositions);

  const range = useQuery({
    queryKey: BOOK_KEYS.dateRange,
    queryFn: () => marketDataApi.dateRange(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // 사용자가 고른 날짜가 있으면 그것이 이긴다. 없으면 데이터가 있는 마지막 날.
  const baseDate = userBaseDate || range.data?.max_date || "";

  /* 기준일의 par 스냅샷. 직접 입력한 줄의 고정금리를 비워 뒀을 때 그 자리를
   * 채우는 값이라, 기준일이 바뀌면 같이 바뀌어야 한다. `enabled`로 막는 이유는
   * 기준일이 없는 첫 렌더에 `/api/market-data/`(빈 날짜)를 때리지 않기
   * 위해서다 — 404가 조용히 에러 상태로 남는다. */
  const snapshot = useQuery({
    queryKey: [...BOOK_KEYS.snapshot, baseDate] as const,
    queryFn: () => marketDataApi.snapshot(baseDate),
    enabled: Boolean(baseDate),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const parQuotes = useMemo(() => snapshot.data?.swap_quotes ?? [], [snapshot.data]);

  /* 북은 이제 알림용이다. 실패해도 아래 setInputs는 그대로 돌아가고, 화면은
   * 손입력만으로 완결된다. */
  const book = useQuery({
    queryKey: BOOK_KEYS.positions,
    queryFn: () => positionsApi.list(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const enginePositions = useMemo(
    () =>
      baseDate
        ? manualPositions
            .filter((p) => isLive(p, baseDate))
            .map((p) => toEnginePosition(p, parRatePct(parQuotes, p.tenor), baseDate))
        : [],
    [manualPositions, parQuotes, baseDate],
  );

  useEffect(() => {
    if (!baseDate) return;
    setInputs({
      baseDate,
      positions: enginePositions,
      // 브릿지는 par 커브를 싣지 않는다 — 백엔드가 기준일의 IRS 스냅샷에서
      // 가져오고, 그날 호가가 없으면 조용한 0 대신 명시적으로 제외한다.
      irsParRates: [],
      dailyShockCurves: { bondCurves: {}, swapCurve: [] },
    });
  }, [baseDate, enginePositions, setInputs]);

  return {
    /* 기준일을 아직 모르는 동안만 대기다. 북과 스냅샷은 여기 없다 — 북은
     * 게이트가 아니고, 스냅샷은 없으면 고정금리를 직접 넣으면 되는 편의값이다. */
    isPending: range.isPending,
    isError: range.isError,
    error: range.error,
    /** 데이터가 있는 마지막 날 — 기준일 선택의 상한이다. */
    latestDataDate: range.data?.max_date ?? null,
    /** 그날의 par 호가. 직접 입력 행이 고정금리 자리에 보여준다. */
    parQuotes,
    /** 북 읽기 결과 — 알림일 뿐 게이트가 아니다. */
    bookError: book.isError,
    bookSwapCount: (book.data ?? []).filter((p) => p.instrument_type === "irs").length,
  };
}
