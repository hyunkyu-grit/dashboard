"use client";

/**
 * 인풋 커브 미리보기 — 설계한 시나리오가 커브를 **실행 전에** 어떻게 움직이는지
 * 보여준다.
 *
 * 겹치는 두 선은 같은 계열의 기준(실선)과 시나리오(파선)다. 시나리오 값은
 * 요청이 실제로 쓰는 기계에서 나온다: `buildSimulateRequest`로 페이로드를 만들고
 * `buildScenarioOverlay`가 그 요청의 경로 평가기로 테너별 누적 bp를 얹는다.
 * 여기서 수식을 다시 쓰지 않는다 — 미리보기가 실행 결과와 다른 규칙을 쓰면
 * 미리보기가 아니라 두 번째 모델이 된다.
 *
 * ─ 범위: 스왑만, 계열도 IRS 하나 ─────────────────────────────────────────
 * 실제로 값이 매겨지는 커브만 그린다. 국고 참조선은 원천 워크북과 함께
 * 사라졌다 — 아래 FAMILIES의 주석이 그 경위를 적어 뒀다.
 *
 * 시간축 스크러버는 시나리오가 **시간에 대해 모양을 가질 때만** 나온다. 직선
 * 경로에서는 어느 날을 봐도 같은 비율의 평행 이동이라, 스크러버가 조작할 것이
 * 없으면서 있는 것처럼 보인다.
 */

import { useMemo, useState } from "react";

import { Segmented } from "@/sim/ui/primitives";
import { useSimulationDataStore } from "@/sim/store/simulation-data-store";
import { PathPreview } from "./PathPreview";
import { TermStructureChart, type TermSeries } from "@/sim/ui/TermStructureChart";
import { SERIES_OPACITY } from "@/sim/theme/ramp";
import { useUiStore } from "@/state/ui";
import { withAlpha } from "@/sim/theme/bridge";
import { getSimChartTheme } from "@/sim/lib/chart-theme";
import { useSimulationPort } from "@/sim/hooks/use-simulation";
import { useSwapInputQuotes } from "@/sim/hooks/use-input-curves";
import {
  buildScenarioOverlay,
  isShapedScenario,
  type BaseQuote,
  type ScenarioOverlayPreview,
} from "@/sim/lib/input-curve-preview";
import { SCENARIO_CASES, type CaseId } from "@/sim/types/simulation-port";
import { buildSimulateRequest } from "@/sim/lib/scenario-curves";
import { MAX_TENOR_YEARS } from "@/sim/lib/components";

/* IRS 하나뿐이다 [OWNER, 2026-08-07].
 *
 * 국고 계열이 여기 있었고 뺐다. 그 선의 원천은 `Credit Matrix Data.xlsx`
 * (42MB)였는데, 시장 데이터가 이 리포의 `irsdata.xlsx` 하나로 정리되면서
 * 그 워크북이 삭제됐다. 남겨 뒀다면 /api/credit-curve/series가 500을 내고
 * 아래 `missing` 배너가 "국고 호가가 없어요"를 영원히 띄웠을 것이다 —
 * 그건 정보가 아니라 소음이고, 진짜로 하루치 커버리지가 빈 날을 말하려고
 * 만든 배너를 못 쓰게 만든다.
 *
 * 시나리오의 앵커는 여전히 국고다. 그것은 시장 국고 커브를 읽지 않는다 —
 * lib/scenario-curves.ts의 `tenorSpreadAt`이 사용자가 정한 spread1y/spread10y
 * 만 받는다. 사라진 것은 참조선이지 앵커가 아니다. */
const FAMILIES = [{ key: "IRS", label: "IRS" }] as const;

/* 케이스별 파선 패턴 [트레이더 피드백 2, 2026-08-07].
 *
 * 넷을 가르는 것은 **색이 아니라 이것**이다. §5(monochrome-first)가 그렇게
 * 적고 있고, 이 화면에서는 실질적인 이유도 있다: 액센트는 기준선이 이미
 * 쓰고 있고, 빨강·파랑은 이 제품에서 부호를 뜻한다. 시나리오는 부호가 아니다.
 *
 * 패턴을 눈에 띄게 벌린다 — 4 3 과 5 3 은 화면에서 같은 선이다. */
const CASE_DASH: Record<CaseId, string> = {
  base: "4 3",
  bull: "1 3",
  bear: "9 4",
  crisis: "9 3 2 3",
};

