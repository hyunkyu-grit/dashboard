/**
 * THE row height. One number, one edit, one visible effect.
 *
 * 60 px [OWNER 2026-08-13], carrying a two-line name cell (instrument + its
 * tenor/curve position). The previous value was 48 — v1's shipped single-line
 * row — and it was chosen before there was a second line to fit.
 *
 * ── Why 60 and not a tuned number ───────────────────────────────────────────
 * It is not hand-picked. CDS's recommended cell density is
 * `spacingVariant="condensed"`: padding `--space-1` top and bottom, no
 * min-height, so the row is exactly its content plus that padding. With CDS's
 * own scale (`space[1]` = 8) a two-line stack computes to
 *
 *     title (body, line-height 24) + description (label2, line-height 20) = 44
 *     + 8 top + 8 bottom                                                  = 60
 *
 * So 60 is what CDS's recommended variant produces for the row this product
 * actually needs; the design mockup landed at 58 independently, which is the
 * same row. `normal` (80) and `compact` (40) are both deprecated in CDS 9.15
 * and neither fits a two-line rates row.
 *
 * ── Why it is declared rather than allowed to add up ────────────────────────
 * Virtualization makes this mandatory rather than merely preferable: spacer
 * heights above and below the rendered window are computed from it, so a row
 * that is not exactly this tall makes the scrollbar lie. The row declares the
 * height explicitly and `guards/virtualization.test.tsx` holds it to a finite
 * number, so tuning the space scale cannot silently drift the two apart.
 *
 * ── The number, verified in the running app rather than derived ─────────────
 * The declared height is a MINIMUM as far as the DOM is concerned, so it is only
 * honest if the cell's NATURAL height is not above it. Measured live, with the
 * inline height removed so the content spoke for itself:
 *
 *     name stack            36   (label1 line-height 20 + legal line-height 16)
 *     CDS inner cell pad    12   (--space-1 ×2)
 *     CDS outer cell pad    12   (--space-1 ×2)
 *                          ───
 *     natural content box   60   ← exactly ROW_H, no headroom spent and none owed
 *
 * CDS nests TWO paddings inside a `TableCell`, which is why this lands on 60
 * with `sauronTheme.space['1'] = 6` rather than CDS's 8 — at 8 the same stack
 * would be 68. The arithmetic in the block above (CDS `condensed` = 44 + 16)
 * predicts the same 60 from CDS's own scale by a different route.
 *
 * ── Known, and PRE-EXISTING: the row's RECT is 60.5, not 60 ─────────────────
 * `getBoundingClientRect()` reports 60.5–61 because `Table variant="ruled"`
 * draws a 1px rule under each row under `border-collapse: collapse`, and half
 * of that shared border falls inside each neighbour's box. The content box is
 * exactly 60; the rule is the remainder.
 *
 * The virtualiser estimates 60 and does not measure elements, so spacer
 * arithmetic accumulates that half pixel — about 38px over 77 rows, which makes
 * the scrollbar slightly optimistic and breaks nothing. This is not new at 60:
 * at the previous 48 the rect was 48.5 for the same reason. Fixing it means
 * either a fractional ROW_H (which is not uniform — the first and last rows
 * carry a different share of the collapsed border) or giving up the rule, and
 * neither is worth doing silently.
 *
 * **This is the owner's dial.** Change this number and the table changes
 * density; nothing else needs to move.
 */
export const ROW_H = 60;

/** The header is its own height — sticky, and not part of the virtual window. */
export const HEADER_H = 40;

/** How many rows to render beyond the visible window. Small enough that the node
 * count stays viewport-bound, large enough that a fast scroll does not show gaps. */
export const OVERSCAN = 8;
