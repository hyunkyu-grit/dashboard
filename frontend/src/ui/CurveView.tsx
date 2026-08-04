"use client";

/* Idle right-pane curve (DESIGN §2/§4, restored Session 13). No row hovered →
 * the pane shows THE IRS PAR CURVE, on every tab. Equal-spaced nodes, blue
 * line (--bw-line, §9 palette cut), two lines only (the dataset's date + D-1
 * comparison — the full six-basis ramp lives in the enlarged view).
 * Hand-rolled SVG (lightweight-charts stays enlarged-only, §11).
 *
 * ONE CURVE, NOT ONE PER TAB [OWNER, pass M]. The idle pane used to switch with
 * the tab: the 1YF ladder on forwards, the two-point-spread curve on spreads,
 * the relative-ATR curve on volatility. Curve viewing is priority 1 (§1) and
 * "the curve" is the IRS par curve — that is what the idle state is FOR. The
 * other three restated, in a shape that takes a moment to identify, columns the
 * table beside it already prints; and a pane whose subject changes under a
 * filter chip is a second thing to keep track of. So the tab now moves the list
 * only, and the curve stays put. `VolatilityPayload.curve` is still served and
 * no longer rendered (see HANDOFF "Open").
 *
 * NOTHING in this pane animates on pin (strip session, Pass A). The ghost
 * curve gesture was removed: at a 10px peak against a curve spanning 136bp it
 * was too small to read as an intent and large enough to draw the eye —
 * illegible and distracting at once. The popup's mode diagram says the same
 * thing on a SCHEMATIC curve where the exaggeration can be large enough to
 * work, so the gesture was the worse of two attempts at one job. What
 * survives is the pane's corner label (App.tsx): pinned instrument · mode. */

import { useMemo, useState } from "react";

import type { Unit, WallSummary } from "@/lib/api";
import { fmtAxis, levelHeadText, levelHeadTitle } from "@/lib/format";
import { BASIS_SECONDARY_OPACITY } from "@/theme/ramp";

import {
  READOUT_CARD_W,
  READOUT_LABEL,
  ReadoutCard,
  ReadoutChange,
  ReadoutLevel,
} from "./ReadoutCard";

interface Node {
  label: string;
  now: number | null;
  prev: number | null; // D-1 comparison
  /* The hovered-node readout (pass N). Every one of these is READ FROM THE
   * PAYLOAD, never computed here (§16): `deltas.d1` is the backend's daily
   * change and `range1y` its 52-week level stats — the same fields the table's
   * 어제 and 52주 columns print. Differencing `now − prev` in the browser to
   * save a field is exactly what §16 forbids, and it would also disagree with
   * the table at the displayed precision. */
  delta: number | null;
  high: number | null;
  low: number | null;
  avg: number | null;
}

const PAD = { top: 14, right: 12, bottom: 20, left: 40 };

