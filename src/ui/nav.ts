/* 두 층의 탐색 — 상단 바 다섯 섹션과 그 아래 메가 패널 [OWNER 2026-08-13].
 *
 * v1(`braveworld/frontend/src/ui/tabs.ts`)이 이미 Main / Backtest / Simulation /
 * Lab 을 정의해뒀고, 오너가 여기에 **Strategy** 를 더했다. 배치는 사이드바가 아니라
 * coinbase.com 의 상단 내비 + 메가메뉴다.
 *
 * ── 섹션은 상태가 아니라 유도값이다 (v1 의 규칙, 그대로 가져옴) ─────────────
 * 화면은 탭 값 하나만 들고 있고 표·미리보기·URL 이 전부 그걸 읽는다. 섹션을 두 번째
 * 상태로 두면 "Backtest 인데 종목군이 없음" 처럼 **화면에 존재하지 않는 조합**이
 * 표현 가능해진다. 그래서 `sectionOf()` 로 유도한다.
 */

import { GROUP_LABEL, type Group } from '@/table/rows';

/** 탭 = 종목군 · 오버뷰 · 시뮬레이션 · 전략 · 설정 · 연구실. URL 의 `g` 가 드는 값이다. */
export type TabId = Group | 'all' | 'sim' | 'strategy' | 'setting' | 'lab';

export type SectionId = 'main' | 'backtest' | 'simulation' | 'strategy' | 'setting' | 'lab';

export type Section = {
  id: SectionId;
  label: string;
  /** 메가 패널 오른쪽에 서는 한 줄. 이 섹션이 무엇을 하는 곳인지. */
  blurb: string;
  /** 섹션을 눌렀을 때 갈 탭. Backtest 만 마지막으로 보던 종목군으로 돌아간다. */
  tab: TabId | null;
};

/** 라벨은 영문 그대로 — v1 에서 오너가 그렇게 부른다. 앱 이름은 어디에도 없다
 * [OWNER 2026-08-07 — "sauron은 예명이야"]. */
export const SECTIONS: Section[] = [
  { id: 'main', label: 'Main', blurb: '오늘 시장을 한 화면에서 본다.', tab: 'all' },
  {
    id: 'backtest',
    label: 'Backtest',
    blurb: '행을 고르고, 차트를 보고, 그 자리에서 백테스트한다.',
    tab: null, // 마지막 종목군으로 — `tabForSection` 참조
  },
  { id: 'simulation', label: 'Simulation', blurb: '금리 시나리오를 넣고 손익을 본다.', tab: 'sim' },
  /* Strategy = RV Analysis [OWNER 2026-08-18 — "RV = v2 Strategy 섹션"]. 랭킹이지
   * 투자판단이 아니다 — blurb 도 그 문법을 지킨다(명령형·추천 금지). */
  /* 어휘는 사분면 라벨과 같은 결이다 [OWNER 2026-08-19 — "싸고 버팀" 계열 교체]. */
  { id: 'strategy', label: 'Strategy', blurb: '평소 대비 얼마나 벌어졌고 버퍼가 얼마나 남는지 — RV 랭킹을 본다.', tab: 'strategy' },
  /* Setting 은 데이터 화면이 아니라 **다른 화면들이 읽는 값을 정하는 자리**라
   * 최상위다 [OWNER, 2026-08-14]. 지금은 조달금리 하나뿐이고, 그 값은 Cash
   * Bond 백테스트가 읽는다.
   *
   * **Lab 앞이다** [OWNER 규칙]. 섹션 순서는 확신의 순서이고 Lab 은 그
   * 가장자리라 반드시 마지막이어야 한다(실험은 가장자리에서 들어와 앞으로
   * 졸업한다). Setting 은 그 사다리에 참여하지 않는 유틸리티 화면이라 졸업할
   * 것도 없고, 뒤에 두면 Lab 이 마지막이 아니게 된다. */
  { id: 'setting', label: 'Setting', blurb: '다른 화면이 읽는 값을 정한다.', tab: 'setting' },
  { id: 'lab', label: 'Lab', blurb: '아직 규칙이 되지 못한 것들.', tab: 'lab' },
];

