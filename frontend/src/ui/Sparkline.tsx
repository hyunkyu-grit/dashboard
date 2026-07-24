"use client";

/* Wide navy sparkline for the home band cards (DESIGN §2/§9). Hand-rolled SVG,
 * navy via one currentColor (text-brand) — no per-element var, no chart lib. */

interface Props {
  values: number[];
  width: number;
  height: number;
}

export function Sparkline({ values, width, height }: Props) {
  if (values.length < 2) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || 0.01;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - ((v - yMin) / (yMax - yMin)) * height;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="text-brand"
      role="img"
      aria-label="sparkline"
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* end dot at full navy so the latest point reads */}
      <circle
        cx={x(values.length - 1)}
        cy={y(values[values.length - 1])}
        r={2.4}
        fill="currentColor"
      />
    </svg>
  );
}
