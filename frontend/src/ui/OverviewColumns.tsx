"use client";

/* The 전체 tab — three columns, not a list [OWNER, 2026-07-31].
 *
 * 전체 used to be every instrument in one table, which is the least useful
 * arrangement of them: 15 outrights, 28 spreads and 140 forwards interleaved
 * by a sort key, so the thing a rates screen is opened for — where are the
 * three blocks right now — took scrolling to answer. It is now a fixed
 * overview: 주요 아웃라이트 · 주요 스프레드 · 주요 포워드 side by side, each
 * with its own chart underneath.
 *
 * Butterflies and volatility are deliberately NOT here. Three columns is the
 * point; a fourth and a fifth would make this the list again.
 *
 * IT IS THE TABLE'S OWN GRID [OWNER, 2026-07-31 — "이거랑 동일하게"]. Header
 * text, column template, row height, type size and the 52주 sub-grid all come
 * from the same modules the instrument tabs use (`columns.ts`, `RangeCells`),
 * so a column here and the 아웃라이트 tab print the same row the same way.
 *
 * This replaced a bespoke eight-track grid at its own type size, which was a
 * second definition of one thing: it drifted twice in a single session (a
 * level track sized by a header it did not print; labels clipped at three
 * different widths because `ch` is the ZERO advance and `M` is not). The
 * shared template had already solved both. Do not re-fork it — if the
 * overview needs a column the table does not have, that is a change to
 * `columns.ts`.
 *
 * SPACING GOES BETWEEN THE COLUMNS, NOT INSIDE THE ROWS. The three sit
 * left / centre / right (`justify-between`), so the leftover width is spent as
 * three wide separations rather than as slack trailing each row — which is
 * where it lands if the columns are equal thirds, and it reads as a gap.
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

import { levelText } from "./cells";
import { GroupBox, GroupBoxTitle } from "./GroupBox";
import { ALL_COLUMNS, BASIS_HEAD, gridTemplate } from "./columns";
import { ErrorState, LoadingState } from "./DataState";
import { PreviewChart } from "./PreviewChart";
import { RangeCells, RangeHeader } from "./RangeCells";
import { useCdReference } from "./useCdReference";
import {
  BASIS_ORDER,
  cmpKey,
  GROUP_LABEL,
  OVERVIEW_GROUPS,
  type Group,
  type Row,
} from "./rows";
import { columnCue } from "./tint";

/* A FIXED chart height [OWNER, 2026-07-31]: "폰트사이즈를 키우고 커브사이즈를
 * 줄이면 되지 않을까". The numbers are the subject of this tab and the curve is
 * the footnote, and the charts had it the other way round — 369px of chart
 * under ~250px of table.
 *
 * Fixed also makes "three charts, one height" true BY CONSTRUCTION. It was
 * previously a measured agreement: each column reported its leftover height,
 * the shortest won, and every column had to be told the answer. A constant
 * needs no measurement, no reporting, and cannot disagree — that whole
 * apparatus is gone. Only the WIDTH is still measured. */
const CHART_H = 200;

/** THE column template — the instrument table's, unmodified. Every column
 * shows every column: the overview never drops one (`ALL_COLUMNS`), because
 * showing all six figures at once is the entire reason this tab exists. */
const TEMPLATE = gridTemplate(ALL_COLUMNS);

