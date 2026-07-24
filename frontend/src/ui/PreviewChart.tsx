"use client";

/* Preview line chart (DESIGN §2). Hand-rolled SVG so the floating tooltip is
 * simple and lightweight-charts stays confined to the enlarged view (§11).
 * Orange line (§9). Hovering shows a floating card near the cursor:
 * 날짜 · 레벨 · 구간 최고 · 구간 최저 · 구간 평균 · 당일 변화. */

import { useMemo, useState } from "react";

import type { SparkPoint } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";

const PAD = { top: 10, right: 10, bottom: 16, left: 6 };

export function PreviewChart({
  points,
  unit,
  width,
  height,
  onHoverDate,
}: {
  points: SparkPoint[];
  unit: "%" | "bp";
  width: number;
  height: number;
  onHoverDate: (date: string | null) => void;
}) {
  const [hi, setHi] = useState<number | null>(null);

  const stats = useMemo(() => {
    const vs = points.map((p) => p.v);
    const lo = Math.min(...vs);
    const high = Math.max(...vs);
    const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
    return { lo, high, avg };
  }, [points]);

  if (points.length < 2) return null;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const pad = (stats.high - stats.lo) * 0.06 || 0.01;
  const yMin = stats.lo - pad;
  const yMax = stats.high + pad;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  const scale = unit === "%" ? 100 : 1;
  const lvl = (v: number) => (unit === "%" ? v.toFixed(4) : v.toFixed(1));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / plotW) * (points.length - 1));
    const idx = Math.max(0, Math.min(points.length - 1, i));
    setHi(idx);
    onHoverDate(points[idx].t);
  };
  const onLeave = () => {
    setHi(null);
    onHoverDate(null);
  };

  const hp = hi != null ? points[hi] : null;
  const dailyChange =
    hi != null && hi > 0 ? (points[hi].v - points[hi - 1].v) * scale : null;
  const tipLeft = hi != null ? Math.min(width - 150, Math.max(0, x(hi) + 10)) : 0;

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        className="text-line"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        role="img"
        aria-label="10y history"
      >
        <polyline
          points={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        {hi != null && hp && (
          <>
            <line
              x1={x(hi)}
              x2={x(hi)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-ink"
              strokeWidth={1}
              strokeOpacity={0.25}
            />
            <circle cx={x(hi)} cy={y(hp.v)} r={3} fill="currentColor" />
          </>
        )}
      </svg>
      {hi != null && hp && (
        <div
          className="pointer-events-none absolute top-2 rounded-[8px] bg-popover p-2 text-[12px] shadow-card"
          style={{ left: tipLeft, width: 140 }}
        >
          <div className="mb-1 font-semibold">{hp.t}</div>
          <Line k="레벨" v={lvl(hp.v)} />
          <Line k="구간 최고" v={lvl(stats.high)} />
          <Line k="구간 최저" v={lvl(stats.lo)} />
          <Line k="구간 평균" v={lvl(stats.avg)} />
          <div className="mt-1 flex justify-between">
            <span className="opacity-50">당일 변화</span>
            <span className={`tabular-nums ${dirClass(dailyChange)}`}>
              {fmtBp(dailyChange)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="opacity-50">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
