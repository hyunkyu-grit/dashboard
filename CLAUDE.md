# braveworld — KRW IRS Monitor (Design Spec)

Status: authoritative for this repo. `braveworld` is a NEW, STANDALONE
project. It is not a rewrite of krw-fi-pms and does not replace it. Nothing in
krw-fi-pms may be modified by work in this repo — that system is frozen
pending a senior-trader review.

Prior design documents belonging to krw-fi-pms (DESIGN.md, the IBM Carbon
spike, all Marquee-derived rulings) do NOT apply here. Do not read them, do
not port their conventions. If a session finds itself citing them, it has gone
wrong.

Owner decisions are marked [OWNER]. Open items are marked [TBD] and must NOT be
implemented speculatively — leave explicit extension points instead.

## 0. Repo & backend strategy

- Location: `Projects_AS/braveworld` on the owner's workstation. Full-stack and
  self-contained. [OWNER]
- The backend is NOT shared with krw-fi-pms at runtime. Coupling to a frozen
  system is unacceptable, and the endpoints this product needs (wall summary,
  forward matrix, the full spread/fly set) do not exist there anyway.
- Instead, port ONLY the curve-side calculation modules from the existing
  engine into `braveworld/backend`: curve bootstrapping, discount factors,
  forward-rate derivation, and the KRW CD-IRS conventions (CD91 fixing = one
  Seoul business day before the reset date). Do NOT port portfolio valuation,
  MtM, P&L attribution, the scenario engine, or trade storage.
  [Exact module list: TBD — confirm with the owner before copying anything.]
- Rationale for copying rather than importing: the source repo is frozen, the
  surface actually needed is small (curve + forwards), and this product must
  run with the other system switched off.

---

## 1. Product definition

- Single-purpose monitor for the KRW IRS market. IRS data only — no bonds, no
  other asset classes. [OWNER]
- Usage mode: an all-day, always-on monitor, not an on-demand tool. Design for
  the idle state first: most of the time nobody is touching it. [OWNER]
- Priority order: (1) curve viewing/pricing, (2) position/risk monitoring,
  (3) scenario/what-if, (4) trade log. Priorities 3–4 get entry points, not
  permanent panels. [OWNER]
- Interaction philosophy: minimal clicks, drag-centric, but LOW user freedom.
  Layout is fixed; users pan a wall, they do not rearrange it. [OWNER]
- Reference: Toss Securities WTS informs interaction grammar (friction removal,
  URL-as-state, command-first navigation) — NOT its visual identity, NOT its
  low density.

## 2. Core layout — the Wall

A single scrollable "wall" of chart tiles, larger than the viewport, navigated
by dragging (panning). No dockable panels, no user rearrangement, no tile
add/remove. [OWNER]

- Wall grid: columns = time bases (fixed 6: Now, D-1, WTD, MTD, QTD, YTD),
  rows = object categories. Tenor lives INSIDE tiles, not on the wall axes.
  [OWNER]
- Wall width fits 1920 viewport (6 columns × ~300px + gaps ≈ 1840px), so
  panning is VERTICAL ONLY. Do not implement horizontal panning.
- Column headers pinned to top; row/band labels pinned to left.
- Tile positions are permanent (muscle memory). NO sorting, NO reordering of
  tiles, ever.
- All ~260 tiles stay mounted (no virtualization): downsampled data is small
  (~150 pts/series) and unmount flicker during panning is worse than the
  memory cost.
- Panning: pointermove must NOT trigger React re-renders. Drag session state
  lives in refs; transform is applied imperatively to the wall container;
  commit on pointerup. This rule is absolute for every drag in the app.
- Tile click → detail overlay (enlarged chart in place). Esc / click-out
  closes. No separate detail panel.

### Band structure (top to bottom)

1. **Band 1 — tenor-axis overlays**: IRS curve overlay tile + volatility tile
   (placeholder, see §6) side by side.
