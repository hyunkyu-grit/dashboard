"use client";

/* Sauron — list-first shell (DESIGN §2). One screen, two panes: the instrument
 * table on the left, a sticky preview on the right that responds to it. URL
 * `?tile=…` opens the enlarged view. No navigation, no basis selector. */

import { useQuery } from "@tanstack/react-query";
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
} from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EventCluster, PolicyStep } from "@/lib/api";
import {
  fetchForwards,
  fetchVolatility,
  fetchWallSummary,
} from "@/lib/api";
import { levelHeadText } from "@/lib/format";
import { syncUiFromDom, useUiStore } from "@/state/ui";
import { CommandBar } from "@/wall/CommandBar";
import { getTile } from "@/wall/tileRegistry";

import { ChangeLog } from "./ChangeLog";
import { asChartType, CHART_TYPES, type ChartType } from "./chartType";

import { mintBacktestKey } from "./backtestMemory";
import { BottomStrip, STRIP_H, useStripCollapsed } from "./BottomStrip";
import { CurveView } from "./CurveView";
import { ErrorState, LoadingState } from "./DataState";
import { EnlargedView } from "./EnlargedView";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  GroupBox,
  GroupBoxGap,
  GroupBoxNote,
  GroupBoxTitle,
} from "./GroupBox";
import { classify } from "./gloss";
import { diagramSpec } from "./payReceiveModel";
import { BacktestWindow, BOOKABLE_GROUPS } from "./BacktestWindow";
import { InstrumentTable } from "./InstrumentTable";
import { IntroCurtain } from "./IntroCurtain";
import {
  DEFAULT_GROUP,
  sectionOf,
  tabForSection,
  type SectionId,
  type TabId,
} from "./tabs";
import { Z_MODAL, Z_TOOLBAR } from "./layers";
import {
  EASE_OUT,
  ENTER,
  EXIT,
  instant,
  MOTION,
  scrollIntoViewSafely,
} from "./motion";
import { PreviewPane } from "./PreviewPane";
import { Sidebar } from "./Sidebar";
import { clearBtPatch, mergeQuery } from "./urlState";
import { PAGE_R, PAGE_X, PAGE_X_PX } from "./pageGutter";
import { buildRows, type Group, type Row } from "./rows";
import { useIsWide } from "./useIsWide";
import { useMeasure } from "./useMeasure";

// Table pane sizes to its columns (§ layout); the preview takes the rest with a
// floor. On an ultrawide the chart grows and the table does not stretch sparse.
const TABLE_W = 880;

/** Resolve a URL target (`series:<id>` or a row id) to its row — the one
 * grammar `tile` and `bti` share. Null until the row set can answer. */
function rowForTarget(rows: Row[], target: string | null): Row | null {
  if (!target) return null;
  if (target.startsWith("series:")) {
    const sid = target.slice("series:".length);
    return rows.find((r) => r.seriesId === sid) ?? null;
  }
  return rows.find((r) => r.id === target) ?? null;
}
/* The preview pane's horizontal padding, subtracted from its measured width to
 * size the chart: the page gutter on the window side, and the DIVIDER INSET on
 * the interior side.
 *
 * The inset went 20 → 32 in the geometry pass (2026-08-05). A hairline with
 * content pressed against it reads as a table rule rather than a boundary
 * between two regions, and this is the shell's only region-to-region divider —
 * the table side already stands 80px off it (PAGE_X), so 20px on the preview
 * side was the asymmetric half. Still deliberately smaller than PAGE_X: this
 * edge is interior, and an interior edge that matched the window gutter would
 * read as a second page margin.
 *
 * Keep in step with the `pl-8` literal on the pane — Tailwind reads source
 * text, so this number and that class cannot be derived from each other. */
const PANE_DIVIDER_INSET = 32;
const PANE_PAD = PAGE_X_PX + PANE_DIVIDER_INSET;

/** Single-column preview: a bottom sheet over the full-width table (§ layout).
 * Opened by a row click (pin), dismissed by Esc / backdrop / downward drag. */
