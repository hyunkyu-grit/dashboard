"use client";

/* Pay/Receive curve diagram (DESIGN §2 popup; rebuilt to draw the CURVE).
 * The companion to the DV01 ratio: the ratio says what to execute, this shows
 * the SHAPE you are betting on and which way it must move to profit.
 *
 * One rule covers every kind: **Pay profits when the displayed value rises,
 * Receive when it falls.** Every kind renders the same base — the current par
 * curve across the nine standard nodes — with the instrument's own region at
 * full strength, the rest dimmed to context, and a dashed ghost of the wanted
 * state. Outrights/spreads/flies move node levels (arrows on nodes); a forward
 * ROTATES a segment (near end down, far end up), because it responds to the
 * slope of the stretch, not any single node. See payReceiveModel.ts for the
 * sign-convention logic (unit-tested).
 *
 * The accent is the FOCUS colour (`--bw-interactive`, orange), not the data-blue
 * used by the real charts, so the diagram reads as an annotation. Direction
 * arrows keep the red-up / blue-down hue (§9); node labels stay ink. */

import { useState } from "react";

import type { WallSummary } from "@/lib/api";

import { classify } from "./gloss";
import {
  buildDiagramModel,
  DIAGRAM_NODES,
  labelToYears,
  rateAtFrac,
  yearsToLabel,
  type Side,
} from "./payReceiveModel";
import type { Row } from "./rows";

const W = 260;
const H = 150;
const ML = 16;
const MR = 16;
const BAND_TOP = 26; // headroom for the up-arrow + lifted ghost
const BAND_BOT = 118; // leaves room for down-arrow + node labels
const ARROW = 15;

function Toggle({ side, onSide }: { side: Side; onSide: (s: Side) => void }) {
  return (
    <div className="flex overflow-hidden rounded-[6px] border border-edge text-[12px]">
      {(["pay", "receive"] as Side[]).map((sd) => (
        <button
          key={sd}
          type="button"
          onClick={() => onSide(sd)}
          className={
            sd === side
              ? "bg-ink px-2.5 py-0.5 text-page"
              : "px-2.5 py-0.5 opacity-50 hover:opacity-90"
          }
        >
          {sd === "pay" ? "페이" : "리시브"}
        </button>
      ))}
    </div>
  );
}

/** A short arrow from a point in the wanted direction — red up / blue down. */
function Arrow({ x, y, up }: { x: number; y: number; up: boolean }) {
  const tip = up ? y - ARROW : y + ARROW;
  const head = up ? tip + 5 : tip - 5;
  return (
    <g className={up ? "text-up" : "text-down"} stroke="currentColor" fill="currentColor">
      <line x1={x} y1={y} x2={x} y2={tip} strokeWidth={1.5} />
      <polygon points={`${x},${tip} ${x - 3},${head} ${x + 3},${head}`} stroke="none" />
    </g>
  );
}

