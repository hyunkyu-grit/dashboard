"use client";

/**
 * 단계 흐름: 조건 설정 → 계산 중 → 결과.
 *
 * 단계는 **포트 스토어**에 산다, 컴포넌트 상태가 아니라. 화면을 떠났다 돌아와도
 * 보던 것이 그대로 있어야 하고, 무엇보다 요청이 컴포넌트보다 오래 산다 —
 * 뮤테이션은 모듈 수준 스토어에 쓰므로, 화면이 언마운트된 사이에 끝난 실행도
 * 결과 단계로 착지한다.
 *
 * 사용자가 취소하면 조건 설정으로 돌아간다. 재실행은 대체다: 새 결과가
 * **도착한 순간에만** 이전 것을 갈아친다.
 */


import { useSimulationPort } from "@/sim/hooks/use-simulation";
import { useSimulationDataStore } from "@/sim/store/simulation-data-store";

import { ConfigureStage } from "./ConfigureStage";
import { ResultsStage } from "./ResultsStage";
import { RunningStage } from "./RunningStage";

export function SimulationFlow() {
  const { status, lastRun, error } = useSimulationPort();
  const stage = useSimulationDataStore((s) => s.stage);
  const setStage = useSimulationDataStore((s) => s.setStage);

  if (status === "running") return <RunningStage />;

  if (stage === "results" && lastRun) return <ResultsStage onEdit={() => setStage("configure")} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {status === "error" && error && (
        // 실패는 화면 위쪽에, 조건 옆에 둔다. 토스트로 띄우면 사라진 뒤에
        // 무엇이 잘못됐는지 물어볼 곳이 없다.
        <p className="mx-5 mt-4 rounded-card border border-edge bg-tile px-4 py-3 text-body text-ink-1">
          시뮬레이션이 실패했어요 — {error}
        </p>
      )}
      <ConfigureStage />
    </div>
  );
}