function PreviewSheet({
  row,
  onOpen,
  onEnlarge,
  onClose,
  policy,
}: {
  row: Row;
  onOpen: (row: Row) => void;
  onEnlarge: (row: Row) => void;
  onClose: () => void;
  policy?: PolicyStep;
}) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  /* The sheet no longer springs [OWNER, 2026-08-06 — exactly one surface may
   * overshoot, and it is the row reorder]. It rises on the shared ease-out and
   * leaves on the shorter exit; the drag-dismiss still follows the pointer,
   * which is direct manipulation rather than an animation. */
  const reduced = useReducedMotion() === true;
  return (
    <motion.div
      className={`fixed inset-0 ${Z_MODAL} flex items-end justify-center bg-page/70`}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: instant(EXIT, reduced) }}
      transition={instant(ENTER, reduced)}
    >
      <motion.div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-sheet bg-popover p-5"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%", transition: instant(EXIT, reduced) }}
        transition={instant(ENTER, reduced)}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) onClose();
        }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-edge" />
        <div ref={ref}>
          {w > 0 && (
            <PreviewPane
              row={row}
              onOpen={onOpen}
              onEnlarge={onEnlarge}
              width={w}
              // the sheet is capped at 85vh; the chart takes a readable slice of it
              height={Math.round(window.innerHeight * 0.5)}
              policy={policy}
            />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}


/** 선 · 주봉 · 월봉 — 툴바의 세그먼티드 컨트롤 [OWNER, 2026-08-13 "모드
 * 설정하면 원하면 캔들차트로 보여줄 수 있게"].
 *
 * 킷 문법 그대로다(Segmented Control/Active, On): 고른 칸은 **액센트 채움 +
 * on-accent 라벨**, 안 고른 칸은 요소 불투명도가 아니라 잉크 층위(§G). 팝업의
 * 같은 컨트롤과 같은 배열(`CHART_TYPES`)을 읽으므로 한쪽만 항목이 늘 수 없다.
 *
 * 툴바 캡슐 하나를 통째로 쓰고 변화로그·테마 그룹 옆에 선다 — 성질이 다른
 * 컨트롤을 한 캡슐에 넣으면 구분선이 무엇을 가르는지가 사라진다. */
function ChartTypeBar({
  chartType,
  onChartType,
}: {
  chartType: ChartType;
  onChartType: (t: ChartType) => void;
}) {
  return (
    <div className="flex h-6 items-center overflow-hidden rounded-full bg-ink/[0.08]">
      {CHART_TYPES.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChartType(c.id)}
          aria-pressed={c.id === chartType}
          title={`${c.label} 차트`}
          className={
            c.id === chartType
              ? "flex h-6 items-center bg-accent px-3 text-[14px] font-medium text-on-accent"
              : "flex h-6 items-center px-3 text-[14px] font-medium text-ink-1 transition-colors hover:text-ink"
          }
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function Header({
  events,
  onFocus,
  showChartType,
  sidebarOpen,
  onSidebarOpen,
}: {
  events: EventCluster[];
  onFocus: (id: string) => void;
  /** 차트가 있는 섹션인가 — 차트 종류 컨트롤을 띄울지 정한다. */
  showChartType: boolean;
  sidebarOpen: boolean;
  onSidebarOpen: (v: boolean) => void;
}) {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const chartType = useUiStore((s) => s.chartType);
  const setChartType = useUiStore((s) => s.setChartType);
  return (
    <header
      /* 툴바 — 킷 Titlebars and Toolbars/Medium, Liquid Glass 위에 [2026-08-07].
         높이 52 = 컨트롤 24 + 상하 14. 킷은 바 자체의 높이를 주지 않는다 (§6.4).

         **셸 위에 떠 있다.** 격자 행을 차지하지 않고 절대 배치로 사이드바와
         본문 위를 지나간다 — HIG Materials 가 유리를 "floats above the content
         layer" 라고 쓰는 그대로다.

         HIG Toolbars 의 세 영역:
           leading   사이드바 토글
           center    (비어 있다)
           trailing  변화 로그 · 테마
         Main/Backtest/Simulation/Lab 은 **사이드바에 있다** [OWNER, 2026-08-07 —
         "상단에 저거 넣지마"]. 한 번 여기 세그먼티드로 올렸다가 되돌렸다:
         탐색이 두 곳에 나뉘면 무엇이 무엇의 하위인지가 사라진다.
         **창 신호등은 여기 없다** [OWNER, 2026-08-07 — "기본으로는 신호등 넣지
         마"]. 이건 브라우저 안의 화면이라 창을 소유하지 않는다. 신호등은 진짜로
         닫고 옮길 수 있는 것, 즉 떠 있는 창(백테스트·크게 보기)에만 붙는다.
         **앱 이름도 없다** [OWNER — "sauron은 예명이야"]. 그래서 HIG 의
         "Don't title windows with your app name" 과 부딪힐 일 자체가 없어졌다.
         데이터 신선도는 최하단 지표 바로 내려갔다 [OWNER].

         HIG Toolbars: "Reduce the use of toolbar backgrounds and tinted
         controls" — 불투명 띠 대신 유리를 두고, 아래 경계는 헤어라인 하나다. */
      className={`absolute inset-x-0 top-0 ${Z_TOOLBAR} flex h-toolbar items-center gap-3 border-b border-glass-edge bg-glass-bar backdrop-blur-[40px] backdrop-saturate-[1.8] ${PAGE_X}`}
    >
      {/* HIG Toolbars: "Elements that let people … show or hide a sidebar
          appear at the far leading edge." 킷 툴바 버튼은 24×24 무테이고,
          호버·눌림에서만 면이 생긴다. */}
      <button
        type="button"
        onClick={() => onSidebarOpen(!sidebarOpen)}
        aria-pressed={sidebarOpen}
        aria-label={sidebarOpen ? "사이드바 숨기기" : "사이드바 보이기"}
        title={sidebarOpen ? "사이드바 숨기기" : "사이드바 보이기"}
        className="flex size-6 shrink-0 items-center justify-center rounded-control text-[14px] text-ink-1 transition-colors hover:bg-ink-6 active:bg-ink-4"
      >
        ◧
      </button>
      <span className="flex-1" />
      {/* 차트 종류 — 차트가 있는 섹션에서만 [OWNER, 2026-08-13].
          Simulation 과 Lab 에는 시계열 차트가 없다. 늘 띄워 두면 아무것도 안
          하는 컨트롤이 되고, HIG 가 툴바에서 가장 싫어하는 것이 그것이다.
          테마와 다른 점이 여기다: 테마는 어느 화면에서나 화면을 바꾼다. */}
      {showChartType && (
        <ChartTypeBar chartType={chartType} onChartType={setChartType} />
      )}
      {/* TOOLBAR BUTTON GROUP, observed in the kit (Titlebars and Toolbars -
          Medium - Buttons, sizes 1 through 6): adjacent toolbar controls do not
          sit as separate pills. They share ONE 24px capsule and are divided by
          a hairline. These two were free-standing buttons before.
          The group owns the shell — fill, radius, height — and each child is a
          bare slot, so the divider lands between them rather than between two
          rounded ends. */}
      <div className="flex h-6 items-center overflow-hidden rounded-full bg-ink/[0.08]">
        <ChangeLog events={events} onFocus={onFocus} />
        <span aria-hidden className="h-3.5 w-px shrink-0 bg-edge" />
        <button
        type="button"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          /* A bare slot. The group above owns the fill (ink 8 percent, the kit's
             Bordered value) and the capsule; putting either here again would
             draw a pill inside a pill. */
          className="flex h-6 items-center px-3 text-[14px] font-medium text-ink-1 transition-colors hover:text-ink"
        >
          {theme === "dark" ? "밝게" : "어둡게"}
        </button>
      </div>
    </header>
  );
}

export function App() {
  const router = useRouter();
  const params = useSearchParams();
  const tileParam = params.get("tile");

  const {
    data: summary,
    isError,
    isFetching: summaryFetching,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["wall-summary"],
    queryFn: fetchWallSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: forwards, isPending: forwardsPending } = useQuery({
    queryKey: ["forwards"],
    queryFn: fetchForwards,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: volatility, isPending: volatilityPending } = useQuery({
    queryKey: ["volatility"],
    queryFn: fetchVolatility,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  /* The row set is only COMPLETE once all three payloads have settled — the
   * summary alone contributes outrights and spreads, forwards and volatility
   * contribute the rest. Anything that asks "is this id unknown?" has to wait
   * for this, not merely for the first rows to appear. Settled, not
   * successful: if one payload fails outright, its rows are never coming and
   * waiting forever would be worse than answering with what arrived. */
  const rowsComplete = !forwardsPending && !volatilityPending && !!summary;

  const [hovered, setHovered] = useState<Row | null>(null);
  const [pinned, setPinned] = useState<Row | null>(null);
  const [stripCollapsed, setStripCollapsed] = useStripCollapsed();
  const [tab, setTab] = useState<TabId>("all");
  const [matrixOpenRaw, setMatrixOpenRaw] = useState(false);
  const active = hovered ?? pinned;
  // the 표로 보기 matrix is a full-width MODE, only on the forward tab (§F)
  const matrixOpen = matrixOpenRaw && tab === "forward";
  /* 전체 is the three-column overview and takes the full surface (§전체): it
   * carries its own chart per column, so the shared preview pane beside it
   * would be a fourth chart answering a question nobody asked, in space the
   * three columns need. Same mechanism as the matrix mode — one flag that
   * both widens the left pane and hides the right one, so the two can never
   * disagree about who owns the width.
   *
   * 시뮬레이션 joins them (2026-08-07) for the stronger version of the same
   * reason: the preview pane previews the HOVERED ROW, and the simulation has
   * no rows. Left beside it, the pane would hold whatever row was hovered on
   * the tab before — a chart of an instrument the reader is no longer looking
   * at, next to a scenario that has nothing to do with it. */
  const fullWidth = matrixOpen || tab === "all" || tab === "sim";

  // ~120ms hover delay so crossing the table does not strobe the preview (§2).
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handleHover = useCallback((row: Row | null) => {
    clearTimeout(hoverTimer.current);
    if (row) hoverTimer.current = setTimeout(() => setHovered(row), 120);
    else setHovered(null);
  }, []);

  const rows = useMemo(
    () => (summary ? buildRows(summary, forwards, volatility) : []),
    [summary, forwards, volatility],
  );

  // Clear the pin on a tab change (§I): a pinned row from another tab shown
  // silently in the preview is the defect; dropping it is the simplest cure
  // (recorded under DESIGN ## Provisional).
  const onTab = useCallback((t: TabId) => {
    setTab(t);
    setPinned(null);
    setHovered(null);
  }, []);

  /* 두 층의 탐색 [OWNER, 2026-08-07 · 2차]. 툴바가 섹션을, 사이드바가 종목군을
   * 고른다. 상태는 여전히 `tab` 하나이고 섹션은 거기서 유도된다 — 둘로 쪼개면
   * "Backtest 인데 종목군이 없음" 같은, 화면에 없는 조합이 표현 가능해진다.
   *
   * `lastGroup` 만 따로 든다. Backtest 를 다시 누를 때 늘 아웃라이트로
   * 되돌리면, 스프레드를 보다 Main 을 한 번 들른 사람이 자리를 잃는다. */
  const section = sectionOf(tab);
  const [lastGroup, setLastGroup] = useState<Group>(DEFAULT_GROUP);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [groupsOpen, setGroupsOpen] = useState(true);


  const onSection = useCallback(
    (s: SectionId) => onTab(tabForSection(s, lastGroup)),
    [onTab, lastGroup],
  );
  const onGroup = useCallback(
    (g: Group) => {
      setLastGroup(g);
      onTab(g);
    },
    [onTab],
  );

  const wide = useIsWide();

  useEffect(() => {
    syncUiFromDom();
  }, []);

  // Esc unpins — but only as the LAST layer: the enlarged view and the
  // backtest window each close themselves on Esc, and one press must peel
  // one layer, not the popup and the pin together.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !tileParam && !params.get("bt"))
        setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tileParam, params]);

  /* THE BACKTEST WINDOW IS PARALLEL, NOT A PAGE (backtest-window session).
   * Its namespace — `bt` (instance nonce, pass Q), `bti` (seed instrument),
   * `btf` (the date under the cursor when the chart was clicked [OWNER:
   * "커서가 가는 곳에서 누르면 그 날부터 스타트해야지"]) — rides the URL so a
   * shared link restores the window, but open/close REPLACE the current
   * history entry rather than pushing one: a floating window is not a place
   * you navigate to, and back/forward should walk tab/tile state UNDER it
   * without ever closing it or wiping its inputs. Every write goes through
   * `mergeQuery`, so the `tile` namespace is carried untouched — and vice
   * versa. This is the structural fix for the back-wipes-the-popup class;
   * pass Q's nonce + session memory still carry the contents. Opening while
   * a window is already open REPLACES it (one instance — presence IS the
   * `bt` param); the new nonce seeds fresh, the position stays where the
   * reader put it (floatingWindow.ts). */
  /* 오버레이 네임스페이스의 URL 쓰기는 **얕은 히스토리**다 [OWNER 증상,
   * 2026-08-12 — "백테스트 또 안 닫히는데"]. `router.replace` 는 프로덕션
   * (정적 프리렌더) 빌드에서 클릭 핸들러 발 같은-페이지 쿼리 트랜지션이
   * 영영 커밋되지 않는 일이 있다 — 창이 안 닫힐 뿐 아니라 그 뒤로는 라우터
   * 전체가 막힌다(이후의 직접 replace 까지 무시됨; CDP 실측 — 히스토리에
   * 옛 URL 재동기화만 남고 RSC 요청은 아예 없음. dev 는 정상, 같은 코드).
   * 창/오버레이는 페이지 이동이 아니므로 Next 가 14.1부터 공식 지원하는
   * `window.history.replaceState/pushState` 얕은 쓰기로 간다:
   * useSearchParams 에 그대로 반영되고(실측: 창이 닫힌다) 트랜지션·RSC
   * 왕복이 없어서 막힐 것도 없다. 서버가 읽지 않는 쿼리 전용 상태에만 —
   * 이 파일의 bt·tile·type·missing 이 정확히 그것이다. */
  const shallowReplace = useCallback((qs: string) => {
    window.history.replaceState(null, "", `/${qs}`);
  }, []);
  const openBacktest = useCallback(
    (row: Row, from?: string) => {
      const target = row.seriesId ? `series:${row.seriesId}` : row.id;
      shallowReplace(
        mergeQuery(params, {
          bt: mintBacktestKey(),
          bti: target,
          btf: from ?? null,
        }),
      );
    },
    [shallowReplace, params],
  );
  const closeBacktest = useCallback(() => {
    shallowReplace(mergeQuery(params, clearBtPatch()));
  }, [shallowReplace, params]);

  /* The ENLARGED VIEW (?tile) is a page-like modal again — the backtest no
   * longer squats on its slot. Open PUSHES (a view you navigate into), so
   * CLOSE IS BACK (pass Q's rule, unchanged): one step, one meaning, no
   * popup residue in the stack. A cold link replaces instead of backing out
   * of the site. `type` (선/주봉/월봉) rides beside it; both writes preserve
   * the bt namespace through `mergeQuery`, so navigating the enlarged view
   * never touches the backtest window. */
  const pushedTile = useRef(false);
  const openEnlarged = useCallback(
    (row: Row) => {
      const target = row.seriesId ? `series:${row.seriesId}` : row.id;
      pushedTile.current = true;
      // 얕은 push — 항목은 쌓되(닫기 = back) 트랜지션은 타지 않는다(위 주석).
      window.history.pushState(null, "", `/${mergeQuery(params, { tile: target })}`);
    },
    [params],
  );
  const closeEnlarged = useCallback(() => {
    if (pushedTile.current) {
      pushedTile.current = false;
      router.back();
    } else {
      shallowReplace(mergeQuery(params, { tile: null, type: null }));
    }
  }, [router, shallowReplace, params]);

  /* 차트 종류: **스토어가 정본**이다 [OWNER, 2026-08-13].
   *
   * 예전에는 `?type=` 이 정본이었고 팝업만 그걸 읽었다. 이제 이것은 한 화면의
   * 성질이 아니라 읽는 사람의 환경설정이고 — 화면의 모든 차트가 따라간다 —
   * 환경설정은 URL 에 있으면 안 된다: 누가 링크를 보내면 받는 사람의 설정이
   * 같이 바뀐다.
   *
   * `?type=` 은 **한 번 읽고 만다**. 예전 링크가 그 종류로 열리도록 마운트에서
   * 스토어에 심고, 그 뒤로는 아무도 쓰지 않는다. 심는 것이 효과인 것은 URL 이
   * 렌더 밖의 입력이기 때문이고, `params` 를 의존성에 넣지 않는 것은 이것이
   * **씨앗**이지 동기화가 아니기 때문이다 — 뒤로 가기로 옛 `?type=` 이 돌아와도
   * 방금 고른 종류를 되돌리지 않는다. */
  const setChartType = useUiStore((s) => s.setChartType);
  const seededType = useRef(false);
  useEffect(() => {
    if (seededType.current) return;
    seededType.current = true;
    const seed = asChartType(params.get("type"));
    if (seed) setChartType(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 씨앗은 한 번뿐
  }, [setChartType]);

  /* An unknown `?tile=` used to render the ordinary screen with the bogus
   * parameter still in the URL, no sheet and no message (Pass A finding).
   * Now the id is cleared and named. The notice is derived from the URL
   * rather than held in state — a `setState` inside the clearing effect is
   * what the compiler lint rejects, and the URL is the honest home for it. */
  const missingTile = params.get("missing");

  const enlargedRow = useMemo(
    () => rowForTarget(rows, tileParam),
    [tileParam, rows],
  );

  /* The backtest window: presence IS the `bt` nonce; `bti` names its seed
   * instrument in the same target grammar `tile` uses. */
  const btKey = params.get("bt");
  const btiParam = params.get("bti");
  const btRow = useMemo(
    () => (btKey ? rowForTarget(rows, btiParam) : null),
    [btKey, btiParam, rows],
  );

  /* A `bt` whose seed instrument names nothing (a stale link) is cleared and
   * said — the tile-missing rule, applied to the other namespace. Waits for
   * the COMPLETE row set for the same reason. */
  useEffect(() => {
    if (!btKey || !rowsComplete || btRow) return;
    shallowReplace(
      mergeQuery(params, {
        ...clearBtPatch(),
        missing: btiParam ?? btKey,
      }),
    );
  }, [btKey, btiParam, rowsComplete, btRow, shallowReplace, params]);

  /* Clear a `?tile=` that names nothing — but only once the row set is
   * COMPLETE.
   *
   * This was guarded on `rows.length === 0`, which is not the same thing and
   * the difference shipped a bug: the summary lands first and contributes only
   * outrights and spreads, so for the window between it and the forwards /
   * volatility payloads, `rows` is non-empty while every forward and vol id in
   * it is still "unknown". A cold shared link to one of those cleared itself.
   * Found by walking the built site (Pass H): `?tile=series:vol:10Y` opened
   * cold landed on `?missing=` every time. */
  useEffect(() => {
    if (!tileParam || !rowsComplete || enlargedRow) return;
    // strip ONLY the tile namespace — an open backtest window survives a
    // stale tile link (mergeQuery carries `bt` and friends forward)
    shallowReplace(
      mergeQuery(params, { tile: null, type: null, missing: tileParam }),
    );
  }, [tileParam, rowsComplete, enlargedRow, shallowReplace, params]);

  /* `scrollIntoViewSafely`, not a bare `behavior: "smooth"`: an explicit
   * behaviour argument OUTRANKS `scroll-behavior: auto` from the
   * reduced-motion blanket in globals.css, so this is one of the two paths
   * that has to read the preference itself (ui/motion.ts). */
  const scrollTo = useCallback((el: HTMLElement) => {
    scrollIntoViewSafely(el);
  }, []);

  // Change-log line → focus (§3/§12): switch to the instrument's OWN group tab
  // (전체 lists spreads/flies far down; its own tab puts it up top), pin it (the
  // preview / bottom sheet follows), and pan the table to it. The pan is a
  // double-rAF after the state updates so the tab switch has committed and the
  // target row has laid out + registered its tile element (§3).
  const focusFromChangeLog = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      // 변화 로그에서 뛰어들면 그 종목의 종목군으로 간다 — Backtest 섹션이
      // 되고, `lastGroup` 도 같이 옮겨야 다음에 Backtest 를 눌렀을 때 여기로
      // 돌아온다.
      setLastGroup(row.group);
      setTab(row.group);
      setPinned(row);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = getTile(id)?.el;
          if (el) scrollIntoViewSafely(el);
        }),
      );
    },
    [rows],
  );

  const [paneRef, paneW, paneH] = useMeasure<HTMLDivElement>();

  // Two panes: hover or pin drives the preview. Single column: only a click
  // (pin) opens the bottom sheet — there is no pane for a hover preview.
  const previewRow = wide ? active : null;

  // the pinned instrument's curve MODE for the pane's corner label (Pass A);
  // null for volatility, which makes no curve statement.
  const pinnedMode = pinned
    ? (diagramSpec(classify(pinned), "pay")?.term ?? null)
    : null;

  return (
    <MotionConfig reducedMotion="user">
    {/* 인트로 커튼 [OWNER, 2026-08-13] — 첫 데이터가 오기 전까지만 전체를 덮는다.
        `ready` 에 isError 가 들어가는 것이 요점이다: 백엔드가 죽었을 때 커튼이
        버티면 안정화 세션이 고친 "실패가 대기처럼 보인다" 가 더 나쁜 형태로
        돌아온다. 커튼 뒤에서는 ErrorState 가 이미 그려져 있고, 커튼은 그것을
        보여 주려고 걷힌다. */}
    <IntroCurtain ready={!!summary || isError} />
    {/* Full-bleed (§H, Session 16): the surface fills the window edge to edge —
        no outer card, no radius, no page-coloured gutter. The window edge is the
        boundary; structure comes from the header hairline, the pane divider, and
        the row hairlines. Card radius survives only where something floats (the
        popup + the chart tooltip). */}
    {/* the app root pads by the strip's height (strip session, Pass C): the
        strip is fixed chrome, so padding the border-box root shortens every
        pane and scroll container inside it at once — the last row is never
        underneath the strip, collapsed or expanded. */}
    {/* the root's padding moves WITH the strip's height (pass B). Before this
        the 22px shift landed in a single frame and every pane jumped; the two
        now run the same duration and curve, so the fold reads as one motion.
        The reduced-motion blanket in globals.css zeroes this transition with
        `!important`, which reaches an inline style. */}
    <div className="relative flex h-screen overflow-hidden bg-tile">
        <Header
          events={summary?.events ?? []}
          onFocus={focusFromChangeLog}
          showChartType={section === "main" || section === "backtest"}
          sidebarOpen={sidebarOpen}
          onSidebarOpen={setSidebarOpen}
        />

        {/* 사이드바 — 창 높이를 끝까지 쓴다. 지표 바가 그 오른쪽에서 시작하므로
            (BottomStrip) 아래쪽을 비워 줄 필요가 없다.
            Backtest 가 아닌 섹션에서는 아무 종목군도 켜지 않는다. 그래도 목록은
            남겨 둔다 — 누르면 그 종목군으로 가는 것이 곧 Backtest 로 가는
            것이고, 사라졌다 나타나는 기둥은 화면을 두 번 흔든다. */}
        {sidebarOpen && (
          <Sidebar
            section={section}
            group={section === "backtest" ? (tab as Group) : null}
            onSection={onSection}
            onGroup={onGroup}
            groupsOpen={groupsOpen}
            onGroupsOpen={setGroupsOpen}
          />
        )}

        {/* 본문 기둥. 지표 바의 높이만큼 바닥을 비우는 것은 여기다 — 예전에는
            루트가 그 패딩을 들고 있어서 사이드바까지 같이 짧아졌다. */}
        <div
          className="flex min-w-0 flex-1 flex-col pt-toolbar"
          style={{
            paddingBottom: stripCollapsed ? STRIP_H.collapsed : STRIP_H.open,
            transitionProperty: "padding-bottom",
            transitionDuration: `${MOTION.base}s`,
            transitionTimingFunction: `cubic-bezier(${EASE_OUT.join(",")})`,
          }}
        >

        {/* A failure must LOOK different from a wait, and carry a way out
            (stability session, Pass B). Before this, both rendered the same
            sentence and the failure never arrived at all — the screen said
            "loading" indefinitely with the backend down. The retry does not
            wait for the fetch layer's retry budget: it is a button. */}
        {!summary && isError && (
          <ErrorState
            what="커브를"
            onRetry={() => void refetchSummary()}
            retrying={summaryFetching}
          />
        )}
        {!summary && !isError && <LoadingState />}
        {/* an unknown ?tile= id: the parameter is cleared and said, rather
            than leaving a bogus URL rendering nothing (Pass B) */}
        {missingTile && (
          <p className={`pb-2 text-center text-[13px] opacity-55 ${PAGE_X}`}>
            {missingTile} 종목을 찾지 못해 닫았어요
          </p>
        )}
        {summary && (
          <div className="flex min-h-0 flex-1">
            {/* left pane: content-sized in two panes; full width in one column
                OR while the forward matrix mode is open (§F). */}
            <div
              /* 두 박스는 **간격**으로 갈린다 — 세로 헤어라인이 아니라.
                 그룹박스가 자기 테두리를 갖는 순간 그 사이의 선은 세 번째
                 경계가 된다 (sauron.html `.split { gap: 14 }`). */
              className={`flex min-w-0 flex-col ${
                wide && !fullWidth ? "shrink-0" : "flex-1"
              }`}
              style={wide && !fullWidth ? { width: TABLE_W } : undefined}
            >
              {/* Each region gets its OWN boundary (stability session, Pass B).
                  A throw anywhere under the root used to unmount the whole
                  tree and leave a white page — one bad row killed the strip,
                  the preview and the header with it. Bounded here, a failing
                  table leaves the rest of the screen usable. */}
              <ErrorBoundary region="table" fallback="표를 그리지 못했어요">
                <InstrumentTable
                  rows={rows}
                  asOf={summary.asof}
                  forwards={forwards}
                  curveBanner={summary.curveBanner}
                  filter={tab}
                  activeId={(wide ? active : pinned)?.id ?? null}
                  pinnedId={pinned?.id ?? null}
                  onHover={handleHover}
                  onPin={setPinned}
                  matrixOpen={matrixOpen}
                  onToggleMatrix={() => setMatrixOpenRaw((v) => !v)}
                  policy={summary.policy}
                  regret={summary.regret ?? []}
                  onLabFocus={focusFromChangeLog}
                />
              </ErrorBoundary>
            </div>
            {/* right pane: hidden in one column and while the matrix mode is
                open; else takes the leftover width, floored at 600px, and the
                idle curve fills its full height (§ layout / §F). */}
            {wide && !fullWidth && (
              /* sauron.html `.split` 의 오른쪽 — **헤더 있는 그룹박스**다.
                 헤더: 제목 · gap · 부기. 무엇을 보고 있는지가 박스 위쪽에
                 적히므로, 하단 sticky 코너 라벨은 없어졌다(같은 사실을 두 번
                 적던 자리다). */
              <div className={`flex min-w-[600px] flex-1 flex-col py-3 ${PAGE_R} pl-3`}>
                <GroupBox
                  className="h-full"
                  header={
                    <>
                      <GroupBoxTitle>
                        {pinned ? pinned.label : previewRow ? previewRow.label : "IRS 커브"}
                      </GroupBoxTitle>
                      <GroupBoxGap />
                      {/* 부기 = 커브 모드가 있으면 그것, 없으면 데이터의 날.
                          CurveView 가 제목 줄에서 적던 "…· 어제"(실선/파선의
                          날 구분)를 이 자리가 이어받았다. */}
                      <GroupBoxNote>
                        {pinnedMode ?? `${levelHeadText(summary.asof)} · 어제`}
                      </GroupBoxNote>
                    </>
                  }
                >
                  <div
                    ref={paneRef}
                    className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3"
                  >
                    <ErrorBoundary region="pane" fallback="이 화면을 그리지 못했어요">
                      {paneW > 0 &&
                        (previewRow ? (
                          <PreviewPane
                            row={previewRow}
                            onOpen={openBacktest}
                            onEnlarge={openEnlarged}
                            width={paneW - PANE_PAD}
                            height={Math.max(360, paneH - PANE_PAD)}
                            policy={summary.policy}
                          />
                        ) : (
                          <CurveView
                            summary={summary}
                            width={paneW - PANE_PAD}
                            height={Math.max(300, paneH - PANE_PAD)}
                          />
                        ))}
                    </ErrorBoundary>
                  </div>
                </GroupBox>
              </div>
            )}
          </div>
        )}
      </div>

      {/* single-column preview: a bottom sheet opened by a row click */}
      <AnimatePresence>
        {summary && !wide && pinned && (
          <PreviewSheet
            row={pinned}
            onOpen={openBacktest}
            onEnlarge={openEnlarged}
            onClose={() => setPinned(null)}
            policy={summary.policy}
          />
        )}
      </AnimatePresence>

      {/* the enlarged view (?tile) — a modal over everything, including the
          floating window; closing it leaves the window exactly as it was.
          NO AnimatePresence — see the backtest window's note below: both
          surfaces are unmounted BY A ROUTER WRITE, and that unmount must not
          wait on an exit animation's completion. EnlargedView's own exit
          props are inert without a presence wrapper and simply never run. */}
      {enlargedRow && summary && (
        <ErrorBoundary
          key="enlarged"
          region="popup"
          fallback="큰 화면을 그리지 못했어요"
        >
          <EnlargedView
            row={enlargedRow}
            summary={summary}
            onClose={closeEnlarged}
          />
        </ErrorBoundary>
      )}

      {/* the floating backtest window (?bt) — parallel to everything above:
          tabs, pins and the enlarged view all keep working underneath it.
          Keyed by the instance nonce so REPLACING (a new chart click while
          one is open) remounts and re-seeds; the window boundaries its own
          body, this covers the shell.

          NO AnimatePresence — THE CLOSE MUST NOT WAIT ON AN ANIMATION
          [2026-08-11, the second 안 닫히는 창]. A presence-wrapped window
          only leaves the DOM when every exit animation reports completion,
          and that report is delivered by motion's rAF frameloop. The render
          that removes this window is a ROUTER write, which triggers a heavy
          re-render right when the 160ms exit needs its ~10 frames — starve
          them (jank at close, a throttled or hidden tab, an energy-saver
          profile) and the completion never arrives: the window stays
          mounted forever, invisible-eating-clicks or fully visible. The
          2026-08-05 ghost (popLayout) was one member of this class; this
          removes the class. Closing is an instant unmount — which is also
          exactly what reduced motion already did by design (§14 instant()).
          The entrance still animates; entrances need no presence. */}
      {btKey && btRow && summary && (
        <ErrorBoundary
          key={btKey}
          region="popup"
          fallback="백테스트 화면을 그리지 못했어요"
        >
          <BacktestWindow
            row={btRow}
            rows={rows}
            asOf={summary.asof}
            entryFrom={params.get("btf") ?? undefined}
            memoryKey={btKey}
            /* only BOOKABLE pins are captured [V-PASS V5]: a pinned
               forward or 변동성 row slipped past the dropdown's filter
               into the book and 422'd two clicks later at 실행. Filtered
               at the source — the window's capture effect cannot grow a
               branch around its setState (compiler lint). */
            captured={
              pinned && BOOKABLE_GROUPS.includes(pinned.group)
                ? pinned
                : null
            }
            policy={summary.policy}
            onClose={closeBacktest}
          />
        </ErrorBoundary>
      )}

      {/* 시뮬레이션 결과 창은 **여기 없다** — 시뮬레이션 서브트리 안에서 뜬다
          (sim/ui/SimulationFlow.tsx). App 이 띄우려면 그 스토어를 정적으로
          물어야 하고, 그러면 시뮬레이션 번들이 첫 바이트에 실린다
          (guards/lazy-chart.test.ts 가 잡는다). 그 대가는 아래 주석에 있다. */}

      <CommandBar onJump={scrollTo} />

      {/* anchors + the next policy meeting, on every tab and in both layouts
          (strip session, Pass C). Chrome: fixed above the card, never
          scrolling with content. */}
      {summary && (
        <ErrorBoundary region="strip" compact fallback="지표 바를 그리지 못했어요">
          <BottomStrip
            rows={rows}
            onPin={setPinned}
            collapsed={stripCollapsed}
            onCollapsed={setStripCollapsed}
            sidebarOpen={sidebarOpen}
          />
        </ErrorBoundary>
      )}
    </div>
    </MotionConfig>
  );
}
