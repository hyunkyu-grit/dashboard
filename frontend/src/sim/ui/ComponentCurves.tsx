"use client";

/**
 * 성분 누적 경로. 응답의 decompositionDaily가 원천이고, 각 선의 마지막 값이
 * 곧 아래 워터폴의 막대다 (같은 엔진 누적기라 다시 계산하지 않는다).
 *
 * 무엇을 그리는지는 lib/components.ts가 정한다 — 지금은 스왑평가·스왑캐리
 * 둘뿐이다 [OWNER, 2026-08-06].
 *
 * ─ 선을 어떻게 가르나 ────────────────────────────────────────────────────
 * **최종(마지막 날) 부호로 방향색**을 칠한다 [OWNER, 2026-08-10 — "성분
 * 누적 경로의 그래프는 최종적으로 상승인 선은 빨간색으로, 하락인 선은
 * 파란색으로"]. 이전 규칙("색조가 아니라 잉크 농도 — 부호가 오가는 선을
 * 부호색으로 칠하면 색이 거짓말을 한다")은 폐기했다. 절충: 기간 중 부호가
 * 바뀌는 선(스왑평가는 시나리오에 따라 바뀔 수 있다)은 **끝에서의** 사실만
 * 정확히 말한다 — 중간 구간에서 반대 부호였던 순간은 이 색이 말해 주지
 * 않는다. 범례 값 색(directionVar, 아래)은 원래도 시점별로 다시 계산되니
 * 영향 없다 — 바뀐 것은 선 자체의 고정색뿐이다.
 *
 * 범례는 **마지막 값 순서**로 세운다. 차트 오른쪽 끝의 세로 순서와 범례의
 * 위아래 순서가 같아지므로, 어느 선이 무엇인지가 색 없이도 눈으로 풀린다.
 *
 * 공백 규칙: 주말·공휴일은 값이 아니라 `{ time }`만 넣는다. 직전 값을 이어
 * 그리면 그 이틀 동안 손익이 멈춰 있었다는 거짓말이 된다. 제외된 자산군은
 * 매일 공백이고 범례에 "제외"라고 적는다 — 0선이 아니다.
 */

import { useMemo, useState } from "react";

import { formatKrwAxisSigned } from "@/sim/lib/format";
import { directionVar } from "@/sim/theme/tint";
import { LineChart, type CrosshairRow, type LineSeriesDef } from "@/sim/ui/LineChart";
import { HoverPanel } from "@/sim/ui/HoverPanel";
import { dayToTime, getSimChartTheme } from "@/sim/lib/chart-theme";
import { COMPONENTS, type ComponentKey } from "@/sim/lib/components";
import { useSimulationPort } from "@/sim/hooks/use-simulation";
import { useUiStore } from "@/state/ui";

interface LegendRow {
  key: ComponentKey;
  label: string;
  color: string;
  final: number;
  excluded: boolean;
}

