"use client";

/* 좌측 사이드바 — 가로 탭 스트립을 대신한다 [OWNER, 2026-08-07].
 *
 * 정보구조는 그대로다. 여덟 개의 탭이 그대로 여덟 개의 항목이고, 고르는 것도
 * 같고, 고른 뒤에 나오는 화면도 같다. 바뀐 것은 그것들이 어디에 어떻게 놓이냐
 * 하나뿐이다. DESIGN §2 의 "list-first 가로 탭 스트립" 은 폐기됐다.
 *
 * ── 킷 ────────────────────────────────────────────────────────────────────
 * Sidebars/Light/Medium. 폭 240(세 크기 공통), 헤더 20, 항목 32.
 * HIG Sidebars: 사이드바도 Liquid Glass 레이어에 뜨지만 "appears more opaque in
 * larger elements like sidebars to preserve legibility" — 그래서 툴바(70%)보다
 * 불투명한 Sidebar/Background/Active(80%)를 쓴다. 킷이 그렇게 두 벌을 준다.
 *
 * HIG 가 요구하는 것 중 지킨 것:
 *   · 계층은 두 단계까지 — 여기는 그룹 헤더 + 항목, 두 단계다.
 *   · 아이콘은 앱 액센트 색.
 *   · 하단에 중요한 것을 두지 않는다 — 창을 내리면 아래가 잘린다.
 *     그래서 여기 바닥에는 아무것도 없다.
 *   · 기본으로 숨기지 않는다. 접는 장치를 두지 않았다 — 항목이 여덟 개라
 *     접을 이유가 없고, 접기는 그 자체로 사용자가 틀릴 수 있는 칸이다. */

import { Z_SIDEBAR } from "./layers";
import type { Row } from "./rows";
import {
  INSTRUMENT_TABS,
  TOOL_TABS,
  type TabDef,
  type TabId,
} from "./tabs";

/* 그룹 헤더 — 위계를 **크기와 굵기로** 만든다.
 *
 * 킷도 목업도 여기에 Labels/2 Secondary(잉크 50%)를 쓴다. 그런데 유리 사이드바
 * 위에서 그게 라이트 **3.07:1** 이다 [측정 2026-08-07, guards/glass-contrast].
 * 이 제품은 라벨을 4.5:1 에 묶어 두고 있고, 이건 내가 방금 새로 넣은 글자다 —
 * 원래 가로 스트립에는 그룹 헤더가 없었다. 이미 있던 미달 자리를 물려받는 것과
 * 새 미달 자리를 만드는 것은 다르다.
 *
 * 그래서 흐리게 하는 대신 **작게** 한다. 11px(킷 08 Subheadline) semibold 에
 * 잉크 85% — 항목은 13px regular 이므로 둘은 여전히 다른 층위이고, 헤더 쪽이
 * 14.6:1 로 읽힌다. 위계를 명도로만 만들면 대비와 맞바꾸게 되는데 크기로
 * 만들면 그 거래가 없다. 킷의 타입 스케일 안에 있고 10px 최소도 넘는다. */
const GROUP_HEADER =
  "mt-3 flex h-sb-header items-center px-2 text-[11px] font-semibold text-ink-1";

/** 다리 수 글리프. 아웃라이트 한 점 · 스프레드 두 점 · 버터플라이 세 점.
 * 새 그림이 아니라 이 제품이 이미 쓰는 사실을 14px 로 옮긴 것이다. 다리 수가
 * 상품을 가르지 않는 탭(전체·포워드·변동성·도구)은 칸을 비운다. */
