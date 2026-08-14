/* The table's last column: 52-week high / low / mean (pass L), the POSITION
 * TRACK (pass N) — where the current level sits inside that range, as a
 * low→high slider with a marker — and, since 2026-08-13, 세타.
 *
 * 세타 is the one thing here that is NOT a 52-week statistic. It is here
 * because the owner put it here ("Backtest 기준 위치 오른쪽에 남는 칸에"), and
 * the placement is the point: carry and rolldown were only reachable by
 * opening the backtest window and pressing 실행, and the number needs neither
 * — a frozen curve makes it a closed form off today's curve alone. Its three
 * rules below are the same three, with the money grammar (`krw.ts`) standing
 * in for `fmtLevel` in rule 1 and rule 2 argued explicitly at its call site.
 *
 * It replaced the 한 줄 sentence and keeps its slot, its width behaviour and
 * its role as the elastic column — only the contents changed, from a Korean
 * sentence to three numbers, and then to three numbers and a track.
 *
 * Three rules hold this file, and each is pinned by guards/range-column.test.ts
 * (the track by guards/range-slider.test.ts):
 *
 * 1. ONE formatter, ONE source. Every number here goes through `rangeText`,
 *    which is `fmtLevel` — the same call the 현재 column makes — and the
 *    track's marker position comes from `rangeValues` + `row.now`, the SAME
 *    fields the three numbers print. There is no rounding, no unit selection
 *    and no `toFixed` in this file, and the slider cannot disagree with the
 *    numbers beside it because there is nothing else it could read.
 * 2. THESE ARE LEVELS, SO THEY ARE INK. No hue, no tint, no emphasis weight.
 *    The track is ink at reduced alpha, the marker full ink — colour is
 *    reserved for signed change values (§5/§9); a level has no direction.
 * 3. NOT SORTABLE. Neither header carries a button, a hover state or a click
 *    handler. Three statistics do not rank rows, and the track is a picture
 *    of the numbers beside it, not a fourth statistic.
 *
 * The sub-columns are fixed-width (the 현재 glyph count, plus a cushion sized
 * for the header label — see `RANGE_PAD`) and the slack sits at the trailing
 * edge, so the column keeps absorbing leftover table width while the numbers
 * stay aligned down the table. The track is one more sub-column of the same
 * width, immediately right of 평균; it has its own ladder rung and drops
 * first (columns.ts). */

import type { Theta, Unit } from "@/lib/api";
import { fmtDelta } from "@/lib/format";

import { rangeTemplate } from "./columns";
import { rangeText } from "./cells";
import { fmtKrw, fmtKrwFromMan, manUnits } from "./krw";

/** Sub-labels, in render order. The window is named once, on the first label,
 * and scopes the three by adjacency — 52주 고점 · 저점 · 평균. Labels are
 * required: high/low/mean is not a number line and does not read from order. */
export const RANGE_LABELS = ["52주 고점", "저점", "평균"] as const;

/** The position track's own label — scoped by the same adjacency. */
export const SLIDER_LABEL = "위치";

/** 3개월 세타, DV01 백만원당 [OWNER, 2026-08-13].
 *
 * The label has to carry the NORMALISER or the number is unreadable: "세타"
 * alone reads as cash, and this is cash PER UNIT OF RISK — the whole reason
 * the column exists is that the two rank the tenors in opposite orders (100억
 * 기준으로는 10Y가 제일 크고, 리스크당으로는 1Y가 6배 크다). Horizon and side
 * do not fit in a sub-column header and ride in `THETA_TITLE` instead. */
export const THETA_LABEL = "세타/DV01백만";