2. **Band 2 — forwards**: 8 column-slice forward tiles (4×2), then the forward
   matrix table + key-forward block below them.
3. **Band 3+ — time-series matrix**: rows = 6 outrights + 35 spreads
   (see §7), columns = 6 time bases. [TBD — tile spec not yet designed; build
   bands 1–2 first, leave band 3 as a stub region.]

Estimated wall height ≈ 8,000px. This is fine — it's a pannable wall.

## 3. Global chrome

- **Top status strip** (always visible): data timestamps, connection state,
  the global comparison-basis selector (Now/D-1/WTD/MTD/QTD/YTD — one control
  that re-bases every delta representation on the wall), compact risk summary
  numbers (total DV01, day P&L — exact set [TBD], leave a slot), theme toggle.
- **Bottom change log**: outlier events append as single lines; clicking a
  line pans the viewport to that tile. This is how off-screen anomalies are
  surfaced. Also the entry point for scenario/trade-log features later.
- **Command bar**: hidden by default; `/` or Cmd+K summons it. Typing a series
  name ("5y", "3s10s", "1yf") pans to that tile. No menu navigation anywhere.
- **Home key**: one keystroke returns the viewport to the wall origin.

## 4. Data & sources

- Curve live nodes (10): 1D (call rate), 3M (IRS 3M = CD91), 6M, 9M, 1Y, 1.5Y,
  2Y, 3Y, 5Y, 10Y. [OWNER]
- Display tenor set for spreads/heatlike aggregation: 1Y, 1.5Y, 2Y, 3Y, 5Y,
  10Y. [OWNER]
- History: last 10 years of daily data per series. [OWNER]
- Two-stage loading: stage 1 = per-series summary (current value, 6 deltas,
  10Y min/max/percentile, ~150-pt downsampled sparkline series) for the whole
  wall; stage 2 = full-resolution series on demand (detail overlay). All
  derived series (spreads, flies, forwards, rolling vol) are computed on the
  BACKEND, never in the browser.
- Volatility: rolling realized vol of daily par-rate changes per tenor.
  Formula [TBD — owner will provide]. Until then the vol tile is an empty
  placeholder that reserves its slot. [OWNER]
- Spreads: IRS-vs-IRS curve spreads only (no bond/swap-spread). ALL
  combinations from the 6 display tenors: 15 two-point spreads + 20
  butterflies = 35 series. [OWNER]

## 5. Monochrome policy (critical)

Ship with NO hue anywhere. [OWNER] Every encoding must work in grayscale
first; color may be layered on later, so nothing may DEPEND on hue.

Channel budget — each channel has exactly one meaning, app-wide:

| Channel        | Meaning                                   |
|----------------|-------------------------------------------|
| Ink opacity    | Time basis (ramp, see §9)                 |
| Line width     | Time basis (secondary, disambiguates ramp)|
| Text weight 600| Outlier only (percentile extreme / large delta) |
| Cell border    | Structural: live-quoted (non-interpolated) point |
| Marker dot     | Live-quoted node on charts                |
| Mini-bar       | Delta sign+magnitude in tables (center-zero, right=+, left=−) |

Do not reuse a channel for a second meaning. Sign is expressed by minus signs,
triangles, and bar direction — never by color, never by lightness.

## 6. Tile spec — curve overlay (Band 1)

- X axis: 9 nodes, EQUAL spacing, 1D excluded: 3M, 6M, 9M, 1Y, 1.5Y, 2Y, 3Y,
  5Y, 10Y. [OWNER — √t proportional was considered and rejected]
- 6 curves overlaid (Now + 5 historical bases), opacity ramp per §9, Now
  thickest (2px) and fully opaque.
- Markers on ALL 6 curves at all 9 nodes (spacing allows it).
- Y axis: absolute rate levels; range = min/max across all 6 curves + 5% pad.
  Fixed-vs-auto range policy [TBD — decide after replaying ~10 days of real
  data; implement auto-fit first, keep the range function swappable].