/** 메가 패널 한 칸. Coinbase 의 항목 구조 그대로 — 글리프 + 제목 + 한 줄 설명. */
export type NavItem = {
  id: TabId;
  label: string;
  desc: string;
  /** 글리프는 v1 이 고른 문자 그대로다(`ui/tabs.ts`). 아이콘 폰트를 새로 고르면
   * 두 제품이 같은 것을 다른 그림으로 부르게 된다. */
  glyph: string;
  /** false 면 아직 화면이 없다는 뜻. 눌러도 되지만 빈 상태가 그렇게 말한다. */
  ready: boolean;
};

/**
 * Backtest 아래의 자산군 [OWNER 2026-08-13 — "굳이 따지면 스왑, 국채현물,
 * 국채선물, 크레딧"; **축소 2026-08-19** — "가상 데이터가 들어갔던 본드스왑,
 * 국고, 국채선물, 크레딧 지워주고"]. 국채현물·국채선물·크레딧 카테고리와 스왑
 * 아래의 본드스왑 탭이 그날 내려갔다. `Group` 값 자체는 건드리지 않는다 —
 * 행·정렬·사다리가 전부 그 값을 읽기 때문이고, 유니버스 백엔드도 그대로다.
 * 탭을 되살리려면 여기 배열(과 `page.tsx` 의 GROUPS)에 도로 넣으면 된다.
 */
export type CategoryId = 'swap' | 'cashbond';

export const BACKTEST_CATEGORIES: {
  id: CategoryId;
  label: string;
  desc: string;
  groups: Group[];
}[] = [
  {
    id: 'swap',
    label: '스왑',
    desc: 'IRS 아웃라이트와 거기서 나오는 스프레드·플라이·포워드',
    groups: ['outright', 'spread', 'fly', 'forward', 'vol'],
  },
  /* 항목 둘이 **별개 표 탭**인 것이 v1 규칙이다(v1 tabs.ts — 현금채권과
   * 자산스왑은 유니버스와 단위가 다른 딴 표다). 민평 8종 × 만기 격자에서 par
   * 발행한 3개월 이표채와, 같은 채권에 같은 명목의 페이 고정을 얹은 par-par
   * 패키지. 민평이 SQL 라이브라 2026-08-19 축소에서 살아남았다 [OWNER 확인]. */
  {
    id: 'cashbond',
    label: '현금채권',
    desc: '민평 커브에서 par 로 발행한 채권과 그 자산스왑',
    groups: ['cashbond', 'asw'],
  },
];

/** v1 의 글리프를 그대로. 없는 그룹은 v1 에 없던 자산군이라 같은 계열에서 골랐다. */
const GROUP_GLYPH: Record<Group, string> = {
  outright: '●',
  spread: '◧',
  fly: '◆',
  forward: '▶',
  vol: '〜',
  govt: '◍',
  bss: '◫',
  credit: '◈',
  futures: '◇',
  cashbond: '▣',
  asw: '⇄',
};

const GROUP_DESC: Record<Group, string> = {
  outright: '고정금리의 절대 수준',
  spread: '두 만기의 차 — 커브가 서는지 눕는지',
  fly: '가운데 만기가 양 날개 대비 비싼지',
  forward: '미래 시점에서 시작하는 금리',
  vol: '만기별 상대 변동성',
  govt: '국고채 수익률',
  bss: '국고 대비 스왑의 차',
  credit: '국고 대비 신용 스프레드',
  futures: '3년·10년 선물',
  cashbond: '민평 수익률 · 3개월 이표채로 가정',
  asw: '민평 − IRS · 같은 만기 · 같은 명목',
};

/** 한 카테고리가 펼치는 항목들. */
export function itemsOf(cat: CategoryId): NavItem[] {
  const c = BACKTEST_CATEGORIES.find((x) => x.id === cat);
  if (!c) return [];
  return c.groups.map((g) => ({
    id: g,
    label: GROUP_LABEL[g],
    desc: GROUP_DESC[g],
    glyph: GROUP_GLYPH[g],
    ready: true,
  }));
}

