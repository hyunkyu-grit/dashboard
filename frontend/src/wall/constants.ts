/* Wall geometry — design spec §2 + §9 spacing. */

export const N_COLS = 6;
export const COL_W = 300;
export const COL_GAP = 8;
export const WALL_W = N_COLS * COL_W + (N_COLS - 1) * COL_GAP; // 1840

export const LEFT_RAIL_W = 72; // pinned band labels
export const HEADER_H = 32; // pinned column headers
export const BAND_GAP = 16;
export const TILE_PAD = 12;

export const DRAG_THRESHOLD_PX = 5; // below = click (design spec §10)
