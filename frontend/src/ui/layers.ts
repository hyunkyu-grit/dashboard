/* THE stacking order. Every fixed/absolute overlay picks its layer from here.
 *
 * [OWNER, 2026-07-31] "밑에 팝업이 이거 때문에 가려지는데" — the bottom strip
 * was painting over the backtest sheet. Not a styling slip: the strip is
 * chrome at z-40 and the sheet was a modal at z-30, so the numbers said the
 * opposite of what the product means. The preview sheet (z-20) had the same
 * bug and nobody had opened it next to the strip yet.
 *
 * The rule is one sentence: A MODAL IS ABOVE CHROME, ALWAYS. A modal dims the
 * whole screen and takes the interaction; anything still painting on top of it
 * is either unreachable behind the dim or reachable and shouldn't be.
 *
 * Named rather than numbered at each call site because these are picked in
 * five different files and the conflict is invisible until two of them are on
 * screen together — the same failure mode the page gutter had. Tailwind scans
 * source text, so every value here is a literal class.
 */

/** Sticky table header — inside the scroll container, below everything else. */
export const Z_TABLE_HEAD = "z-10";

/* ── 셸의 두 기둥 [2026-08-07] ───────────────────────────────────────────────
 * 둘 다 격자 행이 아니라 **떠 있는 레이어**다 (HIG Materials: Liquid Glass
 * "floats above the content layer"). 그래서 여기에 번호가 필요하다 — 본문은
 * 이 둘 밑으로 지나간다.
 *
 * 툴바가 사이드바보다 위다: 툴바는 창 폭을 가로지르고 사이드바는 그 밑에서
 * 시작한다. 반대로 두면 사이드바 머리가 툴바를 뚫는다.
 * 둘 다 Z_CHROME 아래다. 지표 바·명령 바는 본문 위에 얹히는 것이고 이 둘은
 * 본문의 **테두리**라, 겹칠 일이 생기면 얹히는 쪽이 이겨야 한다. */
export const Z_SIDEBAR = "z-20";
export const Z_TOOLBAR = "z-30";

/** Page chrome that outlives the content: the bottom strip, the command bar. */
export const Z_CHROME = "z-40";

/** The floating backtest window (backtest-window session): a parallel work
 * surface the reader positioned, so it rides above chrome — but BELOW modals,
 * which dim the screen and take the interaction; a window that painted over a
 * modal would be reachable when it shouldn't be. Chart tooltips live inside
 * the panes (local z) and are covered only where the window sits, which the
 * reader can change by dragging — occlusion is never permanent. */
export const Z_WINDOW = "z-[45]";

/** Modals: the enlarged view, the mobile preview sheet. Above chrome AND
 * above the floating window. */
export const Z_MODAL = "z-50";
