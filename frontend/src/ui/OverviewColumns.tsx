"use client";

/* The 전체 tab — three columns, not a list [OWNER, 2026-07-31].
 *
 * 전체 used to be every instrument in one table, which is the least useful
 * arrangement of them: 15 outrights, 28 spreads and 140 forwards interleaved
 * by a sort key, so the thing a rates screen is opened for — where are the
 * three blocks right now — took scrolling to answer. It is now a fixed
 * overview: 아웃라이트 · 스프레드 · 포워드 side by side, each showing only its
 * 주요 set, each with its own chart underneath.
 *
 * Butterflies and volatility are deliberately NOT here. Three columns is the
 * point; a fourth and a fifth would make this the list again.
 *
 * ONE COLUMN OWNS ONE CHART. Clicking a tenor draws it in that column and
 * nowhere else — three readers can be answered at once, and moving between
 * columns never costs the comparison already on screen. Each column opens on
 * its own first row so the space is never empty and the affordance is
 * visible without a click.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  fetchSeries,
  type PolicyStep,
  type SeriesDetail,
} from "@/lib/api";
import { dirClass, fmtDelta, levelHeadText, levelHeadTitle } from "@/lib/format";

import { levelText, rangeText } from "./cells";
import { ErrorState, LoadingState } from "./DataState";
import { PreviewChart } from "./PreviewChart";
import { cmpKey, GROUP_LABEL, OVERVIEW_GROUPS, type Group, type Row } from "./rows";

const CHART_H = 180;

/* The column grid, in `ch` so it tracks the font rather than a guessed pixel
 * (the same rule as columns.ts). Eight tracks: 종목 · 현재 · 어제 · MTD · YTD ·
 * 52주 고 · 저 · 평. The overview sets its own type at 11px — three of these
 * live side by side, and at the table's 13px the eight tracks do not fit a
 * third of a 1440 screen without dropping columns, which is the one thing
 * this view must not do: its whole job is showing all six numbers at once.
 *
 * `ch` resolves against the ELEMENT'S OWN font-size, so this template must be
 * applied on an element that is already 11px — putting it on a 13px parent
 * silently widens every track (a trap this repo has hit before).
 *
 * The 종목 track is 9ch for a 5-glyph worst case (`2s10s`, `3Mx3M`) because a
 * `ch` is the ZERO advance and these labels are semibold letters and digits,
 * which are wider — at 6ch the live screen truncated `2s10s` to `2s1…` and
 * `1Yx1Y` to `1Yx…`. Sized generously on purpose: the eight tracks come to
 * ~430px against a ~600px column at 1920, so the slack is free here, and a
 * truncated instrument name is the one thing in this view that cannot be
 * recovered by looking harder. */
const GRID = "9ch 7.5ch 7ch 7ch 7ch 7ch 7ch 7ch";

function Head({ asOf }: { asOf?: string }) {
  return (
    <div
      style={{ gridTemplateColumns: GRID }}
      className="grid gap-x-1.5 border-b border-edge pb-1 text-[11px] text-ink/50"
    >
      <div>종목</div>
      <div
        className="whitespace-nowrap text-right tabular-nums"
        title={levelHeadTitle(asOf)}
      >
        {levelHeadText(asOf)}
      </div>
      <div className="text-right">어제</div>
      <div className="text-right">MTD</div>
      <div className="text-right">YTD</div>
      {/* the 52주 trio under one span — three statistics of one thing, so they
          are headed once rather than three times (the table does the same) */}
      <div className="col-span-3 text-right">52주 고 · 저 · 평</div>
    </div>
  );
}

function OverviewRow({
  row,
  selected,
  onSelect,
}: {
  row: Row;
  selected: boolean;
  onSelect: (row: Row) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      style={{ gridTemplateColumns: GRID }}
      className={`grid w-full gap-x-1.5 border-b border-edge py-1.5 text-left text-[11px] ${
        selected ? "bg-page" : "hover:bg-page/50"
      }`}
    >
      <div className="relative truncate pl-2 font-semibold">
        {/* which row this column's chart is showing — the same left rule the
            table uses for a pin, because it means the same thing */}
        {selected && (
          <span className="absolute left-0 top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-full bg-ink" />
        )}
        {row.label}
      </div>
      <div className="text-right font-semibold tabular-nums text-ink">
        {levelText(row)}
      </div>
      <div className={`text-right tabular-nums ${dirClass(row.changes.d1)}`}>
        {fmtDelta(row.changes.d1, row.unit)}
      </div>
      <div className={`text-right tabular-nums ${dirClass(row.changes.mtd)}`}>
        {fmtDelta(row.changes.mtd, row.unit)}
      </div>
      <div className={`text-right tabular-nums ${dirClass(row.changes.ytd)}`}>
        {fmtDelta(row.changes.ytd, row.unit)}
      </div>
      {/* 52주 statistics are LEVELS, so they are ink — never the up/down hue —
          and they go through `rangeText`, the named second path the parity
          guard compares against 현재. Spreading a fake row into `levelText`
          would print the same string today and make that guard vacuous. */}
      <div className="text-right tabular-nums text-ink/60">
        {rangeText(row.rangeHigh, row.unit)}
      </div>
      <div className="text-right tabular-nums text-ink/60">
        {rangeText(row.rangeLow, row.unit)}
      </div>
      <div className="text-right tabular-nums text-ink/60">
        {rangeText(row.rangeAvg, row.unit)}
      </div>
    </button>
  );
}

