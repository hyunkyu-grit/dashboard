"use client";

/**
 * 텀 스트럭처 차트 — x축이 시간이 아니라 **테너**다.
 *
 * lightweight-charts를 쓰지 않는 이유: 그 라이브러리의 x축은 시간이고, 테너를
 * 시간으로 위장시키면 축 라벨·크로스헤어·줌이 전부 날짜를 말하게 된다. 여기서
 * 필요한 것은 선 두 겹과 호버 하나뿐이라 SVG가 더 정직하고 짧다.
 *
 * 테너는 **균등 간격**으로 놓는다. 실제 연수로 놓으면 3M~2Y 구간이 왼쪽 끝에
 * 뭉치는데, 커브를 읽을 때 실제로 보는 곳이 거기다.
 *
 * 색 규율 [OWNER, 2026-08-06]: **기준선은 파랑, 예상선은 회색**이다.
 * 금리 수준은 부호가 없는 양이라 방향색(빨강/파랑 = 부호)을 쓸 수 없지만,
 * 여기서 파랑은 부호가 아니라 사우론의 차트 선 색(--bw-line)이고 "지금 시장이
 * 이렇다"를 말한다. 예상은 아직 일어나지 않은 일이라 회색으로 물러난다.
 *
 * 자산군(IRS·국고)은 그 위에 **농도**로 얹고, 실선/파선이 기준/예상을 한 번 더
 * 말한다 — 색을 못 보는 조건에서도 두 축이 남는다.
 */

import { useEffect, useRef, useState } from "react";

import { getSimChartTheme } from "@/sim/lib/chart-theme";
import { onThemeChange } from "@/sim/theme/bridge";

export interface TermSeries {
  key: string;
  label: string;
  /** 기준선 색. */
  baseColor?: string;
  /** 예상선 색 (회색 계열). */
  shockedColor?: string;
  /** 예상선 파선 패턴. 시나리오 케이스가 여럿일 때 **색이 아니라 이것이**
   * 어느 케이스인지 말한다 — 흑백으로도 남아야 한다(§5). */
  shockedDash?: string;
  /** 각 pillar에 정렬. undefined = 이 계열이 그 테너를 안 가짐(선이 건너뜀),
   * null = 가지지만 그 날 값이 없음(구멍).
   *
   * 둘 다 **선택**이다: 케이스를 여럿 겹쳐 그릴 때 기준선은 하나뿐이므로,
   * 케이스 계열은 예상선만 갖고 기준 계열은 기준선만 갖는다. */
  basePct?: (number | null | undefined)[];
  shockedPct?: (number | null | undefined)[];
}

export interface TermStructureChartProps {
  pillars: { t: number; label: string }[];
  series: TermSeries[];
  /** 호버 중인 테너 인덱스를 바깥에 알린다 (판독용). */
  onHover?: (index: number | null) => void;
}

const PAD = { top: 14, right: 46, bottom: 22, left: 10 };

export function TermStructureChart({ pillars, series, onHover }: TermStructureChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => onThemeChange(() => bump((n) => n + 1)), []);

  const { w, h } = size;
  const plotW = Math.max(w - PAD.left - PAD.right, 0);
  const plotH = Math.max(h - PAD.top - PAD.bottom, 0);
  if (plotW <= 0 || plotH <= 0 || pillars.length === 0) {
    return <div ref={boxRef} className="h-full w-full" />;
  }

  const t = getSimChartTheme();

  const values: number[] = [];
  for (const s of series) {
    for (const v of [...(s.basePct ?? []), ...(s.shockedPct ?? [])])
      if (typeof v === "number") values.push(v);
  }
  if (values.length === 0) {
    return (
      <div ref={boxRef} className="flex h-full w-full items-center justify-center">
        <p className="text-body text-ink-2">이 날짜에는 표시할 호가가 없어요.</p>
      </div>
    );
  }

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.15, 0.05);
  const yMin = lo - pad;
  const yMax = hi + pad;

  const x = (i: number) =>
    PAD.left + (pillars.length === 1 ? plotW / 2 : (i / (pillars.length - 1)) * plotW);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * plotH;

  /** 값이 있는 구간만 이어 그린다. undefined는 건너뛰고(선 연결), null은 끊는다. */
  function path(vals: (number | null | undefined)[]): string {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (typeof v !== "number") {
        // null은 구멍 — 선을 끊는다. undefined는 계열이 그 테너를 안 가진
        // 것이므로 그냥 넘어가고, 다음 값에서 이어진다.
        if (v === null) pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  }

  const ticks = yTicks(yMin, yMax, 4);
  const labelStep = Math.max(1, Math.ceil(pillars.length / 14));

  return (
    <div
      ref={boxRef}
      className="h-full w-full"
      onMouseLeave={() => {
        setHover(null);
        onHover?.(null);
      }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left - PAD.left;
        const i = Math.round((px / plotW) * (pillars.length - 1));
        const clamped = Math.max(0, Math.min(pillars.length - 1, i));
        setHover(clamped);
        onHover?.(clamped);
      }}
    >
      <svg width={w} height={h} role="img" aria-label="테너별 금리 커브">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} stroke={t.grid} strokeWidth={1} />
            <text
              x={PAD.left + plotW + 6}
              y={y(v) + 3.5}
              fontSize={11}
              fill={t.axis}
              fontFamily="inherit"
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}

        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={t.zeroLine} strokeWidth={1} />
        )}

        {/* 예상선이 먼저, 기준선이 나중이다 — 겹치는 구간에서 기준선이 위로
            온다. 기준은 사실이고 예상은 가정이니, 가려야 한다면 가정이 가린다.
            계열이 나뉜 지금은 **호출자가 기준 계열을 마지막에 놓아** 그 순서를
            지킨다(CurvePreview 의 series 조립). */}
        {series.map((s) => (
          <g key={s.key}>
            {s.shockedPct && (
              <path
                d={path(s.shockedPct)}
                fill="none"
                stroke={s.shockedColor}
                strokeWidth={1.5}
                strokeDasharray={s.shockedDash ?? "4 3"}
              />
            )}
            {s.basePct && (
              <path d={path(s.basePct)} fill="none" stroke={s.baseColor} strokeWidth={2} />
            )}
          </g>
        ))}

        {pillars.map((p, i) =>
          i % labelStep === 0 ? (
            <text
              key={p.label}
              x={x(i)}
              y={h - 6}
              textAnchor="middle"
              fontSize={11}
              fill={hover === i ? t.ink : t.axis}
              fontFamily="inherit"
            >
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

/** 사람이 읽는 눈금 간격 (1 / 2 / 2.5 / 5 × 10ⁿ). */
function yTicks(lo: number, hi: number, target: number): number[] {
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Number(v.toFixed(6)));
  return out;
}
