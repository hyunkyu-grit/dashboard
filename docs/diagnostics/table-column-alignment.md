# Table column alignment audit (2026-08-03)

**Symptom as reported:** across the instrument tabs, column header labels do
not sit on the same right-edge line as the numbers in their column; visible in
버터플라이, magnitude appearing to vary per tab and per column
(어제/MTD/YTD/저점/평균 named).

**Verdict: not reproducible at HEAD `a262886` — the alignment invariant holds
at 0.0px on every tab, every column, sorted and unsorted, and in the 전체
overview.** The measured effect that produces the *impression* of a shift is
glyph ink vs. advance width, and it is sub-pixel (≤0.8px). One latent rule
violation was found in `OverviewColumns.tsx` (font-size on ch-track grid
containers) — currently harmless, unguarded, and exactly the pattern that
caused the historical 7/14/21px defect. Pass B fixes that and pins both rules
in `guards/table-grid.test.ts`.

## Method

Live dev server :3100 (HEAD `a262886`, tree clean), Chrome, viewport 2133 CSS
px (left pane is `shrink-0` → table content width constant at 702.2px; the
column ladder state is therefore fixed with every column visible, matching the
symptom's column set). For every tab: computed `grid-template-columns` of the
header row, every body row, and both 52주 sub-grids; then per column the right
edge of the header label's text box vs. the right edge of the numeric text box
in the first 3 body rows, via `Range.getClientRects()` (DOM geometry — the
same edges `text-align: right` aligns).

## Step 1 — grid templates (header vs body)

Byte-identical everywhere, and identical across tabs:

| surface | computed tracks (px) |
|---|---|
| header row, all 5 tabs | `99.6875 95.4375 64.4531 64.4531 64.4531 315.516` |
| every body row, all 5 tabs | same string, byte-identical |
| 52주 sub-grid, header + body | `70.4531 70.4531 70.4531 70.4531 33.7031` |
| 전체 overview Head + rows (×3 columns) | equal (tplEq true) |

There is one template source (`columns.ts::gridTemplate`), one sub-template
source (`rangeTemplate`), and both header and body consume the same computed
`visible` set — no conditional column injects a different track anywhere.

## Step 2 — measured offsets (body numeric right edge − header label right edge)

0.00px for every numeric column on every tab (first 3 rows each):

| tab | 레벨(date) | 어제 | MTD | YTD | 52주 고점 | 저점 | 평균 | 위치 |
|---|---|---|---|---|---|---|---|---|
| 아웃라이트 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | +1* |
| 스프레드 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 버터플라이 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 포워드 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 변동성 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 버터플라이 sorted (어제 ↓) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 전체 overview (3 columns) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | +1* |

\* the 위치 cell is a graphic, not text: the 2px marker is centered on its
position, so at a 52-week extreme it extends 1px past the track end by
construction (`-translate-x-1/2`, clamped at 100%). Not a header offset.

Ruler overlays drawn at the measured edges confirm the rendered pixels sit on
those lines. Canvas `measureText` in the app's face (400 13px Pretendard
Variable) puts the ink-vs-advance slack of every header string under 0.8px
(어제/저점/위치 0.24, 평균 −0.76, MTD/YTD −0.09, digits ±0.4) — i.e. Korean
and letter glyphs carry small right-side bearings while digit strings run
flush, which at 50%-alpha headers beside weight-600 digits is the visual
effect the report describes. In a downscaled screenshot (the report's likely
medium — a 0.73× JPEG turns 1px of bearing into a soft 2–3px ramp) it reads
as a real shift; in the DOM it is sub-pixel and not correctable by layout.

## Steps 3–5 — rule audit

- **Font-size on ch-track grid containers** (the known 63.3-vs-70.4 defect
  class): the instrument-table path is clean — 13px lives on the non-grid
  table wrapper, 11px only on header spans (`RangeCells.tsx`).
  **VIOLATION (latent): `OverviewColumns.tsx` puts `text-[13px]` directly on
  its two ch-track grid containers** (`Head` row, `OverviewRow`). It happens
  to equal the table's inherited 13px today, so both grids resolve `ch`
  identically and nothing is visibly wrong — but the overview's tracks are now
  pinned to a literal rather than to the inherited size, and no guard watches
  it. If either size is ever changed alone, the overview's header and body
  stay in agreement with each other but the drift pattern returns the moment
  someone "fixes" one container.
- **`ui/columns.ts` widths**: all format-derived. The 52주 sub-columns use
  `WIDEST.level` (6 glyphs), the same glyph count 현재's values use; only the
  cushion differs (`RANGE_PAD` 24, sized to the measured Korean label — a
  documented measurement, not a magic width). 위치 is one more sub-track of
  the same width in the same sub-grid. Nothing per-tab anywhere: the template
  cannot differ per tab because it never reads the tab.
- **Padding**: symmetric. All numeric header cells and body cells `pr-3`;
  labels `pl-3` both; range sub-labels and sub-values `pr-3` both; the track
  `mr-3` (same 12px); the hidden-column note `pr-1` in both of its slots.

## Ruled out

- Track-width mismatch (growing offsets): computed templates byte-identical.
- Padding asymmetry (constant offset): identical `pr-3` both sides.
- Sort state: the sorted header ("어제 ↓") right-aligns as one string at the
  same edge; offsets stay 0.
- Ladder state: table width is fixed at 702.2px by the `shrink-0` pane, all
  columns visible — the reported column set matches this state.
- Viewport width/zoom: templates are shared strings, so any `ch` resolution
  or device-pixel rounding lands on header and body identically.

## Pass B (from this diagnosis)

No layout fix exists to make, and no threshold changes: track widths were not
touched, so the ladder figures (한 줄 606 · QTD 486 · MTD 422 · WTD 358 ·
YTD 293 · 어제 229 in the old set; 600/671 for 52주/위치 in the current one)
stand. Pass B instead removes the latent violation (move `text-[13px]` off
the overview's grid containers onto the wrapper both grids inherit from) and
strengthens `guards/table-grid.test.ts` so both invariants are structural:
render the real components and assert (a) every outer grid on the surface
carries the ONE shared template, and (b) no element that carries a ch-derived
`grid-template-columns` style also carries a font-size utility.

## Pass B result

- `OverviewColumns.tsx`: `text-[13px]` moved off the two grid containers onto
  the wrapper `<div>` both grids inherit from — one declaration, both grids,
  `ch` cannot resolve differently between them. Overview still renders at
  13px (verified computed).
- `guards/table-grid.test.ts`: new rendered-markup describe (renders
  `InstrumentTable` per tab + `OverviewColumns` under a `QueryClientProvider`,
  node env via `renderToStaticMarkup`). Verified RED on the pre-fix
  `OverviewColumns` (stash test: exit 1, exactly the font-size assertion) and
  green after. Render-based, so comments/strings cannot fool it.
- Ladder thresholds untouched — no track width changed, so 600 (52주) / 671
  (위치) and the change-column figures all stand.
- Post-fix re-measurement (same method as step 2): worst |offset| = 0.00px on
  all five tabs and all three overview columns; templates still byte-equal.
  Before: also 0.00px (the fix removed a latent risk, not a live offset).
- Gates: FE vitest 472 passed / 1 skipped (38 files), lint 0, build 0.
  Backend untouched.
