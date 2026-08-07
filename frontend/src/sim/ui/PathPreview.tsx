"use client";

/**
 * 시계열형 미리보기 — 설계한 금리 경로를 **시간축**에 그린다.
 *
 * 커브형이 "기간이 끝났을 때 커브가 어떤 모양인가"에 답한다면, 이쪽은
 * "거기까지 어떻게 가는가"에 답한다. 같은 시나리오의 다른 단면이다.
 *
 * 값은 `createPathEvaluator(req)` — 요청이 실제로 쓰는 경로 평가기다. 웨이포인트
 * 보간, 금통위 계단, 단기 구간 접합이 전부 그 안에 있고 여기서 다시 유도하지
 * 않는다. 미리보기가 실행과 다른 규칙을 쓰면 미리보기가 아니다.
 *
 * 계열은 (자산군 × 테너)다. 기본은 설계 중인 앵커 테너의 국고와 IRS 둘 — 지금
 * 무엇을 설계하고 있는지가 먼저 보여야 한다.
 */

import { useMemo, useState } from "react";

import { LineChart, type CrosshairRow, type LineSeriesDef } from "@/sim/ui/LineChart";
import { HoverPanel } from "@/sim/ui/HoverPanel";
import { Segmented } from "@/sim/ui/primitives";
import { useUiStore } from "@/state/ui";
import { getSimChartTheme } from "@/sim/lib/chart-theme";
import { MAX_TENOR_YEARS } from "@/sim/lib/components";
import { createPathEvaluator, samplePathDays, PATH_PILLARS } from "@/sim/lib/path-matrix";
import type { AnchorTenor } from "@/sim/types/simulation-port";

/** 10년 이하 마디만. 북에 그보다 긴 스왑이 없다(MAX_TENOR_YEARS). */
const TENORS = PATH_PILLARS.filter((p) => p.t <= MAX_TENOR_YEARS);
const TENOR_OPTIONS = TENORS.map((p) => ({ value: p.label, label: p.label }));

const FAMILIES = [
  { key: "swap" as const, label: "IRS" },
  { key: "국채" as const, label: "국고" },
];

export function PathPreview({
  req,
  baseDate,
  anchor,
}: {
  req: Parameters<typeof createPathEvaluator>[0];
  baseDate: string;
  anchor: AnchorTenor;
}) {
  const theme = useUiStore((s) => s.theme);
  const [tenor, setTenor] = useState<string>(anchor);
  const [hover, setHover] = useState<{ time: number; rows: CrosshairRow[] } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [width, setWidth] = useState(0);

  const series = useMemo<LineSeriesDef[]>(() => {
    const t = getSimChartTheme();
    const ev = createPathEvaluator(req);
    const days = samplePathDays(req);
    const years = TENORS.find((p) => p.label === tenor)?.t ?? 3;
    const baseMs = Date.parse(baseDate);
    const originSec = Number.isNaN(baseMs) ? Date.UTC(2025, 0, 1) / 1000 : Math.floor(baseMs / 1000);

    return FAMILIES.map((f, i) => ({
      id: f.key,
      label: f.label,
      color: t.seriesColors[i],
      width: t.seriesWidths[i],
      data: days.map((d) => ({
        time: originSec + d * 86400,
        value: ev.cumBpAt(f.key, years, d),
      })),
    }));
    // theme는 색을 다시 뽑기 위한 의존성이다 — 없으면 테마 전환 후 옛 색에 머문다.
  }, [req, baseDate, tenor, theme]);

  const hoverRows = (hover?.rows ?? []).map((r) => ({
    label: r.label,
    value: `${r.value === null ? "—" : `${r.value >= 0 ? "+" : ""}${r.value.toFixed(1)}bp`}`,
    color: r.color,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-2">
        {/* 이 줄은 단일선택이다 — 왼쪽 판의 앵커 테너와 같은 종류의 선택이고,
            따라서 같은 컴포넌트를 쓴다. 예전엔 컨테이너 없는 맨 글자 줄에
            검은 알약 하나였는데, 그러면 한 화면에 단일선택 문법이 둘이 된다.
            덤으로 선택 표시가 미끄러진다 (Segmented의 layoutId). */}
        <Segmented
          label="미리보기 테너"
          options={TENOR_OPTIONS}
          value={tenor}
          onChange={setTenor}
        />
        <span className="text-callout text-ink-2">{tenor} 누적 변동</span>
      </div>

      <div
        className="relative min-h-[240px] flex-1"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
          setWidth(r.width);
        }}
        onMouseLeave={() => setCursor(null)}
      >
        <LineChart
          series={series}
          formatValue={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}bp`}
          zeroLine
          onCrosshair={setHover}
        />
        <HoverPanel
          at={hover && cursor ? cursor : null}
          width={width}
          title={hover ? dayLabel(baseDate, hover.time) : ""}
          rows={hoverRows}
          footer={`${tenor} 기준`}
        />
      </div>

      <p className="pt-2 text-callout text-ink-2">
        기준일부터 얼마나 움직였는지를 누적 bp로 그려요. 0선 위는 금리가 오른 구간이에요.
      </p>
    </div>
  );
}

function dayLabel(baseDate: string, time: number): string {
  const base = Date.parse(baseDate);
  const day = Number.isNaN(base) ? null : Math.round((time * 1000 - base) / 86400000);
  const iso = new Date(time * 1000).toISOString().slice(0, 10);
  return day === null ? iso : `${iso} · D+${day}`;
}
