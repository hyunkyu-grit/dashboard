"use client";

/* The backtest window — "그때 들어갔으면 지금 얼마였을까" (§backtest).
 *
 * Opened by clicking the CHART (a row click still pins). A FLOATING WINDOW
 * since the backtest-window session (2026-08-03), not a modal sheet: the
 * backtest is a workbench the reader consults the app AROUND — check a level,
 * pin a row, open the enlarged view — and a modal made every one of those a
 * destroy-and-rebuild. The main app stays fully interactive underneath; the
 * window's own state (`bt` namespace in the URL + session memory) is
 * orthogonal to tab/tile state, which is the STRUCTURAL fix for the
 * back-wipes-the-popup family pass Q patched one member of.
 *
 * Window mechanics, kept deliberately minimal: ONE instance (presence is the
 * `bt` URL param — a second cannot exist), draggable by its HEADER only, no
 * resize, no minimize, position remembered for the session (floatingWindow.ts)
 * and clamped so the handle never leaves the viewport. Depth is a surface
 * step + the strong hairline (`border-edge-live`) — no shadow, per §9; the
 * background is opaque (sticky-opaque spirit: no translucent chrome over
 * data). Reduced motion opens/closes it instantly (`instant()`).
 *
 * TOSS-STYLE, WHICH IS A CONSTRAINT ON THE NUMBERS AS MUCH AS THE PAINT
 * [OWNER standing rule]. The result is one big figure in plain Korean, and the
 * controls read as a sentence — instrument, side, size, from, to — not as a
 * form with labels stacked above inputs. Everything that is machinery (per-leg
 * notionals, DV01, settled cash) sits under a fold, because it is the answer to
 * a second question and putting it beside the first one makes neither readable.
 *
 * A BOOK, NOT ONE TRADE [OWNER, 2026-07-31]. Positions are rows: instrument,
 * side, size, entry AND exit, each independent — you leg in on different days
 * and out on different days. The chart click seeds the first row; more come
 * from the row's own dropdown, or by clicking another instrument in the table
 * behind (the sheet stays open and captures it).
 *
 * The headline is the BOOK total and the chart draws only that line. Per
 * position there are numbers, not lines: three or four curves on one axis is
 * a chart nobody reads, and the question "which one carried it" is answered
 * by a column of figures faster than by picking lines apart.
 *
 * IT DOES NOT RUN ON ITS OWN. The user presses 실행. A backtest is a question
 * someone asks, not a thing that happens while they are still typing the date,
 * and each run is a full daily revaluation on the server.
 *
 * LIVE BACKEND ONLY. Every other surface reads a baked JSON file; this answer
 * depends on inputs the reader chooses, so it cannot be one. With no backend
 * configured the sheet says that plainly instead of drawing an empty chart.
 */

import { useMutation } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type BacktestLeg,
  type BacktestResult,
  BacktestUnavailable,
  fetchBacktest,
  type PositionInput,
  type Unit,
} from "@/lib/api";
import { fmtDelta, fmtLevel } from "@/lib/format";

import { loadBacktestMemory, saveBacktestMemory } from "./backtestMemory";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  clampWindowPos,
  initialWindowPos,
  rememberWindowPos,
  WINDOW_W,
  type WinPos,
} from "./floatingWindow";
import { Z_WINDOW } from "./layers";
import { instant } from "./motion";
import { GROUP_LABEL, type Group, type Row } from "./rows";

/* Money, the way a Korean desk reads it: 억 / 만, never 12 raw digits.
 *
 * ROUNDED to the nearest 만원, not floored (2026-08-03 verification). The
 * floor shipped a visible lie: the real book was 평가 1,091,329,056 + 캐리
 * 823,973 = 1,092,153,029 to the won, and the screen said 9,132만 + 82만
 * against a 9,215만 total — off by one 만원, purely from truncating each
 * figure separately. Rounding alone does not make parts SUM at displayed
 * precision, though; that is `splitKrw` below, which the 손익 구성 table
 * must use. Symmetric under negation (sign·round(|v|)), so a payer and its
 * mirror receiver always print mirror figures. */

/** Nearest 만원, as signed integer units — the arithmetic domain in which
 * displayed money is additive. */
export function manUnits(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v) / 10_000);
}

/** Money from signed 만-units. The units-based twin of `fmtKrw`: a table
 * whose parts must sum at displayed precision does its arithmetic on units
 * and formats the results through this. */
export function fmtKrwFromMan(units: number): string {
  const sign = units < 0 ? "−" : "+";
  const n = Math.abs(units);
  const eok = Math.floor(n / 10_000);
  const man = n % 10_000;
  if (eok > 0) return `${sign}${eok}억${man ? ` ${man.toLocaleString()}만` : ""}원`;
  return `${sign}${man.toLocaleString()}만원`;
}

