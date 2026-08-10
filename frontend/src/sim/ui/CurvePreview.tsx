"use client";

/**
 * 인풋 커브 미리보기 — 설계한 시나리오가 커브를 **실행 전에** 어떻게 움직이는지
 * 보여준다.
 *
 * 겹치는 선은 같은 계열의 기준(**파선**, 액센트색 — "현재 금리 상황")과
 * 시나리오(실선, 케이스별 고유색)다 [OWNER, 2026-08-10]. 시나리오 값은
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
import { CaseChips } from "./CaseChips";
import { HoverPanel } from "./HoverPanel";
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
} from "@/sim/lib/input-curve-preview";
import { SCENARIO_CASES } from "@/sim/types/simulation-port";
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

/* 케이스 색 [OWNER, 2026-08-10 — 트레이더 피드백, 이 세션에서 세 번 더 조정].
 *
 * 파선으로 넷을 가르던 [트레이더 피드백 2, 2026-08-07] 방식은 폐기했다 —
 * "빨강·파랑은 부호, 액센트는 기준선"이라 케이스에 쓸 색이 없다고 봤던
 * 판단이었는데, 트레이더가 파선만으로는 넷을 빨리 못 갈랐다. 케이스는 색
 * 하나로만 가른다. 파선은 이제 **기준(현재) 선의 것**이다 [OWNER, 2026-08-10
 * — "현재 금리 상황은 파선으로"]: 시나리오(실선)가 주인공, 현재는 참조.
 *
 * 최종 색은 **이 트레이더의 책상 관행**이다 — 이 제품의 부호색(--bw-up=빨강
 * 상승/--bw-down=파랑 하락)과 정반대로 읽는다 [OWNER — "상승=파랑(안 좋음),
 * 하락=빨강(좋음)"]. 불(하락, 좋음)이 빨강, 베어(상승, 나쁨)가 파랑이다
 * (tokens.css --bw-case-bull/bear — 부호 토큰과 값만 같고 var() 별칭은 아니다,
 * 방향색이 바뀌어도 케이스 색이 따라 움직이면 안 되므로). 케이스 이름 자체가
 * 방향을 고정하고 있어서(CaseSection 문구: "불은 금리 하락, 베어는 상승") 이
 * 반대 읽기가 케이스 안에서는 거짓말이 아니다 — 다만 이 화면의 다른 곳(변동
 * bp 등)에서 빨강/파랑을 보면 그건 여전히 부호(상승/하락)를 뜻하니 헷갈리지
 * 말 것. 크라이시스는 톤다운한 보라(킷 퍼플을 회색으로 눌렀다 — tokens.css
 * 주석에 실측치), 베이스는 방향이 없어 중립 회색(--bw-ref-cd)이다. 기준(오늘)
 * 선은 그대로 액센트 주황이다 — "현재 그래프는 오렌지인데 나머지는
 * 이렇다"[OWNER]. */

export function CurvePreview() {
  const { params, inputs } = useSimulationPort();
  const baseDate = inputs.baseDate;

  const swapQ = useSwapInputQuotes(baseDate);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  // 어느 미리보기를 보고 있는지는 포트 스토어에 산다 — 단계를 오가도 유지된다.
  const previewMode = useSimulationDataStore((s) => s.previewMode);
  const setPreviewMode = useSimulationDataStore((s) => s.setPreviewMode);

  /* 겹쳐 그릴 케이스. 활성 케이스는 **언제나** 들어간다 — 편집 중인 것이
     화면에 없는 상태는 만들지 않는다. 순서는 SCENARIO_CASES 를 따른다:
     토글을 누른 순서로 그리면 같은 조합인데 겹침 순서가 달라진다. */
  const activeCase = useSimulationDataStore((s) => s.activeCase);
  const overlayCases = useSimulationDataStore((s) => s.overlayCases);
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

  /** 활성 케이스의 요청 — 시간축 스크러버가 이걸 본다(그 손잡이는 편집 중인
   * 케이스 하나만 따라간다). 시계열 미리보기 자체는 `reqs`를 받아 넷을 다
   * 겹쳐 그린다 [OWNER, 2026-08-10] — "시계열은 축이 이미 시간이라 못
   * 읽는다"던 판단은 폐기했다. */
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
      // 케이스 색 [OWNER, 2026-08-10]. 예상은 아직 일어나지 않은 일이라
      // 물러난다는 원칙은 남는다 — 편집 중인 케이스만 완전 농도, 나머지는
      // 옅게. 색 자체는 잉크가 아니라 케이스 고유색이다.
      shockedColor: withAlpha(t.case[o.id], o.id === activeCase ? 0.9 : 0.55),
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
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-1.5">
            <ModeToggle mode={previewMode} onChange={setPreviewMode} />
            <CaseChips />
          </div>
          <span className="text-callout text-ink-2">{baseDate} 기준</span>
        </div>
        <PathPreview reqs={reqs} activeCase={activeCase} baseDate={baseDate} anchor={params.anchorTenor ?? "3Y"} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-1.5">
          <ModeToggle mode={previewMode} onChange={setPreviewMode} />
          <CaseChips />
        </div>
        <span className="text-callout text-ink-2">
          {baseDate} · D+{shownDay}
        </span>
      </div>

      <div
        className="relative min-h-[240px] flex-1"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
          setChartWidth(r.width);
        }}
        onMouseLeave={() => setCursor(null)}
      >
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
          <>
            <TermStructureChart pillars={overlay?.pillars ?? []} series={series} onHover={setHoverIdx} />
            {/* 커서 바로 옆 읽기판 [OWNER, 2026-08-10 — "상단에 적지 말고 커서
                옆에"]. 위 헤더의 텍스트 한 줄은 정적 정보(기준일·D+n)만 남고,
                호버 값은 커서를 따라다니는 패널로 옮겼다 — 시계열형
                (PathPreview)이 이미 이 패턴이었다. */}
            <HoverPanel
              at={hoverIdx !== null && cursor ? cursor : null}
              width={chartWidth}
              title={overlays[0]?.ov.pillars[hoverIdx ?? -1]?.label ?? ""}
              rows={overlays.map((o) => {
                const src = o.ov.series[0];
                const shocked = hoverIdx !== null ? src?.shockedPct[hoverIdx] : undefined;
                const base = hoverIdx !== null ? src?.basePct[hoverIdx] : undefined;
                const d = typeof shocked === "number" && typeof base === "number" ? (shocked - base) * 100 : null;
                return {
                  label: o.label,
                  value:
                    typeof shocked === "number"
                      ? `${shocked.toFixed(3)}% (${d !== null && d >= 0 ? "+" : ""}${d?.toFixed(1) ?? "—"}bp)`
                      : "—",
                  color: t.case[o.id],
                };
              })}
            />
          </>
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

      {/* 기준/시나리오는 파선/실선이 가른다 [OWNER, 2026-08-10 — "현재 금리
          상황은 파선으로"] — HIG §6.2 "avoid relying solely on color"가 이
          축에서는 도로 성립한다. 시나리오 넷 사이는 여전히 색만 가른다(위 칩
          견본이 그 범례다). */}
      <p className="pt-2 text-callout text-ink-2">
        파선이 {baseDate} 현재이고, 실선이 시나리오예요.
        {drawnCases.length > 1
          ? " 색이 케이스를 갈라요 — 위 칩과 같은 색이에요."
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
