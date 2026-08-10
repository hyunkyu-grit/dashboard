/* Floating-window geometry (backtest-window session, 2026-08-03).
 *
 * One window, one freedom: WHERE it sits. No resize, no minimize, no second
 * instance — the design keeps user freedom low, and each of those would be a
 * state the product then has to be legible in. The position is session
 * memory only (a module variable): it survives close/reopen so the window
 * comes back where the reader put it, and a reload — a fresh session —
 * starts at the default. Deliberately NOT localStorage: a persisted position
 * on a different monitor is a window nobody can find.
 */

export interface WinPos {
  left: number;
  top: number;
}

/** The window's fixed width; content (the 880px P&L chart) plus padding. */
export const WINDOW_W = 928;

/** 시뮬레이션 결과 창은 더 넓다 [OWNER, 2026-08-10 — "결과창 좀 키워서 최대한
 * 한눈에"]. 케이스 비교·성분 커브·일별 KRD(테너 15개까지) 가 한 창에 살게
 * 되면서 928 은 대사 표를 가로 스크롤로 밀어냈다. 뷰포트가 이보다 좁으면
 * CSS min() 이 줄인다(SimulationWindow 의 style) — 위치 클램프는 이 값
 * 기준이라 좁은 화면에서 left 가 0 으로 앵커된다. */
export const SIM_WINDOW_W = 1320;

/** The drag handle's height — the strip that must NEVER leave the viewport,
 * or the window can be pushed somewhere it cannot be dragged back from. */
export const WINDOW_HEADER_H = 48;

/** Clamp so the window stays fully inside horizontally (left-anchored when
 * the viewport is narrower than the window) and the HEADER stays fully
 * inside vertically — the body may hang below the fold, the handle may not. */
export function clampWindowPos(
  pos: WinPos,
  viewport: { w: number; h: number },
  winW: number = WINDOW_W,
): WinPos {
  return {
    left: Math.max(0, Math.min(pos.left, viewport.w - winW)),
    top: Math.max(0, Math.min(pos.top, viewport.h - WINDOW_HEADER_H)),
  };
}

/** First-open default: horizontally centred, near the top — over the pane
 * rather than the table, so the list stays workable beside it. */
export function defaultWindowPos(
  viewport: { w: number; h: number },
  winW: number = WINDOW_W,
): WinPos {
  return clampWindowPos(
    { left: Math.round((viewport.w - winW) / 2), top: 56 },
    viewport,
    winW,
  );
}

/* 창마다 자기 자리를 기억한다 [2026-08-07].
 *
 * 전에는 모듈 변수 하나였다. 창이 하나뿐일 때는 맞는 모양이었지만 시뮬레이션
 * 결과 창이 생기면서 틀린 모양이 됐다 — 하나를 옮기면 다른 하나가 다음에 열릴
 * 때 거기로 따라간다. "reader가 놓아 둔 자리로 돌아온다" 는 약속이 창마다
 * 성립해야 하므로 키를 받는다.
 *
 * 여전히 localStorage 가 아니다: 다른 모니터에서 복원된 위치는 아무도 못 찾는
 * 창이 된다. */
export type WindowKey = "backtest" | "simulation";

const remembered = new Map<WindowKey, WinPos>();

/** The session's position for this window, or the default for this viewport. */
export function initialWindowPos(
  viewport: { w: number; h: number },
  key: WindowKey,
  winW: number = WINDOW_W,
): WinPos {
  const seen = remembered.get(key);
  return seen ? clampWindowPos(seen, viewport, winW) : defaultWindowPos(viewport, winW);
}

/** Record where the reader put it (already clamped by the caller). */
export function rememberWindowPos(pos: WinPos, key: WindowKey): WinPos {
  remembered.set(key, pos);
  return pos;
}
