"use client";

/**
 * 시나리오 케이스 토글 — 커브형·시계열형 미리보기가 같은 칩을 쓴다
 * [트레이더 피드백 2, 2026-08-07 도입 · 시계열형에도 붙인 것은 2026-08-10].
 *
 * 활성 케이스는 잠겨 있다(끌 수 없다) — 편집 중인 것이 화면에 없는 상태는
 * 만들지 않는다. 나머지는 눌러서 겹쳐 그릴 수 있다.
 *
 * 색은 케이스 고유색 [OWNER, 2026-08-10] — tokens.css --bw-case-*. 예전엔
 * 파선 견본이었는데 파선 자체가 폐기되면서 색 견본으로 바뀌었다.
 */

import { useSimulationDataStore } from "@/sim/store/simulation-data-store";
import { getSimChartTheme } from "@/sim/lib/chart-theme";
import { SCENARIO_CASES } from "@/sim/types/simulation-port";

export function CaseChips() {
  const activeCase = useSimulationDataStore((s) => s.activeCase);
  const overlayCases = useSimulationDataStore((s) => s.overlayCases);
  const toggleOverlayCase = useSimulationDataStore((s) => s.toggleOverlayCase);
  const t = getSimChartTheme();

  return (
    <div className="flex items-center gap-1.5">
      {SCENARIO_CASES.map((c) => {
        const on = c.id === activeCase || overlayCases.includes(c.id);
        const locked = c.id === activeCase;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            disabled={locked}
            title={locked ? "편집 중인 케이스라 항상 그려요" : undefined}
            onClick={() => toggleOverlayCase(c.id)}
            className={
              "flex h-6 items-center gap-1.5 rounded-control-sm px-2.5 text-callout transition-colors " +
              (on
                ? "bg-ink-4 font-medium text-ink"
                : "bg-ink-5 text-ink-2 hover:bg-ink-4 hover:text-ink-1")
            }
          >
            <svg width="14" height="6" aria-hidden className="shrink-0">
              <line x1="0" y1="3" x2="14" y2="3" stroke={t.case[c.id]} strokeWidth="1.5" />
            </svg>
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
