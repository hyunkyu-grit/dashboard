/* Guard (regret session, 2026-08-04): 라고 할 때 살걸 — the change-log
 * popover's hindsight list.
 *
 * Two properties:
 *
 *   ONE VOCABULARY. The line's direction words and its money figure come
 *   from BacktestWindow's own `directionLabel` and `fmtKrw` — imported, not
 *   re-implemented — so the popover and the backtest can never drift into
 *   two grammars for the same trade. The render is checked byte-for-byte
 *   against those functions, and the import is checked at the source so a
 *   local re-implementation cannot sneak back in.
 *
 *   SERVED, NOT DERIVED (§16). The component prints `pnl`, `deltaBp` and
 *   dates as they arrive; the only client arithmetic is formatting. The
 *   source must not compute a P&L, difference a series, or pick a direction
 *   from deltaBp — the server already did (backend/app/regret.py).
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { code, identifiers } from "./_source";

import type { RegretEntry } from "../src/lib/api";
import { directionLabel, fmtKrw } from "../src/ui/BacktestWindow";
import { RegretLine } from "../src/ui/RegretLab";
import { INSTRUMENT_TABS, TOOL_TABS } from "../src/ui/tabs";

const entry = (over: Partial<RegretEntry> = {}): RegretEntry => ({
  date: "2026-07-27",
  id: "3Y-10Y",
  label: "3Y/10Y",
  kind: "spread",
  unit: "bp",
  deltaBp: -9.0,
  reasons: ["transition", "move"],
  direction: -1,
  entry: "2026-07-28",
  matured: false,
  pnl: 22875434,
  ...over,
});

const markup = (r: RegretEntry) =>
  renderToStaticMarkup(createElement(RegretLine, { r, onFocus: () => {} }));

describe("라고 할 때 살걸 — one vocabulary", () => {
  it("prints the money through BacktestWindow's fmtKrw, byte for byte", () => {
    for (const pnl of [22875434, -6092360, 0, 823973]) {
      expect(markup(entry({ pnl }))).toContain(fmtKrw(pnl));
    }
  });

  it("names the direction through BacktestWindow's directionLabel", () => {
    const spread = entry();
    expect(markup(spread)).toContain(directionLabel(spread.id, spread.direction));
    const outright = entry({ id: "10Y", label: "IRS 10Y", kind: "outright", direction: 1 });
    expect(markup(outright)).toContain(directionLabel("10Y", 1));
  });

  it("carries the event date and the label the log itself shows", () => {
    const m = markup(entry());
    expect(m).toContain("7.27"); // shortDate — recent memory, no year
    expect(m).toContain("3Y/10Y");
  });
});

describe("라고 할 때 살걸 — served, not derived (§16)", () => {
  it("RegretLab imports the shared vocabulary instead of re-implementing it", () => {
    const src = identifiers("ui/RegretLab.tsx");
    expect(src).toMatch(/import\s*\{[^}]*directionLabel[^}]*\}\s*from/);
    expect(src).toMatch(/import\s*\{[^}]*fmtKrw[^}]*\}\s*from/);
  });

  it("nothing in the lab panel truncates [OWNER, 2026-08-04: '한글 잘림 꺼라']", () => {
    // A clipped 방향어 hides which trade the figure belongs to. Long lines
    // WRAP; `truncate` (and its raw equivalents) may not return. `code`
    // keeps string literals, where a class name lives — a string occurrence
    // IS the violation.
    const src = code("ui/RegretLab.tsx");
    expect(src).not.toMatch(/\btruncate\b/);
    expect(src).not.toMatch(/text-ellipsis|text-clip/);
  });

  it("the component does no P&L arithmetic of its own", () => {
    // The one place a number is computed from a number in this file must not
    // exist: no dv01/notional math, no deltaBp sign→direction mapping.
    const src = identifiers("ui/RegretLab.tsx");
    expect(src).not.toMatch(/deltaBp\s*[<>]/);
    expect(src).not.toMatch(/pnl\s*[-+*/]/);
    expect(src).not.toMatch(/dv01/i);
  });
});

describe("연구실 — the incubation tab stays FAR RIGHT", () => {
  it("lab is the LAST entry of the tab list [OWNER, 2026-08-04]", () => {
    /* Tab order is the product's order of confidence: experiments enter at
     * the far edge and GRADUATE toward the front on trader feedback. A lab tab
     * that drifted forward without that feedback is the violation.
     *
     * 2026-08-07: 탭 스트립이 사이드바가 되면서 "맨 오른쪽"이 "맨 아래"가
     * 됐다 — 규칙은 그대로고 축만 돌았다. 정의는 ui/tabs.ts 로 옮겼으므로
     * 소스를 정규식으로 긁지 않고 배열을 직접 읽는다. */
    const ids = [...INSTRUMENT_TABS, ...TOOL_TABS].map((t) => t.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids[ids.length - 1]).toBe("lab");
  });
});
