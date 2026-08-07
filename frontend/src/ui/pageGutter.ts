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
 * 80 → 24 [2026-08-07, 사이드바가 들어오면서].
 *
 * 80 은 표면이 full-bleed 이던 시절의 값이다. 창 가장자리가 곧 콘텐츠의 경계라
 * 콘텐츠를 그만큼 안으로 들여야 했다. 이제 왼쪽 경계는 창이 아니라 240px
 * 사이드바이고, 사이드바는 이미 자기 몫의 분리를 한다 — 80 을 그대로 두면
 * 첫 열까지 320px 이 빈다. 목업(defense.html)의 `.content` 는 18px 이고,
 * 240 + 24 = 264 로 그 배치와 같은 자리에 온다.
 *
 * 앞 판이 적어 둔 "전체 탭이 justify-evenly 로 79px 을 만든다" 는 이유는
 * 사라졌다 — 그 탭도 이 컨테이너 안에서 분배되므로 컨테이너가 좁아지면 같이
 * 좁아진다. 하나의 수를 모두가 쓴다는 원칙만 남는다.
 *
 * Tailwind scans source text for class names, so this has to be the literal
 * `px-6`, never a template built from a number.
 */

/** Horizontal page gutter for a full-width surface. */
export const PAGE_X = "px-6";

/** The gutter on the RIGHT edge only — the preview pane, whose left edge is
 * the interior pane divider and takes the ordinary 20px. Spelled out as its
 * own literal rather than derived from PAGE_X: Tailwind reads source text, so
 * `PAGE_X.replace("px-", "pr-")` produces a class at runtime that was never
 * generated at build time, and the padding silently disappears. */
export const PAGE_R = "pr-6";

/** The same gutter as a number, for measurements that cannot use a class —
 * chart widths are computed from a pane's content box. Keep in step with
 * PAGE_X: 6 × 4px = 24. */
export const PAGE_X_PX = 24;