/** 탭에서 섹션을 유도한다. 두 번째 상태를 만들지 않는 지점. */
export function sectionOf(t: TabId): SectionId {
  if (t === 'all') return 'main';
  if (t === 'sim') return 'simulation';
  if (t === 'strategy') return 'strategy';
  if (t === 'setting') return 'setting';
  if (t === 'lab') return 'lab';
  return 'backtest';
}

/** 섹션을 누르면 어디로 가나. Backtest 는 **마지막으로 보던 종목군**으로 돌아간다 —
 * 늘 아웃라이트로 되돌리면 스프레드를 보다 Main 을 한 번 들른 사람이 자리를 잃는다
 * (v1 의 이유 그대로). */
export function tabForSection(s: SectionId, lastGroup: Group): TabId {
  const sec = SECTIONS.find((x) => x.id === s);
  return sec?.tab ?? lastGroup;
}

/* ── Lab 의 세입자들 [2026-08-20] ─────────────────────────────────────────────
 *
 * 세입자가 둘이 되면서 Lab 도 메가 패널을 연다. 이 파일의 위 주석이 이미 그
 * 규칙을 적어 두었다 — "목적지가 하나면 버튼이지 메뉴가 아니다". 반대도 참이다.
 *
 * **위계는 셋이 같다** [OWNER, 2026-08-20]. 세입자끼리 서로를 읽지 않고, 셋을
 * 잇는 화면도 만들지 않는다. 각자 들어와서 각자 졸업하기 때문이다 — 시나리오가
 * Simulation 으로 올라가는 날 표면이 딸려 올라가면 안 된다. 그래서 목록에 순서
 * 말고는 아무 강조도 없다.
 *
 * 세입자는 **탭이 아니라 URL 상태**다(`?g=lab&lab=scenario`). 탭을 늘리면
 * `sectionOf()` 가 드는 «섹션은 유도값» 규칙에 두 번째 상태가 끼어든다. */
export type LabId = 'surface' | 'scenario' | 'issuance' | 'model';

export const DEFAULT_LAB: LabId = 'surface';

export const LAB_ITEMS: { id: LabId; label: string; desc: string; glyph: string }[] = [
  { id: 'surface', label: '커브 표면', desc: '풀별 커브가 지난 몇 해 어떻게 움직였나', glyph: '◇' },
  { id: 'scenario', label: '시나리오', desc: '이 금통위 경로가 프라이싱되면 커브는 어디가 정합인가', glyph: '◆' },
  { id: 'issuance', label: '발행 캘린더', desc: '내일 이 섹터에 얼마가 새로 얹히나', glyph: '▤' },
  /* 「모형」은 시나리오를 **대체하러** 들어온다 [OWNER 2026-08-21]. 셋이 아니라
     둘이 되는 자리인데, 지금은 셸만 서 있고 내용은 다음 두 세션이 채운다. 그때
     시나리오가 내려간다 — 죽은 쌍둥이로 남기지 않는다. */
  { id: 'model', label: '모형', desc: '경로 하나로 데스크 노트까지, 그리고 그 숫자가 어디서 왔는지', glyph: '⌗' },
];

export function isLabId(v: string | undefined): v is LabId {
  return v === 'surface' || v === 'scenario' || v === 'issuance' || v === 'model';
}

/** 메가 패널을 여는 섹션. 나머지는 목적지가 하나뿐이라 버튼이다. */
export const PANELED: SectionId[] = ['backtest', 'lab'];

/** 그 그룹이 속한 카테고리. 메가 패널에서 지금 자리를 표시할 때 쓴다. */
export function categoryOf(g: Group): CategoryId | undefined {
  return BACKTEST_CATEGORIES.find((c) => c.groups.includes(g))?.id;
}

export const DEFAULT_GROUP: Group = 'outright';

/** 아직 화면이 없는 섹션. 빈 상태가 이유를 말해야 하므로 여기에 이유를 둔다.
 *
 * 시뮬레이션(레인 5)·연구실(커브 표면)·Strategy(RV Analysis, rv2)가 차례로
 * **여기서 내려갔다** — 화면이 생겼기 때문이다. 지금은 빈 목록이고, 새 섹션이
 * 생기면 화면보다 이유가 먼저 여기 선다. */
export const NOT_BUILT: Partial<Record<SectionId, string>> = {};
