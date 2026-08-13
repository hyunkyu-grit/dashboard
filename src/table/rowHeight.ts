/**
 * THE row height. One number, one edit, one visible effect.
 *
 * 48 px is v1's shipped value — the only row height a person has actually worked
 * with. CDS's 52.58 / 36.60 / 28.59 are what the theme happens to produce, which
 * is not the same thing as a decision.
 *
 * Virtualization makes this mandatory rather than merely preferable: spacer
 * heights above and below the rendered window are computed from it, so a row that
 * is not exactly this tall makes the scrollbar lie. The row therefore declares the
 * height explicitly instead of letting padding add up to it — `guards/row-height.test.ts`
 * asserts the two agree, so tuning the space scale cannot silently drift them apart.
 *
 * **This is the owner's dial.** Change this number and the table changes density;
 * nothing else needs to move.
 */
export const ROW_H = 48;

/** The header is its own height — sticky, and not part of the virtual window. */
export const HEADER_H = 40;

/** How many rows to render beyond the visible window. Small enough that the node
 * count stays viewport-bound, large enough that a fast scroll does not show gaps. */
export const OVERSCAN = 8;
