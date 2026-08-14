/* 두 층의 탐색, **둘 다 사이드바에** [OWNER, 2026-08-07 · 2차].
 *
 * 섹션이 사이드바의 최상위 항목이고, Backtest 아래에 종목군 다섯이 접힌다 —
 * defense.html 의 `.sb-header.disc` + `.sb-sub` 구조 그대로다. 툴바에 섹션을
 * 올렸다가 되돌렸다 [OWNER — "저거 상단에 넣지마"].
 *
 *   Main         기존 전체 — 3열 오버뷰
 *   Backtest     기존 자산군 — 아웃라이트·스프레드·버터플라이·포워드·변동성.
 *                이 섹션에서만 사이드바가 할 일이 있다. 이름이 Backtest 인 것은
 *                여기서 하는 일이 행 → 차트 → 백테스트이기 때문이다.
 *   Simulation   기존 시뮬레이션
 *   Lab          기존 연구실
 *
 * **`TabId` 는 그대로 둔다.** 화면 하나가 여덟 값 중 하나를 들고 있고 표·미리보기·
 * URL·리오더 스냅이 전부 그걸 읽는다. 섹션은 그 값에서 **유도**되는 것이지 두
 * 번째 상태가 아니다 — 상태를 둘로 쪼개면 "Backtest 인데 종목군이 없음" 같은,
 * 화면에 없는 조합이 표현 가능해진다.
 *
 * 앱 이름은 어디에도 없다 [OWNER, 2026-08-07 — "sauron은 예명이야"]. */

import { GROUP_LABEL, type Group } from "./rows";

/** 탭 = 행 필터 · 오버뷰 · 시뮬레이션 · 연구실 · 현금채권 · 설정.
 * 자산군 다섯의 내부 값은 그대로다. */
export type TabId = Group | "all" | "sim" | "lab" | "cashbond" | "setting";

export type SectionId = "main" | "backtest" | "simulation" | "lab" | "setting";

/** Backtest 아래에 접히는 것들 — 자산군 다섯 + 현금채권.
 *
 * 현금채권이 `Group` 이 **아닌** 것이 요점이다 [OWNER, 2026-08-14]. `Group` 은
 * IRS 행 빌더(`rows.ts:buildRows`)가 읽는 값이고, 현금채권은 그 표의 행이
 * 아니라 딴 표다(민평 SQL, 자기 백테스트). 같은 열거로 묶으면 buildRows 가
 * 절대 만들 수 없는 필터 값을 받게 된다. */
export type BacktestTab = Group | "cashbond";

/** 사이드바의 최상위. 라벨은 영문 그대로 — 오너가 그렇게 부른다.
 * 글리프는 sauron.html 이 같은 자리(전체·시뮬레이션·연구실)에 쓰던 문자다. */
export const SECTIONS: { id: SectionId; label: string; glyph: string }[] = [
  { id: "main", label: "Main", glyph: "◍" },
  { id: "backtest", label: "Backtest", glyph: "◫" },
  { id: "simulation", label: "Simulation", glyph: "◇" },
  // Setting 은 데이터 화면이 아니라 **다른 화면들이 읽는 값을 정하는 자리**라
  // 최상위다 [OWNER, 2026-08-14]. 지금은 조달금리 하나뿐이고, 그 값은 Cash
  // Bond 백테스트가 읽는다.
  //
  // **Lab 앞이다.** 섹션 순서는 확신의 순서이고 Lab 은 그 가장자리라 반드시
  // 마지막이어야 한다 [OWNER, 2026-08-04 — 실험은 가장자리에서 들어와 트레이더
  // 피드백을 받으며 앞으로 졸업한다]. Setting 은 그 사다리에 참여하지 않는
  // 유틸리티 화면이라 졸업할 것도 없고, 뒤에 두면 Lab 이 마지막이 아니게 된다.
  { id: "setting", label: "Setting", glyph: "◎" },
  { id: "lab", label: "Lab", glyph: "◈" },
];

export const sectionOf = (t: TabId): SectionId =>
  t === "all"
    ? "main"
    : t === "sim"
      ? "simulation"
      : t === "lab"
        ? "lab"
        : t === "setting"
          ? "setting"
          : "backtest";  // 자산군 다섯 + 현금채권

/** 섹션을 누르면 어느 탭으로 가나. Backtest 는 **마지막으로 보던 종목군**으로
 * 돌아간다 — 늘 아웃라이트로 되돌리면 스프레드를 보다 Main 을 한 번 들른
 * 사람이 자리를 잃는다. */
export const tabForSection = (s: SectionId, lastGroup: BacktestTab): TabId =>
  s === "main"
    ? "all"
    : s === "simulation"
      ? "sim"
      : s === "lab"
        ? "lab"
        : s === "setting"
          ? "setting"
          : lastGroup;

export type GroupTab = {
  id: Group;
  label: string;
  /** 사이드바 글리프. sauron.html 이 고른 문자 그대로다 — SF Symbols 를 실을 수
   * 없어서 목업이 텍스트 글리프로 대신했고, 그 선택을 지어내지 않고 가져온다.
   * 14px 칸 안에 10px 로 앉고 색은 액센트 전경이다 (HIG Sidebars: 사이드바
   * 아이콘은 앱 액센트 색). */
  glyph: string;
};

/** 사이드바 목록. 전체(→ Main)와 도구(→ Simulation · Lab)는 툴바로 올라갔으므로
 * 여기 없다. 남는 것이 정확히 자산군 다섯이다. */
export const GROUP_TABS: GroupTab[] = [
  { id: "outright", label: GROUP_LABEL.outright, glyph: "●" },
  { id: "spread", label: GROUP_LABEL.spread, glyph: "◧" },
  { id: "fly", label: GROUP_LABEL.fly, glyph: "◆" },
  { id: "forward", label: GROUP_LABEL.forward, glyph: "▶" },
  { id: "vol", label: GROUP_LABEL.vol, glyph: "〜" },
];

/** 사이드바의 Backtest 하위 목록 = 자산군 다섯 + 현금채권 [OWNER, 2026-08-14].
 * 현금채권이 맨 아래인 것은 스왑 다섯을 먼저 보는 화면이기 때문이다. */
export const BACKTEST_TABS: { id: BacktestTab; label: string; glyph: string }[] = [
  ...GROUP_TABS,
  { id: "cashbond", label: "현금채권", glyph: "▤" },
];

/** 처음 Backtest 를 눌렀을 때의 종목군. */
export const DEFAULT_GROUP: BacktestTab = "outright";
