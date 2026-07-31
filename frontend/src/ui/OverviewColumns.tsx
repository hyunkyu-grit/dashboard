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
import { useCdReference } from "./useCdReference";
import { cmpKey, GROUP_LABEL, OVERVIEW_GROUPS, type Group, type Row } from "./rows";

/* The chart's FLOOR, not its height. It grows into whatever the list leaves
 * (see ColumnChartSlot): the three lists are 10, 8 and 6 rows, so a fixed
 * height left a band of dead screen between the numbers and the charts that
 * got taller the shorter the list was. Growing into it spends that space on
 * the one thing here that can use more of it. */
const CHART_MIN_H = 160;

/* The column grid, in `ch` so it tracks the font rather than a guessed pixel
 * (the same rule as columns.ts). Eight tracks: 종목 · 현재 · 어제 · MTD · YTD ·
 * 52주 고 · 저 · 평.
 *
 * TYPE IS 13px — the table's size, not a smaller one [OWNER, 2026-07-31].
 * This shipped at 11px on the theory that three tables side by side needed to
 * be small, and on screen it just read as small. The eight tracks fit 13px at
 * 1920 with room over, so the smaller type bought nothing and cost legibility.
 *
 * `ch` resolves against the ELEMENT'S OWN font-size, so this template must be
 * applied on an element that is already 13px — putting it on a parent of a
 * different size silently resizes every track (a trap this repo has hit
 * before, in the table's 52주 header).
 *
 * Tracks are sized to their CONTENT and no wider, because every surplus `ch`
 * shows up as a gap between 종목 and the 52주 trio, which is the one stretch
 * of this row with nothing in it:
 *   종목  7ch — 5 semibold glyphs (`2s10s`, `9Mx3M`); a `ch` is the ZERO
 *                advance and letters are wider, so 5 glyphs need more than 5ch
 *   the rest 6.5ch — six glyphs (`+113.9`, `−100.5`, `2.4090`), the level
 *                     column included
 *
 * The level track is 6.5ch like the others, NOT 10.5ch for the ISO date the
 * table heads it with. The date is ten glyphs against six of value, so the
 * surplus landed as leading slack in a right-aligned column — a visible gap
 * immediately after 종목, three times over. The date is stated ONCE above the
 * grid instead, which is also the honest count: one fact about the dataset,
 * not three about three columns. */
const GRID = "7ch 6.5ch 6.5ch 6.5ch 6.5ch 6.5ch 6.5ch 6.5ch";

function Head() {
  return (
    <div
      style={{ gridTemplateColumns: GRID }}
      className="grid gap-x-1 border-b border-edge pb-1 text-[13px] text-ink/50"
    >
      <div>종목</div>
      {/* deliberately empty: the level is the bold number and needs no naming,
          and the date that heads this column in the table is said once above
          the grid (see OverviewColumns). Heading it 현재 is what pass M ruled
          out — these are closes, not a live quote. */}
      <div />
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
      className={`grid w-full gap-x-1 border-b border-edge py-1.5 text-left text-[13px] ${
        selected ? "bg-page" : "hover:bg-page/50"
      }`}
    >
      <div className="relative truncate pl-1.5 font-semibold">
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
  height,
  policy,
}: {
  row: Row | null;
  width: number;
  height: number;
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
  const cd = useCdReference(row?.unit, row?.seriesId);

  if (!row) {
    return (
      <div className="flex items-center justify-center text-[13px] opacity-45"
        style={{ height: CHART_MIN_H }}>
        종목을 누르면 흐름이 나옵니다
      </div>
    );
  }
  if (!row.seriesId) {
    return (
      <div className="flex items-center justify-center text-[13px] opacity-45"
        style={{ height: CHART_MIN_H }}>
        과거 흐름을 볼 수 없습니다
      </div>
    );
  }
  return (
    <div>
      <div className="mb-1 text-[13px] font-semibold">{row.label}</div>
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
          height={height}
          policy={policy}
          cd={cd}
        />
      )}
    </div>
  );
}

function Column({
  group,
  rows,
  policy,
  onAvail,
  sharedH,
}: {
  group: Group;
  rows: Row[];
  policy?: PolicyStep;
  onAvail: (h: number) => void;
  sharedH: number | null;
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
    // h-full + the grid's default `stretch`: every column is the container's
    // full height, which is what gives `mt-auto` on the chart a floor to sit on
    <div className="flex h-full min-w-0 flex-col">
      <div className="mb-1 text-[13px] font-semibold">{GROUP_LABEL[group]}</div>
      <div className="text-[13px]">
        <Head />
        {shown.map((r) => (
          <OverviewRow
            key={r.id}
            row={r}
            selected={selected?.id === r.id}
            onSelect={(row) => setSelectedId(row.id)}
          />
        ))}
      </div>
      {/* mt-auto: the chart sits at the BOTTOM of the column, not directly
          under a list whose length differs per group [OWNER, 2026-07-31].
          The three lists are 10, 8 and 6 rows, so charts that followed their
          lists started at three different heights with dead space beneath
          them; pinned to the floor they share one baseline and the slack
          moves above the charts where it reads as separation, not emptiness. */}
      <ColumnChartSlot
        row={selected}
        policy={policy}
        onAvail={onAvail}
        sharedH={sharedH}
      />
    </div>
  );
}

