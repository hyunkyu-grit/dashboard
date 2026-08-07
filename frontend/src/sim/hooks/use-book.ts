"use client";

/**
 * 북 브릿지 — 백엔드가 `data/Portfolio Data.xlsx`에서 파싱한 포지션을 포트의
 * 주변 입력으로 밀어 넣는다.
 *
 * 원본 앱은 이 자리에 업로드 화면 + localStorage 원장 + 브라우저 파서를 뒀다.
 * 여기서는 폴더가 원천이므로 읽기 한 번이면 된다.
 *
 * ─ 범위: 스왑만 [OWNER, 2026-08-06] ─────────────────────────────────────
 * 채권 행은 요청에 싣지 않는다. 실측(2026-08-06): 채권을 빼도 스왑 손익은
 * 바이트 그대로였고(+22.6억 / −25.1억), 채권 성분과 조달비용은 정확히 0이었다.
 * 런타임은 109.3초로 거의 그대로였다 — 시간의 대부분은 스왑 377건의 전체
 * 재평가이지 채권이 아니다.
 *
 * ─ 기준일 기본값 ─────────────────────────────────────────────────────────
 * "오늘"이 아니라 **시장 데이터가 있는 마지막 날**이다. 원본은 오늘을 기본값으로
 * 썼고, 워크북이 며칠 뒤처지는 순간 커브 프리뷰가 비고 스왑이 통째로 제외됐다.
 * 화면은 조용히 비었을 뿐이라 원인을 찾는 데 오래 걸린다.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { marketDataApi, positionsApi } from "@/sim/lib/api-client";
import type { ParsedPosition } from "@/sim/lib/api-types";
import type { Position } from "@/sim/types/portfolio";
import { useSimulationDataStore } from "@/sim/store/simulation-data-store";

export const BOOK_KEYS = {
  positions: ["positions"] as const,
  dateRange: ["market-data", "range"] as const,
};

/** 백엔드의 IRS 행 → 시뮬레이션 도메인의 Position.
 *
 * 계약 조건만 싣는다. 시장에서 결정되는 값(pvbp·krdMap·현재 픽싱·다음 픽싱일)은
 * 백엔드가 채운다 — 여기서 지어내면 그 순간 두 개의 진실이 생긴다.
 *
 * 단위 주의: 백엔드의 fixed_rate는 소수(0.0191)이고 도메인의 couponRate는
 * **퍼센트**다. 원본에서도 임포트 시점에 ×100을 했다. */
function irsToPosition(p: ParsedPosition, baseDate: string): Position {
  const remainingDays = Math.max(
    Math.round((Date.parse(p.maturity_date ?? "") - Date.parse(baseDate)) / 86_400_000),
    0,
  );
  return {
    id: p.position_id,
    name: p.position_id,
    book: p.book,
    bondType: "swap",
    sector: (p.sector === "OIS" ? "OIS" : "IRS") as Position["sector"],
    maturityDate: p.maturity_date ?? "",
    couponRate: (p.fixed_rate ?? 0) * 100,
    frequency: 4,
    notional: p.notional ?? 0,
    entryYield: 0,
    entryYieldPurchase: 0,
    evaluationAmount: 0,
    duration: 0,
    pvbp: 0,
    tenor: "",
    remainingDays,
    durationWeight: 0,
    krdMap: {},
    // 백엔드 관례: +1 = 고정 수취, −1 = 고정 지급.
    direction: p.pay_fixed ? -1 : 1,
    currentFloatRate: 0,
    startDate: p.start_date ?? "",
  };
}

export function useBook() {
  const setInputs = useSimulationDataStore((s) => s.setInputs);
  const userBaseDate = useSimulationDataStore((s) => s.userBaseDate);

  const positions = useQuery({
    queryKey: BOOK_KEYS.positions,
    queryFn: () => positionsApi.list(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const range = useQuery({
    queryKey: BOOK_KEYS.dateRange,
    queryFn: () => marketDataApi.dateRange(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // 사용자가 고른 날짜가 있으면 그것이 이긴다. 없으면 데이터가 있는 마지막 날.
  const baseDate = userBaseDate || range.data?.max_date || "";

  const swaps = useMemo(() => {
    const rows = positions.data ?? [];
    return rows.filter((p) => p.instrument_type === "irs");
  }, [positions.data]);

  useEffect(() => {
    if (!baseDate) return;
    setInputs({
      baseDate,
      // 기준일에 이미 만기가 지난 스왑은 평가 대상이 아니다.
      positions: swaps
        .filter((p) => Date.parse(p.maturity_date ?? "") > Date.parse(baseDate))
        .map((p) => irsToPosition(p, baseDate)),
      // 브릿지는 par 커브를 싣지 않는다 — 백엔드가 기준일의 IRS 스냅샷에서
      // 가져오고, 그날 호가가 없으면 조용한 0 대신 명시적으로 제외한다.
      irsParRates: [],
      dailyShockCurves: { bondCurves: {}, swapCurve: [] },
    });
  }, [baseDate, swaps, setInputs]);

  return {
    isPending: positions.isPending || range.isPending,
    isError: positions.isError || range.isError,
    error: positions.error ?? range.error,
    /** 데이터가 있는 마지막 날 — 기준일 선택의 상한이다. */
    latestDataDate: range.data?.max_date ?? null,
    swapCount: swaps.length,
    bondCount: (positions.data ?? []).length - swaps.length,
  };
}