function NodeLine({
  nodes,
  unit,
  width,
  height,
  baseRate,
}: {
  nodes: Node[];
  unit: Unit;
  width: number;
  height: number;
  /** BOK base rate in force at the as-of date, or null (§policy). This curve
   * is CROSS-SECTIONAL — x is tenor, not time — so the step degenerates to a
   * single horizontal reference at the current level. That is the useful
   * reading here anyway: how far the whole curve sits above policy, and where
   * it crosses. */
  baseRate?: number | null;
}) {
  // hovered node index — the curve's equivalent of the preview chart's hovered
  // date. Nothing else in the app reacts to it: it does not pin, does not
  // filter, and does not touch the table (§2 — hover on the TABLE owns that).
  const [hi, setHi] = useState<number | null>(null);
  const pts = nodes.filter((n) => n.now != null);
  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of nodes) {
      for (const v of [n.now, n.prev]) {
        if (v != null) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    // one axis, so the domain must hold the policy line too (§policy) —
    // otherwise it would be drawn outside the plot box or clipped to an edge,
    // where a flat line reads as "equal to the minimum"
    if (baseRate != null) {
      lo = Math.min(lo, baseRate);
      hi = Math.max(hi, baseRate);
    }
    const pad = (hi - lo) * 0.08 || 0.05;
    return { yMin: lo - pad, yMax: hi + pad };
  }, [nodes, baseRate]);

  if (pts.length < 2) return null;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (nodes.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const line = (key: "now" | "prev") =>
    nodes
      .map((n, i) => (n[key] == null ? null : `${x(i)},${y(n[key]!)}`))
      .filter(Boolean)
      .join(" ");
  /* The AXIS label's grammar is `fmtAxis` — coarser than a level's on purpose
   * (see lib/format.ts). The readout card is where a level prints at full
   * precision, through `fmtLevel`. No other rounding lives in this file. */
  const axisLabel = (v: number) => fmtAxis(v, unit);
  const labelEvery = Math.ceil(nodes.length / 8);

  // nearest node by x, the same snap the preview chart uses — the nodes are
  // equal-spaced (§2), so this is arithmetic, not a search.
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / plotW) * (nodes.length - 1));
    setHi(Math.max(0, Math.min(nodes.length - 1, i)));
  };

  const hn = hi != null ? nodes[hi] : null;
  const tipLeft =
    hi != null
      ? Math.min(width - READOUT_CARD_W - 10, Math.max(0, x(hi) + 10))
      : 0;

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        className="text-line"
        onMouseMove={onMove}
        onMouseLeave={() => setHi(null)}
        role="img"
        aria-label="curve"
      >
        {[yMin + (yMax - yMin) * 0.15, yMax - (yMax - yMin) * 0.15].map((v) => (
          <text key={v} x={PAD.left - 5} y={y(v) + 4} textAnchor="end"
            className="fill-ink" style={{ fontSize: 11, opacity: 0.5 }}>
            {axisLabel(v)}
          </text>
        ))}
        {/* the base rate: a translucent red hairline UNDER both curves and
            named at the right edge [OWNER, 2026-08-04 revision — solid, red,
            extra-transparent]. The same colour + opacity this line wears on
            every chart; the label names it — it is the reference the curve
            is read against, not a third curve. */}
        {baseRate != null && (
          <>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(baseRate)}
              y2={y(baseRate)}
              className="stroke-ref-policy"
              strokeWidth={1}
              strokeOpacity={0.35}
            />
            <text
              x={width - PAD.right}
              y={y(baseRate) - 4}
              textAnchor="end"
              className="fill-ref-policy"
              style={{ fontSize: 10, opacity: 0.75 }}
            >
              기준금리 {baseRate.toFixed(2)}
            </text>
          </>
        )}
        <polyline points={line("prev")} fill="none" stroke="currentColor"
          strokeOpacity={BASIS_SECONDARY_OPACITY} strokeWidth={1.4} />
        <polyline points={line("now")} fill="none" stroke="currentColor"
          strokeWidth={1.8} strokeLinejoin="round" />
        {nodes.map((n, i) =>
          n.now == null ? null : (
            <circle key={n.label} cx={x(i)} cy={y(n.now)} r={2.4} fill="currentColor" />
          ),
        )}
        {nodes.map((n, i) =>
          i % labelEvery === 0 || i === nodes.length - 1 ? (
            <text key={`l-${n.label}`} x={x(i)} y={height - 6} textAnchor="middle"
              className="fill-ink" style={{ fontSize: 10, opacity: 0.5 }}>
              {n.label}
            </text>
          ) : null,
        )}
        {/* crosshair + a fattened dot on the hovered node — the y marker, so
            the card can stay pinned at the top and not chase the cursor */}
        {hn && (
          <>
            <line
              x1={x(hi!)}
              x2={x(hi!)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-ink"
              strokeWidth={1}
              strokeOpacity={0.25}
            />
            {hn.now != null && (
              <circle cx={x(hi!)} cy={y(hn.now)} r={3.6} fill="currentColor" />
            )}
          </>
        )}
      </svg>
      {/* the hovered node's readout — the SAME card the preview chart uses,
          with the tenor where the date would be (pass N) */}
      {hn && (
        <ReadoutCard title={hn.label} left={tipLeft}>
          <ReadoutLevel k={READOUT_LABEL.level} v={hn.now} unit={unit} />
          <ReadoutLevel k={READOUT_LABEL.rangeHigh} v={hn.high} unit={unit} />
          <ReadoutLevel k={READOUT_LABEL.rangeLow} v={hn.low} unit={unit} />
          <ReadoutLevel k={READOUT_LABEL.rangeAvg} v={hn.avg} unit={unit} />
          <ReadoutChange
            k={READOUT_LABEL.dailyChange}
            v={hn.delta}
            unit={unit}
          />
        </ReadoutCard>
      )}
    </div>
  );
}

const CURVE_NODES = ["3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"];

/** The IRS par curve across the 9 equal-spaced nodes, each carrying the
 * readout its hover shows. Every field is read straight off the summary row —
 * the same row the table prints — so the curve and the table can never disagree
 * about a node (§16). A tenor absent from the payload yields nulls, which the
 * card prints as em dashes rather than hiding. */
function parNodes(summary: WallSummary): Node[] {
  const byId = new Map(summary.outrights.map((o) => [o.id, o]));
  return CURVE_NODES.map((t) => {
    const o = byId.get(t);
    return {
      label: t,
      now: o?.now ?? null,
      prev: o?.basisValues.d1 ?? null,
      delta: o?.deltas.d1 ?? null,
      high: o?.range1y.max ?? null,
      low: o?.range1y.min ?? null,
      avg: o?.range1y.avg ?? null,
    };
  });
}

export function CurveView({
  summary,
  width,
  height,
}: {
  summary: WallSummary;
  width: number;
  height: number;
}) {
  const nodes = parNodes(summary);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[15px] font-semibold">IRS 커브</span>
        {/* the solid line's DAY and the dashed one's, in the level header's
            grammar (pass M) — the pane no longer claims "지금" either. */}
        <span
          className="text-[12px] tabular-nums opacity-40"
          title={levelHeadTitle(summary.asof)}
        >
          {levelHeadText(summary.asof)} · 어제
        </span>
      </div>
      <NodeLine
        nodes={nodes}
        unit="%"
        width={width}
        height={height - 24}
        baseRate={summary.policy?.latest ?? null}
      />
    </div>
  );
}
