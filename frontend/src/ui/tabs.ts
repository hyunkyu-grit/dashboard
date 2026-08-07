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

/** 탭 = 행 필터 · 오버뷰 · 시뮬레이션 · 연구실. 내부 값은 그대로다. */
export type TabId = Group | "all" | "sim" | "lab";

export type SectionId = "main" | "backtest" | "simulation" | "lab";

/** 사이드바의 최상위. 라벨은 영문 그대로 — 오너가 그렇게 부른다.
 * 글리프는 sauron.html 이 같은 자리(전체·시뮬레이션·연구실)에 쓰던 문자다. */
export const SECTIONS: { id: SectionId; label: string; glyph: string }[] = [
  { id: "main", label: "Main", glyph: "◍" },
  { id: "backtest", label: "Backtest", glyph: "◫" },
  { id: "simulation", label: "Simulation", glyph: "◇" },
  { id: "lab", label: "Lab", glyph: "◈" },
];

export const sectionOf = (t: TabId): SectionId =>
  t === "all"
    ? "main"
    : t === "sim"
      ? "simulation"
      : t === "lab"
        ? "lab"
        : "backtest";

/** 섹션을 누르면 어느 탭으로 가나. Backtest 는 **마지막으로 보던 종목군**으로
 * 돌아간다 — 늘 아웃라이트로 되돌리면 스프레드를 보다 Main 을 한 번 들른
 * 사람이 자리를 잃는다. */
export const tabForSection = (s: SectionId, lastGroup: Group): TabId =>
  s === "main" ? "all" : s === "simulation" ? "sim" : s === "lab" ? "lab" : lastGroup;

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

/** 처음 Backtest 를 눌렀을 때의 종목군. */
export const DEFAULT_GROUP: Group = "outright";
