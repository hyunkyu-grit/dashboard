"use client";

/**
 * 실행 중 화면.
 *
 * 정직성 각서: 엔드포인트는 단일 요청/응답이다. 스트리밍도, 진행 채널도 없다.
 * 실제 신호는 "요청이 떠났다"와 "응답이 왔다" 둘뿐이므로, **경과 시간만이
 * 유일한 살아 있는 신호**다.
 *
 * 그래서 진행 막대도, 단계 목록도 두지 않는다. 정해진 단계 목록은 실제 진행과
 * 무관하게 흘러가면서 진행률처럼 읽히고, 그건 지어낸 정보다. 백엔드가 언젠가
 * 단계 이벤트를 흘려보내면 그때 여기에 배선한다 — 흉내 내지 않는다.
 */

import { useEffect, useState } from "react";

import { Button, FloatingCard } from "@/sim/ui/primitives";
import { Spinner } from "@/sim/ui/Spinner";
import { useSimulationPort } from "@/sim/hooks/use-simulation";

export function RunningStage() {
  const { cancelRun } = useSimulationPort();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-5">
      {/* 폭은 FloatingCard가 킷 값(260)으로 정한다 — 알럿은 부르는 쪽이
          넓히는 면이 아니다. */}
      <FloatingCard>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-title3 font-semibold tracking-tight">
            {/* 킷의 Circular **Indeterminate**다 — 이름 그대로 진행률을 말하지
                않는다. 여기 신호는 "요청이 떠났다"뿐이라 Determinate(도넛)를
                쓰면 없는 진행률을 지어내게 된다. 앞서 쓰던 맥박 점도 같은 일을
                더 조용히 했을 뿐이고, 이건 킷에 실제로 있는 컴포넌트다. */}
            <Spinner size={16} label="계산 중" />
            계산하고 있어요
          </h2>
          <span className="text-title3 font-medium text-ink-1" aria-live="off">
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        </div>
        <p className="mt-1.5 text-body text-ink-2">
          단일 요청이라 단계별 진행 신호가 없어요. 경과 시간이 유일한 실제 신호예요.
        </p>
        <Button variant="secondary" size="md" onClick={cancelRun} className="mt-5 w-full">
          취소
        </Button>
      </FloatingCard>
    </div>
  );
}