- Vertical gridlines at each tenor (they double as tenor guides).
- Last-value badge: Now only, top-right of tile.
- Hover on a tenor: gridline darkens, label bolds, readout updates.
- **Fixed readout strip** at tile bottom (NOT a tooltip — persistent, two
  lines): line 1 = hovered tenor · level · all 5 deltas; line 2 = annualized
  segment slope in bp/yr for the hovered segment (corrects the equal-spacing
  distortion) plus 1D call rate value. Default (no hover) shows 10Y.

## 7. Tile spec — forward column slices (Band 2)

8 tiles, one per forward tenor: SPOT, 3MF, 6MF, 9MF, 1YF, 2YF, 3YF, 5YF.
Layout 4×2, each tile ~1.5 wall-columns wide. [OWNER]

- X axis: 21 forward start points (ON, then 3M steps to 5Y), equal spacing
  (here it's genuinely uniform in time, no distortion).
- 6 time-basis lines overlaid, same opacity/width ramp as §6.
- Markers ONLY where BOTH the start and end of the forward period land on
  live-quoted curve nodes (e.g. for 1YF: ON, 6M, 1Y, 2Y starts). Marker
  presence = "this point sits on quotes, not interpolation."
- Y axis: INDEPENDENT per tile (SPOT spans ~160bp, 5YF ~9bp; a shared axis
  would flatten the far tiles). Print the Y-span in bp in each tile header so
  cross-tile magnitude comparison survives.
- Readout strip: hovered start · Now value · 5 deltas / line 2: live-node
  flag + the actual start date.

## 8. Table spec — forward matrix (Band 2)

The table is for exact value reading; the tiles are for shape. Both exist.

- 21 rows (start points, real dates in a pinned second column) × 8 forward
  tenor columns. Values at 4 decimal places (e.g. 4.2446). [OWNER]
- Column width ~74px at 13px font; total table ≈ 748px + key-forward block on
  the right.
- Each cell: value line + a center-zero mini-bar underneath encoding the delta
  vs the global comparison basis (length = magnitude, direction = sign).
  Changing the global selector re-bases every bar.
- Live-quoted intersections (start AND end on live nodes) get a visible cell
  border — same rule as tile markers. No other cell decoration. The purple
  "key forward" shading from the legacy sheet is DROPPED (redundant with the
  key-forward block).
- Bold row separator above each integer-year row (2Y, 3Y, 4Y, 5Y).
- Header row and the two left columns are pinned. NO sorting (row order is
  time; sorting would destroy it).
- Hovering a cell highlights the corresponding point in the matching column-
  slice tile above (linked highlight).
- **Key-forward block** (right of matrix): rows = the named forwards from the
  legacy sheet (6Mx3M, 1Yx1Y, 2Yx1Y, 2Yx2Y, 3Yx3Y, 5Yx5Y, …), columns = the
  6 time bases, same cell grammar (value + mini-bar).

## 9. Design tokens

### Time-basis ramp (opacity × line width)

| Basis | Opacity (light) | Opacity (dark) | Line width |
|-------|-----------------|----------------|------------|
| Now   | 1.00            | 1.00           | 2.0        |
| D-1   | 0.78            | 0.74           | 1.5        |
| WTD   | 0.60            | 0.56           | 1.3        |
| MTD   | 0.47            | 0.43           | 1.1        |
| QTD   | 0.36            | 0.32           | 1.0        |
| YTD   | 0.28            | 0.24           | 1.0        |

[OWNER: floor 0.28 chosen over 0.20 — readability over contrast.]

### Surfaces

| Role          | Light    | Dark     |
|---------------|----------|----------|
| Page          | #FAFAFA  | #1A1A1A  |
| Tile          | #FFFFFF  | #202020  |
| Popover       | #FFFFFF  | #262626  |
| Ink           | #1A1A1A  | #EDEDED  |
| Border        | ink 12%  | ink 18%  |
| Live border   | ink 40%  | ink 55%  |

[OWNER: default theme = LIGHT; dark = neutral dark-gray #1A1A1A family, not
pure black, not blue-gray. Theme is user-switchable.]

Implementation: every color goes through semantic CSS custom properties with
light/dark pairs; zero raw hex in component code (enforce with a lint guard).
No shadows for depth (they die in dark mode) — depth = surface steps + borders.
Chart canvases cannot resolve CSS variables: build a theme bridge that injects
RESOLVED hex into canvas-bound options and triggers redraw on theme switch.
This was a recurring defect class in the old system — gate it with a test that
rejects `var(` strings in canvas-bound option objects.

### Typography

- Font: Pretendard Variable. `font-variant-numeric: tabular-nums` enforced
  globally — every numeral in the app.
- Sizes/weights: cell·axis·readout 13/400 [OWNER]; outlier value 13/600;
  tile title 14/600; band title 15/600. Weight 600 appears ONLY on outliers
  and titles. Two weights total.

### Spacing

4px base grid. Tile padding 12, tile gap 8, band gap 16, table row height 26,
table header height 32.

## 10. Interaction rules

- Confirmation dialogs: none inside the analysis surface. Every action is
  optimistic + undoable (single undo stack). Nothing on this monitor is an
  order/execution action in v2.
- Drag threshold 5px (below = click). Wall pan is the ONLY free drag; it is
  vertical-only by construction.
- Hover is the primary inspection gesture and must never move layout. Readout
  strips occupy reserved space at all times. Floating tooltips are banned: in
  the predecessor system a component-kit tooltip wrapped cell contents in a
  shrink-to-fit inline span and silently broke column alignment while the DOM
  looked correct. Do not reintroduce that class of defect.
- URL reflects state: focused tile / detail overlay target lives in the query
  string (deep-linkable, back-button works, shareable).
- Keyboard: `/` or Cmd+K command bar, Esc closes overlay, Home returns to
  origin.

## 11. Stack

- Next.js (App Router) + TypeScript + Tailwind. Router owns entry + URL
  state; the wall itself is one route.
- Zustand with subscribeWithSelector for client state; transient updates for
  anything touched during drag.
- TanStack Query for server state (stage-1 summary + stage-2 detail fetches).
- Charts: lightweight tiles are hand-rolled SVG paths (or one shared canvas) —
  do NOT instantiate a chart library per tile (~260 tiles). A full chart
  library (lightweight-charts) is used ONLY inside the detail overlay.
- No component kit (no Carbon, no Blueprint, no MUI). Headless primitives
  (Radix) only where genuinely needed (popover, dialog); all styling is ours.
- cmdk for the command bar.
- Backend: this repo's own FastAPI/QuantLib service (see §0). Endpoints: wall
  summary (stage 1), per-series full history (stage 2), forward matrix, full
  spread/fly set. All derivations server-side.

## 12. Build order

1. Token layer + theme bridge + guards (raw-hex lint, canvas-var test).
2. Wall shell: fixed grid, vertical pan (imperative transform), pinned
   headers, home key, URL state.
3. Curve overlay tile (§6) against real data — validates the ramp, the
   readout, and the fixed-vs-auto Y question.
4. Forward column-slice tiles (§7).
5. Forward matrix table + key-forward block (§8) + linked highlight.
6. Status strip + comparison-basis selector wired to every delta consumer.
7. Change log + outlier detection (weight-600 rule needs a percentile
   threshold — start with |Δ| ≥ 10Y-percentile 95 and make it a constant).
8. Command bar + tile jump.
9. Detail overlay with full-resolution history.
10. Band 3 time-series matrix [TBD — spec with owner first].

## 13. Explicitly out of scope for v2

- Vol tile internals (placeholder only until formula arrives).
- Any color/hue. Any user layout customization. Panel add/remove.
- Scenario engine UI, trade capture UI (entry points only via change log).
- Band 3 tile spec (do not improvise it).