function Head({ asOf }: { asOf?: string }) {
  return (
    <div
      role="row"
      style={{ gridTemplateColumns: TEMPLATE }}
      className="grid items-end border-b border-edge pb-2 text-left text-ink-2"
    >
      <div role="columnheader" className="pl-3">
        종목
      </div>
      {/* the level column's header is the DATA'S DATE, not the word 현재
          (pass M) — the same header the table prints, for the same reason */}
      <div
        role="columnheader"
        className="whitespace-nowrap pr-3 text-right tabular-nums"
        title={levelHeadTitle(asOf)}
      >
        {levelHeadText(asOf)}
      </div>
      {BASIS_ORDER.map((b) => (
        <div key={b} role="columnheader" className="pr-3 text-right">
          {BASIS_HEAD[b]}
        </div>
      ))}
      {/* Not sortable here either, and for a stronger reason: the overview is
          a fixed set in curve order, so there is no sort on this surface at
          all. The header is text in both places. */}
      <RangeHeader />
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
    <div
      role="row"
      onClick={() => onSelect(row)}
      /* keyboard parity with the click affordance (the table row's rule) */
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(row);
        }
      }}
      style={{ gridTemplateColumns: TEMPLATE }}
      className={`grid h-11 cursor-pointer items-center border-b border-edge ${
        selected ? "bg-page" : "hover:bg-page/50"
      }`}
    >
      <div role="cell" className="relative pl-3 font-semibold">
        {/* which row this column's chart is showing — the same left rule the
            table uses for a pin, because it means the same thing.
            The quoted/interpolated DOT is deliberately absent: every row here
            is a 주요 row and every 주요 outright is quoted, so the marker
            would be identical on all of them and mark nothing. */}
        {selected && (
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ink" />
        )}
        {row.label}
      </div>
      <div role="cell" className="pr-3 text-right font-semibold tabular-nums text-ink">
        {levelText(row)}
      </div>
      {BASIS_ORDER.map((b) => (
        <div
          role="cell"
          key={b}
          // own-history outlier cue on the live 어제 column only (§B) — the
          // table's rule, applied by the table's function
          style={
            b === "d1"
              ? columnCue(row.movePct, (row.changes.d1 ?? 0) > 0)
              : undefined
          }
          className={`self-stretch content-center pr-3 text-right tabular-nums ${dirClass(row.changes[b])}`}
        >
          {fmtDelta(row.changes[b], row.unit)}
        </div>
      ))}
      {/* 52주 고점/저점/평균 — the table's component, so the two cannot print
          one quantity two ways (guards/readout-parity.test.ts) */}
      <RangeCells row={row} />
    </div>
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
        style={{ height: CHART_H }}>
        종목을 누르면 흐름이 나와요
      </div>
    );
  }
  if (!row.seriesId) {
    return (
      <div className="flex items-center justify-center text-[13px] opacity-45"
        style={{ height: CHART_H }}>
        과거 흐름을 볼 수 없어요
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
    /* 열 하나 = **그룹박스** 하나 [OWNER, 2026-08-07]. sauron.html 의 `.ov` 가
       3열 그리드이고 `.ov .groupbox { min-height: 0 }` 을 따로 적어 둔 것이
       그 뜻이다 — 오버뷰의 표와 차트도 박스 안에 있다.
       제목은 박스 **헤더**로 올라갔다. 예전에는 열 위에 떠 있는 13px 텍스트
       줄이었는데, 그건 이 리포가 만든 문법이고 킷에는 그 자리에 헤더가 있다.
       h-full + 그리드 기본 `stretch`: 모든 열이 컨테이너 높이를 채우고, 그게
       차트의 `mt-auto` 에 바닥을 준다. */
    <GroupBox
      className="h-full"
      header={
        /* 열의 제목은 탭의 주요 구분 제목과 같은 말이다 — 두 표면이 같은
           블록을 같은 이름으로 부른다. */
        <GroupBoxTitle>주요 {GROUP_LABEL[group]}</GroupBoxTitle>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2">
      {/* The type size sits HERE, on the wrapper both grids inherit from —
          never on a ch-track grid container. The template is written in `ch`,
          which resolves against the element's OWN font size, so a size set on
          one grid but not the other is the 63.3-vs-70.4 track drift
          (RangeCells has the full history). One declaration, both grids, and
          the two cannot resolve `ch` differently. Pinned by
          guards/table-grid.test.ts. */}
      <div className="text-[13px]">
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
      {/* mt-auto: the chart sits at the BOTTOM of the column, not directly
          under a list whose length differs per group [OWNER, 2026-07-31].
          The three lists are 10, 8 and 6 rows, so charts that followed their
          lists started at three different heights with dead space beneath
          them; pinned to the floor they share one baseline and the slack
          moves above the charts where it reads as separation, not emptiness. */}
      <ColumnChartSlot row={selected} policy={policy} />
      </div>
    </GroupBox>
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
    // WIDTH only. Height is a constant, so there is nothing to measure and no
    // way to re-create the feedback loop an earlier version hit (a chart sized
    // from a box the chart itself sized).
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
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
      {w > 0 && (
        /* bottom-0: the charts sit on the floor, so a column with a shorter
           list carries its slack ABOVE the chart, not below it. */
        <div className="absolute inset-x-0 bottom-0">
          <ColumnChart row={row} width={w} height={CHART_H} policy={policy} />
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
  /* Content-width columns, placed LEFT / CENTRE / RIGHT [OWNER, 2026-07-31 —
   * "아웃라이트는 이 위치 고정하고, 스프레드는 화면 중간, 포워드는 화면 우측"].
   *
   * `max-content` + `justify-evenly` is exactly that: the tracks are the
   * table's own width, and every spare pixel is spent as FOUR equal gaps —
   * edge, column, column, edge. Equal thirds spent the same pixels as trailing
   * slack inside each column, which put the widest gap on the screen between
   * one column's last number and the next column's 종목 — the one stretch of
   * that row with nothing in it.
   *
   * `evenly`, not `between` [OWNER, 2026-07-31 — "맨 좌우 간격도 차트간 간격과
   * 동일하게"]: `between` pins the outer columns to the edges, so the two
   * separations were 138px against a 20px margin. `evenly` is the only
   * distribution that makes the outer margins equal to the inner gaps.
   *
   * This is also why the scroll container drops its `px-5` on this tab
   * (InstrumentTable): the padding sits OUTSIDE the content box the gaps are
   * computed in, so leaving it on would add itself to the two outer margins
   * and break the equality this line exists to produce.
   *
   * Below the two-pane breakpoint they stack: three full instrument tables
   * side by side on a laptop half-screen is unreadable at any type size. */
  return (
    /* `max-content` → **`minmax(0,1fr)`** [OWNER, 2026-08-07 — "100%에서
       잘린다"].
       max-content 는 세 열이 각자 필요한 만큼 요구하고, 합이 화면보다 넓으면
       셸의 `overflow-hidden` 에 **잘린다** — 스크롤바도 안 생기니 오른쪽 열에
       닿을 방법이 없었다. 그게 이 탭의 결함이었다.
       sauron.html 이 그 자리에 적어 둔 것이 정확히
       `.ov { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px }`
       이다. 1fr 은 남는 폭을 나누는 것이 아니라 **모자란 폭을 나눠 진다** —
       셋이 같이 좁아지고 아무도 잘리지 않는다.
       `justify-evenly` 는 함께 은퇴한다: 트랙이 폭을 다 쓰므로 나눠 줄 여백이
       없고, 바깥 여백은 이제 스크롤 컨테이너의 거터가 진다. */
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 lg:grid-cols-3">
      {OVERVIEW_GROUPS.map((g) => (
        <Column key={g} group={g} rows={rows} asOf={asOf} policy={policy} />
      ))}
    </div>
  );
}
