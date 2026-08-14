"use client";

/* Left pane — the instrument table (DESIGN §2). Instrument · the level (headed
 * by the DATA'S DATE since pass M, `levelHeadText`) · five change
 * columns (red up / blue down) · 52주 고점/저점/평균. Filter chips, sortable by
 * any CHANGE column (the 52주 column is not sortable — see RangeCells), hover →
 * preview, click → pin, Esc unpins (in App). Rows self-register in the tile
 * registry so the command bar can scroll to them. */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  BasisKey,
  CurveBanner,
  ForwardsPayload,
  PolicyStep,
} from "@/lib/api";
import { dirClass, fmtDelta, levelHeadText, levelHeadTitle } from "@/lib/format";
import { ForwardMatrix, KeyForwardBlock } from "@/wall/ForwardMatrix";
import { getTile } from "@/wall/tileRegistry";
import { useRegisterTile } from "@/wall/useRegisterTile";

import { levelText } from "./cells";
import {
  BASIS_HEAD,
  gridTemplate,
  visibleColumns,
  type VisibleColumns,
  withThetaData,
} from "./columns";
import {
  EXIT,
  flipWindow,
  instant,
  reorderAnimates,
  rowShouldFlip,
  SPRING,
} from "./motion";
import { OverviewColumns } from "./OverviewColumns";
import { PAGE_X } from "./pageGutter";
import { RangeCells, RangeHeader } from "./RangeCells";
import { TintLegend } from "./TintLegend";
import { YieldSurface } from "./YieldSurface";
import {
  BASIS_ORDER,
  GROUP_LABEL,
  type Group,
  orderRows,
  type Row,
} from "./rows";
import type { TabId } from "./tabs";
import { GroupBox } from "./GroupBox";
import { columnCue } from "./tint";
import { LoadingState } from "./DataState";

/* The simulation arrives with its tab, not with the app.
 *
 * Statically imported it rode in on the first byte of every visit: ~5,000
 * lines of scenario UI plus lightweight-charts, which its two charts import
 * and which guards/lazy-chart.test.ts already keeps off the first-load path
 * for the monitor's own chart (196 KB, measured — see
 * docs/diagnostics/perf-baseline.md). Most visits open the wall and never
 * touch 시뮬레이션.
 *
 * `ssr: false` for the same reason DetailChart takes it: the charts
 * underneath need a real canvas, which the server has not. */
const SimulationFlow = dynamic(
  () => import("@/sim/ui/SimulationFlow").then((m) => m.SimulationFlow),
  { ssr: false, loading: () => <LoadingState what="시뮬레이션" className="h-[420px]" /> },
);

/** The 52주 column's name in noun form — what the hidden-column note calls it
 * when the ladder drops it. The header itself renders the three sub-labels. */
const RANGE_COL_NAME = "52주 레인지";

/** The position track's noun for the same note (pass N). */
const SLIDER_COL_NAME = "52주 내 위치";

/** 세타's noun for the same note [OWNER, 2026-08-13]. Spelled out where the
 * sub-header could not be: the note is prose, so it has the room. */
const THETA_COL_NAME = "3개월 세타 (DV01 백만원당)";

/* 탭의 정의는 ui/tabs.ts 로 옮겼다 [2026-08-07]. 탭은 이제 표 안의 세그먼티드
 * 컨트롤이 아니라 셸의 사이드바(ui/Sidebar.tsx)이고, 표와 셸이 함께 읽는
 * 정의가 표 안에 있으면 셸이 표를 import 해야 한다.
 *
 * `TabId` 는 여기서 계속 내보낸다 — 부르는 쪽이 여덟 군데이고, 그것들이
 * 가리키는 것은 그대로다. */
export type { TabId };

/** Which tabs draw the 주요/전체 divider [OWNER, 2026-07-31]. Generalized from
 * the forward tab, whose two-block layout is the reference. 변동성 is absent
 * because six rows do not need dividing; 전체 is absent because it is no
 * longer a list at all (see OverviewColumns). */
const DIVIDED: Group[] = ["outright", "spread", "fly", "forward"];

