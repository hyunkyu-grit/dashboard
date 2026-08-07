/* Guard: ONE page gutter, used by every surface that reaches the window edge
 * (2026-07-31 — "모든 탭의 전반적인 맨 좌우 간격도 전체에 맞추기").
 *
 * The surfaces that touch the edge are not one element: the header band, the
 * tab strip, the table's scroll container, the preview pane and the bottom
 * strip each reach it independently. Four of them agreeing while the fifth
 * does not is invisible until the fifth is on screen beside the others — so
 * the constant is asserted rather than the pixel value.
 */

import { describe, expect, it } from "vitest";

import { code } from "./_source";
import { PAGE_R, PAGE_X, PAGE_X_PX } from "../src/ui/pageGutter";

const SURFACES = [
  "ui/App.tsx",
  "ui/InstrumentTable.tsx",
  "ui/BottomStrip.tsx",
] as const;

describe("the page gutter", () => {
  it("is a literal class, not one built at runtime", () => {
    /* Tailwind scans SOURCE TEXT. A class assembled at runtime — the first
     * attempt here was `PAGE_X.replace("px-", "pr-")` — names a rule that was
     * never generated, and the padding silently does not exist. Both edges get
     * their own spelled-out literal for that reason. */
    /* 80 → 24 [2026-08-07]: 왼쪽 경계가 창이 아니라 240px 사이드바가 되면서
     * 콘텐츠를 창 가장자리에서 밀어낼 이유가 사라졌다. 값이 아니라 "하나의
     * 상수를 모두가 쓴다" 가 이 가드의 주장이므로 숫자만 옮긴다. */
    expect(PAGE_X).toBe("px-6");
    expect(PAGE_R).toBe("pr-6");
    const gutter = code("ui/pageGutter.ts");
    expect(gutter).not.toMatch(/\.replace\(/);
    expect(gutter).not.toMatch(/\$\{/);
  });

  it("the px number and the class agree", () => {
    // PANE_PAD does chart-width arithmetic in px and cannot read a class
    expect(PAGE_X_PX).toBe(Number(PAGE_X.split("-")[1]) * 4);
  });

  it("every edge-touching surface imports it", () => {
    for (const f of SURFACES) {
      expect(code(f), f).toMatch(/from "\.\/pageGutter"/);
    }
  });

  it("no edge surface still hard-codes the old 20px inset", () => {
    /* `px-5` was the app-wide inset before this: a card's padding applied to a
     * full-bleed surface. It survives INSIDE components (the bottom sheet, the
     * preview pane's interior edge); what must not survive is a top-level
     * horizontal padding on a surface that reaches the window. */
    expect(code("ui/App.tsx")).not.toMatch(/className="[^"]*\bpx-5\b/);
    expect(code("ui/InstrumentTable.tsx")).not.toMatch(/className="[^"]*\bpx-5\b/);
    expect(code("ui/BottomStrip.tsx")).not.toMatch(/className="[^"]*\bpx-3\b/);
  });

  it("the 전체 overview TAKES the gutter now — its columns no longer supply it", () => {
    /* 뒤집혔다 [2026-08-07]. `justify-evenly` + max-content 는 남는 폭을 네
     * 등분해 바깥 여백을 스스로 만들었고, 그래서 컨테이너 패딩이 금지였다.
     * 열이 `minmax(0,1fr)` 이 되면서 나눠 줄 남는 폭이 사라졌으므로 — 그게
     * 잘림을 고친 방법이다 — 바깥 여백은 컨테이너가 져야 한다. 안 주면 박스가
     * 사이드바와 창 가장자리에 붙는다. */
    const overview = code("ui/OverviewColumns.tsx");
    expect(overview).not.toContain("justify-evenly");
    expect(overview).not.toMatch(/PAGE_X/); // 여전히 열 자신은 거터를 모른다
    /* 거터를 누가 갖느냐가 2026-08-07 에 갈렸다. 행 목록은 **그룹박스** 안에
     * 들어갔고 거터는 그 박스를 감싸는 래퍼(`Boxed`)가 갖는다 — 스크롤
     * 컨테이너가 또 주면 테두리 안쪽에 빈 띠가 두 겹 생긴다. 오버뷰·시뮬레이션은
     * 박스가 없어 예전 그대로고, 연구실만 여전히 스크롤 컨테이너가 거터를 든다. */
    const table = code("ui/InstrumentTable.tsx");
    expect(table).toMatch(/<GroupBox className="h-full">/);
    expect(table).toMatch(/`min-h-0 flex-1 pb-3 pt-3 \$\{PAGE_X\}`/);
    expect(table).toMatch(/isLab\s*\?\s*`\$\{PAGE_X\}/);
    // 오버뷰도 이제 컨테이너에서 거터를 받는다
    expect(table).toMatch(/isOverview\s*\r?\n?\s*\?\s*`flex flex-col pb-8 pt-3 \$\{PAGE_X\}`/);
  });

  it("the scrollbar gutter is off on the overview and on for the table", () => {
    /* `scrollbar-gutter: stable` keeps the TABLE's grid width constant when a
     * filter crosses the overflow boundary. On the overview — a fixed set with
     * no filters and nothing to scroll — the 16px it reserves is blank space
     * that shows up as a wider RIGHT margin than left. */
    const table = code("ui/InstrumentTable.tsx");
    expect(table).toMatch(/"px-3 pb-3 pt-1 \[scrollbar-gutter:stable\]"/);
    // 오버뷰·시뮬레이션·연구실은 그 예약 폭을 쓰지 않는다 — 셋 다 다른 팔이다
    expect(table).toMatch(/isSim\s*\r?\n?\s*\? "flex flex-col pb-8 pt-3"/);
  });
});
