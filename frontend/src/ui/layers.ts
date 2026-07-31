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

/** Page chrome that outlives the content: the bottom strip, the command bar. */
export const Z_CHROME = "z-40";

/** Modals: the backtest sheet, the mobile preview sheet. Above chrome. */
export const Z_MODAL = "z-50";
