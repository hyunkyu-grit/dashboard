/* URL namespaces (backtest-window session, 2026-08-03).
 *
 * The URL carries TWO independent things: the enlarged view (`tile`, `type`,
 * plus the transient `missing` notice) and the backtest window (`bt` — the
 * instance nonce, `bti` — the seed instrument, `btf` — the seed entry date).
 * They used to be one thing — `?tile` opened the backtest and closing either
 * destroyed both — and the whole class of back-wipes-my-popup bugs (pass Q
 * patched one) came from that coupling.
 *
 * The rule now: EVERY URL write goes through `mergeQuery`, which patches only
 * the keys it is handed and carries everything else forward verbatim. Opening
 * the enlarged view cannot drop the backtest params; closing the backtest
 * cannot drop the tile. The two views compose because neither can see the
 * other's keys. Pinned by guards/backtest-window.test.ts.
 */

/** The backtest window's whole namespace — cleared together on close. */
export const BT_KEYS = ["bt", "bti", "btf"] as const;

/** A query string ("" or "?k=v&…") from the current params plus a patch.
 * `null` deletes a key; everything not named in the patch is preserved. */
export function mergeQuery(
  current: URLSearchParams,
  patch: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  const s = next.toString();
  return s ? `?${s}` : "";
}

/** The close patch: the whole bt namespace, nulled. */
export function clearBtPatch(): Record<string, null> {
  return Object.fromEntries(BT_KEYS.map((k) => [k, null])) as Record<
    string,
    null
  >;
}