function Legs({ n }: { n: 1 | 2 | 3 }) {
  // 세로 가운데 한 줄. 3다리는 가운데가 벨리라 크게 그린다 — 버터플라이는
  // 1:2:1 이고 그 2가 벨리다.
  const r = [2, 2, 2];
  if (n === 3) r[1] = 3;
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <circle
          key={i}
          cx={n === 1 ? 7 : 7 + (i - (n - 1) / 2) * 4.5}
          cy={7}
          r={r[i]}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

function Item({
  tab,
  on,
  count,
  onPick,
}: {
  tab: TabDef;
  on: boolean;
  count?: number;
  onPick: (id: TabId) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={on ? "page" : undefined}
        onClick={() => onPick(tab.id)}
        /* 선택은 액센트 채움 + 잉크 라벨. 흰 라벨은 채움 주황 위에서 2.31:1 이라
           쓸 수 없다 — --bw-on-accent 는 킷 Labels/1 Primary(검정 85%)이고
           7.61:1 이다.
           호버는 잉크 5%. 목업은 3%(킷 Fills/4)를 쓰는데 이 제품에서 3% 상태
           표시는 화면에서 안 보인다는 것이 이미 측정돼 있다 — 5%가 하한이다. */
        className={`flex h-sb-item w-full items-center gap-2 rounded-control px-2 text-left transition-colors ${
          on
            ? "bg-accent font-semibold text-on-accent"
            : "text-ink hover:bg-ink-5"
        }`}
      >
        {/* HIG Sidebars: "By default, sidebar icons use your app's accent color." */}
        <span className={on ? "text-on-accent" : "text-accent-fg"}>
          {tab.legs ? <Legs n={tab.legs} /> : <span className="block size-3.5" />}
        </span>
        <span className="min-w-0 truncate">{tab.label}</span>
        {count !== undefined && (
          /* 배지는 종목군에만 단다. 이 자리에 맞는 사실이 있는 탭이 그것들뿐이다 —
             "포워드 9개" 는 고르기 전에 알면 쓸모가 있고, "시뮬레이션 1개" 는
             아무 뜻도 없다. defense.html 은 모든 항목에 배지를 달았지만 그건
             모든 항목이 목록인 화면이었다. */
          <span
            className={`ml-auto shrink-0 tabular-nums ${
              on ? "text-on-accent/70" : "text-ink-2"
            }`}
          >
            {count}
          </span>
        )}
      </button>
    </li>
  );
}

export function Sidebar({
  tab,
  onTab,
  rows,
}: {
  tab: TabId;
  onTab: (id: TabId) => void;
  rows: Row[];
}) {
  /* 종목군 항목에만 부른다 — 도구 쪽은 배지를 안 단다. 그래서 여기에는 "이 탭이
     행 목록인가" 를 다시 묻는 분기가 없다. 한 번 넣었다가 지웠는데, 부르는 쪽이
     이미 그걸 정하고 있어서 죽은 가지였다. */
  const count = (t: TabDef): number | undefined =>
    (t.id === "all"
      ? rows.length
      : rows.filter((r) => r.group === t.id).length) || undefined;

  return (
    <nav
      aria-label="종목군과 도구"
      /* 위쪽을 툴바 높이만큼 비운다 — 툴바는 격자 행을 차지하지 않고 이 위를
         지나가는 레이어라, 비우지 않으면 첫 헤더가 바 밑에 깔린다. */
      className={`${Z_SIDEBAR} w-sidebar shrink-0 overflow-y-auto border-r border-sep bg-glass-side px-2 pb-3 pt-toolbar backdrop-blur-[40px] backdrop-saturate-[1.8]`}
    >
      <h2 className={GROUP_HEADER}>종목군</h2>
      <ul className="list-none">
        {INSTRUMENT_TABS.map((t) => (
          <Item
            key={t.id}
            tab={t}
            on={tab === t.id}
            count={count(t)}
            onPick={onTab}
          />
        ))}
      </ul>
      <h2 className={GROUP_HEADER}>도구</h2>
      <ul className="list-none">
        {TOOL_TABS.map((t) => (
          <Item key={t.id} tab={t} on={tab === t.id} onPick={onTab} />
        ))}
      </ul>
    </nav>
  );
}