function ColumnChart({
  row,
  width,
  policy,
}: {
  row: Row | null;
  width: number;
  policy?: PolicyStep;
}) {
  const { data, isError, isLoading, isFetching, refetch } = useQuery<SeriesDetail>({
    // the SAME query key the preview pane uses (§ react-query): moving a row
    // between the two views is a cache hit, not a second fetch of one series
    queryKey: ["series", row?.seriesId, "preview"],
    queryFn: () => fetchSeries(row!.seriesId!, "preview"),
    enabled: !!row?.seriesId,
    staleTime: 30_000,
  });

  if (!row) {
    return (
      <div className="flex items-center justify-center text-[11px] opacity-45"
        style={{ height: CHART_H }}>
        종목을 누르면 흐름이 나옵니다
      </div>
    );
  }
  if (!row.seriesId) {
    return (
      <div className="flex items-center justify-center text-[11px] opacity-45"
        style={{ height: CHART_H }}>
        과거 흐름을 볼 수 없습니다
      </div>
    );
  }
  return (
    <div style={{ minHeight: CHART_H }}>
      <div className="mb-1 text-[11px] font-semibold">{row.label}</div>
      {isError && (
        <ErrorState
          what="이 종목의 과거 흐름을"
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      )}
      {isLoading && <LoadingState />}
      {data && (
        <PreviewChart
          points={data.points}
          stats={data.stats}
          unit={row.unit}
          width={width}
          height={CHART_H}
          policy={policy}
        />
      )}
    </div>
  );
}

function Column({
  group,
  rows,
  asOf,
  policy,
}: {
  group: Group;
  rows: Row[];
  asOf?: string;
  policy?: PolicyStep;
}) {
  /* Only 주요 here, in the backend's sort order. The 전체 members of each group
   * are one tab click away and this view is not where they belong — an
   * overview that listed everything would be the table it replaced. */
  const shown = useMemo(
    () => rows.filter((r) => r.group === group && r.key).sort((a, b) => cmpKey(a.sortKey, b.sortKey)),
    [rows, group],
  );

  /* A column whose selected row leaves the set (a payload arriving late, a
   * group going empty) falls back to its first row rather than to nothing, so
   * the chart never blanks because of something that happened elsewhere.
   *
   * That fallback is this ONE expression — there is no effect reconciling
   * `selectedId` against `shown`. An effect was written first and the lint
   * rejected it (setState in an effect body), correctly: deriving during
   * render is both simpler and free of the extra render pass. `selectedId`
   * is allowed to name a row that is not currently present; it is a wish,
   * not a claim, and it becomes true again if the row comes back. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = shown.find((r) => r.id === selectedId) ?? shown[0] ?? null;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-1 text-[13px] font-semibold">{GROUP_LABEL[group]}</div>
      <div className="text-[11px]">
        <Head asOf={asOf} />
        {shown.map((r) => (
          <OverviewRow
            key={r.id}
            row={r}
            selected={selected?.id === r.id}
            onSelect={(row) => setSelectedId(row.id)}
          />
        ))}
      </div>
      <ColumnChartSlot row={selected} policy={policy} />
    </div>
  );
}

/** The chart under a column, sized to the column it is in. Split out so the
 * width measurement is per-column and does not force the whole grid to
 * re-render when one column resizes. */
function ColumnChartSlot({
  row,
  policy,
}: {
  row: Row | null;
  policy?: PolicyStep;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return (
    <div ref={setEl} className="mt-3 min-w-0">
      {w > 0 && <ColumnChart row={row} width={w} policy={policy} />}
    </div>
  );
}

export function OverviewColumns({
  rows,
  asOf,
  policy,
}: {
  rows: Row[];
  asOf?: string;
  policy?: PolicyStep;
}) {
  /* Three equal columns, `minmax(0,1fr)` so a long instrument name cannot
   * push its column wider than a third — `1fr` alone floors at min-content
   * and one wide row would unbalance the set. Below the two-pane breakpoint
   * they stack, because three of these side by side on a laptop half-screen
   * is eight numeric columns in ~200px, which is unreadable at any type size.
   */
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
      {OVERVIEW_GROUPS.map((g) => (
        <Column key={g} group={g} rows={rows} asOf={asOf} policy={policy} />
      ))}
    </div>
  );
}