export function fmtKrw(v: number): string {
  const n = Math.abs(Math.round(v));
  if (n < 10_000) return `${v < 0 ? "−" : "+"}${n.toLocaleString()}원`;
  return fmtKrwFromMan(manUnits(v));
}

/** 평가 + 캐리 = 합계, AT DISPLAYED PRECISION, by construction: the total and
 * the valuation round once each, and the carry IS their difference in
 * 만-units — the fmtMove precedent (difference the displayed endpoints)
 * applied to money. Rounding all three independently can miss by a 만원,
 * which is exactly the defect the old carry & roll block was deleted for. */
export function splitKrw(
  pnl: number,
  valuation: number,
): { uPnl: number; uVal: number; uCarry: number } {
  const uPnl = manUnits(pnl);
  const uVal = manUnits(valuation);
  return { uPnl, uVal, uCarry: uPnl - uVal };
}

/** 억 in, raw won out. The input is in 억 because nobody types eleven zeros. */
const EOK = 100_000_000;

/** Mirrors `backtest.MAX_POSITIONS`. Past this the sheet is unreadable and
 * each extra row is another full daily revaluation pass on the server. */
const MAX_POSITIONS = 12;

/** What can actually be BOOKED — one list, read by the dropdown AND (in
 * App.tsx) the click-behind capture, so the two entrances cannot disagree
 * about what the engine accepts [V-PASS V5, 2026-08-03]. A volatility ratio
 * is not a position anyone can put on; FORWARDS are out because the engine
 * has no forward-leg construction (`_legs_for` splits on '-', `_validate`
 * refuses every 'x' id) and each one the dropdown offered 422'd at 실행 —
 * offering what the server refuses is the claim-vs-behaviour defect class.
 * Real forward-start legs are an owner decision (DESIGN ## Provisional);
 * pinned server-side by
 * test_backtest_edges::test_forward_positions_are_refused…. The capture
 * filter lives at the SOURCE (App passes only bookable pins) because the
 * compiler lint forbids adding branches around this effect's setState. */
export const BOOKABLE_GROUPS: Group[] = ["outright", "spread", "fly"];

/** The hover card's fixed width, so the caller can clamp it inside the plot. */
const CARD_W = 150;

/* How a direction is NAMED [OWNER, after external research 2026-07-31].
 *
 * `+1` is always "long the quoted value" in the engine. What that gets CALLED
 * turned out to be three different questions:
 *
 *   outright / forward — 페이 / 리시브. KRW desks use these as verbs ("IRS
 *   페이했다"); 고정 지급/수취 is the accounting register, not the trading one.
 *
 *   spread — 스티프너 / 플래트너 IS a market standard: buying or paying a
 *   steepener means paying fixed on the LONGEST leg (Clarus, "Mechanics and
 *   Definitions of Spread and Butterfly Swap Packages"), which is exactly what
 *   `backtest._legs_for` builds. The legs are printed alongside anyway, so the
 *   term never has to be trusted on its own.
 *
 *   butterfly — THERE IS NO TERM, and that is the finding rather than a gap in
 *   the research. Clarus defines buying a fly as paying the belly; other desk
 *   write-ups define it as receiving; TraditionData states the problem
 *   outright — "one trader's 'buy the fly' may not mean the same thing as
 *   another's unless the legs are explicitly stated". So the legs are stated
 *   and no word is invented. Two earlier attempts here (벨리 지급/수취, then
 *   벨리 페이/리시브) were both coinages the owner had never heard, which is
 *   what inventing vocabulary for an unsettled convention gets you.
 *
 * MIRRORS `backtest._legs_for`: a 2-leg `A-B` pays B at +1, a 3-leg `A-B-C`
 * pays the belly B at +1. That order is pinned server-side by
 * test_backtest.py::test_a_spread_is_weighted_dv01_neutral_at_entry and
 * ::test_a_butterfly_weights_the_belly_against_both_wings — a label that
 * silently disagreed with the trade would be worse than no label.
 */
function directionLabel(id: string, direction: number): string {
  const legs = id.split("-");
  const pay = direction > 0 ? "페이" : "리시브";
  const rec = direction > 0 ? "리시브" : "페이";
  if (legs.length === 3) {
    return `${legs[1]} ${pay} · ${legs[0]}/${legs[2]} ${rec}`;
  }
  if (legs.length === 2) {
    const word = direction > 0 ? "스티프너" : "플래트너";
    return `${word} (${legs[1]} ${pay} · ${legs[0]} ${rec})`;
  }
  return pay; // outright, and a forward is one swap too
}

/** The same sentence, built from the legs the SERVER actually priced. Used in
 * the result table: after a run there is no need to infer anything, and
 * reading the server's own answer is one fewer place the two can disagree. */
