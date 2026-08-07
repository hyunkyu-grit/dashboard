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
import { useQueries, useQuery } from "@tanstack/react-query";

import { instrumentsApi, marketDataApi, positionsApi } from "@/sim/lib/api-client";
import { applyRateOverrides, notionalToKrw, type ExpandedLeg } from "@/sim/lib/manual-position";
import type { Position } from "@/sim/types/portfolio";
import { useSimulationDataStore } from "@/sim/store/simulation-data-store";

export const BOOK_KEYS = {
  positions: ["positions"] as const,
  dateRange: ["market-data", "range"] as const,
  snapshot: ["market-data", "snapshot"] as const,
  expand: ["instruments", "expand"] as const,
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

  /* 기준일은 **가격 가능한 날**이어야 한다.
   *
   * 예전에는 `userBaseDate || max_date || ""`였고, 그 마지막 칸이 사고였다.
   * 백엔드가 아직 대답하지 않았거나 라우트가 없으면 기준일이 빈 문자열이
   * 되고, 그 상태로 만든 줄은 시작일도 만기일도 없이 태어난 뒤 "그날 호가가
   * 없어요"만 반복했다. 원인은 호가가 아니라 날짜였는데 화면은 호가를 탓했다.
   *
   * 이제 데이터 범위를 모르면 기준일도 없고(`""`), 그 상태에서는 포지션을
   * 추가할 수 없으며, 화면이 "시장 데이터를 못 읽었다"고 그 사실 그대로
   * 말한다. 사용자가 고른 날짜도 범위 밖이면 받지 않는다 — 워크북에 없는
   * 날로 실행하면 스왑이 통째로 제외된 채 결과만 조용히 빈다. */
  const available = range.data?.available_dates;
  const priceable = (d: string | null): d is string =>
    !!d && (!available || available.includes(d));
  const baseDate = priceable(userBaseDate) ? userBaseDate : (range.data?.max_date ?? "");

  /* 북은 이제 알림용이다. 실패해도 아래 setInputs는 그대로 돌아간다. */
  const book = useQuery({
    queryKey: BOOK_KEYS.positions,
    queryFn: () => positionsApi.list(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  /* 상품 한 줄 → 스왑 다리들. 백엔드가 한다 — DV01 중립 가중은 기준일 커브가
   * 있어야 하고 브라우저는 계산하지 않는다(§16).
   *
   * 줄이 여럿이면 요청도 여럿이다. 한 번에 묶어 보내는 엔드포인트를 만들지
   * 않은 이유는, 줄 하나가 실패해도 나머지는 살아야 하기 때문이다 — 6M 호가가
   * 없는 날 그 줄만 빠지고 다른 줄은 그대로 평가된다. 묶으면 전부 아니면
   * 전무가 된다. */
  const expansions = useQueries({
    queries: manualPositions.map((p) => ({
      queryKey: [...BOOK_KEYS.expand, baseDate, p.seriesId, p.direction, p.notionalEok] as const,
      queryFn: () =>
        instrumentsApi.expand({
          seriesId: p.seriesId,
          direction: p.direction,
          notional: notionalToKrw(p.notionalEok),
          baseDate,
        }),
      enabled: Boolean(baseDate) && p.notionalEok > 0,
      staleTime: 5 * 60_000,
      retry: 1,
    })),
  });

  /** 줄 id → 그 줄의 다리들(또는 실패 사유). 화면이 행 아래에 펼쳐 보여준다. */
  const legsByRow = useMemo(() => {
    const out: Record<string, { legs: ExpandedLeg[]; error: string | null; pending: boolean }> = {};
    manualPositions.forEach((p, i) => {
      const q = expansions[i];
      /* 여기 담기는 것은 **서버가 준 par 그대로**다. 사용자의 덮어쓰기는 아래
       * `enginePositions` 에서만 얹는다 [트레이더 피드백 3, 2026-08-07] —
       * 화면이 "par 는 얼마였는데 내가 얼마로 옮겼다" 를 말하려면 par 가 어딘가에
       * 남아 있어야 하고, 그 자리가 여기다. 여기서 덮어쓰면 par 가 사라져서
       * 되돌리기도, 비교도 할 수 없게 된다. */
      out[p.id] = {
        legs: q?.data?.legs ?? [],
        error: q?.error ? (q.error as Error).message : null,
        pending: q?.isPending ?? false,
      };
    });
    return out;
  }, [manualPositions, expansions]);

  /* 페이로드에 실리는 것은 다리들이다. 줄이 아니라.
   *
   * 줄을 훑어서 모은다 — `Object.values(legsByRow)` 로 평평하게 펴면 다리가
   * 어느 줄에서 왔는지를 잃고, 그러면 그 줄의 금리 덮어쓰기를 얹을 수 없다. */
  const enginePositions = useMemo(
    () => manualPositions.flatMap((p) => applyRateOverrides(legsByRow[p.id]?.legs ?? [], p)),
    [manualPositions, legsByRow],
  ) as unknown as Position[];

  /* 무한 렌더 루프를 끊는 것 [2026-08-07].
   *
   * `useQueries`는 매 렌더마다 **새 배열**을 돌려준다. 그래서 legsByRow도
   * enginePositions도 내용이 같아도 신원이 매번 달라지고, 그것을 아래
   * useEffect의 의존성에 그대로 넣으면:
   *
   *   렌더 → 효과 실행 → setInputs → 스토어 변경 → 리렌더 → 효과 실행 → …
   *
   * React가 "Maximum update depth exceeded"로 끊어 주기 전까지 멈추지 않는다.
   * 화면에서는 시뮬레이션 탭이 통째로 에러 경계에 잡혀 "표를 그리지 못했어요"만
   * 남았다. 포지션이 하나도 없어도 걸린다 — 빈 배열도 매번 새 빈 배열이다.
   *
   * 그래서 효과는 **내용**에 걸린다. 직렬화가 비싸 보이지만 다리 수는 상품당
   * 세 개를 넘지 않고, 진짜 비용은 여기가 아니라 setInputs가 부르는 리렌더다.
   * 신원 대신 내용을 보는 것이 이 자리에서는 더 싸다. */
  const positionsKey = useMemo(() => JSON.stringify(enginePositions), [enginePositions]);

  useEffect(() => {
    if (!baseDate) return;
    setInputs({
      baseDate,
      // positionsKey가 바뀌었을 때만 여기 온다 — 그 시점의 배열을 그대로 쓴다.
      positions: JSON.parse(positionsKey) as Position[],
      // 브릿지는 par 커브를 싣지 않는다 — 백엔드가 기준일의 IRS 스냅샷에서
      // 가져오고, 그날 호가가 없으면 조용한 0 대신 명시적으로 제외한다.
      irsParRates: [],
      dailyShockCurves: { bondCurves: {}, swapCurve: [] },
    });
  }, [baseDate, positionsKey, setInputs]);

  return {
    /* 기준일을 아직 모르는 동안만 대기다. 북은 여기 없다 — 게이트가 아니다. */
    isPending: range.isPending,
    isError: range.isError,
    error: range.error,
    /** 데이터가 있는 마지막 날 — 기준일 선택의 상한이다. */
    latestDataDate: range.data?.max_date ?? null,
    /** 시장 데이터를 아예 못 읽었다. 이때는 포지션을 만들 수도 없다. */
    marketUnavailable: !range.isPending && !baseDate,
    /** 줄별 다리 — 화면이 읽기 전용으로 펼친다. */
    legsByRow,
    /** 북 읽기 결과. 지금은 워크북이 없는 것이 정상이라 화면에 띄우지 않는다. */
    bookError: book.isError,
  };
}
