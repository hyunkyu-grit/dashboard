"use client";

/* 시뮬레이션 결과 창 — 백테스트와 같은 종류의 떠 있는 창
 * [트레이더 피드백 1, 2026-08-07: "시뮬레이션 결과가 백테스트와 마찬가지로
 * 팝업으로 뜨면 좋겠다"].
 *
 * 결과가 인라인으로 조건 화면을 **대체**하고 있었다. 그래서 결과를 보는 동안
 * 조건이 안 보이고, 조건을 다시 보려면 결과를 닫아야 했다 — "이 숫자가 어느
 * 조건에서 나왔더라" 를 물으려면 화면을 왕복해야 한다는 뜻이다. 창으로 띄우면
 * 둘이 같이 있는다.
 *
 * ── 백테스트 창과 같은 것 ──────────────────────────────────────────────────
 * 기계는 통째로 공유한다 (`useFloatingWindow`): 자리 기억, 헤더로만 끌기,
 * 뷰포트 클램프. 창 하나, 자유도 하나(어디에 두느냐) — 리사이즈도 최소화도
 * 없다. 표면도 같다: 불투명 popover + 강한 헤어라인 + 창 그림자. 유리가 아닌
 * 이유는 HIG §6.1 이다(콘텐츠 레이어). 신호등도 같은 자리, 닫기 하나.
 *
 * ── 백테스트 창과 다른 것: URL 이 없다 ────────────────────────────────────
 * 백테스트는 `?bt` 나노스로 산다 — 링크를 공유하면 창이 복원된다. 시뮬레이션은
 * 그럴 수 없다: 결과는 방금 계산한 실행이고 URL 에 담기지 않는다. 파라미터를
 * 두면 **빈 창을 복원**하게 되고, 그건 없는 것보다 나쁘다.
 * 그래서 존재 조건은 그대로 스토어다 — `stage === "results" && lastRun`.
 * 이미 모듈 수준 스토어라 화면을 떠났다 돌아와도 살아 있고, 언마운트된 사이에
 * 끝난 실행도 결과로 착지한다(SimulationFlow 의 주석).
 */

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { SIM_WINDOW_W } from "@/ui/floatingWindow";
import { Z_WINDOW } from "@/ui/layers";
import { ENTER, instant } from "@/ui/motion";
import { useFloatingWindow } from "@/ui/useFloatingWindow";
import { WindowControls } from "@/ui/WindowControls";

import { ResultsStage } from "./ResultsStage";

export function SimulationWindow({ onClose }: { onClose: () => void }) {
  const reduced = useReducedMotion() === true;
  const { pos, dragHandlers } = useFloatingWindow("simulation", SIM_WINDOW_W);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /* Esc 는 **한 겹만** 벗긴다. 이 창이 열려 있으면 여기서 멈추고, 위에 확대
   * 보기나 명령 바가 떠 있으면 그쪽이 먼저 먹는다 — 그 둘은 자기 핸들러에서
   * `stopPropagation` 한다. App 의 핀 해제도 같은 규칙을 따른다. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      role="dialog"
      aria-label="시뮬레이션 결과"
      ref={rootRef}
      tabIndex={-1}
      /* 백테스트 창과 같은 표면: 불투명 + 강한 헤어라인 + 킷의 Utility Panel
         그림자. 배경 막(backdrop)은 없다 — 뒤의 조건 화면이 계속 살아 있어야
         하고, 그게 이 창을 만든 이유다. */
      className={`fixed ${Z_WINDOW} flex max-h-[88vh] flex-col overflow-hidden rounded-card border border-edge-live bg-popover shadow-window`}
      /* 백테스트(928)보다 넓다 [OWNER, 2026-08-10 — "결과창 좀 키워서"].
         min() 은 뷰포트가 좁을 때를 위한 것 — 위치 클램프(useFloatingWindow)는
         SIM_WINDOW_W 기준이라 그 경우 left 가 0 에 앵커되고 폭만 줄어든다. */
      style={{ left: pos.left, top: pos.top, width: `min(${SIM_WINDOW_W}px, calc(100vw - 16px))` }}
      /* exit 는 없다 — 프레즌스 밖에서 마운트되므로(SimulationFlow) 죽은
         코드이고, 살아 있으면 다시 프레즌스에 넣고 싶어진다. 닫기는 즉시다. */
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={instant(ENTER, reduced)}
    >
      {/* 끌 수 있는 유일한 면. 신호등이 맨 앞인 이유는 백테스트 창과 같다 —
          오른쪽 끝의 × 를 옮긴 것이 아니라 이 표면이 창이라는 선언이다. */}
      <div
        {...dragHandlers}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-edge bg-popover px-5 py-3"
      >
        <WindowControls onClose={onClose} />
        <span className="text-[18px] font-bold">시뮬레이션 결과</span>
        <span className="text-[14px] text-ink-2">이 경로면 얼마였을까</span>
        <span className="flex-1" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <ErrorBoundary fallback="시뮬레이션 결과를 그리지 못했어요">
          {/* `onEdit` 은 조건 단계로 되돌리는 것이었다. 이제 조건은 창 뒤에
              계속 있으므로 되돌릴 것이 없다 — 창을 닫는 것이 곧 조건으로
              돌아가는 것이다. */}
          <ResultsStage onEdit={onClose} />
        </ErrorBoundary>
      </div>

      {/* 서랍은 없앴다 [OWNER, 2026-08-10 — "일별 PnL탭 없애고, KRD의
          컴포넌트를 위로 올리기"]. 일별 대사 표(KrdDailyTable)는 이제
          ResultsStage 본문의 마지막 구획이다 — 손익 렌즈가 스왑평가·스왑캐리·
          그날 손익까지 다 실으면서 일별 PnL 탭(DailyPnlTable)은 같은 숫자의
          부분집합이 됐고, 부분집합을 별도 탭으로 두면 "어느 쪽이 진짜냐"는
          질문만 만든다. DailyPnlTable 은 ResultsTables.tsx 에 남아 있다(감춘 표
          복원 경로). 트레이더 피드백 5("서랍에 둘 다")는 이 지시로 대체됐다 —
          백테스트 창의 서랍은 그대로다. */}
    </motion.div>
  );
}

/* 존재 조건을 읽는 훅은 여기 두지 않는다. App 이 그것을 알아야 하는데, 이
 * 파일에서 내보내면 App 이 이 모듈을 **정적으로** import 하게 되고 그러면
 * 시뮬레이션 번들(차트 포함, ~196KB)이 첫 바이트에 실린다 —
 * guards/lazy-chart.test.ts 가 막는 바로 그것이다. App 은 스토어를 직접 읽고
 * 이 컴포넌트만 `dynamic()` 으로 가져온다. */
