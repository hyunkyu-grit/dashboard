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
 * ─ 범위: 스왑만 ─────────────────────────────────────────────────────────
 * 계열은 IRS와 국고 둘이다. IRS는 실제로 값이 매겨지는 커브고, 국고는 그 커브가
 * 파생되는 앵커(전송 페이로드에서 swapCurve = 국채 커브 + irsSpread)라 설계한
 * 목표가 어디에 꽂히는지 보려면 같이 있어야 한다.
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
import { useSectorInputQuotes, useSwapInputQuotes } from "@/sim/hooks/use-input-curves";
import { buildScenarioOverlay, isShapedScenario, type BaseQuote } from "@/sim/lib/input-curve-preview";
import { buildSimulateRequest } from "@/sim/lib/scenario-curves";
import { MAX_TENOR_YEARS } from "@/sim/lib/components";

const FAMILIES = [
  { key: "IRS", label: "IRS" },
  { key: "국고채", label: "국고" },
] as const;

export function CurvePreview() {
  const { params, inputs } = useSimulationPort();
  const baseDate = inputs.baseDate;

  const swapQ = useSwapInputQuotes(baseDate);
  const bondQ = useSectorInputQuotes("국고채", baseDate);

  const [visible, setVisible] = useState<Record<string, boolean>>({ IRS: true, 국고채: true });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // 어느 미리보기를 보고 있는지는 포트 스토어에 산다 — 단계를 오가도 유지된다.
  const previewMode = useSimulationDataStore((s) => s.previewMode);
  const setPreviewMode = useSimulationDataStore((s) => s.setPreviewMode);

  const req = useMemo(() => buildSimulateRequest(inputs, params), [inputs, params]);
  const shaped = useMemo(() => isShapedScenario(req), [req]);
  const [day, setDay] = useState<number | null>(null);
  const shownDay = shaped ? (day ?? params.simDays) : params.simDays;

  // 계열별 가용성. **호가가 하나도 없는 것과 요청이 실패한 것은 다르다** —
  // 크레딧 매트릭스는 실패 대신 빈 배열을 돌려주므로, 에러만 보면 국고 계열이
  // 통째로 사라져도 화면은 아무 말도 하지 않는다. 실제로 그랬다: 워크북의
  // 커버리지가 IRS보다 하루 짧은 날, 국고 선만 조용히 없어졌다.
  const availability = useMemo(() => {
    const has = (q: BaseQuote[] | undefined) =>
      Array.isArray(q) && q.some((x) => typeof x.rate === "number");
    return {
      IRS: { ready: !swapQ.isPending, ok: has(swapQ.data) },
      국고채: { ready: !bondQ.isPending, ok: has(bondQ.data) },
    } as Record<string, { ready: boolean; ok: boolean }>;
  }, [swapQ.isPending, swapQ.data, bondQ.isPending, bondQ.data]);

  const families = useMemo(() => {
    // 10년에서 끊는다 — 북에 그보다 긴 스왑이 없다(lib/components MAX_TENOR_YEARS).
    // 축을 30Y까지 늘리면 실제로 읽는 3M~10Y 구간이 왼쪽 절반으로 압축된다.
    const cap = (q: BaseQuote[]) => q.filter((x) => x.t <= MAX_TENOR_YEARS);
    const out: { key: string; quotes: BaseQuote[] }[] = [];
    if (visible.IRS && availability.IRS.ok && swapQ.data)
      out.push({ key: "IRS", quotes: cap(swapQ.data) });
    if (visible.국고채 && availability.국고채.ok && bondQ.data)
      out.push({ key: "국고채", quotes: cap(bondQ.data) });
    return out;
  }, [visible.IRS, visible.국고채, availability, swapQ.data, bondQ.data]);

  /** 켜져 있는데 그 날 호가가 없는 계열. 침묵하지 않고 이름을 말한다. */
  const missing = FAMILIES.filter(
    (f) => visible[f.key] && availability[f.key].ready && !availability[f.key].ok,
  );

  const overlay = useMemo(
    () => (families.length > 0 ? buildScenarioOverlay(req, shownDay, families) : null),
    [req, shownDay, families],
  );

  // 스토어의 테마를 구독한다 — 렌더 시점에 DOM을 읽으면 테마가 바뀌어도
  // 리렌더가 일어나지 않아 농도가 옛 테마 값에 머문다.
  // 기준선은 파랑, 예상선은 회색 [OWNER, 2026-08-06]. 자산군은 그 위에
  // 농도로 얹는다 — 두 계열이니 두 단계면 충분하다.
  const theme = useUiStore((s) => s.theme);
  const ramp = SERIES_OPACITY[theme];
  const t = getSimChartTheme();
  const series: TermSeries[] = (overlay?.series ?? []).map((s, i) => ({
    key: s.key,
    label: FAMILIES.find((f) => f.key === s.key)?.label ?? s.key,
    baseColor: withAlpha(t.line, ramp[i]),
    // 예상은 아직 일어나지 않은 일이라 물러난다. 잉크를 절반 아래로 내리면
    // 두 테마 모두에서 회색으로 읽힌다.
    shockedColor: withAlpha(t.ink, ramp[i] * 0.5),
    basePct: s.basePct,
    shockedPct: s.shockedPct,
  }));

  const loading = swapQ.isPending || bondQ.isPending;
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
          {FAMILIES.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={visible[f.key]}
              onClick={() => setVisible((v) => ({ ...v, [f.key]: !v[f.key] }))}
              // 이 칩들은 다중선택 **토글**이고, 킷에 그 변형이 따로 있다
              // (Buttons/Content Area/Toggle). 실측·육안 확인:
              //
              //   Off  채움 잉크 5%     라벨 Labels/Primary
              //   On   채움 강조색 6%   라벨·글리프 **강조색 전체**
              //
              // 즉 킷에서 켜짐을 말하는 것은 채움이 아니라 **색**이다. 채움은
              // 5%→6%로 사실상 그대로다.
              //
              // 우리는 강조색을 부호에 쓰므로 색을 신호로 못 쓴다. 대신 같은
              // 자리(라벨)에서 **농도와 굵기**로 말한다 — 채움이 아니라 글자가
              // 상태를 진다는 구조는 킷과 같고, 수단만 다르다. 앞서는 반대로
              // 채움 농도(8%↔16%)로 말하고 있었는데, 그건 Bordered 버튼의
              // 문법이지 Toggle의 문법이 아니다.
              //
              // 대가가 하나 있다: 킷은 꺼짐도 라벨이 Primary(85%)인데 우리는
              // 잉크 2단계(50%)로 내렸다. 색이 아니라 농도로 말하려면 꺼짐이
              // 물러나 줘야 한다. 즉 off 채움 5%만 킷 값이고 **라벨 농도는
              // 우리가 정한 것**이다. 여기서는 그게 맞기도 하다 — 꺼짐은
              // "이 계열을 차트에서 숨겼다"는 뜻이라 물러나는 게 사실이다.
              className={
                "h-6 rounded-control-sm px-4 text-callout transition-colors " +
                (visible[f.key]
                  ? "bg-ink-4 font-medium text-ink"
                  : "bg-ink-5 text-ink-2 hover:bg-ink-4 hover:text-ink-1")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-callout text-ink-2">
          {hoverIdx !== null && overlay ? readout(overlay, series, hoverIdx) : `${baseDate} · D+${shownDay}`}
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

      <p className="pt-2 text-callout text-ink-2">
        파란 실선이 {baseDate} 기준이고, 회색 파선이 시나리오예요.
        {series.length > 1 && ` 진한 쪽이 ${series[0].label}이에요.`}
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

function readout(
  overlay: { pillars: { label: string }[]; series: { key: string; basePct: (number | null | undefined)[]; shockedPct: (number | null | undefined)[] }[] },
  series: TermSeries[],
  i: number,
): string {
  const tenor = overlay.pillars[i]?.label ?? "";
  const parts: string[] = [];
  for (const s of series) {
    const src = overlay.series.find((o) => o.key === s.key);
    const base = src?.basePct[i];
    const shocked = src?.shockedPct[i];
    if (typeof base !== "number" || typeof shocked !== "number") continue;
    const d = (shocked - base) * 100;
    parts.push(`${s.label} ${shocked.toFixed(3)}% (${d >= 0 ? "+" : ""}${d.toFixed(1)}bp)`);
  }
  return parts.length > 0 ? `${tenor} · ${parts.join(" · ")}` : tenor;
}