function legsSentence(legs: BacktestLeg[]): string {
  if (legs.length === 1) return legs[0].side === "pay" ? "페이" : "리시브";
  const say = (l: BacktestLeg) => (l.side === "pay" ? "페이" : "리시브");
  const [head, ...rest] = legs;
  const body = `${head.tenor} ${say(head)}${legs.length === 3 ? "×2" : ""} · ${rest
    .map((l) => l.tenor)
    .join("/")} ${say(rest[0])}`;
  if (legs.length === 2) {
    // the standard term, with the legs it stands for
    return `${head.side === "pay" ? "스티프너" : "플래트너"} (${body})`;
  }
  return body;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] opacity-50">{label}</span>
      {children}
    </label>
  );
}

const INPUT =
  "rounded-[10px] bg-page px-3 py-2 text-[14px] tabular-nums outline-none " +
  "focus:ring-2 focus:ring-ink/15";

/** The P&L line, with a hovered readout [OWNER].
 *
 * Hand-rolled SVG like every other chart here. Two things are deliberate:
 *
 * The zero line is always in frame, because it is the win/lose boundary and a
 * P&L chart that can be entirely above or below its own axis cannot be read at
 * a glance.
 *
 * The readout is LOCAL and not the shared `ReadoutCard`. That card owns
 * `fmtLevel` and `fmtDelta` precisely so the preview chart and the idle curve
 * cannot drift into two grammars for one quantity — but this axis is MONEY,
 * formatted by `fmtKrw` in 억/만. Passing pre-formatted strings into the shared
 * card, or teaching it a money mode, would dissolve the property it exists
 * for. Different quantity, different card.
 */
