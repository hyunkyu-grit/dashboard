"use client";

/**
 * 차트 위에 떠서 커서 지점의 값을 읽어 주는 패널.
 *
 * 차트에 커서를 올리면 무엇이 궁금한가: **그 지점의 숫자**다. 축과 선만으로는
 * "대충 20억쯤"까지밖에 못 읽는데, 판단은 그 자릿수에서 갈리지 않는다.
 *
 * 위치 규칙: 커서를 따라다니되 패널이 커서 **오른쪽 아래**에 붙고, 오른쪽
 * 가장자리에 가까우면 왼쪽으로 뒤집는다. 커서 위에 얹으면 읽으려는 지점을
 * 패널이 가린다.
 *
 * `pointer-events-none` — 패널이 커서를 먹으면 차트가 hover를 잃고 패널이
 * 깜빡이며 사라진다. 실제로 그렇게 만들기 쉬운 실수다.
 */

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/* FAST, not the simulation's own NUMBER_FADE (0.18s), which this product's
 * timing scale has no room for — it runs fast/base/exit at 0.12/0.22/0.16 and
 * "a timing system with one exception is not a timing system" (ui/motion.ts).
 * FAST is the nearer neighbour and the right one on the merits: this panel
 * chases the cursor, so arriving late is arriving in the wrong place. */
import { FAST, instant } from "@/ui/motion";

export interface HoverPanelProps {
  /** 컨테이너 기준 커서 좌표. null이면 렌더하지 않는다. */
  at: { x: number; y: number } | null;
  /** 컨테이너 폭 — 오른쪽 가장자리에서 뒤집을지 판단한다. */
  width: number;
  title: string;
  rows: { label: string; value: string; color?: string; muted?: boolean }[];
  footer?: ReactNode;
}

const PANEL_W = 200;
const OFFSET = 14;

export function HoverPanel({ at, width, title, rows, footer }: HoverPanelProps) {
  // Before the `at` guard below: `at` goes null every time the cursor leaves
  // the chart, and a hook called after an early return unmounts and remounts
  // the hook list on that transition.
  const reduced = useReducedMotion() === true;
  if (!at) return null;
  const flip = at.x + OFFSET + PANEL_W > width;
  const left = flip ? at.x - OFFSET - PANEL_W : at.x + OFFSET;

  return (
    <motion.div
      // 떠 있는 면이므로 라운드와 그림자를 쓴다 — 셸의 규율에서 그림자가
      // 허용되는 유일한 경우다.
      // 그림자는 킷 Popovers의 첫 겹이다 (0 18px 46px #000/0.25). 라운드 20도
      // 팝오버 마스터에서 왔다. 킷은 여기에 유리 가장자리 겹을 다섯 개 더
      // 얹는데 그중 유리는 여기 오지 않는다.
      //
      // "이 셸은 머티리얼을 안 쓴다" 는 폐기됐다 [OWNER, 2026-08-07] — 툴바와
      // 사이드바가 Liquid Glass 를 쓴다. 그런데 이 패널은 여전히 불투명하다.
      // 이유가 뒤집힌 것이 아니라 바뀌었다: HIG Materials 가 유리를 **기능
      // 레이어 전용**으로 두고 "Don't use Liquid Glass in the content layer"
      // 라고 적는다. 커서를 따라다니는 값 읽기는 콘텐츠 위의 콘텐츠라
      // 불투명한 면이 맞고, 그 뒤에 있는 차트를 흐리게 하면 읽으려던 것이
      // 가려진다. 남는 건 "떠 있다" 하나다.
      className="pointer-events-none absolute z-20 rounded-popover border border-edge bg-popover px-3 py-2 shadow-popover"
      style={{ left, top: at.y + OFFSET, width: PANEL_W }}
      // 나타날 때만 페이드한다. **자리 이동은 애니메이션하지 않는다** — 커서를
      // 따라가는 것이 일이라, 뒤늦게 미끄러져 오면 읽으려는 지점과 어긋난다.
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={instant(FAST, reduced)}
    >
      <p className="pb-1 text-callout text-ink-2">{title}</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-baseline justify-between gap-3 text-body">
            <span className={r.muted ? "text-ink-2" : "text-ink-2"}>{r.label}</span>
            <span style={r.color ? { color: r.color } : undefined}>{r.value}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="pt-1.5 text-callout text-ink-2">{footer}</div>}
    </motion.div>
  );
}
