/* 탭의 정의 — 사이드바(ui/Sidebar.tsx)와 표(ui/InstrumentTable.tsx)가 함께 읽는다.
 *
 * 2026-08-07 에 InstrumentTable 에서 꺼냈다. 그때까지 탭은 표 안의 세그먼티드
 * 컨트롤이었고 목록의 일부였는데, 이제 셸의 사이드바가 됐다. 표가 자기 필터의
 * 정의를 들고 있으면 셸이 표를 import 해야 하고 그건 방향이 반대다.
 *
 * `TabId` 는 InstrumentTable 이 계속 re-export 한다 — 부르는 쪽이 여덟 군데라
 * 한 번에 옮길 이유가 없다. */

import { GROUP_LABEL, type Group } from "./rows";

/** 탭 = 행 필터 · 오버뷰 · 시뮬레이션 · 연구실. */
export type TabId = Group | "all" | "sim" | "lab";

export type TabDef = {
  id: TabId;
  label: string;
  /** 다리 수. 아웃라이트 1 · 스프레드 2 · 버터플라이 3 — 이 제품이 이미
   * 그렇게 부르는 사실이고(BacktestWindow "포지션 한 줄은 상품 하나다"),
   * 사이드바 글리프는 그걸 점으로 그린 것뿐이다. 그 셋이 아닌 항목은 null 이고
   * 글리프 칸을 비워 둔다 — 없는 뜻을 지어내는 것보다 낫다. */
  legs: 1 | 2 | 3 | null;
};

/** 종목군 — 행을 거르는 탭들. 전체가 맨 위. */
export const INSTRUMENT_TABS: TabDef[] = [
  { id: "all", label: "전체", legs: null },
  { id: "outright", label: GROUP_LABEL.outright, legs: 1 },
  { id: "spread", label: GROUP_LABEL.spread, legs: 2 },
  { id: "fly", label: GROUP_LABEL.fly, legs: 3 },
  { id: "forward", label: GROUP_LABEL.forward, legs: null },
  { id: "vol", label: GROUP_LABEL.vol, legs: null },
];

/** 도구 — 행 목록이 아니라 자기 화면을 그리는 탭들. 연구실은 인큐베이션
 * 표면이라 맨 아래다 [OWNER, 2026-08-04]. 가로 스트립일 때의 "맨 오른쪽"이
 * 세로에서는 "맨 아래"다 — 순서는 확신의 순서라는 규칙이 그대로 옮겨진다. */
export const TOOL_TABS: TabDef[] = [
  { id: "sim", label: "시뮬레이션", legs: null },
  { id: "lab", label: "연구실", legs: null },
];

/* 여기에 `isRowList(t)` 헬퍼를 하나 뒀다가 지웠다. 부르는 곳이 없었고,
 * InstrumentTable 은 `isOverview` / `isLab` / `isSim` 세 불린을 따로 들고
 * 각각을 다른 조합으로 쓴다 — 하나로 묶으면 그 세 갈래가 도로 안 보인다.
 * 정의만 있고 참조가 없는 것은 이 리포가 이미 --radius-card 로 한 번 겪은
 * 함정이라 남기지 않는다. */