/** The header's tooltip — the facts the label had no room for. §15's register:
 * 해요체, one sentence one fact.
 *
 * The DIRECTION sentence is the one that had to change when spreads and flies
 * joined [OWNER, 2026-08-13 — "스프레드랑 버터플라이까지 부탁할게"]. "페이
 * 기준" is true of an outright and meaningless on a butterfly. What actually
 * holds across all three is the product's own +1 — long the quoted value —
 * which the dropdown already names 페이 / 스티프너 / 벨리 페이
 * (`BacktestWindow.directionLabel`). Naming the three costs one clause and
 * keeps the column readable on every tab; "+1 방향" would have been correct
 * and unreadable. */
export const THETA_TITLE =
  "커브가 그대로일 때 하루 손익이에요 (캐리 + 롤다운). " +
  "아웃라이트는 페이, 스프레드는 스티프너, 플라이는 벨리 페이 기준이라 " +
  "마이너스면 그 방향을 잡았을 때 시간이 돈을 가져가요. " +
  "DV01 백만원당이라 종목끼리 바로 비교돼요 — 스프레드·플라이는 다리 하나의 DV01이에요.";

/** high, low, mean — the order the labels declare. */
/** 이 파일의 셀들이 **실제로 읽는 것 전부**.
 *
 * `Row`(IRS 표)와 현금채권 행이 둘 다 이 모양을 만족한다 — 52주 통계와 위치
 * 트랙과 세타는 종목이 스왑인지 채권인지 알 필요가 없다. 구체 타입 대신 이
 * 구조로 받아 두면 두 표가 **같은 셀**을 쓰고, 그래야 슬라이더 규칙과 세타
 * 서식이 갈릴 수가 없다(`PnlSeries` 를 뽑을 때와 같은 판단). */
export interface RangeRow {
  unit: Unit;
  now: number | null;
  rangeHigh: number | null;
  rangeLow: number | null;
  rangeAvg: number | null;
  theta?: Theta | null;
}

export function rangeValues(row: RangeRow): (number | null)[] {
  return [row.rangeHigh, row.rangeLow, row.rangeAvg];
}

/** Marker position on the low→high track, in percent of its width, reading
 * the SAME `rangeValues` the numeric sub-columns print — the one-source rule
 * that makes slider/number disagreement impossible by construction.
 *
 * Stated rules (pass N):
 *   — at or OUTSIDE an extreme, the marker sits exactly at the track end
 *     (clamped): the current print being the new 52-week high is a marker at
 *     the right end, not off the track;
 *   — a zero-width range (high == low) has no interior to place a marker in,
 *     and a row without the statistics has no frame at all — both render as
 *     an empty cell, the graphic's equivalent of the numbers' em dash. */
export function markerPct(row: RangeRow): number | null {
  const [high, low] = rangeValues(row);
  if (high == null || low == null || row.now == null) return null;
  if (!(high > low)) return null;
  const p = ((row.now - low) / (high - low)) * 100;
  return Math.min(100, Math.max(0, p));
}

/** The track: 2px ink hairline spanning low→high, a 2×12px full-ink marker at
 * the current level. Sized for the 48px row — measured, the marker is 12px
 * tall against 13px body type, the same visual weight as a digit. */
function RangeTrack({ row }: { row: RangeRow }) {
  const pct = markerPct(row);
  if (pct == null) return <span className="pr-3" />;
  return (
    <span className="relative mr-3 block h-3 self-center overflow-visible">
      <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-ink-3" />
      <span
        className="absolute top-1/2 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
        style={{ left: `${pct}%` }}
      />
    </span>
  );
}

/** Header sub-labels, sitting in the same sub-grid as the numbers below them.
 * Plain text: a columnheader with no control inside it. `note` is the
 * hidden-column statement ("1열 숨김") for the state where only the position
 * track is dropped — it lives in the filler track, the one slot that still
 * exists then.
 *
 * The smaller type is on the SPANS, never on the grid container. The template
 * is written in `ch`, which resolves against the element's OWN font size — so a
 * `text-[11px]` container silently made the header's tracks 63.3px against the
 * body's 70.4px and slid every label left of the numbers it names, by 7px, then
 * 14px, then 21px. Sizing the children instead leaves both grids resolving `ch`
 * at the table's 13px, which is the only reason header and body line up. */
