/**
 * TanStack Query layer for the Simulation Screen (protocol §1.3). Server state
 * lives in Query; client scenario state lives in the Zustand slice. Query keys are
 * namespaced ['simulation', …] per the protocol. Modeled on the target's src/hooks/use-api.ts.
 *
 * The run is a MUTATION (an explicit user action with a fresh body each time), and on
 * success it invalidates ['simulation'] and writes the result into the slice so
 * cross-screen selectors see it.
 */
"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { simulationApi } from "../api/simulation-api";
import type { SimulateRequest, SimulateResponse } from "../api/simulate-dto";
import { anchorConversionError, buildSimulateRequest } from "../lib/scenario-curves";
import { caseParams, useSimulationDataStore } from "../store/simulation-data-store";
import { SCENARIO_CASES, type CaseId, type SimulationDataPort } from "../types/simulation-port";

export const SIMULATION_KEYS = {
  all: ["simulation"] as const,
  run: () => ["simulation", "run"] as const,
  lastResult: () => ["simulation", "last-result"] as const,
};

/** Low-level run-trigger mutation. Prefer useSimulationPort().run() from the screen. */
export function useRunSimulation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SIMULATION_KEYS.run(),
    mutationFn: ({ req, signal }: { req: SimulateRequest; signal?: AbortSignal }) =>
      simulationApi.simulate(req, signal),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SIMULATION_KEYS.all }),
  });
}

/**
 * Assembles the full SimulationDataPort the screen consumes: Zustand-held inputs +
 * params + last result, with run() wired to the mutation and result ingestion.
 * This is the single object the ported <ScenarioSimulator> will bind to in Phase 4.
 */
// SIM2-6 — MODULE-level controller for the in-flight request: the request
// outlives the component (the mutation writes to the module-level store), so
// the cancel affordance must too. A hook-local ref meant a remount during
// flight rendered a Running screen whose cancel could no longer abort the
// live request. One run at a time (the UI gates on status).
let activeRunController: AbortController | null = null;

export function useSimulationPort(): SimulationDataPort {
  const store = useSimulationDataStore();
  const runMutation = useRunSimulation();

  const run = useCallback(
    async (request: SimulateRequest): Promise<SimulateResponse | null> => {
      const { markRunning, ingestResult, markError } = useSimulationDataStore.getState();
      const controller = new AbortController();
      activeRunController = controller;
      markRunning();
      try {
        const result = await runMutation.mutateAsync({ req: request, signal: controller.signal });
        ingestResult(request, result);
        return result;
      } catch (err) {
        // A user cancel is not an error state: markCancelled already ran.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          markError(err instanceof Error ? err.message : "시뮬레이션 오류가 발생했습니다.");
        }
        return null;
      } finally {
        if (activeRunController === controller) activeRunController = null;
      }
    },
    [runMutation],
  );

  /* 실행 하나가 **네 케이스를 전부** 돌린다 [OWNER, 2026-08-10 — "실행결과
   * 나란히 보여주는 거 ㄱㄱ"]. 요청은 케이스마다 caseParams 로 조립한다 —
   * 공유 필드(기간·앵커·포지션)는 하나, 케이스 필드(목표·경로·스프레드·
   * 이벤트)만 갈린다. 네 요청이 같은 AbortController 를 물고 병렬로 나간다:
   * 취소 한 번이 넷을 다 끊고, 하나라도 실패하면 전체가 실패다(세 케이스만
   * 있는 결과 화면은 "비교" 라는 이 화면의 목적을 반쪽으로 만든다). */
  const runCurrent = useCallback(async (): Promise<SimulateResponse | null> => {
    // Read fresh from the store (not the closed-over render snapshot) so a run
    // triggered right after a patchParams uses the latest params/inputs.
    const state = useSimulationDataStore.getState();
    const { inputs, markError, markRunning, setLastRunAnchorTenor, ingestCaseResults } = state;

    // N1 degeneracy guard, per case — belt to Configure's braces: even a
    // programmatic caller cannot ship a degenerate anchor conversion. The
    // error names the case so the fix is findable (three of the four are
    // hidden behind the case switcher).
    const requests: { id: CaseId; label: string; req: SimulateRequest }[] = [];
    for (const c of SCENARIO_CASES) {
      const p = caseParams(state, c.id);
      const anchorError = anchorConversionError(p);
      if (anchorError) {
        markError(`${c.label} 케이스: ${anchorError}`);
        return null;
      }
      requests.push({ id: c.id, label: c.label, req: buildSimulateRequest(inputs, p) });
    }

    const anchor = state.params.anchorTenor ?? "3Y";
    const controller = new AbortController();
    activeRunController = controller;
    markRunning();
    try {
      const results = await Promise.all(
        requests.map(async ({ id, req }) => {
          const result = await runMutation.mutateAsync({ req, signal: controller.signal });
          return [id, { request: req, result }] as const;
        }),
      );
      const runs = Object.fromEntries(results);
      // 결과 창은 실행 시점의 활성(편집 중) 케이스로 열린다 — 방금 만지던
      // 숫자의 결과가 먼저 보여야 한다. 나머지 셋은 탭으로 갈아 끼운다.
      const primary = useSimulationDataStore.getState().activeCase;
      ingestCaseResults(runs, primary);
      // Remember which pillar the landed run was designed on (Results chip
      // labeling) — captured at build time, immune to mid-flight anchor edits.
      setLastRunAnchorTenor(anchor);
      return runs[primary]?.result ?? null;
    } catch (err) {
      // A user cancel is not an error state: markCancelled already ran.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        markError(err instanceof Error ? err.message : "시뮬레이션 오류가 발생했습니다.");
      }
      return null;
    } finally {
      if (activeRunController === controller) activeRunController = null;
    }
  }, [runMutation]);

  const cancelRun = useCallback((): void => {
    // Flip the store first so the abort's rejection sees status already idle;
    // previous result stays untouched (replace-on-arrival semantics). The
    // module-level controller means this also aborts a request started by a
    // PREVIOUS mount of the tab (SIM2-6).
    useSimulationDataStore.getState().markCancelled();
    activeRunController?.abort();
    activeRunController = null;
  }, []);

  return {
    inputs: store.inputs,
    params: store.params,
    lastRun: store.lastRun,
    lastRunRequest: store.lastRunRequest,
    status: store.status,
    error: store.error,
    setInputs: store.setInputs,
    patchParams: store.patchParams,
    resetParams: store.resetParams,
    run,
    runCurrent,
    cancelRun,
  };
}