export function ComponentCurves() {
  const { lastRun, inputs } = useSimulationPort();
  const [hover, setHover] = useState<{ time: number; rows: CrosshairRow[] } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [width, setWidth] = useState(0);

  // 테마를 **구독**한다. getSimChartTheme()은 호출 시점의 색을 돌려주는데,
  // 그 결과가 useMemo에 갇히면 테마가 뒤집혀도 범례 스와치는 옛 색 그대로다.
  // 차트 선은 LineChart가 MutationObserver로 다시 칠하므로 둘이 어긋난다 —
  // 실제로 다크에서 스와치가 배경에 먹혀 사라졌다.
  const theme = useUiStore((s) => s.theme);

  const daily = useMemo(() => lastRun?.decompositionDaily ?? [], [lastRun]);
  const swapExcluded = (lastRun?.exclusions ?? []).some((x) => x.assetClass === "swap");

  const { series, legend } = useMemo(() => {
    if (daily.length === 0) return { series: [] as LineSeriesDef[], legend: [] as LegendRow[] };

    const t = getSimChartTheme();
    const byDay = new Map(daily.map((r) => [r.day, r]));
    const lastDay = daily[daily.length - 1].day;

    const finalOf = (key: ComponentKey): number => {
      for (let i = daily.length - 1; i >= 0; i--) {
        const v = daily[i][key];
        if (typeof v === "number") return v;
      }
      return 0;
    };

    // 마지막 값 내림차순 — 차트 오른쪽 끝의 세로 순서와 같아진다.
    const ordered = [...COMPONENTS].sort((a, b) => finalOf(b.key) - finalOf(a.key));

    const built: LineSeriesDef[] = ordered.map(({ key, label }, i) => {
      const data: ({ time: number; value: number } | { time: number })[] = [];
      for (let d = 0; d <= lastDay; d++) {
        const time = dayToTime(inputs.baseDate, d);
        const v = byDay.get(d)?.[key];
        if (typeof v === "number") data.push({ time, value: v });
        else data.push({ time });
      }
      const color = finalOf(key) >= 0 ? t.up : t.down;
      return { id: key, label, color, width: t.seriesWidths[i], data };
    });

    const rows: LegendRow[] = ordered.map(({ key, label }) => ({
      key,
      label,
      color: finalOf(key) >= 0 ? t.up : t.down,
      final: finalOf(key),
      excluded: swapExcluded && (key === "swapMtm" || key === "swapCarry"),
    }));

    return { series: built, legend: rows };
  }, [daily, inputs.baseDate, swapExcluded, theme]);

  if (daily.length === 0) {
    return (
      <p className="py-10 text-center text-body text-ink-2">
        이 실행 결과에는 일별 성분 경로가 없어요. 다시 실행하면 성분 커브가 나와요.
      </p>
    );
  }

  const lastDay = daily[daily.length - 1].day;
  const hoverByKey = new Map((hover?.rows ?? []).map((r) => [r.id, r.value]));

  return (
    <div className="flex flex-col">
      <p className="pb-1 pt-1 text-callout text-ink-2">
        {hover ? dayLabel(inputs.baseDate, hover.time) : `D+0 ~ D+${lastDay}`}
      </p>

      <div
        className="relative h-[340px]"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
          setWidth(r.width);
        }}
        onMouseLeave={() => setCursor(null)}
      >
        <LineChart series={series} formatValue={formatKrwAxisSigned} zeroLine onCrosshair={setHover} />
        {/* 커서 지점의 숫자. 축과 선만으로는 "대충 20억쯤"까지밖에 못 읽는데,
            판단은 그 자릿수에서 갈리지 않는다. */}
        <HoverPanel
          at={hover && cursor ? cursor : null}
          width={width}
          title={hover ? dayLabel(inputs.baseDate, hover.time) : ""}
          rows={[
            ...(hover?.rows ?? []).map((r) => ({
              label: r.label,
              value: r.value === null ? "—" : formatKrwAxisSigned(r.value),
              color: r.value === null ? undefined : directionVar(r.value),
            })),
            ...(hover
              ? [{
                  label: "합계",
                  value: formatKrwAxisSigned(
                    (hover.rows ?? []).reduce((a, r) => a + (r.value ?? 0), 0),
                  ),
                  color: directionVar((hover.rows ?? []).reduce((a, r) => a + (r.value ?? 0), 0)),
                }]
              : []),
          ]}
        />
      </div>

      {/* 범례 순서 = 차트 오른쪽 끝의 세로 순서. 크로스헤어가 올라가 있으면
          그 날의 값으로 바뀐다. */}
      <ul className="flex flex-col gap-0.5 pb-4 pt-2">
        {legend.map((r) => {
          const shown = hover ? (hoverByKey.get(r.key) ?? null) : r.excluded ? null : r.final;
          return (
            <li key={r.key} className="flex items-center gap-2 text-body">
              <span
                aria-hidden
                className="inline-block h-[2px] w-5 shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
              />
              <span className="flex-1 text-ink-2">{r.label}</span>
              {/* 선은 회색이지만 **값은 방향색**이다. 선의 부호는 기간 중에
                  바뀔 수 있어 한 색으로 말할 수 없는 반면, 여기 적힌 숫자는
                  특정 시점의 확정된 값이라 부호가 하나다. 아래 워터폴도 같은
                  규칙이라 두 표면이 같은 사실을 같은 색으로 말한다. */}
              {r.excluded ? (
                <span className="text-ink-2">제외</span>
              ) : (
                <span style={shown === null ? undefined : { color: directionVar(shown) }}>
                  {shown === null ? "—" : formatKrwAxisSigned(shown)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function dayLabel(baseDate: string, time: number): string {
  const base = Date.parse(baseDate);
  const day = Number.isNaN(base) ? null : Math.round((time * 1000 - base) / 86400000);
  const iso = new Date(time * 1000).toISOString().slice(0, 10);
  return day === null ? iso : `${iso} · D+${day}`;
}