export function RangeHeader({
  slider = true,
  theta = false,
  note,
  noteTitle,
}: {
  slider?: boolean;
  theta?: boolean;
  note?: string;
  noteTitle?: string;
}) {
  return (
    <div
      role="columnheader"
      style={{ gridTemplateColumns: rangeTemplate(slider, theta) }}
      className="grid text-ink-2"
    >
      {RANGE_LABELS.map((label) => (
        <span
          key={label}
          className="whitespace-nowrap pr-3 text-right text-[11px]"
        >
          {label}
        </span>
      ))}
      {slider && (
        <span className="whitespace-nowrap pr-3 text-right text-[11px]">
          {SLIDER_LABEL}
        </span>
      )}
      {theta && (
        <span
          className="whitespace-nowrap pr-3 text-right text-[11px]"
          title={THETA_TITLE}
        >
          {THETA_LABEL}
        </span>
      )}
      {note ? (
        <span
          className="whitespace-nowrap pr-1 text-right text-[11px] text-ink-2"
          title={noteTitle}
        >
          {note}
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}

/** The cell's own tooltip: the 100억 figures the column had no room for, plus
 * the breakeven. Additive AT DISPLAYED PRECISION by the `splitKrw` precedent —
 * the total and the roll round once each and the CARRY IS THEIR DIFFERENCE in
 * 만-units, so a reader who subtracts the two parts always gets the total back.
 * Rounding all three separately can miss by a 만원, and this repo has shipped
 * that exact lie once already (see `krw.ts`). */
export function thetaTitle(t: Theta): string {
  const uCash = manUnits(t.cash);
  const uRoll = manUnits(t.roll);
  const uCarry = uCash - uRoll;
  return (
    `100억 기준 ${fmtKrwFromMan(uCash)}` +
    ` — 캐리 ${fmtKrwFromMan(uCarry)} + 롤다운 ${fmtKrwFromMan(uRoll)}. ` +
    `이 100억의 DV01 은 ${fmtKrw(t.dv01)}/bp 예요. ` +
    // the breakeven is a bp MOVE, so it prints in the move grammar the change
    // columns use — `fmtDelta`, not a local toFixed (readout-parity pins that
    // this file owns no rounding of its own)
    `3개월 안에 ${fmtDelta(t.beBp, "bp")}bp 움직여야 본전이에요.`
  );
}

/** One row's three statistics, the track, and 세타. `tabular-nums` + the fixed
 * sub-tracks are what make the digits line up vertically down the table. */
export function RangeCells({
  row,
  slider = true,
  theta = false,
}: {
  row: RangeRow;
  slider?: boolean;
  theta?: boolean;
}) {
  return (
    <div
      role="cell"
      style={{ gridTemplateColumns: rangeTemplate(slider, theta) }}
      className="grid text-ink"
    >
      {rangeValues(row).map((v, i) => (
        <span
          key={RANGE_LABELS[i]}
          className="pr-3 text-right tabular-nums"
        >
          {rangeText(v, row.unit)}
        </span>
      ))}
      {slider && <RangeTrack row={row} />}
      {/* 세타 — INK, not a signed hue, although it IS a signed money value and
          §5 reserves colour for exactly those. The row it sits in already
          spends that hue on RATE direction (the 어제/MTD/YTD columns), and two
          meanings of one colour in one row is worse than none. The sign glyph
          `fmtKrw` prints carries the direction on its own, which is also what
          monochrome-first asks for. Em dash where there is no value: spreads,
          flies, forwards, volatility and the 1D/3M nodes have no swap theta,
          and an empty cell would read as a loading state. */}
      {theta && (
        <span
          className="pr-3 text-right tabular-nums"
          title={row.theta ? thetaTitle(row.theta) : undefined}
        >
          {row.theta ? fmtKrw(row.theta.perDv01) : "—"}
        </span>
      )}
      <span />
    </div>
  );
}