function PnlChart({
  result,
  width,
  height,
}: {
  result: BacktestResult;
  width: number;
  height: number;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const pts = result.points;

  const PAD = { top: 8, right: 8, bottom: 18, left: 8 };
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  let lo = 0; // the zero line is always in frame — it is the win/lose boundary
  let hi2 = 0;
  for (const p of pts) {
    if (p.pnl < lo) lo = p.pnl;
    if (p.pnl > hi2) hi2 = p.pnl;
  }
  const pad = (hi2 - lo) * 0.08 || 1;
  const yMin = lo - pad;
  const yMax = hi2 + pad;
  const x = (i: number) => PAD.left + (i / Math.max(1, pts.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  if (pts.length < 2) return null;

  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.pnl).toFixed(1)}`).join(" ");
  const up = result.pnl >= 0;
  // the area closed on the ZERO axis rather than the bottom of the box, so the
  // fill reads as "distance from breakeven", which is what it is
  const area = `${line} ${x(pts.length - 1).toFixed(1)},${y(0).toFixed(1)} ${x(0).toFixed(1)},${y(0).toFixed(1)}`;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - PAD.left) / plotW) * (pts.length - 1));
    setHi(Math.max(0, Math.min(pts.length - 1, i)));
  };

  const hp = hi != null ? pts[hi] : null;
  const tipLeft =
    hi != null ? Math.min(width - CARD_W - 8, Math.max(0, x(hi) + 10)) : 0;

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="누적 손익"
        onMouseMove={onMove}
        onMouseLeave={() => setHi(null)}
      >
        <defs>
          <linearGradient id="btfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <g className={up ? "text-up" : "text-down"}>
          <polygon points={area} fill="url(#btfill)" stroke="none" />
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </g>
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-ink"
          strokeWidth={1}
          strokeOpacity={0.25}
        />
        {hp && (
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
            <circle
              cx={x(hi!)}
              cy={y(hp.pnl)}
              r={3.5}
              className={up ? "fill-up" : "fill-down"}
            />
          </>
        )}
        <text x={PAD.left} y={height - 5} className="fill-ink"
          style={{ fontSize: 10, opacity: 0.45 }}>
          {result.from}
        </text>
        <text x={width - PAD.right} y={height - 5} textAnchor="end"
          className="fill-ink" style={{ fontSize: 10, opacity: 0.45 }}>
          {result.to}
        </text>
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 rounded-[10px] bg-popover px-2.5 py-2 text-[12px] shadow-lg"
          style={{ left: tipLeft, width: CARD_W }}
        >
          <div className="tabular-nums opacity-50">{hp.t}</div>
          <div className="mt-1 flex justify-between gap-2">
            <span className="opacity-50">누적</span>
            <span
              className={`font-semibold tabular-nums ${
                hp.pnl >= 0 ? "text-up" : "text-down"
              }`}
            >
              {fmtKrw(hp.pnl)}
            </span>
          </div>
          <div className="mt-0.5 flex justify-between gap-2">
            {/* Always 당일: the server values the business day before every
                published point, so this is a real one-day change even where
                the line is drawn at one dot per ~6 days. */}
            <span className="opacity-50">당일</span>
            <span
              className={`tabular-nums ${
                hp.d == null ? "opacity-40" : hp.d >= 0 ? "text-up" : "text-down"
              }`}
            >
              {hp.d == null ? "—" : fmtKrw(hp.d)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* Levels here print through the ONE formatter (pass P). The raw
 * interpolation this replaced (`${p.entryValue} → ${p.exitValue}` plus its
 * own toFixed on the difference) was a second display grammar for the same
 * quantity the main table prints via fmtLevel — the two-displays defect that
 * has shipped in this repo once already (the carry block whose components
 * summed to −3.2 against a −3.1 headline, purely from display digits). */

/** THE entry/exit level text — `fmtLevel`, exactly as the table's 현재 and
 * 52주 cells (`ui/cells.ts`). Exported so `guards/readout-parity.test.ts`
 * can pin byte-identity between this and the main table's rendering. */
export function entryLevelText(v: number | null, unit: Unit): string {
  return fmtLevel(v, unit);
}

/** The instrument's own unit suffix beside a level (the pane header's rule:
 * ratio carries none — not that a ratio can be a position anyway). */
const LEVEL_SUFFIX: Record<Unit, string> = { "%": "%", bp: "bp", ratio: "" };

/** Fallback only for an id the row set does not name: outrights/forwards
 * quote in %, spreads and flies in bp — the id's leg count distinguishes
 * them, the same rule rows.ts routes groups by. */
function unitFromShape(id: string): Unit {
  return !id.includes("-") ? "%" : "bp";
}

function fmtMove(
  p: { entryValue: number | null; exitValue: number | null; id: string },
  unit: Unit,
): string {
  if (p.entryValue == null || p.exitValue == null) return "";
  const a = entryLevelText(p.entryValue, unit);
  const b = entryLevelText(p.exitValue, unit);
  /* The parenthetical is differenced from the DISPLAYED endpoints, so the
   * sentence always agrees with itself at the displayed precision. A bp
   * level prints at 1dp while the quotes sit on a 0.25bp grid — differencing
   * the raw values would print `26.5 → 25.3 (−1.3bp)`, whose own subtraction
   * says 1.2. */
  const d = (Number(b) - Number(a)) * (unit === "%" ? 100 : 1);
  return `${a} → ${b} (${fmtDelta(d, unit)}bp)`;
}

function Result({
  result,
  naming,
}: {
  result: BacktestResult;
  /** id → how the rest of the product names it AND its unit. The server
   * echoes the id it was given (`3Y-10Y`); every other surface says `3s10s`,
   * and a backtest that names instruments differently from the table above
   * it is two products. The unit rides along so entry levels print in the
   * row's own grammar, not one inferred from the id. */
  naming: Map<string, { label: string; group: string; unit: Unit }>;
}) {
  const up = result.pnl >= 0;
  const unitOf = (id: string): Unit => naming.get(id)?.unit ?? unitFromShape(id);
  return (
    <div className="mt-5">
      <p className="text-[13px] opacity-55">
        {result.from} → {result.to} · 포지션 {result.positions.length}개
      </p>
      <p
        className={`mt-1 text-[34px] font-bold leading-tight tabular-nums ${
          up ? "text-up" : "text-down"
        }`}
      >
        {fmtKrw(result.pnl)}
      </p>

      <div className="mt-4">
        <PnlChart result={result} width={880} height={200} />
      </div>

      <div className="mt-3 flex gap-6 text-[13px] tabular-nums">
        <span>
          <span className="opacity-50">최고 </span>
          <span className="text-up">{fmtKrw(result.maxProfit)}</span>
        </span>
        <span>
          <span className="opacity-50">최저 </span>
          <span className="text-down">{fmtKrw(result.maxLoss)}</span>
        </span>
      </div>

      {/* Which position carried it. Numbers, not lines — see the header note.
          진입 레벨 (pass P): computed at backtest time and already in the
          payload — the instrument's quoted number on the entry date, printed
          through `entryLevelText` (= fmtLevel, the table's grammar). The
          진입 par column that briefly sat beside it is GONE [OWNER,
          2026-08-03 — "아웃라이트에서는 진입레벨과 진입par가 같은
          개념일텐데 왜 중복으로 적혀있는거야"]: for a one-swap position the
          two are the same concept (par ≈ the quoted level, exactly so on a
          quoted node), and for a package it printed a dash because a package
          has one par PER LEG. A column that is either a duplicate or a dash
          earns no width; the struck par rates live in the fold's per-leg
          table, where they are a fact per swap. */}
      <table className="mt-5 w-full text-[13px] tabular-nums">
        <thead className="text-left text-ink/50">
          <tr>
            <th className="pb-1 font-normal">종목</th>
            <th className="pb-1 font-normal">방향</th>
            <th className="pb-1 pr-4 text-right font-normal">명목</th>
            <th className="pb-1 pr-4 text-right font-normal">진입 레벨</th>
            <th className="pb-1 font-normal">기간</th>
            <th className="pb-1 text-right font-normal">손익</th>
          </tr>
        </thead>
        <tbody>
          {result.positions.map((p, i) => (
            <tr key={`${p.id}-${i}`} className="border-t border-edge">
              <td className="py-1.5 font-semibold">
                {naming.get(p.id)?.label ?? p.id}
              </td>
              <td className="py-1.5">{legsSentence(p.legs)}</td>
              <td className="py-1.5 pr-4 text-right">
                {(p.notional / EOK).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
                억
              </td>
              <td className="py-1.5 pr-4 text-right">
                {entryLevelText(p.entryValue, unitOf(p.id))}
                {p.entryValue != null && (
                  <span className="ml-0.5 text-[11px] opacity-45">
                    {LEVEL_SUFFIX[unitOf(p.id)]}
                  </span>
                )}
              </td>
              <td className="py-1.5 text-[12px] opacity-60">
                {p.entry} → {p.exit}
                {/* 만기 and 청산 are different facts: one ran to the end of
                    its own schedule, the other was closed out early. */}
                {p.matured ? (
                  <span className="ml-1 opacity-70">(만기)</span>
                ) : p.closed ? (
                  <span className="ml-1 opacity-70">(청산)</span>
                ) : null}
              </td>
              <td
                className={`py-1.5 text-right font-semibold ${
                  p.pnl >= 0 ? "text-up" : "text-down"
                }`}
              >
                {fmtKrw(p.pnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 손익 구성 [OWNER]: the headline split into the two things that made
          it. Above the fold, because "was this a rate call or was I just
          collecting coupon" is a question about the RESULT, not about how the
          trade was built. */}
      <table className="mt-5 w-full text-[13px] tabular-nums">
        <thead className="text-left text-ink/50">
          <tr>
            <th className="pb-1 font-normal">손익 구성</th>
            <th className="pb-1 text-right font-normal">평가손익</th>
            <th className="pb-1 text-right font-normal">캐리손익</th>
            <th className="pb-1 text-right font-normal">합계</th>
          </tr>
        </thead>
        {/* The grid is ADDITIVE AT DISPLAYED PRECISION, by construction
            (2026-08-03 verification): each row's 캐리 is 합계 − 평가 in
            만-units (splitKrw), and the 합계 row is the COLUMN SUM of the
            displayed rows — so every row sums across, every column sums
            down, and no reader's mental arithmetic can catch the table
            lying by a 만원. The server relationship is exact to the won
            (verified: 1,499 points, worst gap 1원); this is purely about
            what rounding does to three figures printed separately. A
            sub-만원 figure prints as ±0만원 here — the attribution table
            keeps one unit so it keeps its arithmetic. */}
        <tbody>
          {result.positions.map((p, i) => {
            const u = splitKrw(p.pnl, p.valuation);
            return (
              <tr key={`${p.id}-${i}`} className="border-t border-edge">
                <td className="py-1.5">{naming.get(p.id)?.label ?? p.id}</td>
                <td
                  className={`py-1.5 text-right ${
                    u.uVal >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {fmtKrwFromMan(u.uVal)}
                </td>
                <td
                  className={`py-1.5 text-right ${
                    u.uCarry >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {fmtKrwFromMan(u.uCarry)}
                </td>
                <td className="py-1.5 text-right font-semibold">
                  {fmtKrwFromMan(u.uPnl)}
                </td>
              </tr>
            );
          })}
          {result.positions.length > 1 &&
            (() => {
              const rows = result.positions.map((p) => splitKrw(p.pnl, p.valuation));
              const sum = (f: (u: ReturnType<typeof splitKrw>) => number) =>
                rows.reduce((a, u) => a + f(u), 0);
              return (
                <tr className="border-t-2 border-t-edge font-semibold">
                  <td className="py-1.5">합계</td>
                  <td className="py-1.5 text-right">{fmtKrwFromMan(sum((u) => u.uVal))}</td>
                  <td className="py-1.5 text-right">{fmtKrwFromMan(sum((u) => u.uCarry))}</td>
                  <td className="py-1.5 text-right">{fmtKrwFromMan(sum((u) => u.uPnl))}</td>
                </tr>
              );
            })()}
        </tbody>
      </table>
      <p className="mt-1.5 text-[12px] opacity-50">
        평가손익은 금리가 움직이고 잔존만기가 줄면서 생긴 평가 변화,
        캐리손익은 실제로 주고받은 이자입니다. 둘을 더하면 손익이 됩니다.
      </p>

      <details className="mt-5">
        <summary className="cursor-pointer text-[13px] opacity-50 hover:opacity-80">
          자세히 — 다리별 구성과 정산
        </summary>
        {result.positions.map((p, i) => (
          <div key={`${p.id}-${i}`} className="mt-3">
            <p className="text-[12px] font-semibold opacity-70">
              {naming.get(p.id)?.label ?? p.id} · {fmtMove(p, unitOf(p.id))}
            </p>
            <table className="mt-1 w-full text-[13px] tabular-nums">
              <tbody>
                {p.legs.map((l) => (
                  <tr key={l.tenor} className="border-t border-edge">
                    <td className="py-1 font-semibold">{l.tenor}</td>
                    <td className="py-1">{l.side === "pay" ? "페이" : "리시브"}</td>
                    <td className="py-1 text-right">
                      {(l.notional / EOK).toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}
                      억
                    </td>
                    {/* the struck par rate, in the level grammar (pass P) —
                        a raw `{l.entryRate}%` here printed 3.75 where every
                        other surface says 3.7500 */}
                    <td className="py-1 text-right">
                      {entryLevelText(l.entryRate, "%")}%
                    </td>
                    <td className="py-1 text-right">
                      {(l.dv01 * l.notional * 1e-4).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      원/bp
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[12px] opacity-50">
              누적 정산현금 {fmtKrw(p.cash)}
            </p>
          </div>
        ))}
        <p className="mt-3 text-[12px] leading-relaxed opacity-55">
          매일 그날의 커브로 다시 평가하고, 그동안 실제로 정산된 현금을 더한
          값입니다. 금리 변동분만 곱한 근사치가 아니라 잔존만기가 줄어드는
          효과(롤다운)와 캐리가 들어 있습니다. 다리가 둘 이상이면 진입일 DV01
          중립 비율로 명목을 잡았습니다. 청산한 포지션은 청산일 손익에서 멈추고,
          그 값은 합계에 계속 남습니다.
        </p>
      </details>
    </div>
  );
}

/** One editable row of the book. */
function PositionRow({
  value,
  choices,
  asOf,
  onChange,
  onRemove,
  removable,
}: {
  value: PositionInput;
  /** grouped for the dropdown — see the optgroup note at the call site */
  choices: { group: string; label: string; items: { id: string; label: string }[] }[];
  asOf?: string;
  onChange: (next: PositionInput) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const set = (patch: Partial<PositionInput>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-edge py-2.5">
      <Field label="종목">
        {/* Grouped by kind [OWNER]: the flat list ran 1D → 10Y → 6M/9M →
            1s2s → 6M/9M/1Y → 3Mx3M with nothing marking where outrights ended
            and spreads began, and at ~200 entries the reader had to know the
            naming convention to know what they were looking at. `optgroup` is
            what HTML has for exactly this, so it needs no second control. */}
        <select
          value={value.id}
          onChange={(e) => set({ id: e.target.value })}
          className={`${INPUT} max-w-[13rem]`}
        >
          {choices.map((g) => (
            <optgroup key={g.group} label={g.label}>
              {g.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="방향">
        {/* Both options spell out the legs. For a butterfly there is no term
            to spell them out INSTEAD of (see directionLabel); for a spread the
            standard term leads and the legs follow it. */}
        <select
          value={value.direction}
          onChange={(e) => set({ direction: Number(e.target.value) })}
          className={`${INPUT} max-w-[16rem]`}
        >
          <option value={1}>{directionLabel(value.id, 1)}</option>
          <option value={-1}>{directionLabel(value.id, -1)}</option>
        </select>
      </Field>
      <Field label="명목">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            value={value.eok}
            onChange={(e) => set({ eok: Math.max(1, Number(e.target.value)) })}
            className={`${INPUT} w-20 text-right`}
          />
          <span className="text-[14px] opacity-55">억</span>
        </div>
      </Field>
      <Field label="진입일">
        <input
          type="date"
          value={value.entry}
          max={asOf}
          onChange={(e) => set({ entry: e.target.value })}
          className={INPUT}
        />
      </Field>
      <Field label="청산일">
        <input
          type="date"
          value={value.exit}
          max={asOf}
          onChange={(e) => set({ exit: e.target.value })}
          className={INPUT}
        />
      </Field>
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        title="이 포지션 빼기"
        className="rounded-[10px] px-2 py-2 text-[16px] opacity-40 hover:opacity-90 disabled:opacity-15"
      >
        ×
      </button>
    </div>
  );
}

/** One year before the data's last date, ISO. Empty when there is no as-of
 * yet — the run button stays disabled until there is. Derived at call time
 * rather than set by an effect: setState in an effect body is lint-banned
 * here, and it would flash an empty date field for a frame first. */
function defaultEntry(asOf: string | undefined): string {
  if (!asOf) return "";
  const d = new Date(asOf);
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** A fresh row, seeded from an instrument id. */
function newRow(id: string, asOf: string | undefined): PositionInput {
  return { id, direction: 1, eok: 100, entry: defaultEntry(asOf), exit: "" };
}

export function BacktestWindow({
  row,
  rows,
  asOf,
  entryFrom,
  memoryKey,
  captured,
  onClose,
}: {
  row: Row;
  /** every instrument the app knows, for the per-row dropdown */
  rows: Row[];
  /** the dataset's last date — the default 청산일 and the latest allowed */
  asOf?: string;
  /** the date the reader clicked ON THE CHART, which is the entry date they
   * asked for. Only the FIRST row gets it — rows added afterwards are new
   * questions and fall back to a year before the data's end. */
  entryFrom?: string;
  /** this window INSTANCE's session-memory key (pass Q): the `bt` nonce the
   * URL carries. A history traversal that re-enters this URL re-mounts the
   * window with the same key and finds the book and the last result AS LEFT;
   * a fresh chart click mints a new key and seeds fresh. */
  memoryKey: string;
  /** an instrument clicked in the table BEHIND the window, to be appended */
  captured?: Row | null;
  onClose: () => void;
}) {
  const choices = useMemo(() => {
    // BOOKABLE_GROUPS, not a local list — see its note: the dropdown and the
    // click-behind capture must read one definition of what the engine takes
    return BOOKABLE_GROUPS
      .map((g) => ({
        group: g as string,
        label: GROUP_LABEL[g],
        items: rows
          .filter((r) => r.group === g)
          .map((r) => ({ id: r.seriesId ?? r.id, label: r.label })),
      }))
      .filter((g) => g.items.length > 0);
  }, [rows]);

  const naming = useMemo(
    () =>
      new Map(
        rows.map((r) => [
          r.seriesId ?? r.id,
          { label: r.label, group: r.group as string, unit: r.unit },
        ]),
      ),
    [rows],
  );

  /* AS LEFT, or seeded (pass Q). Both reads happen ONCE, at mount: this is
   * the remount a history traversal performs, and what it must show is the
   * state at the moment the reader left — not a live view of anything. */
  const [book, setBook] = useState<PositionInput[]>(() => {
    const remembered = loadBacktestMemory(memoryKey);
    if (remembered && remembered.book.length > 0) return remembered.book;
    const seed = newRow(row.seriesId ?? row.id, asOf);
    return [entryFrom ? { ...seed, entry: entryFrom } : seed];
  });
  const [restoredResult] = useState(
    () => loadBacktestMemory(memoryKey)?.result,
  );

  /* Write-through: the memory tracks the book as it changes, so whatever
   * instant the reader navigates away at is the instant that is kept. No
   * setState here — the lint's effect rule stays satisfied. */
  useEffect(() => {
    saveBacktestMemory(memoryKey, { book });
  }, [memoryKey, book]);

  /* An instrument clicked in the TABLE BEHIND the sheet is appended as a row.
   * Guarded by the last id seen, because `captured` stays set until the click
   * that replaces it — without this, any unrelated re-render would append the
   * same instrument again.
   *
   * A capture is a click WHILE THE SHEET IS OPEN ("뒤 표에서 종목을 눌러도" —
   * behind the sheet). A pin that already exists at MOUNT is not that: it is
   * residue of however the sheet was reached, and appending it did two wrong
   * things — it duplicated the seed when the sheet was opened from the
   * pinned row's own chart, and it appended a phantom row on every history
   * traversal back INTO the sheet (pass Q: the restored book must be AS
   * LEFT, and the pin is still set from before). The `undefined` sentinel
   * marks the first run: record what is already pinned, append nothing. */
  const lastCaptured = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = captured?.seriesId ?? captured?.id ?? null;
    if (lastCaptured.current === undefined) {
      lastCaptured.current = id;
      return;
    }
    if (!id || id === lastCaptured.current) return;
    lastCaptured.current = id;
    setBook((b) => (b.length >= MAX_POSITIONS ? b : [...b, newRow(id, asOf)]));
  }, [captured, asOf]);

  /* The RESULT is remembered too — an answer the reader already pressed
   * 실행 for. Restoring it costs no server round-trip and does not violate
   * "IT DOES NOT RUN ON ITS OWN": nothing runs, the last answer is shown. */
  const run = useMutation({
    mutationFn: () => fetchBacktest(book),
    onSuccess: (data) => saveBacktestMemory(memoryKey, { result: data }),
  });
  const shownResult = run.data ?? restoredResult;

  /* Drag, by the HEADER only. Event-time snapshots throughout (compiler
   * rules): pointer-down records where the drag started and where the window
   * was — reading `pos` inside the handler, never a ref during render — and
   * every move derives the new position from that snapshot, clamped against
   * the viewport read AT THE EVENT. Pointer capture keeps the moves flowing
   * to the header even when the cursor outruns it. No effects involved. */
  const [pos, setPos] = useState<WinPos>(() =>
    typeof window === "undefined"
      ? { left: 0, top: 56 }
      : initialWindowPos({ w: window.innerWidth, h: window.innerHeight }),
  );
  const dragRef = useRef<{ px: number; py: number; base: WinPos } | null>(null);
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, base: pos };
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPos(
      rememberWindowPos(
        clampWindowPos(
          {
            left: d.base.left + e.clientX - d.px,
            top: d.base.top + e.clientY - d.py,
          },
          { w: window.innerWidth, h: window.innerHeight },
        ),
      ),
    );
  };
  const onHeaderPointerUp = () => {
    dragRef.current = null;
  };

  const reduced = useReducedMotion();
  const unavailable = run.error instanceof BacktestUnavailable;
  const ready = book.length > 0 && book.every((b) => b.entry);

  return (
    <motion.div
      role="dialog"
      aria-label="백테스트"
      /* Opaque surface + the STRONG hairline: depth by surface step + border
         (§9), no shadow. In light theme popover and tile are both white, so
         the hairline carries the boundary alone — border-edge-live (40% ink)
         is the live-weight one for exactly that job. NO backdrop: the app
         behind stays fully interactive. */
      className={`fixed ${Z_WINDOW} flex max-h-[88vh] flex-col overflow-hidden rounded-[16px] border border-edge-live bg-popover`}
      style={{ left: pos.left, top: pos.top, width: WINDOW_W, maxWidth: "96vw" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={instant({ duration: 0.15 }, reduced === true)}
    >
      {/* the drag handle — the ONLY draggable surface, and the strip the
          clamp keeps on-screen. The close button opts out of starting a
          drag; there is no resize and no minimize on purpose. */}
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        className="flex shrink-0 cursor-grab touch-none select-none items-baseline gap-2 border-b border-edge bg-popover px-5 py-3"
      >
        <span className="text-[17px] font-bold">백테스트</span>
        <span className="text-[13px] opacity-50">
          그때 들어갔으면 지금 얼마였을까
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          title="닫기"
          className="cursor-pointer rounded-[8px] px-2 text-[15px] opacity-50 hover:opacity-100"
        >
          ×
        </button>
      </div>
      <div className="min-h-[420px] flex-1 overflow-y-auto p-6 pt-4">
        <ErrorBoundary fallback="백테스트 화면을 그리지 못했어요">
          <div className="mt-0">
            {book.map((b, i) => (
              <PositionRow
                key={i}
                value={b}
                choices={choices}
                asOf={asOf}
                removable={book.length > 1}
                onChange={(next) =>
                  setBook((prev) => prev.map((p, j) => (j === i ? next : p)))
                }
                onRemove={() => setBook((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                setBook((b) => [
                  ...b,
                  newRow(b[b.length - 1]?.id ?? choices[0]?.items[0]?.id ?? "", asOf),
                ])
              }
              disabled={book.length >= MAX_POSITIONS}
              className="rounded-[10px] border border-edge px-3 py-2 text-[13px] disabled:opacity-40"
            >
              + 포지션 추가
            </button>
            <button
              type="button"
              onClick={() => run.mutate()}
              disabled={!ready || run.isPending}
              className="rounded-[10px] bg-ink px-5 py-2 text-[14px] font-semibold text-page disabled:opacity-40"
            >
              {run.isPending ? "계산 중…" : "실행"}
            </button>
            <span className="text-[12px] opacity-45">
              청산일을 비우면 {asOf ?? "마지막 영업일"}까지 · 뒤 표에서 종목을
              눌러도 추가됩니다
            </span>
          </div>

          {unavailable && (
            <div className="mt-6 rounded-[12px] bg-page p-4 text-[13px] leading-relaxed">
              <p className="font-semibold">백엔드가 필요한 화면이에요</p>
              <p className="mt-1 opacity-60">
                다른 화면은 미리 만들어 둔 파일을 읽지만, 백테스트는 입력한
                조건마다 답이 달라져서 미리 구워둘 수 없습니다. 백엔드를 띄우고
                <code className="mx-1 rounded bg-tile px-1">
                  NEXT_PUBLIC_API_BASE
                </code>
                를 지정해 주세요.
              </p>
            </div>
          )}
          {run.error && !unavailable && (
            <p className="mt-6 text-[13px] text-up">{run.error.message}</p>
          )}
          {shownResult && <Result result={shownResult} naming={naming} />}
          {!shownResult && !run.error && !run.isPending && (
            <p className="mt-8 text-center text-[14px] opacity-45">
              조건을 정하고 실행을 눌러 주세요
            </p>
          )}
        </ErrorBoundary>
      </div>
    </motion.div>
  );
}
