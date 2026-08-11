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
 *
 * ── 결과는 창이다 [트레이더 피드백 1, 2026-08-07] ──────────────────────────
 * 결과가 이 자리를 **대체**하고 있었다. 그래서 결과를 보는 동안 조건이 안
 * 보이고, 조건을 다시 보려면 결과를 닫아야 했다 — "이 숫자가 어느 조건에서
 * 나왔더라" 를 물으려면 화면을 왕복해야 한다는 뜻이다. 이제 조건 위에 창으로
 * 뜬다.
 *
 * **창을 여기서 띄우는 이유**(App 이 아니라): App 이 띄우려면 시뮬레이션
 * 스토어를 정적으로 물어야 하고, 그러면 시뮬레이션 번들이 첫 바이트에 실린다
 * (guards/lazy-chart.test.ts). 이 파일은 이미 `dynamic()` 뒤에 있다.
 *
 * **그 대가**: 백테스트 창과 달리 이 창은 Simulation 섹션을 떠나면 사라진다.
 * 백테스트 창은 `?bt` 로 셸이 들고 있어 탭을 옮겨도 남는다. 결과 자체는
 * 스토어에 그대로 있으므로 돌아오면 다시 뜬다 — 잃는 것은 창이지 결과가
 * 아니다. 탭을 넘나들며 결과를 옆에 두고 싶다면 셸이 그 사실을 알아야 하고,
 * 그건 시뮬레이션 번들을 첫 바이트에 올리거나 셸에 두 번째 상태를 만드는
 * 일이다. 지금은 치르지 않는다. [미해결]
 */

import { useSimulationPort } from "@/sim/hooks/use-simulation";
import { useSimulationDataStore } from "@/sim/store/simulation-data-store";
import { ErrorBoundary } from "@/ui/ErrorBoundary";

import { ConfigureStage } from "./ConfigureStage";
import { RunningStage } from "./RunningStage";
import { SimulationWindow } from "./SimulationWindow";

export function SimulationFlow() {
  const { status, lastRun, error } = useSimulationPort();
  const stage = useSimulationDataStore((s) => s.stage);
  const setStage = useSimulationDataStore((s) => s.setStage);

  if (status === "running") return <RunningStage />;

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

      {/* 조건 위에 뜬다. 존재 조건은 예전과 같다 — 결과 단계이고 실행 결과가
          있을 때. 창을 닫는 것이 곧 조건 단계로 돌아가는 것이다.

          NO AnimatePresence — 백테스트 창과 같은 판결이다 [안 닫히는 창 2제,
          ba2c1e0 & 2026-08-11 "팝업창 아직도 잘 안닫히는데"]: 프레즌스 자식은
          exit 완료 보고(rAF)를 기다려야 내려가는데, 닫는 순간의 무거운 리렌더
          (이 창은 일별 대사까지 실어 크다)나 스로틀된 탭이 그 보고를 굶기면
          창이 영원히 남는다. 닫기는 아무것도 기다리지 않는 평범한 조건부
          언마운트다. 입장 애니메이션은 프레즌스가 필요 없어 그대로 산다. */}
      {stage === "results" && lastRun && (
        <ErrorBoundary
          key="sim-window"
          region="popup"
          fallback="시뮬레이션 결과를 그리지 못했어요"
        >
          <SimulationWindow onClose={() => setStage("configure")} />
        </ErrorBoundary>
      )}
    </div>
  );
}
