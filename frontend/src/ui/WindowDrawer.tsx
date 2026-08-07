"use client";

/* 떠 있는 창의 **하단 서랍** [트레이더 피드백 5, 2026-08-07].
 *
 * "일자별 PnL과 KRD는 백테스트와 시뮬레이션 결과창 둘 다에 존재해야 하며,
 *  위치는 팝업창 하단에 열었다 닫았다 하는 탭에서 조절할 수 있으면 좋겠다."
 *
 * 실제 트레이딩 시스템과 **대사**하려고 보는 숫자다. 늘 펼쳐져 있으면 창이
 * 그만큼 길어지고, 없으면 대사할 때마다 다른 화면을 찾아가야 한다. 접히는
 * 서랍이 그 둘 사이의 답이고, 접힌 상태가 기본이다 — 대사는 매번 하는 일이
 * 아니다.
 *
 * ── 킷 ────────────────────────────────────────────────────────────────────
 * `Titlebars and Toolbars/*​/Utility Panel/Tab Bar` 220×30, 그 안의
 * `Tab Bar/Button` 44×28. 유틸리티 패널의 탭 바가 킷에 따로 있다는 것이
 * 이 자리에 쓰라는 뜻이다 — 본문의 세그먼티드가 아니라.
 * 바는 30, 버튼은 28. 선택은 액센트 채움 + 잉크 라벨(주황 위 흰 글자는
 * 2.31:1).
 *
 * ── 왜 창마다 만들지 않는가 ────────────────────────────────────────────────
 * 두 창이 같은 것을 보여줘야 한다는 것이 요청의 절반이다. 서랍이 두 벌이면
 * 한쪽에만 탭이 붙거나 접힘 규칙이 갈리고, 그러면 "둘 다에 존재한다" 가 곧
 * 거짓이 된다. 내용만 창이 정하고 껍데기는 하나다. */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";

import { ENTER, EXIT, instant } from "./motion";

export interface DrawerTab {
  id: string;
  label: string;
  /** 이 탭이 그릴 것. 없으면(`null`) 라벨이 흐려지지만 **누를 수는 있다** —
   * 숨기지 않는 이유가 그것이다: 백테스트에 KRD 가 없다는 사실이 보여야 하고,
   * 왜 없는지는 열어 봐야 읽힌다. 못 누르게 막으면 흐린 라벨만 남는다. */
  content: ReactNode | null;
  /** 비었을 때 그 자리에 쓸 이유. 트레이더가 "왜 비었지" 를 물을 곳이다. */
  unavailable?: string;
}

export function WindowDrawer({ tabs }: { tabs: DrawerTab[] }) {
  const reduced = useReducedMotion() === true;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];

  if (tabs.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-edge">
      {/* 탭 바 — 킷 Utility Panel Tab Bar, 30 높이. 창 바닥에 붙어 있고
          접혀 있을 때도 보인다: 무엇을 펼칠 수 있는지가 접힌 상태에서
          읽혀야 서랍이 발견된다. */}
      <div className="flex h-[30px] items-center gap-1 bg-popover px-3">
        {tabs.map((t) => {
          const on = t.id === tab?.id && open;
          const dead = t.content === null;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              title={dead ? t.unavailable : undefined}
              onClick={() => {
                if (t.id === tab?.id && open) {
                  setOpen(false); // 같은 탭을 다시 누르면 접는다
                } else {
                  setActive(t.id);
                  setOpen(true);
                }
              }}
              className={`flex h-7 min-w-[44px] items-center rounded-control px-2.5 text-[13px] transition-colors ${
                on
                  ? "bg-accent font-medium text-on-accent"
                  : dead
                    ? "text-ink-3"
                    : "text-ink-2 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "서랍 접기" : "서랍 펼치기"}
          className="flex size-5 items-center justify-center rounded-control-sm text-[10px] font-bold leading-none text-ink-2 transition-colors hover:text-ink"
          style={{ transform: open ? undefined : "rotate(180deg)" }}
        >
          ▾
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: instant(EXIT, reduced) }}
            transition={instant(ENTER, reduced)}
            className="overflow-hidden border-t border-edge"
          >
            {/* 서랍이 창을 무한정 늘리지 않는다: 자기 높이를 갖고 그 안에서
                스크롤한다. 창 자체의 max-h 는 그대로다. */}
            <div className="max-h-[38vh] overflow-y-auto [overflow-anchor:none] px-5 py-3">
              {tab?.content ?? (
                <p className="py-6 text-center text-[13px] text-ink-2">
                  {tab?.unavailable ?? "아직 없어요"}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