export function CurvePreview() {
  const { params, inputs } = useSimulationPort();
  const baseDate = inputs.baseDate;

  const swapQ = useSwapInputQuotes(baseDate);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // 어느 미리보기를 보고 있는지는 포트 스토어에 산다 — 단계를 오가도 유지된다.
  const previewMode = useSimulationDataStore((s) => s.previewMode);
  const setPreviewMode = useSimulationDataStore((s) => s.setPreviewMode);

  /* 겹쳐 그릴 케이스. 활성 케이스는 **언제나** 들어간다 — 편집 중인 것이
     화면에 없는 상태는 만들지 않는다. 순서는 SCENARIO_CASES 를 따른다:
     토글을 누른 순서로 그리면 같은 조합인데 겹침 순서가 달라진다. */
  const activeCase = useSimulationDataStore((s) => s.activeCase);
  const overlayCases = useSimulationDataStore((s) => s.overlayCases);
  const toggleOverlayCase = useSimulationDataStore((s) => s.toggleOverlayCase);
  const cases = useSimulationDataStore((s) => s.cases);
  /* 배열은 매 렌더 새 객체라 그대로 의존성에 넣으면 아래 memo 가 매번 깨진다.
     내용을 문자열로 접어서 넣는다 — 순서가 고정돼 있으므로 같은 조합이면 같은 키다. */
  const overlayKey = overlayCases.join(",");
  const drawnCases = useMemo(
    () => SCENARIO_CASES.filter((c) => c.id === activeCase || overlayCases.includes(c.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCase, overlayKey],
  );

  /* 케이스마다 하나씩. 활성 케이스는 `params` 가 최신이고, 나머지는 저장된
     케이스 필드를 공유 필드 위에 얹는다 (store 의 caseParams 와 같은 규칙).
     여기서도 요청 빌더를 지난다 — 미리보기가 실행과 다른 규칙을 쓰면 미리보기가
     아니라 두 번째 모델이 된다. */
  const reqs = useMemo(
    () =>
      drawnCases.map((c) => ({
        id: c.id,
        label: c.label,
        req: buildSimulateRequest(
          inputs,
          c.id === activeCase ? params : { ...params, ...cases[c.id] },
        ),
      })),
    [inputs, params, cases, activeCase, drawnCases],
  );

  /** 활성 케이스의 요청 — 시계열 미리보기와 스크러버가 이걸 본다. 겹쳐 그리기는
   * 커브 단면에만 있다: 시계열은 이미 축이 시간이라 네 선을 얹으면 읽히지 않는다. */
  const req = reqs.find((r) => r.id === activeCase)?.req ?? reqs[0].req;
  const shaped = useMemo(() => isShapedScenario(req), [req]);
  const [day, setDay] = useState<number | null>(null);
  const shownDay = shaped ? (day ?? params.simDays) : params.simDays;

  // 계열별 가용성. **호가가 하나도 없는 것과 요청이 실패한 것은 다르다** —
  // 로더가 실패 대신 빈 배열을 돌려주는 경로가 있어서, 에러만 보면 한 계열이
  // 통째로 사라져도 화면이 아무 말도 안 한다. 실제로 그랬다: 워크북의
  // 커버리지가 하루 짧은 날 선 하나가 조용히 없어졌다. 계열이 하나 남은
  // 지금도 규칙은 같다 — 그날 IRS 호가가 없으면 아래 배너가 이름을 말한다.
  const availability = useMemo(() => {
    const has = (q: BaseQuote[] | undefined) =>
      Array.isArray(q) && q.some((x) => typeof x.rate === "number");
    return {
      IRS: { ready: !swapQ.isPending, ok: has(swapQ.data) },
    } as Record<string, { ready: boolean; ok: boolean }>;
  }, [swapQ.isPending, swapQ.data]);

  const families = useMemo(() => {
    // 10년에서 끊는다 — 북에 그보다 긴 스왑이 없다(lib/components MAX_TENOR_YEARS).
    // 축을 30Y까지 늘리면 실제로 읽는 3M~10Y 구간이 왼쪽 절반으로 압축된다.
    const cap = (q: BaseQuote[]) => q.filter((x) => x.t <= MAX_TENOR_YEARS);
    const out: { key: string; quotes: BaseQuote[] }[] = [];
    if (availability.IRS.ok && swapQ.data) out.push({ key: "IRS", quotes: cap(swapQ.data) });
    return out;
  }, [availability, swapQ.data]);

  /* 계열 토글이 있던 자리를 케이스 토글이 가져갔다 [트레이더 피드백 2].
     계열이 IRS 하나뿐이라 그 토글이 만들 수 있는 유일한 다른 상태가 **빈 차트**
     였고, 그건 조작할 것이 있는 척하는 컨트롤이다. 아래 `missing` 배너는 남는다 —
     그건 사용자가 끈 것이 아니라 그날 호가가 없는 것을 말한다. */

  /** 그 날 호가가 없는 계열. 침묵하지 않고 이름을 말한다. */
  const missing = FAMILIES.filter((f) => availability[f.key].ready && !availability[f.key].ok);

  /** 케이스마다 하나씩. 기둥(pillars)은 families 가 정하므로 넷이 같다 —
   * 첫 번째 것을 축으로 쓴다. */
  const overlays = useMemo(
    () =>
      families.length > 0
        ? reqs.map((r) => ({ id: r.id, label: r.label, ov: buildScenarioOverlay(r.req, shownDay, families) }))
        : [],
    [reqs, shownDay, families],
  );
  const overlay = overlays.find((o) => o.id === activeCase)?.ov ?? overlays[0]?.ov ?? null;

  // 스토어의 테마를 구독한다 — 렌더 시점에 DOM을 읽으면 테마가 바뀌어도
  // 리렌더가 일어나지 않아 농도가 옛 테마 값에 머문다.
  // 기준선은 액센트, 예상선은 회색 [OWNER, 2026-08-06 · 색만 2026-08-07]. 자산군은 그 위에
  // 농도로 얹는다 — 두 계열이니 두 단계면 충분하다.
  const theme = useUiStore((s) => s.theme);
  const ramp = SERIES_OPACITY[theme];
  const t = getSimChartTheme();
  /* 계열 조립. 기준선은 **하나뿐**이다 — 케이스가 넷이어도 시장 커브는 하나고,
     같은 선을 네 번 겹쳐 그리면 굵기만 이상해진다. 그래서 케이스 계열은 예상선만
     갖고, 기준 계열을 따로 하나 만들어 **맨 뒤에** 놓는다(차트가 순서대로
     칠하므로 마지막이 위로 온다 — 기준이 위라는 규칙은 그대로다). */
  const series: TermSeries[] = [
    ...overlays.map((o) => ({
      key: o.id,
      label: o.label,
      // 예상은 아직 일어나지 않은 일이라 물러난다. 편집 중인 케이스만 조금 더
      // 진하다 — 지금 손대고 있는 선이 어느 것인지가 화면에서 읽혀야 한다.
      shockedColor: withAlpha(t.ink, ramp[0] * (o.id === activeCase ? 0.85 : 0.45)),
      shockedDash: CASE_DASH[o.id],
      shockedPct: o.ov.series[0]?.shockedPct,
    })),
    {
      key: "__base",
      label: "기준",
      baseColor: withAlpha(t.line, ramp[0]),
      basePct: overlay?.series[0]?.basePct,
    },
  ];

  const loading = swapQ.isPending;
  /** 그릴 것이 하나도 없을 때만 차트 자리를 통째로 문장으로 바꾼다. 한 계열만
   * 없으면 나머지는 그리고 없는 쪽을 아래에서 이름으로 말한다. */
  const nothingToDraw = !loading && families.length === 0;

  if (previewMode === "path") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 pb-2">
          <ModeToggle mode={previewMode} onChange={setPreviewMode} />
          <span className="text-callout text-ink-2">{baseDate} 기준</span>
        </div>
        <PathPreview req={req} baseDate={baseDate} anchor={params.anchorTenor ?? "3Y"} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-1.5">
          <ModeToggle mode={previewMode} onChange={setPreviewMode} />
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
                // 아래 계열 칩과 같은 문법이다 (킷 Buttons/Content Area/Toggle을
                // 농도로 옮긴 것). 다른 것은 하나 — 칩 안에 **자기 파선 견본**을
                // 그린다. 차트에서 넷을 가르는 것이 파선이므로, 어느 패턴이 어느
                // 케이스인지 말하는 자리가 있어야 한다. 별도 범례를 두면 차트
                // 밖에 또 하나의 목록이 생긴다.
                className={
                  "flex h-6 items-center gap-1.5 rounded-control-sm px-2.5 text-callout transition-colors " +
                  (on
                    ? "bg-ink-4 font-medium text-ink"
                    : "bg-ink-5 text-ink-2 hover:bg-ink-4 hover:text-ink-1")
                }
              >
                <svg width="14" height="6" aria-hidden className="shrink-0">
                  <line
                    x1="0"
                    y1="3"
                    x2="14"
                    y2="3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray={CASE_DASH[c.id]}
                  />
                </svg>
                {c.label}
              </button>
            );
          })}
        </div>
        <span className="text-callout text-ink-2">
          {hoverIdx !== null && overlays.length > 0
            ? readout(overlays, hoverIdx)
            : `${baseDate} · D+${shownDay}`}
        </span>
      </div>

      <div className="min-h-[240px] flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-body text-ink-2">호가를 읽는 중이에요</p>
          </div>
        ) : nothingToDraw ? (
          // 조용히 빈 캔버스를 두지 않는다. 빈 차트는 "이 날은 커브가
          // 평평했나 보다"로 읽힌다.
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-body text-ink-2">
              {baseDate}에 표시할 호가가 없어요. 비영업일이거나 워크북이 이 날짜까지
              오지 않았을 수 있어요.
            </p>
          </div>
        ) : (
          <TermStructureChart pillars={overlay?.pillars ?? []} series={series} onHover={setHoverIdx} />
        )}
      </div>

      {/* 한 계열만 없을 때. 선이 하나 사라진 것을 사용자가 알아채기를 기대하지
          않는다 — 이름을 대고 말한다. */}
      {!nothingToDraw && missing.length > 0 && (
        <p className="pt-2 text-body text-ink-2">
          {missing.map((f) => f.label).join(" · ")} 커브는 {baseDate} 호가가 없어서 못 그렸어요.
        </p>
      )}

      {shaped && (
        <label className="flex items-center gap-3 pb-3 pt-3">
          <span className="shrink-0 text-body text-ink-2">D+{shownDay}</span>
          <input
            type="range"
            min={0}
            max={params.simDays}
            value={shownDay}
            onChange={(e) => setDay(Number(e.target.value))}
            className="h-1 flex-1 accent-current"
            aria-label="미리보기 시점"
          />
        </label>
      )}

      {/* 색을 부르지 않는다 [2026-08-07]. "파란 실선" 이라고 적혀 있었는데
          기준선이 액센트 주황으로 옮겨가면서 문장이 화면과 어긋났다. 색 이름을
          주황으로 바꾸는 대신 없앤다 — 실선과 파선이 이미 둘을 가르고, HIG §6.2
          가 "Avoid relying solely on color to differentiate between objects"
          라고 적는 자리가 정확히 여기다. 시나리오 쪽 "회색" 은 남긴다: 그건
          물러난 상태를 말하는 말이지 어느 선인지 짚는 말이 아니다. */}
      <p className="pt-2 text-callout text-ink-2">
        실선이 {baseDate} 기준이고, 회색 파선이 시나리오예요.
        {drawnCases.length > 1
          ? " 파선 모양이 케이스를 갈라요 — 위 칩과 같은 모양이에요."
          : " 위 칩을 눌러 다른 케이스를 겹쳐 볼 수 있어요."}
      </p>
    </div>
  );
}

