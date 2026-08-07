/* The table's last column: 52-week high / low / mean (pass L), plus the
 * POSITION TRACK (pass N) — where the current level sits inside that range,
 * as a low→high slider with a marker.
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

import { rangeTemplate } from "./columns";
import { rangeText } from "./cells";
import type { Row } from "./rows";

/** Sub-labels, in render order. The window is named once, on the first label,
 * and scopes the three by adjacency — 52주 고점 · 저점 · 평균. Labels are
 * required: high/low/mean is not a number line and does not read from order. */
export const RANGE_LABELS = ["52주 고점", "저점", "평균"] as const;

/** The position track's own label — scoped by the same adjacency. */
export const SLIDER_LABEL = "위치";

/** high, low, mean — the order the labels declare. */
export function rangeValues(row: Row): (number | null)[] {
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
export function markerPct(row: Row): number | null {
  const [high, low] = rangeValues(row);
  if (high == null || low == null || row.now == null) return null;
  if (!(high > low)) return null;
  const p = ((row.now - low) / (high - low)) * 100;
  return Math.min(100, Math.max(0, p));
}

/** The track: 2px ink hairline spanning low→high, a 2×12px full-ink marker at
 * the current level. Sized for the 48px row — measured, the marker is 12px
 * tall against 13px body type, the same visual weight as a digit. */
function RangeTrack({ row }: { row: Row }) {
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
  note,
  noteTitle,
}: {
  slider?: boolean;
  note?: string;
  noteTitle?: string;
}) {
  return (
    <div
      role="columnheader"
      style={{ gridTemplateColumns: rangeTemplate(slider) }}
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

/** One row's three statistics and the track. `tabular-nums` + the fixed
 * sub-tracks are what make the digits line up vertically down the table. */
export function RangeCells({ row, slider = true }: { row: Row; slider?: boolean }) {
  return (
    <div
      role="cell"
      style={{ gridTemplateColumns: rangeTemplate(slider) }}
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
      <span />
    </div>
  );
}
