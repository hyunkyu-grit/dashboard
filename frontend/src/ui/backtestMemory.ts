/* Session memory for the backtest sheet (pass Q, 2026-08-03).
 *
 * THE BUG THIS EXISTS FOR: the sheet's contents — the book the reader built
 * and the result they ran — lived only in component state, while closing the
 * sheet PUSHED a fresh `/` entry. History filled with popup entries, and any
 * back/forward step that re-entered one mounted a fresh sheet: the reader
 * returned to an EMPTIED popup rather than the one they left.
 *
 * The rule now: any history traversal that re-shows a popup shows it AS LAST
 * LEFT. The sheet writes its book (and its last result) here as they change,
 * keyed by the popup INSTANCE — the `bt` nonce `openBacktest` mints into the
 * URL on each deliberate open. Instance-keyed on purpose:
 *
 *   — back/forward re-enter the SAME instance (same nonce in the restored
 *     URL), so they restore;
 *   — a new chart click mints a NEW nonce, so a deliberate re-open of the
 *     same instrument still seeds fresh from the clicked date, exactly as
 *     before;
 *   — a pasted link carries someone else's nonce and finds nothing here,
 *     so it seeds fresh — the memory is session-local by design (an
 *     in-memory Map: surviving a reload would need storage, and a reload is
 *     a fresh session, not a traversal).
 *
 * The RESULT is remembered, not re-run. "IT DOES NOT RUN ON ITS OWN" (§
 * backtest) still holds: what is restored is an answer the reader already
 * pressed 실행 for, and coming back to it costs no server round-trip.
 */

import type { BacktestResult, PositionInput } from "@/lib/api";

export interface BacktestMemory {
  book: PositionInput[];
  result?: BacktestResult;
}

const memory = new Map<string, BacktestMemory>();

let seq = 0;

/** A fresh instance key for a deliberate open — unique within the session,
 * meaningless outside it. */
export function mintBacktestKey(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}`;
}

export function loadBacktestMemory(key: string): BacktestMemory | undefined {
  return memory.get(key);
}

/** Merge-write: the book and the result arrive from different places (state
 * change vs mutation success) and neither may clobber the other. */
export function saveBacktestMemory(
  key: string,
  patch: Partial<BacktestMemory>,
): void {
  const cur = memory.get(key);
  memory.set(key, {
    book: patch.book ?? cur?.book ?? [],
    result: patch.result ?? cur?.result,
  });
}
