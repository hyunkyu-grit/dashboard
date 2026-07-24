"use client";

/* Calendar heatmap of daily changes (DESIGN §2). Weeks × weekdays; cell shade
 * by |change| magnitude, hue by direction (red up / blue down, §9). The cell
 * for the chart-hovered date pulses with an INK outline (never orange = line,
 * never blue = direction). Recent ~26 weeks only (see ## Provisional). */

import { useMemo } from "react";

import type { SparkPoint } from "@/lib/api";

const WEEKS = 26;
const WEEKDAYS = ["월", "화", "수", "목", "금"]; // Mon–Fri

interface Cell {
  date: string;
  change: number;
  col: number;
  row: number; // 0=Mon … 4=Fri
}

export function CalendarHeatmap({
  points,
  hoveredDate,
  cell = 13,
  gap = 3,
}: {
  points: SparkPoint[];
  hoveredDate: string | null;
  cell?: number;
  gap?: number;
}) {
  const { cells, maxMag } = useMemo(() => {
    // daily changes over the recent window
    const changes: { date: string; change: number }[] = [];
    for (let i = 1; i < points.length; i++) {
      changes.push({ date: points[i].t, change: points[i].v - points[i - 1].v });
    }
    const recent = changes.slice(-WEEKS * 5);
    if (recent.length === 0) return { cells: [] as Cell[], maxMag: 1 };

    // column 0 = the Monday-week of the first recent point
    const start = new Date(recent[0].date + "T00:00:00");
    const startMon = new Date(start);
    const dow = (start.getDay() + 6) % 7; // Mon=0
    startMon.setDate(start.getDate() - dow);

    const out: Cell[] = [];
    let maxMag = 1e-9;
    for (const c of recent) {
      const d = new Date(c.date + "T00:00:00");
      const row = (d.getDay() + 6) % 7;
      if (row > 4) continue; // weekends absent, but guard anyway
      const days = Math.round(
        (d.getTime() - startMon.getTime()) / 86_400_000,
      );
      const col = Math.floor(days / 7);
      out.push({ date: c.date, change: c.change, col, row });
      maxMag = Math.max(maxMag, Math.abs(c.change));
    }
    return { cells: out, maxMag };
  }, [points]);

  if (cells.length === 0) return null;
  const cols = Math.max(...cells.map((c) => c.col)) + 1;
  const labelW = 18;
  const width = labelW + cols * (cell + gap);
  const height = 5 * (cell + gap);

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="daily change calendar"
    >
      {WEEKDAYS.map((wd, r) => (
        <text
          key={wd}
          x={0}
          y={r * (cell + gap) + cell - 2}
          className="fill-ink"
          style={{ fontSize: 9, opacity: 0.4 }}
        >
          {wd}
        </text>
      ))}
      {cells.map((c) => {
        const up = c.change >= 0;
        const mag = Math.min(1, Math.abs(c.change) / maxMag);
        const pulsed = hoveredDate === c.date;
        return (
          <rect
            key={c.date}
            x={labelW + c.col * (cell + gap)}
            y={c.row * (cell + gap)}
            width={cell}
            height={cell}
            rx={2}
            className={up ? "text-up" : "text-down"}
            fill="currentColor"
            fillOpacity={0.15 + 0.85 * mag}
            stroke={pulsed ? "var(--bw-ink)" : "none"}
            strokeWidth={pulsed ? 1.5 : 0}
          />
        );
      })}
    </svg>
  );
}