export function PayReceive({ row, summary }: { row: Row; summary: WallSummary }) {
  const [side, setSide] = useState<Side>("pay");
  const c = classify(row);

  // Volatility (and anything with no curve statement): say so, don't invent a
  // picture (a ratio has no direction on the curve).
  if (c.kind === "volatility") {
    return (
      <div className="mt-4">
        <div
          className="flex h-[110px] w-[260px] items-center justify-center rounded-[10px] border border-dashed border-edge px-4 text-center text-[12px] leading-relaxed opacity-45"
        >
          변동성은 커브 위의 방향이 아니라 크기의 비율이라, 페이/리시브 그림으로 나타내지 않습니다.
        </div>
      </div>
    );
  }

  // The nine-node current par curve (same source as CurveView).
  const byId = new Map(summary.outrights.map((o) => [o.id, o.now] as const));
  const rates = DIAGRAM_NODES.map((t) => byId.get(t) ?? null);
  if (rates.some((r) => r == null)) return null;
  const solid = rates as number[];

  const model = buildDiagramModel(c, solid, side);
  if (!model) return null;

  // y-fit over BOTH curves (solid + ghost) with a small pad, into the band that
  // leaves arrow headroom top and bottom.
  const ghostRates = model.ghost.map((g) => g.rate);
  const lo = Math.min(...solid, ...ghostRates);
  const hi = Math.max(...solid, ...ghostRates);
  const pad = (hi - lo) * 0.12 || 0.05;
  const yLo = lo - pad;
  const yHi = hi + pad;
  const plotH = BAND_BOT - BAND_TOP;
  const plotW = W - ML - MR;

  const xAt = (frac: number) => ML + (frac / (DIAGRAM_NODES.length - 1)) * plotW;
  const yAt = (rate: number) => BAND_TOP + (1 - (rate - yLo) / (yHi - yLo)) * plotH;
  const solidY = (frac: number) => yAt(rateAtFrac(solid, frac));

  // full solid curve (context), dimmed
  const solidAll = solid.map((r, i) => `${xAt(i)},${yAt(r)}`).join(" ");

  // region overlay at full strength: interpolated endpoints + integer nodes between
  const [rLo, rHi] = model.region;
  const regionPts: string[] = [`${xAt(rLo)},${solidY(rLo)}`];
  for (let i = Math.ceil(rLo + 1e-9); i <= Math.floor(rHi - 1e-9); i++) {
    regionPts.push(`${xAt(i)},${yAt(solid[i])}`);
  }
  regionPts.push(`${xAt(rHi)},${solidY(rHi)}`);
  const regionLine = regionPts.join(" ");

  const ghostLine = model.ghost.map((g) => `${xAt(g.frac)},${yAt(g.rate)}`).join(" ");

  // labels for the leg tenors (node kinds) / the forward interval
  const legLabel = (frac: number): string => {
    if (model.kind === "forward") {
      const startY = labelToYears(c.kind === "forward" ? c.start : "");
      return Math.abs(frac - model.region[0]) < 1e-6
        ? (c.kind === "forward" ? c.start : "")
        : yearsToLabel(
            startY + labelToYears(c.kind === "forward" ? c.tenor : ""),
          );
    }
    return DIAGRAM_NODES[Math.round(frac)];
  };

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center gap-2">
        <Toggle side={side} onSide={setSide} />
        <span className="text-[13px] font-semibold">{model.term}</span>
      </div>

      <svg
        width={W}
        height={H}
        className="text-interactive"
        role="img"
        aria-label="pay/receive 커브 모양"
      >
        {/* shaded stretch (forward's 선도 구간) */}
        {model.shaded && (
          <rect
            x={xAt(rLo)}
            y={BAND_TOP - 6}
            width={xAt(rHi) - xAt(rLo)}
            height={plotH + 12}
            fill="currentColor"
            fillOpacity={0.08}
          />
        )}

        {/* full current curve — context, dimmed */}
        <polyline
          points={solidAll}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {/* the instrument's own region — full strength */}
        <polyline
          points={regionLine}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {/* wanted state — dashed ghost */}
        <polyline
          points={ghostLine}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          strokeLinejoin="round"
        />

        {/* leg markers + direction arrows */}
        {model.legs.map((leg) => {
          const lx = xAt(leg.frac);
          const ly = solidY(leg.frac);
          return (
            <g key={`leg-${leg.frac}`}>
              <circle cx={lx} cy={ly} r={3} fill="currentColor" />
              <Arrow x={lx} y={ly} up={leg.arrow > 0} />
              <text
                x={lx}
                y={H - 5}
                textAnchor="middle"
                className="fill-ink"
                style={{ fontSize: 9, opacity: 0.55 }}
              >
                {legLabel(leg.frac)}
              </text>
            </g>
          );
        })}

        {/* region caption (forward: 선도 구간, centred under the stretch) */}
        {model.regionLabel && (
          <text
            x={(xAt(rLo) + xAt(rHi)) / 2}
            y={BAND_TOP - 12}
            textAnchor="middle"
            className="fill-ink"
            style={{ fontSize: 9, opacity: 0.5 }}
          >
            {model.regionLabel}
          </text>
        )}
      </svg>

      {/* the curve meaning of the move (forward) */}
      {model.note && (
        <p className="mt-1 max-w-[260px] text-[12px] leading-snug opacity-55">
          {model.note}
        </p>
      )}
    </div>
  );
}
