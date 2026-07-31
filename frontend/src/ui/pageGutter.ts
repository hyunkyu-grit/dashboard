/* THE page gutter — how far every surface stays off the window edge.
 *
 * [OWNER, 2026-07-31 — "모든 탭의 전반적인 맨 좌우 간격도 전체에 맞추기, 그냥
 * 맨 좌우를 비운다고 생각하기"]. The app sat 20px off the edge everywhere,
 * which is a card's inset applied to a full-bleed surface; the 전체 tab's three
 * columns had just landed on a much wider one and the rest of the product
 * looked cramped beside it.
 *
 * ONE constant, because the surfaces that touch the edge are not one element:
 * the header band, the tab strip, the table's scroll container, the preview
 * pane and the bottom strip all reach it independently, and four of them
 * agreeing while the fifth does not is exactly the kind of drift nobody
 * notices until the fifth is on screen next to the others.
 *
 * WHY 80px, and why it is a plain number rather than derived: the 전체 tab
 * distributes ITS leftover width with `justify-evenly`, so its outer margin is
 * whatever a quarter of the leftover comes to — 79px at the owner's window,
 * and different at every other width. Matching that exactly everywhere would
 * mean every surface measuring the overview's arithmetic. 80 is that figure
 * rounded, fixed, and close enough that the two read as one decision.
 *
 * Tailwind scans source text for class names, so this has to be the literal
 * `px-20`, never a template built from a number.
 */

/** Horizontal page gutter for a full-width surface. */
export const PAGE_X = "px-20";

/** The gutter on the RIGHT edge only — the preview pane, whose left edge is
 * the interior pane divider and takes the ordinary 20px. Spelled out as its
 * own literal rather than derived from PAGE_X: Tailwind reads source text, so
 * `PAGE_X.replace("px-", "pr-")` produces a class at runtime that was never
 * generated at build time, and the padding silently disappears. */
export const PAGE_R = "pr-20";

/** The same gutter as a number, for measurements that cannot use a class —
 * chart widths are computed from a pane's content box. Keep in step with
 * PAGE_X: 20 × 4px = 80. */
export const PAGE_X_PX = 80;