function TableRow({
  row,
  active,
  pinned,
  onHover,
  onPin,
  flip,
  orderKey,
  enter,
  reduced,
  template,
  visible,
}: {
  row: Row;
  active: boolean;
  pinned: boolean;
  onHover: (row: Row | null) => void;
  onPin: (row: Row) => void;
  /** FLIP this row on the next reorder (Pass C) — transform-only. */
  flip: boolean;
  /** reorder generation: layout is measured only when this changes. */
  orderKey: string;
  /** row entered the set via a screener toggle → fade in at destination. */
  enter: boolean;
  /** the OS preference, resolved once by the table and passed down — 140 rows
   * must not open 140 matchMedia subscriptions. */
  reduced: boolean;
  /** the ONE grid definition, shared with the header (columns session). */
  template: string;
  /** which columns fit — the ladder's prefix, sorted column forced in. */
  visible: VisibleColumns;
}) {
  const registerRef = useRegisterTile(row.id, row.label, [
    row.label,
    row.label.replace(/\s/g, ""),
    row.id,
  ]);
  return (
    <motion.div
      role="row"
      ref={registerRef}
      layout={flip ? "position" : false}
      layoutDependency={orderKey}
      /* THE ONE SIGNATURE MOMENT [OWNER, 2026-08-06]. Every other spring in
         the product was demoted to ENTER in this pass; the reorder keeps
         SPRING because this is the only motion §14 ranks as functional, and
         the only one whose overshoot lands on a position the eye is already
         tracking. */
      transition={instant(SPRING, reduced)}
      initial={enter ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      variants={{
        // exits fade in place (popLayout pops them out of the flow so the
        // survivors slide at the same time); the cause decides whether the
        // fade runs at all — a tab switch snaps.
        /* The ternary is INSIDE instant() rather than around it so the route
           is unconditional: a `transition:` that reaches motion without
           passing through instant() is what the reduced-motion guard counts,
           and a branch that skips it on one arm is exactly the hole. */
        exit: (fade: boolean) => ({
          opacity: 0,
          transition: instant(fade ? EXIT : { duration: 0 }, reduced),
        }),
      }}
      exit="exit"
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPin(row)}
      /* keyboard parity with the pointer affordances: Tab reaches a row and
         previews it (focus = hover), Enter/Space pins it (key = click). The
         global :focus-visible outline is the affordance (accent blue since
         2026-08-06, the way macOS draws every focus ring). */
      tabIndex={0}
      onFocus={() => onHover(row)}
      onBlur={() => onHover(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPin(row);
        }
      }}
      style={{ gridTemplateColumns: template }}
      /* macOS list selection is an INSET ROUNDED BAND, not an edge-to-edge
         tint (macos component pass). The accent-filled row macOS actually
         ships is not portable here twice over: a blue fill would sit under
         red/blue direction numerals and take their legibility, and §9's
         palette cut requires every non-directional state to be ink/grey
         (gated by palette.test.ts). So the SHAPE comes across and the hue
         does not — which is the half that was carrying the meaning anyway. */
      /* HOVER TAKES THE SAME GEOMETRY as selection — an inset rounded band, not
         the edge-to-edge tint it was. The kit ships no hover master for a list
         row (Sidebars has Default / Selected / Disabled only; macOS rows do not
         light up under an idle pointer), but this product's hover is functional
         — it previews the row in the pane — so the cue stays and only its SHAPE
         moves onto the kit's. The fill is unchanged, so no number is invented.
         `isolate` + `-z-10`: a bare pseudo-element paints above the cells and
         would grey out the numbers it is meant to sit behind. */
      /* 선택은 **액센트 채움**이다 [OWNER, 2026-08-07 · 목업]:
         `tbody tr[aria-selected="true"] { background: var(--accent);
          color: var(--on-accent) }`.
         앞 판은 킷 Sidebars/Items/Selected 의 잉크 5.5% 밴드를 썼다. 그건
         **사이드바 행**의 규칙이고 표 행의 규칙이 아니었다 — 목업이 표에는
         꽉 찬 주황을 준다. 고른 것이 화면에서 즉시 보여야 하는 자리다.
         행 안의 방향색은 globals.css 의 `.bw-row-selected` 가 덮는다: 행이
         나르는 내용을 행 자신이 닿을 수 없다(메뉴 행과 같은 이유).
         호버는 잉크 5% 띠. `isolate` + `-z-10` 이 없으면 가상 요소가 셀 위에
         칠해져 숫자를 지운다. */
      className={`relative isolate grid h-12 cursor-pointer items-center border-b border-edge ${
        active
          ? "bw-row-selected bg-accent text-on-accent"
          : "before:pointer-events-none before:absolute before:inset-y-0 before:left-1 before:right-1 before:-z-10 before:rounded-control-lg before:content-[''] hover:before:bg-ink-5"
      }`}
    >
      {/* Measured off the kit (Sidebars - Items - Level 0 - Selected): the
          selection is a rounded rectangle at r=8 filled with ink at 11 percent
          and then set to 50 percent layer opacity, i.e. about 5.5 percent
          effective, running the FULL row height and bleeding out past the
          row's own padding rather than sitting inset from it. The first pass
          here guessed r=6, 8 percent and a 3px vertical inset. */}
      {/* 별도의 선택 밴드는 없어졌다 — 행 자신이 채워진다. 앞 판은 잉크 5.5%
          밴드를 `left-1 right-1` 로 인셋해서 그렸는데, 목업의 표 행은 셀
          경계까지 꽉 찬 주황이다. */}
      <div role="cell" className="relative z-10 pl-3 font-semibold">
        {/* the pin bar moves in to left-2 so it lands ON the selection band's
            left edge rather than floating outside it */}
        {pinned && (
          <span className="absolute left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ink" />
        )}
        {/* quoted vs interpolated (§6): a filled dot = live-quoted node, a
            hollow dot = interpolated tenor (4Y/6Y/7Y/8Y/9Y). A dot, not a
            badge; outrights only, where the distinction exists. */}
        {row.quoted === true && (
          <span
            title="고시 만기"
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ink-2 align-middle"
          />
        )}
        {row.quoted === false && (
          <span
            title="보간 만기"
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full border border-ink-2 align-middle"
          />
        )}
        {row.label}
      </div>
      {/* 현재 is a structural anchor: weight 600, tabular, ink (§5) */}
      <div role="cell" className="pr-3 text-right font-semibold tabular-nums text-ink">
        {levelText(row)}
      </div>
      {visible.bases.map((b) => (
        <div
          role="cell"
          key={b}
          // own-history outlier cue on the live 어제 column only (§B): an
          // outlier day gets a leading-edge rule (not a fill — a fill behind
          // the coloured number can't clear contrast). Number keeps full hue.
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
      {/* 52주 고점/저점/평균 + 위치 track + 세타 — ink, and not sortable
          (RangeCells) */}
      {visible.range52 && (
        <RangeCells row={row} slider={visible.slider} theta={visible.theta} />
      )}
    </motion.div>
  );
}

export function InstrumentTable({
  rows,
  asOf,
  forwards,
  curveBanner,
  filter,
  activeId,
  pinnedId,
  onHover,
  onPin,
  matrixOpen,
  onToggleMatrix,
  policy,
}: {
  rows: Row[];
  /** The dataset's as-of date — the level column's HEADER (pass M). Comes from
   * the summary payload, never from the reader's clock (see `levelHeadText`). */
  asOf?: string;
  forwards?: ForwardsPayload;
  curveBanner?: CurveBanner;
  /** 어느 탭이 켜져 있나. 고르는 것은 셸의 사이드바이고 표는 결과만 받는다
   * — 탭이 표 안의 컨트롤이던 시절의 `onFilter` 는 없어졌다 [2026-08-07]. */
  filter: TabId;
  activeId: string | null;
  pinnedId: string | null;
  onHover: (row: Row | null) => void;
  onPin: (row: Row) => void;
  // matrix mode is lifted to App: while open it takes the full surface width
  // and the preview pane is hidden (§F).
  matrixOpen: boolean;
  onToggleMatrix: () => void;
  /** BOK base rate step, forwarded to the overview's per-column charts. */
  policy?: PolicyStep;
}) {
  /* Resolved ONCE here and passed to every row: `useReducedMotion` subscribes
   * to a media query per call, and the 포워드 tab renders 140 rows. */
  const reduced = useReducedMotion() === true;
  const [sortCol, setSortCol] = useState<BasisKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [startFilter, setStartFilter] = useState<string>("all");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Column ladder measurements (columns session): the table's content width
  // (ResizeObserver) and the real `ch` advance in its font (probe span, re-
  // measured once webfonts settle). Before the first measurement every
  // column renders (Infinity width) — corrected on mount, without animation.
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [tableW, setTableW] = useState(Number.POSITIVE_INFINITY);
  const [chPx, setChPx] = useState(8);
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const measureCh = () => {
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.width = "1ch";
      el.appendChild(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      if (w > 0) setChPx(w);
    };
    measureCh();
    document.fonts?.ready.then(measureCh).catch(() => undefined);
    const ro = new ResizeObserver((entries) => {
      setTableW(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [matrixOpen]);
  // Reorder snapshot (Pass C): captured in the EVENT HANDLER, before the
  // state update, so render stays pure (no ref/DOM reads during render —
  // compiler rule). Holds what caused the current arrangement (only sort and
  // screener animate; a tab / start-filter switch is a view change and
  // snaps), the pre-change row positions, and the viewport window.
  const [flipSnap, setFlipSnap] = useState<{
    cause: "sort" | "other";
    scrollTop: number;
    viewH: number;
    tops: ReadonlyMap<string, number>;
  }>({ cause: "other", scrollTop: 0, viewH: 800, tops: new Map() });

  /* 탭이 바깥에서 바뀐다 [2026-08-07]. 예전에는 이 파일 안의 세그먼티드 버튼이
   * 핸들러에서 `snapReorder("other")` 를 부르고 나서 필터를 바꿨는데, 탭이
   * 사이드바로 나가면서 그 핸들러가 여기 없다.
   *
   * 이펙트가 아니라 **렌더 중 setState** 인 이유: "other" 스냅은 리오더를
   * 애니메이션하지 **않게** 하는 스냅이고, 이펙트는 새 필터의 커밋 뒤에 도는
   * 탓에 탭이 바뀌는 그 한 프레임을 놓친다 — 행들이 한 번 날아다니고 나서
   * 스냅이 걸린다. 이전 값과 다를 때만 부르므로 루프가 되지 않는다(React 가
   * 권하는 "props 로 state 조정" 형태 그대로). DOM 도 ref 도 읽지 않는다:
   * "other" 분기는 상수만 쓴다. */
  const [snapFor, setSnapFor] = useState<TabId>(filter);
  if (snapFor !== filter) {
    setSnapFor(filter);
    setFlipSnap({ cause: "other", scrollTop: 0, viewH: 800, tops: new Map() });
  }

  const isForward = filter === "forward";
  // 전체 is not a list any more — it is the three-column overview (§전체). The
  // tab strip, the freshness banner and the scroll container stay shared; only
  // the body below them changes.
  const isOverview = filter === "all";
  // 연구실: same shell, its own body; row machinery (sort, screeners,
  // dividers) has nothing to work on there and stays hidden.
  const isLab = filter === "lab";
  // 시뮬레이션: the same arrangement as 연구실 — the shell and tab strip stay,
  // the body is the simulation's own stage machine. It owns its scrolling, so
  // it is the one body that must not sit inside the shared scroll container's
  // horizontal padding (see the container's className below).
  const isSim = filter === "sim";
  const divided = DIVIDED.includes(filter as Group);

  const startOptions = useMemo(() => {
    const s: string[] = [];
    for (const r of rows) {
      if (r.group === "forward" && r.startLabel && !s.includes(r.startLabel)) {
        s.push(r.startLabel);
      }
    }
    return s;
  }, [rows]);

  const shown = useMemo(() => {
    let base = filter === "all" ? rows : rows.filter((r) => r.group === filter);
    if (isForward && startFilter !== "all") {
      base = base.filter((r) => r.startLabel === startFilter);
    }
    // ordering lives in rows.ts so it can be tested without a DOM; only a
    // CHANGE column can ever be the sort column (pass L)
    return orderRows(base, sortCol, sortAsc, divided);
  }, [rows, filter, startFilter, sortCol, sortAsc, isForward, divided]);

  /* Interleave the 주요 / 전체 group headings (§3). Was forwards-only; every
   * instrument tab draws it now, with the group's own noun in the heading.
   *
   * Suppressed while a change column is sorted, exactly as before: the reader
   * asked "what moved most" of the whole tab, and a divider that no longer
   * separates two contiguous blocks would be drawing a line through the
   * middle of the answer. Suppressed too when a screener has filtered one
   * side away entirely — a "주요" heading over an empty stretch, or a lone
   * "전체" heading with no 주요 above it, states a split that isn't there. */
  const items = useMemo(() => {
    if (!divided || sortCol) {
      return shown.map((row) => ({ head: null, row }) as const);
    }
    const noun = GROUP_LABEL[filter as Group];
    const out: { head: string | null; row: Row | null }[] = [];
    let phase: "key" | "rest" | null = null;
    for (const row of shown) {
      const p = row.key ? "key" : "rest";
      if (p !== phase) {
        // only head a block when the OTHER one also has rows
        if (shown.some((r) => r.key !== row.key)) {
          out.push({ head: `${p === "key" ? "주요" : "전체"} ${noun}`, row: null });
        }
        phase = p;
      }
      out.push({ head: null, row });
    }
    return out;
  }, [shown, divided, sortCol, filter]);

  /** h-12. Estimates a row's destination, and sizes the snapshot window.
   * Declared above `snapReorder` because that handler reads it. */
  const ROW_H = 48;

  /** Event-time snapshot: old row tops (tile registry) + viewport window.
   *
   * MEASURES A WINDOW, NOT THE WHOLE TAB (pass B). This used to loop over
   * every row in `shown` — 140 `offsetTop` reads on the 포워드 tab, on the
   * main thread, before the state update — and the viewport cull ran
   * afterwards, so it never reduced this cost. It was the one step in the
   * reorder path that was O(all rows) rather than O(animated rows), and
   * FLIP_MAX_ROWS = 400 was three times too loose to bound it usefully.
   *
   * `flipWindow` picks the ≤48 rows around the viewport, which is also the
   * only set `rowShouldFlip` can admit. Rows outside it get no snapshot
   * entry — and a missing entry means `oldTop` is null, which
   * `rowShouldFlip` treats as "animate" by design (never freeze a row on a
   * missing measurement). That default is wrong here, so the window is
   * applied to the FLIP decision too (see `flip=` below), not just to the
   * measuring. */
  const snapReorder = (cause: "sort" | "other") => {
    if (cause === "other") {
      setFlipSnap({ cause, scrollTop: 0, viewH: 800, tops: new Map() });
      return;
    }
    const vp = scrollRef.current;
    const scrollTop = vp?.scrollTop ?? 0;
    const viewH = vp?.clientHeight ?? 800;
    const { from, to } = flipWindow(shown.length, scrollTop, viewH, ROW_H);
    const tops = new Map<string, number>();
    for (let i = from; i < to; i++) {
      const r = shown[i];
      if (!r) continue;
      const el = getTile(r.id)?.el;
      if (el) tops.set(r.id, el.offsetTop);
    }
    setFlipSnap({ cause, scrollTop, viewH, tops });
  };

  const clickSort = (b: BasisKey) => {
    snapReorder("sort");
    if (sortCol !== b) {
      setSortCol(b);
      setSortAsc(false);
    } else if (!sortAsc) {
      setSortAsc(true);
    } else {
      setSortCol(null); // third click → back to instrument order
    }
  };

  // Reorder motion (Pass C): FLIP rows to their new positions on sort and on
  // screener filtering. Transform-only (layout="position"); measured only
  // when orderKey changes; culled to the viewport's neighbourhood AND capped
  // at FLIP_MAX_ANIMATED rows (pass B); instant above FLIP_MAX_ROWS and under
  // prefers-reduced-motion (routed through instant(), not left to MotionConfig).
  const orderKey = `${sortCol ?? ""}|${sortAsc}`;
  const flipOn = reorderAnimates(flipSnap.cause, shown.length);
  /* The destination window, computed against the SAME arithmetic the snapshot
   * used, so "was measured" and "may animate" cannot disagree. Without this a
   * row outside the snapshot window has a null `oldTop`, and rowShouldFlip
   * reads null as "animate" by design — the un-measured tail of a 140-row tab
   * would all animate from nowhere. */
  const flipDest = flipWindow(
    items.length,
    flipSnap.scrollTop,
    flipSnap.viewH,
    ROW_H,
  );

  // The column ladder (columns session): which columns fit the measured
  // width, sorted column forced in; header and body share the template.
  const widthCols = useMemo(
    () => visibleColumns(tableW, chPx, sortCol),
    [tableW, chPx, sortCol],
  );
  /* …and whether 세타 applies to what this tab lists (see `withThetaData`).
   *
   * Read off the TAB'S GROUP, not off `rows` (which is every instrument the
   * app knows — the 스프레드 tab would then keep a column of em dashes because
   * some outright elsewhere has a theta) and not off `shown` (the screener
   * chips and the forward start filter both narrow that, and a column that
   * appears and disappears as chips are toggled is a layout that flinches).
   * Group membership is the stable fact, and it is the one the rule is about.
   *
   * `hiddenNames` below stays on `widthCols`: that note names what the WIDTH
   * dropped, and a column that does not apply to spreads was never hidden. */
  const thetaApplies = useMemo(
    () =>
      (filter === "all" ? rows : rows.filter((r) => r.group === filter)).some(
        (r) => r.theta,
      ),
    [rows, filter],
  );
  const visible = useMemo(
    () => withThetaData(widthCols, thetaApplies),
    [widthCols, thetaApplies],
  );
  const template = gridTemplate(visible);
  const hiddenNames = [
    ...BASIS_ORDER.filter((b) => !visible.bases.includes(b)).map(
      (b) => BASIS_HEAD[b],
    ),
    ...(widthCols.range52 ? [] : [RANGE_COL_NAME]),
    ...(widthCols.slider ? [] : [SLIDER_COL_NAME]),
    ...(widthCols.theta ? [] : [THETA_COL_NAME]),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 고정 머리 — 스크리너 칩과 포워드 컨트롤이 표면 위쪽에 남는다 (§shell).
          탭 스트립은 여기 있었고 이제 셸의 사이드바다 [2026-08-07]. */}
      <div className={`shrink-0 pt-4 ${PAGE_X}`}>
      {/* curve-level extreme, stated once (§I) — a fact about the whole curve,
          not any row, so the per-row percentile is suppressed on outrights. */}
      {curveBanner?.kind && (
        <p className="mt-2 text-[12px] text-up">
          {curveBanner.kind === "curve_high"
            ? "커브 전 구간이 52주 고점권이에요"
            : "커브 전 구간이 52주 저점권이에요"}
        </p>
      )}

      {/* 스크리너 칩(오늘 많이 움직인 것 · 52주 고점권 · 저점권 · 되돌림)은
          은퇴했다 [OWNER, 2026-08-14 — "스크리너 칩은 이제 스왑에서도 없애기"].
          표 자체가 정렬과 52주·위치·세타 열로 같은 질문에 답하고 있어서, 칩은
          같은 답을 두 번 주는 두 번째 문법이었다. `ui/screener.ts` 의 프리셋
          정의는 남겨 둔다 — 연구실이 그 어휘를 쓴다. */}

      {/* forward-tab secondary controls (§3): narrow by start point, or flip
          to the 21×8 matrix */}
      {isForward && (
        <div className="mt-2 flex items-center gap-3 text-[13px]">
          <select
            value={startFilter}
            onChange={(e) => {
              snapReorder("other"); // view change — reorder snaps
              setStartFilter(e.target.value);
            }}
            className="rounded-control bg-page px-2 py-1 opacity-70"
          >
            <option value="all">전체 시작</option>
            {startOptions.map((s) => (
              <option key={s} value={s}>
                {s} 시작
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onToggleMatrix}
            className="opacity-60 hover:opacity-100"
          >
            {matrixOpen ? "▾ 목록으로" : "▸ 표로 보기"}
          </button>
        </div>
      )}
      </div>

      {/* scroll: the table body scrolls under the fixed header (§shell).
          scrollbar-gutter keeps the usable width constant whether or not the
          scrollbar is present (§ Pass A) — without it the grid would shift on
          every filter that crosses the overflow boundary. overflow-x-auto +
          the last column's track floor (carry session, Pass D; three 현재
          widths since pass L): a viewport narrower than the columns scrolls
          horizontally instead of clipping content flush against the card
          edge; pb-8 keeps the last row off the card's bottom edge and clear
          of anything floating there. */}
      <Boxed on={!isOverview && !isSim && !isLab}>
      <div
        ref={scrollRef}
        /* `flex flex-col` only for the overview: it lets the three-column grid
           take the container's CONTENT height with `flex-1`, so the charts can
           sit on the floor. `min-h-full` was the obvious alternative and is
           wrong here — a percentage min-height resolves against the content
           box while `pt-3 pb-8` sits outside it, so the grid would overshoot
           by 44px and put a permanent scrollbar on a page that fits. */
        /* The overview drops BOTH the gutter and the padding.
           `scrollbar-gutter: stable` is there so the TABLE's grid width does
           not shift when a filter crosses the overflow boundary — the overview
           is a fixed set with no filters and nothing to scroll, so the 16px it
           reserves is blank space that shows up as a wider RIGHT margin than
           left, which is exactly the symmetry `justify-evenly` exists to
           produce. `px-5` is dropped for the same reason: it sits outside the
           content box the gaps are computed in, so it would add itself to both
           outer margins. */
        /* 행 목록일 때는 **그룹박스 안**이라 좌우 거터도 아래 여백도 박스가
           갖는다 — 여기서 또 주면 테두리 안쪽에 빈 띠가 두 겹 생긴다. */
        /* 오버뷰가 거터를 **되찾았다** [2026-08-07]. `justify-evenly` + max-content
           일 때는 남는 폭을 네 등분해서 바깥 여백을 스스로 만들었고, 그래서
           컨테이너 패딩을 주면 그 여백에 더해져 좌우가 안쪽 간격보다 넓어졌다.
           1fr 로 바꾸면서 나눠 줄 남는 폭이 없어졌으므로 바깥 여백은 이제
           컨테이너가 진다 — 안 주면 박스가 사이드바와 창 가장자리에 붙는다. */
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-auto ${
          isSim
            ? "flex flex-col pb-8 pt-3"
            : isOverview
              ? `flex flex-col pb-8 pt-3 ${PAGE_X}`
              : isLab
                ? `${PAGE_X} pb-8 pt-3`
                : "px-3 pb-3 pt-1 [scrollbar-gutter:stable]"
        }`}
      >
        {isSim ? (
          <SimulationFlow />
        ) : isLab ? (
          <YieldSurface policy={policy} />
        ) : isOverview ? (
          <OverviewColumns rows={rows} asOf={asOf} policy={policy} />
        ) : isForward && matrixOpen && forwards ? (
          // wrap the 주요 포워드 block below the matrix rather than clipping it
          // off the right edge (§F); the matrix scrolls horizontally itself.
          <div>
            <div className="flex flex-wrap items-start gap-6">
              <ForwardMatrix payload={forwards} />
              <KeyForwardBlock payload={forwards} />
            </div>
            {/* what the 168 tinted cells mean (§E2) — same key as the heatmap */}
            <TintLegend className="mt-4" />
          </div>
        ) : (
          <div
            ref={tableRef}
            role="table"
            className="w-full text-[13px]"
            onMouseLeave={() => onHover(null)}
          >
            {/* THE column grid (§ Pass A): one template, format-derived and
                frozen (columns.ts), shared by the header row and every body
                row — widths never depend on today's values or the open tab.
                When width runs out, columns DROP in ladder order rather than
                shrink (columns session); header and body derive from the same
                `visible` set so they cannot disagree. Muting is a TEXT-colour
                alpha (text-ink-2), never element opacity — opacity on the
                row would sink the sticky header background and let rows bleed
                through (§G). A hairline (not a shadow) marks the boundary. */}
            <div
              role="row"
              style={{ gridTemplateColumns: template }}
              className="sticky top-0 z-10 grid items-end border-b border-edge bg-tile pb-2 text-left text-ink-2"
            >
              <div role="columnheader" className="pl-3">
                종목
              </div>
              {/* The level column's header is the DATA'S DATE, not the word
                  현재 (pass M): these are closes, and on a day the file has
                  not been rebuilt "현재" would assert a currency the numbers do
                  not have. `tabular-nums` so the ten digits sit on the same
                  advance the column is sized for (WIDEST.levelHead). */}
              <div
                role="columnheader"
                className="whitespace-nowrap pr-3 text-right tabular-nums"
                title={levelHeadTitle(asOf)}
              >
                {levelHeadText(asOf)}
              </div>
              {visible.bases.map((b) => (
                <div key={b} role="columnheader" className="pr-3 text-right">
                  <button
                    type="button"
                    onClick={() => clickSort(b)}
                    className="hover:text-ink"
                  >
                    {BASIS_HEAD[b]}
                    {sortCol === b ? (sortAsc ? " ↑" : " ↓") : ""}
                  </button>
                </div>
              ))}
              {visible.range52 ? (
                // when only the tail rungs (위치, 세타) are dropped, the
                // hidden-column note rides in the range header's filler track
                // — the one slot that still exists in that state. Keyed off
                // `hidden` rather than off one rung's flag: with two tail
                // rungs, testing `slider` alone left 세타 dropping silently,
                // and a column that vanishes without saying so is the exact
                // condition this note exists to prevent.
                <RangeHeader
                  slider={visible.slider}
                  theta={visible.theta}
                  note={visible.hidden ? `${visible.hidden}열 숨김` : undefined}
                  noteTitle={visible.hidden ? hiddenNames.join(" · ") : undefined}
                />
              ) : (
                // what is hidden, stated (Pass B) — a statement, not a
                // control: the reader must not wonder whether a column is
                // missing or merely empty. Lives in the empty filler track.
                <div
                  className="whitespace-nowrap pr-1 text-right text-[11px] opacity-45"
                  title={hiddenNames.join(" · ")}
                >
                  {visible.hidden}열 숨김
                </div>
              )}
            </div>
            {/* relative: popLayout pops exiting rows out of the flow so they
                fade in place while the survivors slide (Pass C). */}
            <div role="rowgroup" className="relative">
              <AnimatePresence
                initial={false}
                mode="popLayout"
                custom={false}
              >
                {items.map((it, i) =>
                  it.row ? (
                    <TableRow
                      key={it.row.id}
                      row={it.row}
                      active={it.row.id === activeId}
                      pinned={it.row.id === pinnedId}
                      onHover={onHover}
                      onPin={onPin}
                      orderKey={orderKey}
                      flip={
                        flipOn &&
                        i >= flipDest.from &&
                        i < flipDest.to &&
                        rowShouldFlip(
                          flipSnap.tops.get(it.row.id) ?? null,
                          i * ROW_H,
                          flipSnap.scrollTop,
                          flipSnap.viewH,
                        )
                      }
                      enter={false}
                      reduced={reduced}
                      template={template}
                      visible={visible}
                    />
                  ) : (
                    <div
                      role="row"
                      key={`head-${i}`}
                      className="border-t-2 border-t-edge pb-1 pl-3 pt-4 text-[12px] font-semibold opacity-45"
                    >
                      {it.head}
                    </div>
                  ),
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
      </Boxed>
    </div>
  );
}

/** 행 목록일 때만 그룹박스로 감싼다 [OWNER, 2026-08-07].
 *
 * sauron.html 의 `.split` 왼쪽이 그것이다 — **헤더 없는** 그룹박스 안에
 * `.tablewrap` 이 들어간다. 헤더가 없는 이유는 표의 `thead` 가 이미 그 일을
 * 하기 때문이고, 붙이면 제목 줄이 둘이 된다.
 *
 * 전체(오버뷰)·시뮬레이션·연구실은 감싸지 않는다: 오버뷰는 자기 열 셋을 각각
 * 박스로 두고(OverviewColumns), 나머지 둘은 자기 화면을 그린다. 여기서 한 번
 * 더 감싸면 박스 안의 박스가 된다. */
function Boxed({
  on,
  children,
}: {
  on: boolean;
  children: React.ReactNode;
}) {
  if (!on) return <>{children}</>;
  return (
    <div className={`min-h-0 flex-1 pb-3 pt-3 ${PAGE_X}`}>
      <GroupBox className="h-full">{children}</GroupBox>
    </div>
  );
}
