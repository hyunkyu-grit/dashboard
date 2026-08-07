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
 * step, the strong hairline (`border-edge-live`) AND `shadow-lg` — §9's "no
 * elevation" rule was corrected on 2026-08-05 (it claimed one sanctioned
 * shadow existed while six did); shadows are permitted on floating surfaces
 * and banned on in-flow chrome, and this window is the floating surface that
 * had neither shadow nor scrim. The background is opaque (sticky-opaque
 * spirit: no translucent chrome over data). Position is a transform, not
 * left/top (pass B). Reduced motion opens/closes it instantly (`instant()`).
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

import { useMutation, useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type BacktestLeg,
  type BacktestResult,
  BacktestUnavailable,
  CD_SERIES_ID,
  fetchBacktest,
  fetchSeries,
  type HistoryPoint,
  type PolicyStep,
  type PositionInput,
  type SeriesDetail,
  type Unit,
} from "@/lib/api";
import { fmtDelta, fmtLevel } from "@/lib/format";

import { AnimatedNumber } from "./AnimatedNumber";
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
import { LinkedLegsChart } from "./LinkedLegsChart";
import {
  ARRIVE,
  ARRIVE_STAGGER,
  ENTER,
  EXIT,
  instant,
  STAGGER_STEP,
} from "./motion";
import { CHART_PAD, type ChartMark, PreviewChart } from "./PreviewChart";
import { GROUP_LABEL, type Group, type Row } from "./rows";
import { useCdReference } from "./useCdReference";

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
export function directionLabel(id: string, direction: number): string {
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

/* Text field, resolved off the kit (Text Fields - 3 Rg): the field is the TILE
 * surface with a 1px hairline at ink 5 percent and r=6, its text sits 6px in at
 * Medium 13, and focus is a 3.5px ring at 50 percent — not the 2px/15 percent
 * ring this had. The kit draws that ring in the ACCENT and it does so here too
 * now [OWNER, 2026-08-06]: the earlier pass left it ink because a blue ring sits
 * beside blue change numbers, and the owner ruled that acceptable — a ring
 * surrounds a control, a number does not, so the two do not compete. The hue is
 * this product's blue, not the kit's. */
/* h-6 is the kit's 3 Rg, and it is what makes the row line up: the field was
 * rendering 27.5px next to 24px pop-up buttons in the same row, so the two
 * controls' top and bottom edges sat ~1.75px apart on both sides. Same defect
 * class as the stepper that was a rung low — each value came from the kit, but
 * from different rungs. */
const INPUT =
  "h-6 rounded-control bg-tile px-1.5 text-[13px] font-medium tabular-nums " +
  "outline-none ring-1 ring-inset ring-ink/[0.05] " +
  "focus:ring-[3.5px] focus:ring-down/50";

/* A <select> is a POP-UP BUTTON in the kit, not a text field, and the two do not
 * share a shape: the pop-up carries the chevron and the field does not. Both were
 * on INPUT before.
 * NOT a capsule. Looked at again in Sketch Cloud at 800 percent, size by size:
 * Pop-up Buttons 3 Rg (120x24) is a rounded RECTANGLE and 4 Lg (120x28) is the
 * first capsule — the same 28 boundary the Buttons and Segmented families draw.
 * The pass that made every control a capsule read the 28/36 artboards and called
 * it a rule; 24 has a long flat run on every edge. */
const POPUP =
  "kit-button rounded-control px-3 text-[13px] font-medium tabular-nums " +
  "outline-none focus:ring-[3.5px] focus:ring-down/50";

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
          className="pointer-events-none absolute top-1 rounded-popover bg-popover px-2.5 py-2 text-[12px] shadow-popover"
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

/* ── The book, priced BEFORE 실행 [OWNER feedback, 2026-08-04] ──────────────
 *
 * Two asks, one mechanism. ① "진입 레벨은 실행 전에도 보여야" — each position
 * row states the level its entry date would strike, as the reader types the
 * date, not two clicks later in the result table. ② A single-instrument test
 * should show "원래 그래프랑 CD, Base Rate가 함께" — the instrument's own
 * chart with both reference lines, the same picture every pane already draws,
 * so the trade can be TRACKED against the market it sat in.
 *
 * Both read the instrument's own series file — the same static JSON every
 * other chart reads — so neither needs the live backend the run itself needs.
 * "IT DOES NOT RUN ON ITS OWN" holds: nothing here revalues anything; the
 * level is a table lookup and the chart is history that already existed. */

/** The dataset point an entry DATE strikes: the first ON OR AFTER it. Exactly
 * the server's `_index_on_or_after` (backtest.py `_span_of`), so the level
 * shown before 실행 is the level the run then prices — two snap rules would
 * put two 진입 레벨 on screen for one date. Null past the data's end. */
export function pointOnOrAfter(
  points: HistoryPoint[] | undefined,
  iso: string,
): HistoryPoint | null {
  if (!points || !iso) return null;
  for (const p of points) if (p.t >= iso) return p;
  return null;
}

/** The base rate IN FORCE on a date, or null. The step's own rules apply
 * (policyLine's founding ones): the last decision on or before the date is
 * the rate in force; NEVER past `through` — the backend stops the step short
 * when the workbook has not been refreshed through a Board meeting, and a
 * readout that carried the last rate forward anyway would print exactly the
 * unverified number that bound exists to withhold. */
export function policyRateOn(
  policy: PolicyStep | undefined,
  iso: string | null | undefined,
): number | null {
  if (!policy || !iso || iso > policy.through) return null;
  let rate: number | null = null;
  for (const s of policy.steps) {
    if (s.date > iso) break;
    rate = s.rate;
  }
  return rate;
}

/** The instrument's daily history, at FULL resolution — the ~150-point
 * preview snaps an entry date to the nearest ~3.5 weeks, which is a wrong
 * level printed confidently. Same query key as PreviewPane's chart, so the
 * pane the reader just clicked is a cache hit, not a second fetch. */
function useSeriesFull(id: string | undefined): SeriesDetail | undefined {
  const { data } = useQuery({
    queryKey: ["series", id, "full"],
    queryFn: () => fetchSeries(id!, "full"),
    enabled: !!id,
    staleTime: 30_000,
  });
  return data;
}

/** The context chart: the instrument's OWN line over the tested window, with
 * the CD + 기준금리 references, 진입 marks pinning date AND level, 청산 marks
 * the date alone. Rendered only when the book is ONE instrument — with the
 * whole point being "track THE trade against THE market", a chart that had to
 * pick one of three instruments would answer for none of them; a multi-
 * instrument book keeps the P&L line as its one chart (§backtest: the chart
 * draws the book total only).
 *
 * REUSES PreviewChart wholesale: references, dual bp/% axis, in-place zoom,
 * tooltip, extremes all come from the one implementation — a second chart
 * that draws the references its own way is the two-displays defect class
 * (§ reference lines has ONE owner ruling, it must have one renderer). The
 * slice leads in ahead of the earliest entry (a quarter of the tested span,
 * at least 20 business days) so the entry mark sits in context, not on the
 * left edge. */
function BookContextChart({
  book,
  unit,
  policy,
  result,
}: {
  book: PositionInput[];
  unit: Unit;
  policy?: PolicyStep;
  /** the last run's answer, ONLY when it prices this same instrument — the
   * caller gates it, so a result left over from a different book cannot be
   * paired with the wrong line. When present the chart is WINDOWED to the
   * run (entry → exit), goes `still`, and the LinkedPnlChart below shares
   * its x axis and crosshair [OWNER 재피드백, 2026-08-04]. */
  result?: BacktestResult | null;
}) {
  const id = book[0]?.id;
  const series = useSeriesFull(id);
  // the ONE CD hook (useCdReference) — it already knows CD itself takes no
  // overlay, so a 3M book simply draws without the CD line
  const cd = useCdReference(unit, id);
  /* The instrument's LEGS, for the 구성 금리 panel [OWNER, 2026-08-05] — a
   * spread/fly id splits on '-' into its outright tenors (the id grammar
   * rows.ts and the server's `_legs_for` share). THREE FIXED hook slots, not
   * a map: the hook count must not change when the dropdown swaps a fly for
   * a spread or an outright (legIds is then shorter and the spare slots are
   * simply disabled). Same full-resolution fetch as the instrument's own —
   * outright series files the panes already cache. */
  const legIds = id && id.includes("-") ? id.split("-") : [];
  const legSeries = [
    useSeriesFull(legIds[0]),
    useSeriesFull(legIds[1]),
    useSeriesFull(legIds[2]),
  ];
  const [hoverIso, setHoverIso] = useState<string | null>(null);
  const reduced = useReducedMotion();
  if (!series || series.points.length < 2 || !series.stats) return null;

  const points = series.points;

  /* THE WINDOW. With a result, far left IS the entry and far right IS the
   * exit [OWNER 재피드백, 2026-08-04]: the slice is exactly
   * [result.from, result.to], so the P&L chart below can share this x axis
   * point for point. Without a result there is nothing to align with yet,
   * and the slice leads in ahead of the earliest entry (a quarter of the
   * tested span, at least 20 business days) so the entry mark sits in
   * context rather than on the left edge. */
  let pts: typeof points;
  if (result) {
    let sIdx = points.findIndex((p) => p.t >= result.from);
    if (sIdx < 0) sIdx = 0;
    let eIdx = points.length - 1;
    while (eIdx > sIdx && points[eIdx].t > result.to) eIdx--;
    pts = points.slice(sIdx, eIdx + 1);
  } else {
    const first = book
      .map((b) => b.entry)
      .filter(Boolean)
      .sort()[0];
    let start = 0;
    if (first) {
      let sIdx = points.findIndex((p) => p.t >= first);
      if (sIdx < 0) sIdx = points.length - 1;
      start = Math.max(
        0,
        sIdx - Math.max(20, Math.round((points.length - 1 - sIdx) * 0.25)),
      );
    }
    pts = points.slice(start);
  }
  if (pts.length < 2) return null; // a one-day window cannot draw a line

  const marks: ChartMark[] = [];
  const seen = new Set<string>();
  for (const b of book) {
    // two rows entering the same day are one mark — the annotation names the
    // date, and printing it twice at one x is noise
    if (b.entry && !seen.has(`e${b.entry}`)) {
      seen.add(`e${b.entry}`);
      marks.push({ date: b.entry, label: "진입", level: true });
    }
    if (b.exit && !seen.has(`x${b.exit}`)) {
      seen.add(`x${b.exit}`);
      marks.push({ date: b.exit, label: "청산" });
    }
  }

  return (
    <div className="mt-5">
      {/* One crosshair, two readouts [OWNER 재피드백: "그 좌우로 움직이면
          위에는 기존 그래프의 정보가 뜨고 밑에는 PL의 당일 변화량 및 누적
          PL"]: each chart reports its hover here, and each renders the
          shared date — the instrument chart via `hoverDate`, the P&L chart
          via `hoverIso`. `still` while linked: a zoom the sibling cannot
          follow would silently break the alignment that is the point. */}
      <PreviewChart
        /* remount on mode change: a zoom `view` left from the free (pre-run)
           chart would otherwise index into the NEW run-window slice — a
           plausible-looking wrong crop the `still` flag alone cannot clear */
        key={result ? "linked" : "free"}
        points={pts}
        stats={series.stats}
        unit={unit}
        width={880}
        height={200}
        policy={policy}
        cd={cd}
        marks={marks}
        still={!!result}
        hoverDate={hoverIso}
        onHoverDate={setHoverIso}
      />
      {/* 구성 금리 — the legs + CD + 기준금리 in %, the linked stack's third
          panel [OWNER, 2026-08-05]. Only for a derived instrument (an
          outright IS its own component, and its chart above already carries
          both references on the shared % axis). Waits for every leg: a fly
          drawn with two of three legs would look complete and be wrong.
          Same pts / CHART_PAD / x-formula as the siblings; the crosshair
          date is shared through the same `hoverIso`. Pre-run it aligns with
          the un-zoomed chart above; while linked, `still` holds all three. */}
      {legIds.length >= 2 &&
        legSeries.slice(0, legIds.length).every((s) => s && s.points.length >= 2) && (
          <div className="mt-1">
            <LinkedLegsChart
              legs={legIds.map((legId, k) => ({
                id: legId,
                points: legSeries[k]!.points,
              }))}
              pts={pts}
              cd={cd}
              policy={policy}
              markDates={marks.map((m) => m.date)}
              width={880}
              height={150}
              hoverIso={hoverIso}
              onHover={setHoverIso}
            />
          </div>
        )}
      {/* the chart pair's lower half arrives with the answer (§14 arrival);
          the CONTAINER rises — the P&L path inside never animates */}
      {result && (
        <motion.div
          key={`p-${result.from}|${result.to}|${result.pnl}`}
          className="mt-1"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={instant(ARRIVE, reduced === true)}
        >
          <LinkedPnlChart
            pts={pts}
            result={result}
            width={880}
            height={140}
            hoverIso={hoverIso}
            onHover={setHoverIso}
          />
        </motion.div>
      )}
    </div>
  );
}

/** The P&L, drawn UNDER the instrument it was earned on and PIXEL-ALIGNED
 * with it [OWNER 재피드백, 2026-08-04 — "PL은 밑에 그려지되 … far left가
 * 진입일, far right가 청산일로 해서 … 완전히 수직적으로 얼라인"].
 *
 * Alignment is CONSTRUCTED, not tuned: this chart takes the SAME `pts` slice
 * the instrument chart plots (entry → exit), shares `CHART_PAD`'s left/right,
 * and uses the same index→x formula — a date's x here equals its x above to
 * the pixel, which is what lets one crosshair serve both. The money at each
 * date is the SERVER's cumulative P&L at the most recent published point on
 * or before it (§16: the line is thinned server-side; 누적 and 당일 are both
 * served, never differenced here).
 *
 * PnlChart's rules carry over — the zero line always in frame (the win/lose
 * boundary), the area closed on zero, the hue the run's final sign, and the
 * hover card the same money card (fmtKrw; the shared ReadoutCard stays
 * level-only, see PnlChart's note). What it deliberately does NOT have:
 * its own x labels (the instrument chart's date labels sit between the two
 * charts and serve both) and any zoom (`still` above, same reason). */
export function LinkedPnlChart({
  pts,
  result,
  width,
  height,
  hoverIso,
  onHover,
}: {
  pts: HistoryPoint[];
  result: BacktestResult;
  width: number;
  height: number;
  hoverIso: string | null;
  onHover: (iso: string | null) => void;
}) {
  const PAD = {
    top: 8,
    right: CHART_PAD.right,
    bottom: 6,
    left: CHART_PAD.left,
  };
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  /* cumulative P&L per plotted date — a forward walk, both series sorted */
  const vals: number[] = [];
  {
    let j = -1;
    for (const p of pts) {
      while (j + 1 < result.points.length && result.points[j + 1].t <= p.t) j++;
      vals.push(j >= 0 ? result.points[j].pnl : 0);
    }
  }
  let lo = 0; // zero always in frame — the win/lose boundary
  let hi = 0;
  for (const v of vals) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const pad = (hi - lo) * 0.08 || 1;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (i: number) => PAD.left + (i / (pts.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const line = vals
    .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  // closed on ZERO, so the fill reads as distance from breakeven
  const area = `${line} ${x(vals.length - 1).toFixed(1)},${y(0).toFixed(1)} ${x(0).toFixed(1)},${y(0).toFixed(1)}`;
  const up = result.pnl >= 0;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(
      ((e.clientX - rect.left - PAD.left) / plotW) * (pts.length - 1),
    );
    onHover(pts[Math.max(0, Math.min(pts.length - 1, i))].t);
  };

  /* the crosshair index from the SHARED date — same on-or-after mapping the
   * instrument chart uses for its external hover, so the two verticals land
   * on the same x for the same date */
  const hIdx =
    hoverIso != null && hoverIso >= pts[0].t && hoverIso <= pts[pts.length - 1].t
      ? Math.max(0, pts.findIndex((p) => p.t >= hoverIso))
      : null;
  const hp =
    hIdx != null
      ? ([...result.points].reverse().find((p) => p.t <= pts[hIdx].t) ?? null)
      : null;
  const tipLeft =
    hIdx != null ? Math.min(width - CARD_W - 8, Math.max(0, x(hIdx) + 10)) : 0;

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="누적 손익"
        className="select-none"
        onMouseMove={onMove}
        onMouseLeave={() => onHover(null)}
      >
        {/* the panel says what it is — the top chart carries a legend for
            its references, and an unlabelled second chart one gap below
            would make the reader infer "this is the money" */}
        <text
          x={PAD.left + 2}
          y={PAD.top + 8}
          className="fill-ink"
          style={{ fontSize: 10, opacity: 0.45 }}
        >
          누적 손익
        </text>
        <g className={up ? "text-up" : "text-down"}>
          <polygon
            points={area}
            fill="currentColor"
            fillOpacity={0.08}
            stroke="none"
          />
          <polyline
            data-linked-pnl=""
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
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
        {hIdx != null && (
          <>
            <line
              data-crosshair=""
              x1={x(hIdx)}
              x2={x(hIdx)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-ink"
              strokeWidth={1}
              strokeOpacity={0.25}
            />
            <circle
              cx={x(hIdx)}
              cy={y(vals[hIdx])}
              r={3}
              className={up ? "fill-up" : "fill-down"}
            />
          </>
        )}
      </svg>
      {hp && hIdx != null && (
        <div
          className="pointer-events-none absolute top-1 rounded-popover bg-popover px-2.5 py-2 text-[12px] shadow-popover"
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
  chartLinked,
}: {
  result: BacktestResult;
  /** id → how the rest of the product names it AND its unit. The server
   * echoes the id it was given (`3Y-10Y`); every other surface says `3s10s`,
   * and a backtest that names instruments differently from the table above
   * it is two products. The unit rides along so entry levels print in the
   * row's own grammar, not one inferred from the id. */
  naming: Map<string, { label: string; group: string; unit: Unit }>;
  /** true when the P&L is already drawn in the LINKED chart pair above
   * [OWNER 재피드백, 2026-08-04]. The standalone line here would then be the
   * same series twice, so it is dropped; a multi-instrument book (no context
   * chart) keeps it as the book's one chart. */
  chartLinked?: boolean;
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

      {!chartLinked && (
        <div className="mt-4">
          <PnlChart result={result} width={880} height={200} />
        </div>
      )}

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
        <thead className="text-left text-ink-2">
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
        <thead className="text-left text-ink-2">
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
        평가손익 = 금리·잔존만기 변화, 캐리손익 = 실제 주고받은 이자. 둘의
        합이 손익이에요.
      </p>

      <details className="mt-5">
        <summary className="cursor-pointer text-[13px] opacity-50 hover:opacity-80">
          자세히 — 다리별 구성·정산
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
        {/* the mechanics, one sentence per fact — the four-sentence essay
            this replaces said the same things with connective tissue nobody
            reads twice [OWNER, 2026-08-05 lighten pass] */}
        <p className="mt-3 text-[12px] leading-relaxed opacity-55">
          매일 그날 커브로 재평가한 값 + 정산 현금이에요. Δ금리×DV01 근사가
          아니라 롤다운·캐리가 들어 있어요. 다리 둘 이상이면 진입일 DV01
          중립 비율이에요. 청산 포지션은 청산일 손익으로 합계에 남아요.
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
  unit,
  policy,
  onChange,
  onRemove,
  removable,
}: {
  value: PositionInput;
  /** grouped for the dropdown — see the optgroup note at the call site */
  choices: { group: string; label: string; items: { id: string; label: string }[] }[];
  asOf?: string;
  /** the instrument's own unit, from the row model — the level readout's grammar */
  unit: Unit;
  /** the base-rate step, for the component line's 기준금리 figure */
  policy?: PolicyStep;
  onChange: (next: PositionInput) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const set = (patch: Partial<PositionInput>) => onChange({ ...value, ...patch });

  /* 진입 레벨, BEFORE 실행 [OWNER feedback, 2026-08-04]. The level the typed
   * entry date strikes, looked up in the instrument's own series file as the
   * date is typed — the result table's column answered this only after a
   * server round-trip the reader had no reason to spend on "where would I be
   * getting in". Same on-or-after snap as the server (`pointOnOrAfter`), same
   * grammar as everywhere (`entryLevelText` = fmtLevel); the title names the
   * business day actually struck, which matters when the typed date is a
   * weekend. Em dash while the series loads or past the data's end. */
  const struck = pointOnOrAfter(useSeriesFull(value.id)?.points, value.entry);

  /* THE COMPONENTS, EACH AT ITS OWN ENTRY LEVEL [OWNER 재피드백, 2026-08-05
   * — "실행 위에 진입 레벨만 나오는게 아니라 각각 나와줘야"]. A package's
   * combined figure answers "where is the SPREAD/FLY getting in"; the desk
   * also legs the trade, so each component tenor's own rate at the same
   * struck day has to be readable BEFORE 실행 — plus CD and the base rate,
   * the two references every rate is read against. Same snap
   * (`pointOnOrAfter`), same full-resolution files (the chart below already
   * fetched them — cache hits), same level grammar. THREE FIXED leg slots +
   * one CD slot: the hook count must not move when the dropdown swaps a fly
   * for an outright. The base rate is a STEP lookup (`policyRateOn`) at the
   * struck business day, silent past `through`. An outright's own level is
   * the 진입 레벨 beside it, so its line carries the references alone. */
  const legIds = value.id.includes("-") ? value.id.split("-") : [];
  const legSeries = [
    useSeriesFull(legIds[0]),
    useSeriesFull(legIds[1]),
    useSeriesFull(legIds[2]),
  ];
  const cdFull = useSeriesFull(value.id === CD_SERIES_ID ? undefined : CD_SERIES_ID);
  const parts: { label: string; v: number | null; t?: string }[] = value.entry
    ? [
        ...legIds.map((legId, k) => {
          const p = pointOnOrAfter(legSeries[k]?.points, value.entry);
          return { label: legId, v: p?.v ?? null, t: p?.t };
        }),
        ...(value.id === CD_SERIES_ID
          ? []
          : [
              {
                label: "CD 91일",
                v: pointOnOrAfter(cdFull?.points, value.entry)?.v ?? null,
              },
            ]),
        { label: "기준금리", v: policyRateOn(policy, struck?.t ?? value.entry) },
      ]
    : [];

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
          className={`${POPUP} max-w-[13rem]`}
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
          className={`${POPUP} max-w-[16rem]`}
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
      <Field label="진입 레벨">
        {/* a readout, not an input — same vertical rhythm as its neighbours
            so the sentence still reads left to right */}
        <span
          className="px-1 py-2 text-[14px] tabular-nums"
          title={struck ? `${struck.t} 종가 기준` : undefined}
        >
          {/* AnimatedNumber (§14): the level swaps as the date is typed, and a
              cross-fade is what separates "the number changed" from a
              flicker */}
          <AnimatedNumber value={entryLevelText(struck?.v ?? null, unit)} />
          {struck && (
            <span className="ml-0.5 text-[11px] opacity-45">
              {LEVEL_SUFFIX[unit]}
            </span>
          )}
        </span>
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
        className="rounded-popover px-2 py-2 text-[16px] opacity-40 hover:opacity-90 disabled:opacity-15"
      >
        ×
      </button>
      {/* the component line — w-full wraps it under the fields, still inside
          the row's border so it reads as THIS position's facts. Levels in %,
          the one grammar; em dash while a series loads (never blank, never
          0.00). The title names the struck day once for the whole line. */}
      {parts.length > 0 && (
        <div
          data-entry-components=""
          className="w-full pb-0.5 text-[12px] tabular-nums"
          title={struck ? `${struck.t} 종가 기준` : undefined}
        >
          {parts.map((p, i) => (
            <span key={p.label}>
              {i > 0 && <span className="mx-1.5 opacity-25">·</span>}
              <span className="opacity-50">{p.label}</span>{" "}
              <AnimatedNumber value={entryLevelText(p.v, "%")} />
            </span>
          ))}
        </div>
      )}
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
  policy,
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
  /** the BOK step, for the context chart's reference pair (§ reference lines) */
  policy?: PolicyStep;
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

  /* Dialog keyboard convention: Escape closes the window (the × was the only
   * way out). One press peels ONE layer: this handler yields while the
   * enlarged view (`tile`) is up — that modal closes itself on Escape — and
   * App's unpin handler yields while `bt` is in the URL. The command bar
   * stops its own Escape from reaching either. The URL is read AT THE EVENT
   * (the two namespaces compose, so props here cannot see `tile`). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (new URLSearchParams(window.location.search).has("tile")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* Focus follows the dialog: into the window on open (Tab starts on its
   * controls, not back at the top of the page), back to the opener on close.
   * tabIndex={-1} makes the container programmatically focusable without
   * joining the tab order; a programmatic focus does not match
   * :focus-visible, so no ring is drawn. */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    rootRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const reduced = useReducedMotion();
  const unavailable = run.error instanceof BacktestUnavailable;
  const ready = book.length > 0 && book.every((b) => b.entry);

  /** the row model's unit for a booked id — Result derives the same way */
  const unitOf = (id: string): Unit => naming.get(id)?.unit ?? unitFromShape(id);
  /* the context chart's gate: a book of ONE instrument (however many rows leg
   * in and out of it) — see BookContextChart's note for why not the first of
   * several */
  const soleId =
    book.length > 0 && book.every((b) => b.id === book[0].id) && book[0].id
      ? book[0].id
      : null;
  /* Does the last answer belong WITH the context chart (the linked pair)?
   * Only when every priced position is the chart's own instrument — the book
   * can be edited AFTER a run (the result deliberately stays), and a 10Y P&L
   * paired under the 3s10s line the reader just switched to would be a wrong
   * chart that looks plausible. When it does, the Result's standalone P&L
   * chart is REDUNDANT and is dropped [OWNER 재피드백, 2026-08-04]. */
  const chartLinked =
    !!soleId &&
    !!shownResult &&
    shownResult.positions.every((p) => p.id === soleId);

  return (
    <motion.div
      role="dialog"
      aria-label="백테스트"
      ref={rootRef}
      tabIndex={-1}
      /* Opaque surface, the STRONG hairline, AND a shadow: depth by surface
         step + border + elevation (§9 as corrected 2026-08-05). In light
         theme popover and tile are both #ffffff (ΔL* 0.00), so before the
         shadow the boundary rested entirely on a 2.47:1 hairline —
         border-edge-live (40% ink) is the live-weight one, and it was not
         enough on its own. NO backdrop: the app behind stays fully
         interactive. */
      /* Floating-window shadow is the kit's (Windows - Utility Panel - Active):
         0,5 blur 20 spread 0 at black 30 percent. Tailwind's shadow-lg is a
         two-layer preset that sits tighter and darker than macOS's single
         low drop. */
      className={`fixed ${Z_WINDOW} flex max-h-[88vh] flex-col overflow-hidden rounded-card border border-edge-live bg-popover shadow-window`}
      /* POSITION IS A TRANSFORM, NOT left/top (pass B). Dragging wrote
         `left`/`top` on every pointermove — a layout write per event, and the
         only continuous non-composited animation in the product, on the one
         surface the reader physically pushes around.
         `x`/`y` are motion's own transform channels rather than a raw
         `transform` string: this element also animates `scale` on entrance,
         and a hand-written transform would fight motion for the property.
         The element stays anchored at the viewport origin, so the clamp
         arithmetic in floatingWindow.ts is unchanged — it still describes a
         top-left in viewport coordinates. */
      style={{
        left: 0,
        top: 0,
        x: pos.left,
        y: pos.top,
        width: WINDOW_W,
        maxWidth: "96vw",
      }}
      /* a window MATERIALIZES — the slight scale gives it a surface arriving
         rather than a div blinking on; exit is the faster twin (§14: exits
         run shorter than entrances). `transitionEnd: display none` is the
         close-button fix's second belt [2026-08-05]: the failure was the
         window fading to opacity 0 and then STAYING MOUNTED (a nested
         presence blocked AnimatePresence's removal), which left an
         invisible surface eating every click over its area. The root cause
         is fixed in AnimatedNumber (no popLayout); this line makes the
         failure CLASS harmless — a node that somehow survives its exit
         stops painting AND stops hit-testing. */
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{
        opacity: 0,
        transitionEnd: { display: "none" },
        transition: instant(EXIT, reduced === true),
      }}
      /* Was an ad-hoc 0.15s pair. It is the shared entrance now — the window
         was the last site still carrying its own duration, and "exits run
         shorter than entrances" is the token pair's job rather than a number
         written here. */
      transition={instant(ENTER, reduced === true)}
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
          className="cursor-pointer rounded-control px-2 text-[15px] opacity-50 hover:opacity-100"
        >
          ×
        </button>
      </div>
      <div className="min-h-[420px] flex-1 overflow-y-auto p-6 pt-4">
        <ErrorBoundary fallback="백테스트 화면을 그리지 못했어요">
          <div className="mt-0">
            {/* Rows ENTER only (fade + rise, briefing-stagger cadence) — no
                exit animation on purpose: the keys are indices, so on a
                removal React reuses nodes and an exit would fade the WRONG
                row. Enter is safe: an append mounts a fresh index, and a
                window open staggers the restored book in. */}
            {book.map((b, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                /* the shared entrance plus a delay — the 0.2s that used to
                   sit here was an eighth distinct duration nobody chose */
                transition={instant(
                  { ...ARRIVE, delay: Math.min(i, 8) * STAGGER_STEP },
                  reduced === true,
                )}
              >
                <PositionRow
                  value={b}
                  choices={choices}
                  asOf={asOf}
                  unit={unitOf(b.id)}
                  policy={policy}
                  removable={book.length > 1}
                  onChange={(next) =>
                    setBook((prev) => prev.map((p, j) => (j === i ? next : p)))
                  }
                  onRemove={() =>
                    setBook((prev) => prev.filter((_, j) => j !== i))
                  }
                />
              </motion.div>
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
              /* 4 Lg (28) and therefore a CAPSULE — the two action buttons sit a
                 rung above the form's 24px fields, the way a sheet's buttons do
                 in the kit (Alerts draws Cancel / Don't Save / Save at 228x28,
                 all three fully round). It was 37.7px tall at r=10, which is on
                 no rung of the kit's ladder at all. */
              className="flex h-7 items-center rounded-full border border-edge px-4 text-[13px] font-medium hover:bg-page disabled:opacity-40 disabled:hover:bg-transparent"
            >
              + 포지션 추가
            </button>
            {/* min-width holds through the 실행 ↔ 계산 중… swap — a primary
                button that changes size mid-action shoves the hint beside it */}
            <button
              type="button"
              onClick={() => run.mutate()}
              disabled={!ready || run.isPending}
              /* The DEFAULT button of this sheet: same 28 capsule as its
                 neighbour, filled, and filled with THE ACCENT — that is what
                 macOS marks a default with.
                 2026-08-07: 그 "액센트" 가 파랑에서 주황으로 돌아왔다 [OWNER].
                 파랑이 여기 있던 것은 액센트가 은퇴해 있던 동안 그 자리를 대신
                 메운 것이고, 액센트가 있는 지금은 방향 파랑을 비운다 — 이 창은
                 파란 −25.1억을 같이 띄운다.
                 라벨이 `text-page`(흰 글자)에서 `text-on-accent`(잉크 85%)로
                 같이 움직인다: 채움 주황 위 흰 글자는 2.31:1, 잉크는 7.61:1.
                 14px semibold was the one label in the window off the kit's type
                 scale — 4 Lg carries 13/Medium like every size above 20. */
              className={`flex h-7 min-w-[6.75rem] items-center justify-center rounded-full bg-accent px-5 text-center text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40 ${
                // a full revaluation takes a beat — the pulse says the server
                // is working; motion-safe so reduced motion sees a still label
                run.isPending ? "motion-safe:animate-pulse" : ""
              }`}
            >
              {run.isPending ? "계산 중…" : "실행"}
            </button>
            {/* the two facts a reader needs at the controls, as fragments —
                §15 keeps hints 합니다체/noun-final, and lighter here means
                FEWER words, not a softer register [OWNER, 2026-08-05:
                "말들을 좀 더 가볍게"] */}
            <span className="text-[12px] opacity-45">
              청산일 비우면 {asOf ?? "마지막 영업일"}까지예요 · 뒤 표를 누르면
              추가돼요
            </span>
          </div>

          {/* the instrument's own chart, THERE BEFORE 실행 — with the entry
              marks and the level readouts above, the question "where in the
              market am I getting in" is answered before the server is ever
              asked "and what did it pay". After a matching run it becomes
              the top half of the linked pair (entry→exit window, P&L
              beneath, one crosshair). */}
          {soleId && (
            <BookContextChart
              book={book}
              unit={unitOf(soleId)}
              policy={policy}
              result={chartLinked ? shownResult : null}
            />
          )}

          {unavailable && (
            <div className="mt-6 rounded-card bg-page p-4 text-[13px] leading-relaxed">
              <p className="font-semibold">백엔드가 필요한 화면이에요</p>
              <p className="mt-1 opacity-60">
                백테스트는 입력마다 답이 달라 미리 구워둘 수 없어요.
                백엔드를 띄우고
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
          {/* THE ANSWER ARRIVES (§14 arrival): keyed by the run's identity so
              every fresh answer rises in — a re-run with the same result is
              the same answer and stays put. One beat after the chart pair
              (ARRIVE_STAGGER): chart first, money second, one gesture. */}
          {shownResult && (
            <motion.div
              key={`r-${shownResult.from}|${shownResult.to}|${shownResult.pnl}|${shownResult.positions.length}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={instant(
                { ...ARRIVE, delay: ARRIVE_STAGGER },
                reduced === true,
              )}
            >
              <Result
                result={shownResult}
                naming={naming}
                chartLinked={chartLinked}
              />
            </motion.div>
          )}
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