/** The chart under a column, sized to the column it is in. Split out so the
 * width measurement is per-column and does not force the whole grid to
 * re-render when one column resizes. */
function ColumnChartSlot({
  row,
  policy,
  onAvail,
  sharedH,
}: {
  row: Row | null;
  policy?: PolicyStep;
  /** report how much height this column has left, so the set can agree */
  onAvail: (h: number) => void;
  /** the agreed height — the SHORTEST column's, or null before all report */
  sharedH: number | null;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setBox({ w: r.width, h: r.height });
      onAvail(r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, onAvail]);
  /* flex-1 for the height, and the chart ABSOLUTELY POSITIONED inside it.
   *
   * The absolute layer is load-bearing, not styling. Measuring this box and
   * then sizing an in-flow child from the measurement is a ResizeObserver
   * feedback loop: the chart grows to the measured height, which grows the
   * box, which reports a larger height, which grows the chart. It does not
   * settle — first attempt ran the charts off the bottom of the page and put a
   * scrollbar on a screen that fits. Out of flow, the child cannot influence
   * the parent it is measured from, so the loop cannot form. */
  return (
    <div ref={setEl} className="relative mt-auto min-h-0 min-w-0 flex-1 pt-4">
      {box.w > 0 && (
        /* bottom-0, not inset-0: the three charts share one HEIGHT and one
           BASELINE, so a column with a shorter list carries its slack above
           the chart rather than below it. */
        <div className="absolute inset-x-0 bottom-0">
          <ColumnChart
            row={row}
            width={box.w}
            height={Math.max(CHART_MIN_H, (sharedH ?? box.h) - 20)}
            policy={policy}
          />
        </div>
      )}
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
  /* Columns are CONTENT-WIDTH and packed left, not equal thirds [OWNER,
   * 2026-07-31 — "아웃라이트 52주 고저평이 끝나는 부분이랑 스프레드 종목 사이에
   * 빈칸이 너무 많다"].
   *
   * Equal thirds gave each column ~500px for ~355px of fixed tracks, and the
   * 145px of trailing slack sat exactly between one column's last number and
   * the next column's first — the widest gap on the screen, three times over,
   * in the place with nothing in it. `max-content` columns close it to the
   * grid gap alone.
   *
   * The cost is real and deliberate: the three columns no longer span the
   * window, so a wide screen has empty space at the right. That space is at the
   * EDGE, where empty space reads as margin; the same pixels between two
   * columns read as a gap. Below the two-pane breakpoint they stack, because
   * three of these side by side on a laptop half-screen is eight numeric
   * columns in ~200px, unreadable at any type size. */
  /* ONE CHART HEIGHT FOR ALL THREE [OWNER, 2026-07-31]. Each slot reports the
   * height its own column has left, and the SHORTEST wins — so the three
   * charts are the same size and share a baseline instead of being 307, 372
   * and 437 tall because their lists are 10, 8 and 6 rows.
   *
   * The slack this gives back sits ABOVE the charts, under the shorter lists,
   * which is strictly more empty screen than letting each chart grow. That is
   * the trade the owner asked for: three charts of one size compare, three of
   * three sizes do not.
   *
   * Safe from the feedback loop the first version hit only because the charts
   * are absolutely positioned — a shared height derived from measurements that
   * the height itself fed would oscillate across all three columns at once. */
  const [avail, setAvail] = useState<Record<string, number>>({});
  const report = useMemo(() => {
    const out: Record<string, (h: number) => void> = {};
    for (const g of OVERVIEW_GROUPS) {
      out[g] = (h: number) =>
        setAvail((prev) => (prev[g] === h ? prev : { ...prev, [g]: h }));
    }
    return out;
  }, []);
  const reported = OVERVIEW_GROUPS.map((g) => avail[g]).filter(
    (h): h is number => typeof h === "number" && h > 0,
  );
  const sharedH =
    reported.length === OVERVIEW_GROUPS.length ? Math.min(...reported) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The dataset's date, once for the whole overview — the level columns
          used to each head themselves with it (pass M's rule, applied three
          times). One surface, one dataset, one date. */}
      <p
        className="mb-2 shrink-0 text-[12px] tabular-nums opacity-45"
        title={levelHeadTitle(asOf)}
      >
        {levelHeadText(asOf)} 종가 기준
      </p>
      <div className="grid flex-1 grid-cols-1 justify-start gap-x-10 gap-y-8 lg:grid-cols-[repeat(3,max-content)]">
        {OVERVIEW_GROUPS.map((g) => (
          <Column
            key={g}
            group={g}
            rows={rows}
            policy={policy}
            onAvail={report[g]}
            sharedH={sharedH}
          />
        ))}
      </div>
    </div>
  );
}
