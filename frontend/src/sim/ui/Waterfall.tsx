"use client";

/**
 * Total Return 워터폴 — 성분 다섯이 누적 수준을 왼쪽에서 오른쪽으로 계단처럼
 * 밀고, 마지막 토탈 막대는 0에서 그린다.
 *
 * 표시 전용이다. 값은 서버의 totalReturnDecomposition에서 오고 항등식(성분 합
 * == 토탈, ±₩1)은 서버에서 핀되어 있다. 여기서 다시 계산하지 않는다.
 *
 * 여기서 방향색을 쓰는 것은 규율 위반이 아니다: 막대 하나의 부호는 고정이고,
 * 배경 위 텍스트가 아니라 도형이다. 값 라벨은 막대 **밖**(위/아래)에 놓아
 * 채움 위에 글자가 올라앉지 않게 한다 — 틴트 셀에서 겪은 것과 같은 문제다.
 *
 * null 성분(제외된 스왑)은 빈 자리에 "—"를 놓고 누적 수준은 그대로 흘린다.
 * 공란이지 0이 아니다.
 */

import { useEffect, useRef, useState } from "react";

import { formatKrwAxisSigned } from "@/sim/lib/format";
import { getSimChartTheme } from "@/sim/lib/chart-theme";
import { onThemeChange } from "@/sim/theme/bridge";

export interface WaterfallItem {
  label: string;
  /** 부호 있는 원화 기여분. null = 미정의(제외) → "—". */
  value: number | null;
}

const PAD = { top: 26, right: 12, bottom: 26, left: 12 };
const MIN_BAR_PX = 2;
/** 막대 폭 상한. 없으면 넓은 화면에서 막대가 늘어나 계단이 아니라 별개의
 * 기둥 다섯 개로 읽힌다. */
const MAX_SLOT_PX = 104;

function buildSlots(items: WaterfallItem[]) {
  let cum = 0;
  return items.map((it) => {
    const from = cum;
    if (it.value !== null) cum += it.value;
    return { ...it, from, to: cum };
  });
}

export function Waterfall({
  items,
  total,
  totalLabel = "토탈",
}: {
  items: WaterfallItem[];
  total: number;
  totalLabel?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, bump] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    // jsdom에는 ResizeObserver가 없다. 그 환경에서는 크기가 0으로 남고 SVG가
    // 비는데, 테스트는 카드 DOM을 보지 SVG를 보지 않는다.
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 테마가 뒤집히면 SVG 색을 다시 뽑아야 한다. SVG는 var()를 이해하지만,
  // 이 색들은 브릿지가 해석한 문자열이라 자동으로 따라오지 않는다.
  useEffect(() => onThemeChange(() => bump((n) => n + 1)), []);

  const { w, h } = size;
  const plotW = Math.max(w - PAD.left - PAD.right, 0);
  const plotH = Math.max(h - PAD.top - PAD.bottom, 0);
  if (plotW <= 0 || plotH <= 0) return <div ref={boxRef} className="h-full w-full" />;

  const t = getSimChartTheme();
  const slots = buildSlots(items);
  const n = items.length + 1;

  const levels = [0, total, ...slots.flatMap((s) => [s.from, s.to])];
  const span = Math.max(Math.max(...levels) - Math.min(...levels), 1);
  const yMin = Math.min(...levels) - span * 0.14;
  const yMax = Math.max(...levels) + span * 0.14;
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * plotH;

  const slotW = Math.min(plotW / n, MAX_SLOT_PX);
  const groupW = slotW * n;
  const xStart = PAD.left + (plotW - groupW) / 2;
  const barW = Math.max(slotW * 0.72, 8);
  const cx = (i: number) => xStart + slotW * i + slotW / 2;

  function bar(i: number, from: number, to: number, label: string, value: number | null, strong: boolean) {
    const x = cx(i);
    if (value === null) {
      return (
        <g key={label}>
          <text x={x} y={y(from) - 7} textAnchor="middle" fontSize={11} fill={t.axis} fontFamily="inherit">
            —
          </text>
          <text x={x} y={h - PAD.bottom + 16} textAnchor="middle" fontSize={11} fill={t.axis} fontFamily="inherit">
            {label}
          </text>
        </g>
      );
    }
    const positive = value >= 0;
    const top = Math.min(y(from), y(to));
    const height = Math.max(Math.abs(y(from) - y(to)), MIN_BAR_PX);
    return (
      <g key={label}>
        <rect
          x={x - barW / 2}
          y={top}
          width={barW}
          height={height}
          fill={positive ? t.upFill : t.downFill}
          rx={2}
        />
        {/* 값이 시작하는 쪽 모서리를 진하게 — 막대가 어디서 출발했는지가
            계단에서 읽어야 할 사실이다. */}
        <rect
          x={x - barW / 2}
          y={positive ? top : top + height - 2}
          width={barW}
          height={2}
          fill={positive ? t.up : t.down}
        />
        {/* 값 라벨은 막대 밖. 채움 위에 올리면 진한 구간에서 대비를 잃는다. */}
        <text
          x={x}
          y={positive ? top - 7 : top + height + 15}
          textAnchor="middle"
          fontSize={11}
          fontWeight={strong ? 600 : 400}
          fill={positive ? t.up : t.down}
          fontFamily="inherit"
        >
          {formatKrwAxisSigned(value)}
        </text>
        <text
          x={x}
          y={h - PAD.bottom + 16}
          textAnchor="middle"
          fontSize={11}
          fontWeight={strong ? 600 : 400}
          fill={strong ? t.ink : t.axis}
          fontFamily="inherit"
        >
          {label}
        </text>
      </g>
    );
  }

  return (
    <div ref={boxRef} className="h-full w-full">
      <svg width={w} height={h} role="img" aria-label="Total Return 성분 워터폴">
        <line x1={xStart} x2={xStart + groupW} y1={y(0)} y2={y(0)} stroke={t.zeroLine} strokeWidth={1} />
        {slots.map((s, i) => (
          <line
            key={`link-${s.label}`}
            x1={cx(i) + barW / 2}
            x2={cx(i + 1) - barW / 2}
            y1={y(s.to)}
            y2={y(s.to)}
            stroke={t.grid}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ))}
        {slots.map((s, i) => bar(i, s.from, s.to, s.label, s.value, false))}
        {bar(items.length, 0, total, totalLabel, total, true)}
      </svg>
    </div>
  );
}
