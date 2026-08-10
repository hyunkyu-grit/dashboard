"use client";

/* 좌측 사이드바 — 이 제품의 **유일한** 탐색 [OWNER, 2026-08-07].
 *
 * 최상위가 섹션 넷이고, Backtest 아래에 종목군 다섯이 접힌다.
 *
 *   Main         기존 전체 — 3열 오버뷰
 *   Backtest  ▾  기존 자산군. 여기서 하는 일이 행 → 차트 → 백테스트다.
 *     아웃라이트 · 스프레드 · 버터플라이 · 포워드 · 변동성
 *   Simulation   기존 시뮬레이션
 *   Lab          기존 연구실
 *
 * 구조는 `Codex\mockups` 가 이미 그려 둔 것을 조합했다 — sauron.html 의
 * `.sidebar`/`.sb-item`/`.gl` 에, defense.html 의 디스클로저 그룹
 * (`.sb-header.disc` + `.disclosure` + `.sb-sub`). 새 패턴은 없다.
 *
 * 앱 이름은 없다 [OWNER — "sauron은 예명이야"].
 *
 * ── 킷 ────────────────────────────────────────────────────────────────────
 * Sidebars/Light/Medium. 폭 240(세 크기 공통), 항목 32, 중첩은 16 들여쓰기.
 * HIG Sidebars: "In general, show no more than two levels of hierarchy" —
 * 정확히 두 단계다. 사이드바도 유리 레이어에 뜨지만 "appears more opaque in
 * larger elements like sidebars to preserve legibility" 라 툴바(70%)보다
 * 불투명한 Sidebar/Background/Active(80%)를 쓴다.
 * 하단에는 아무것도 두지 않는다 ("Avoid putting critical information or actions
 * at the bottom of a sidebar" — 창을 내리면 아래가 잘린다). */

import { Fragment } from "react";

import type { Group } from "./rows";
import { GROUP_TABS, SECTIONS, type SectionId } from "./tabs";
import { Z_SIDEBAR } from "./layers";

/** 항목 하나. 최상위와 중첩이 같은 칸(32)·같은 활자를 쓰고 들여쓰기로만
 * 갈린다 — 킷의 Level 0 / L1+ 가 그렇게 되어 있다. 크기는 headline(15) —
 * 본문 상속(14)이 작다는 지적에 사다리 한 칸 위 [OWNER, 2026-08-11]. */
function Item({
  label,
  glyph,
  on,
  onPick,
  disclosure,
}: {
  label: string;
  glyph: string;
  on: boolean;
  onPick: () => void;
  /** Backtest 에만 붙는 접기 삼각형. 항목 자체와 **다른 버튼**이다 — 누르면
   * 섹션이 바뀌는 것과 접히는 것은 다른 일이고, 하나에 둘을 걸면 접으려다
   * 화면이 바뀐다. */
  disclosure?: { open: boolean; onToggle: () => void };
}) {
  return (
    <li>
      <div className="flex items-center">
        {disclosure && (
          <button
            type="button"
            aria-expanded={disclosure.open}
            aria-label={`종목군 ${disclosure.open ? "접기" : "펼치기"}`}
            onClick={disclosure.onToggle}
            className="flex size-4 shrink-0 items-center justify-center text-[8px] text-ink-2 transition-transform hover:text-ink"
            style={{ transform: disclosure.open ? undefined : "rotate(-90deg)" }}
          >
            ▼
          </button>
        )}
        <button
          type="button"
          aria-current={on ? "page" : undefined}
          onClick={onPick}
          /* 선택은 액센트 채움 + 잉크 라벨. 흰 라벨은 채움 주황 위에서 2.31:1
             이라 쓸 수 없다 — `--bw-on-accent` 는 킷 Labels/1 Primary(검정 85%)
             이고 7.61:1 이다.
             호버는 잉크 5%. 목업은 3%(킷 Fills/4)인데 이 제품에서 3% 상태
             표시는 화면에서 안 보인다는 것이 이미 측정돼 있다. */
          className={`flex h-sb-item min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-left text-headline transition-colors ${
            on ? "bg-accent font-semibold text-on-accent" : "text-ink hover:bg-ink-5"
          }`}
        >
          {/* HIG Sidebars: "By default, sidebar icons use your app's accent
              color." 문자는 목업이 고른 것 그대로. */}
          <span
            aria-hidden
            className={`w-3.5 shrink-0 text-center text-[12px] ${
              on ? "text-on-accent" : "text-accent-fg"
            }`}
          >
            {glyph}
          </span>
          <span className="min-w-0 truncate">{label}</span>
        </button>
      </div>
    </li>
  );
}

export function Sidebar({
  section,
  group,
  onSection,
  onGroup,
  groupsOpen,
  onGroupsOpen,
}: {
  section: SectionId;
  /** 지금 켜져 있는 종목군. Backtest 섹션이 아니면 null. */
  group: Group | null;
  onSection: (s: SectionId) => void;
  onGroup: (g: Group) => void;
  groupsOpen: boolean;
  onGroupsOpen: (v: boolean) => void;
}) {
  return (
    <nav
      aria-label="탐색"
      /* 위쪽을 툴바 높이만큼 비운다 — 툴바는 격자 행을 차지하지 않고 이 위를
         지나가는 레이어라, 비우지 않으면 첫 항목이 바 밑에 깔린다. */
      className={`${Z_SIDEBAR} w-sidebar shrink-0 overflow-y-auto border-r border-sep bg-glass-side px-2 pb-3 pt-toolbar backdrop-blur-[40px] backdrop-saturate-[1.8]`}
    >
      <ul className="mt-2 list-none">
        {SECTIONS.map((s) => {
          const isBacktest = s.id === "backtest";
          return (
            <Fragment key={s.id}>
              <Item
                label={s.label}
                glyph={s.glyph}
                /* Backtest 는 종목군이 켜져 있을 때 **자신은 안 켜진다** —
                   켜진 것은 그 아래 한 줄이고, 부모까지 같이 칠하면 무엇이
                   골라졌는지가 두 개가 된다. */
                on={section === s.id && !(isBacktest && group !== null)}
                onPick={() => onSection(s.id)}
                disclosure={
                  isBacktest
                    ? { open: groupsOpen, onToggle: () => onGroupsOpen(!groupsOpen) }
                    : undefined
                }
              />
              {isBacktest && groupsOpen && (
                <li>
                  {/* 중첩 목록. 킷의 L1+ 는 16 들여쓰기다. */}
                  <ul className="list-none pl-4">
                    {GROUP_TABS.map((t) => (
                      <Item
                        key={t.id}
                        label={t.label}
                        glyph={t.glyph}
                        on={group === t.id}
                        onPick={() => onGroup(t.id)}
                      />
                    ))}
                  </ul>
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}