/** 두 미리보기는 같은 시나리오의 다른 단면이다 — 커브형은 "끝났을 때 커브가
 * 어떤 모양인가", 시계열형은 "거기까지 어떻게 가는가". */
function ModeToggle({
  mode,
  onChange,
}: {
  mode: "curve" | "path";
  onChange: (m: "curve" | "path") => void;
}) {
  return (
    <Segmented
      label="미리보기 방식"
      value={mode}
      onChange={onChange}
      options={[
        { value: "curve", label: "커브" },
        { value: "path", label: "시계열" },
      ]}
    />
  );
}

/** 호버한 테너에서 **그려진 케이스마다** 한 조각씩. 파선이 어느 케이스인지
 * 말한다면, 이 줄은 그 케이스가 그 테너에서 얼마인지를 말한다. */
function readout(
  overlays: { id: CaseId; label: string; ov: ScenarioOverlayPreview }[],
  i: number,
): string {
  const tenor = overlays[0]?.ov.pillars[i]?.label ?? "";
  const parts: string[] = [];
  for (const o of overlays) {
    const src = o.ov.series[0];
    const base = src?.basePct[i];
    const shocked = src?.shockedPct[i];
    if (typeof base !== "number" || typeof shocked !== "number") continue;
    const d = (shocked - base) * 100;
    parts.push(`${o.label} ${shocked.toFixed(3)}% (${d >= 0 ? "+" : ""}${d.toFixed(1)}bp)`);
  }
  return parts.length > 0 ? `${tenor} · ${parts.join(" · ")}` : tenor;
}
