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
- Usage mode: **an on-demand tool a trader opens several times a day**, not an
  always-on wall. [OWNER 2026-07-24, Session 12] Design for someone who has
  just arrived and is actively looking — the first thing they need is "what
  changed since I last looked." There is no idle state to optimize for.
- Priority order: (1) curve viewing/pricing, (2) position/risk monitoring,
  (3) scenario/what-if, (4) trade log. Priorities 3–4 get entry points, not
  permanent panels. [OWNER]
- Interaction philosophy: **progressive disclosure** — show a calm overview,
  reveal density on demand. Legibility and calm over maximum density. Minimal
  clicks; low user freedom (layout is fixed, users navigate levels, they do
  not rearrange). [OWNER, revised Session 12]
- Reference: Toss Securities WTS informs both the interaction grammar (friction
  removal, URL-as-state, command-first navigation) AND the visual model — its
  stock-detail screen is the reference for the achromatic surface + semantic
  direction color in §9.

## 2. Core layout — three levels in one column

[OWNER, Session 12] The wall is retired. Everything is a **single centered
column, max-width 960px**, that scrolls vertically like a normal page. No
horizontal wall, no panning, no viewport-sized grid. Navigation is three
levels of progressive disclosure, not spatial panning.

### Level 1 — Home

A vertical stack, in order:

1. **Status line** — one sentence plus a timestamp (§15 voice). Not labels.
2. **Briefing card** — "마지막으로 보신 뒤로 …" plus up to 5 change-log lines
   from the events endpoint (§12, unchanged: event/state split, D-1 fixed).
   Because the user is away most of the time, this is the most important thing
   on screen — the most visual weight after the band cards' hero numbers. It
   has its own empty-state sentence.
3. **Five band cards**, stacked, one per band: 커브, 변동성, 스왑 포워드,
   아웃라이트, 스프레드. Each card carries: a one-sentence summary; one hero
   number at 28px (curve → 10Y level; forwards → 1Yx1Y; outrights → 10Y;
   spreads → the largest absolute mover; volatility → placeholder); the delta
   vs the active basis, small, beside the hero; a wide navy sparkline of that
   hero series; whole card is the tap target.

### Level 2 — Band view

Reached by tapping a band card; animated expansion (§14), same column width.

- Header: band name + back affordance.
- Tiles stacked one per row, ~960 × 220.
- **Each tile shows only two lines by default: Now + the selected comparison
  basis** (Now full navy, basis at 45% — §9). The other four bases live only
  in Level 3. This is the single biggest legibility fix of the redesign.
- Tenor markers, tile hero value 28px top-left, label + delta small.
- The band's matrix table is behind a "표로 보기" toggle, collapsed by default.
  Tables are the dense view, not the default.
- **Spreads band** defaults to the 8 largest absolute movers with a "전체 보기"
  control expanding to all 35. Never render 35 tiles on entry.

### Level 3 — Detail

A sheet that slides up from the bottom over the current view (§14).

- Full 10-year history via the stage-2 endpoint and `lightweight-charts`
  (only here, §11), with `assertDomainRendered` in force.
- A segmented control exposes all six time bases here — the full ramp lives
  only in this sheet now.
- Dismiss on Esc, backdrop tap, or downward drag of the sheet.
- URL state (`?tile=series:<id>`, plus `?band=<band>` for Level 2) keeps
  working and is deep-linkable.

The old five physical "bands" of the wall are now the five band cards /
band-views above; the object taxonomy (curve, volatility, forwards, outrights,
spreads) is unchanged.

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

## 5. Channel budget (critical)

[Revised Session 12.] The surface is achromatic first (§9): everything reads
in grayscale, and hue is a thin semantic layer added on top in a few reserved
places. Each channel still has exactly one meaning, app-wide:

| Channel        | Meaning                                   |
|----------------|-------------------------------------------|
| Ink opacity    | Time basis (ramp, see §9)                 |
| Line width     | Time basis (secondary, disambiguates ramp)|
| Text weight 600| Outlier only (percentile extreme / large delta) |
| Cell border    | Structural: live-quoted (non-interpolated) point |
| Marker dot     | Live-quoted node on charts                |
| Mini-bar       | Delta sign+magnitude in tables (center-zero, right=+, left=−) |
| **Direction hue** | **Sign of a number: red = up, blue = down (Korean market convention, §9)** |
| **Motion**     | **State change (§14) — a value updated, a level opened/closed** |

Direction hue is a **deliberate, owner-mandated exception** to the old "sign
never by color" rule: a KRW rates trader reads red/blue before the digits.
Sign is now carried by BOTH hue and the mini-bar direction — the mini-bar
keeps it legible in grayscale, so nothing DEPENDS on hue alone. Do not reuse a
channel for a second meaning. Navy is chrome/chart-accent only and never
encodes sign; the per-band chart hues of the previous draft are dropped
(chart lines are navy — §9).

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

### Surfaces, radius, borders [revised Session 12]

| Role          | Light    | Dark     |
|---------------|----------|----------|
| Page          | #FAFAFA  | #1A1A1A  |
| Card / tile   | #FFFFFF  | #202020  |
| Card (raised) | #FFFFFF  | #262626  | dark uses a lighter step in place of a shadow |
| Sheet         | #FFFFFF  | #262626  |
| Ink           | #1A1A1A  | #EDEDED  |
| Border        | ink 12%  | ink 18%  | tables + live-quote marker ONLY |
| Live border   | ink 40%  | ink 55%  |

- **Cards and tiles have no borders.** Separation comes from the surface step
  plus spacing. Hairlines survive only inside tables and as the live-quote
  cell marker.
- **Radius:** card 16, sheet 20 (top corners only). Nothing above 20.
- **Elevation:** light mode gets one soft card shadow token (the casual look
  depends on it). Dark mode substitutes the lighter surface step (`#262626`) —
  shadows still die in dark mode.

[OWNER: default theme = LIGHT; dark = neutral dark-gray #1A1A1A family, not
pure black, not blue-gray. Theme is user-switchable.]

Implementation: every color goes through semantic CSS custom properties with
light/dark pairs; zero raw hex in component code (enforce with a lint guard).
Chart canvases cannot resolve CSS variables: the theme bridge injects RESOLVED
hex into canvas-bound options and triggers redraw on theme switch — gated by a
test that rejects `var(` strings in canvas-bound option objects.

### Color — achromatic + semantic direction [OWNER, Session 12]

Reference: the Toss Securities WTS stock-detail screen. It is **almost
entirely achromatic** — light-grey page, white cards, no borders, near-black
numbers, grey labels. Hue appears in exactly three places: the direction of a
number, the primary action control, and the selected state of a control.
Nothing else is colored. When in doubt, leave it grey.

#### Direction (the dominant color on screen)

Semantic, not brand. Korean market convention: **red = up, blue = down.** A
rates trader reads these before the digits, so this overrides the old "sign
never by hue" rule (§5). Sign is carried by hue AND the mini-bar direction —
the mini-bar keeps grayscale working.

| Role | Value | Notes |
|---|---|---|
| Up (양) | `#E5484D` | red; ≥4.5:1 on white and on dark tile |
| Down (음) | `#1D6FD8` | blue; ≥4.5:1 on white and on dark tile |

Starting values; `## Provisional` records them for the owner to swap for house
values. Gated in `band-hue-contrast.test.ts` against both surfaces.

#### Brand roles

| Role | Value | Use |
|---|---|---|
| Interactive fill | `#F58220` orange | primary action control; near-black label (`#1A1A1A`) — white fails ~2.4:1 |
| Chrome accent | `#043B72` navy (dark: `#8DC8E8`) | selected segment, active tab, links, AND all chart lines |

#### Chart lines are navy, full stop

The per-band-hue-by-object scheme is dropped: with one band on screen at a
time it bought nothing, and the reference screen keeps chart chrome muted
while the *numbers* carry color. All chart strokes — curve, forward tiles,
home sparklines — are the navy accent. Series separation inside a tile is the
opacity ramp, unchanged.

- **Levels 1–2 use two ramp steps**: Now at full navy, comparison basis at
  45%. The six-step ramp lives only in the Level 3 detail sheet.
- `band-hue-contrast.test.ts` checks navy at every step actually used (full +
  45% for L1/L2; the six ramp steps for L3) and both direction colors against
  both surfaces.
- The sub-palette (`#CB6015`, `#84888B`, `#AD624E`, `#0086B8`, and the rest)
  stays **defined in the token module but unreferenced** — kept for a possible
  future multi-object view.

Implementation unchanged in mechanism: hex lives only in the token layer (raw-
hex lint); navy reaches SVG lines via one `currentColor` on a wrapping `<g>`
(never per-element `var()`); canvas lines resolve navy to hex through the theme
bridge and pass `assertNoCssVars()`. Direction color applies to number text
and mini-bar fills only, never to a chart stroke. Axis, gridlines, and labels
stay ink/grey.

### Typography [revised Session 12]

- Font: Pretendard Variable. `font-variant-numeric: tabular-nums` enforced
  globally — every numeral in the app.
- Base body rises from 13 to 15. Hero numbers are the point; the old screen
  read flat because every number was the same size. Weights are 400/600/700.

| Use | Size | Weight |
|---|---|---|
| Hero number | 28 | 700 |
| Card / section title | 17 | 600 |
| Body sentence | 15 | 400 |
| Label, axis, table cell | 13 | 400 |
| Caption, secondary delta | 12 | 400 |

Outlier value keeps weight 600 (§5). Weight 700 is reserved for hero numbers.

### Spacing [revised Session 12]

4px base grid. Card padding 20, card gap 12, section gap 32, column gutter 24,
column max-width 960. Table row height 26, table header height 32. Whitespace
is a feature now, not waste.

## 10. Interaction rules [revised Session 12]

- Navigation is three levels of progressive disclosure (§2), not spatial
  panning. The page scrolls normally; there is no wall to pan.
- **Level transitions:** tap a band card → Level 2 band view (animated
  expansion, §14). Tap a tile → Level 3 detail sheet (slides up). Back
  affordance and Esc step back one level; backdrop tap and downward sheet drag
  dismiss the detail sheet.
- Drag threshold 5px (below = tap). The only free drag is the detail sheet's
  downward drag-to-dismiss; a tap on a card/tile must never be swallowed by
  that drag handler.
- Hover is a secondary inspection gesture and must never move layout. Readout
  space is reserved at all times. Floating tooltips remain banned (the
  predecessor's shrink-to-fit tooltip silently broke column alignment).
- Press feedback: every tappable card/tile scales to 0.98 (§14).
- URL reflects state: `?band=<band>` (Level 2) and `?tile=series:<id>`
  (Level 3) are deep-linkable and back-button-friendly.
- Keyboard: `/` or Cmd+K command bar (scrolls to a series via the tile
  registry), Esc steps back / closes the sheet.
- Confirmation dialogs: none. Nothing here is an order/execution action in v2.

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
7. Change log + event detection (see "Change-log firing rule" below).
8. Command bar + tile jump.
9. Detail overlay with full-resolution history.
10. ~~Band 3 time-series matrix~~ — superseded by the Session-12 redesign.
11. **Session 12 — three-level column redesign (§2):** retire the wall (pan
    machinery `@deprecated`, not deleted); Home (status + briefing + 5 band
    cards); Level-2 band views (2-line tiles + table toggle; outrights and
    spreads bands built); Level-3 detail sheet; new tokens (§9); motion (§14);
    voice (§15). Backend, endpoints, and all guards unchanged.

### Change-log firing rule [OWNER-confirmed 2026-07-24]

Diagnosis in `docs/diagnostics/changelog-firing.md`. The governing
distinction: **a percentile-extreme level is a STATE; the log records
EVENTS.** States belong on the tile, events belong in the log.

- **State (on the tile, NOT the log):** a series whose current level sits in
  the extreme percentile band (`pct ≥ 95` or `pct ≤ 5`, constant
  `OUTLIER_PCT = 95`) keeps its weight-600 treatment on the tile. This is a
  persistent condition and never appears in the log.
- **Event detection is fixed to the D-1 basis**, decoupled from the global
  comparison-basis selector — the log reads the same regardless of what the
  selector shows. The selector therefore offers only the five non-trivial
  comparison bases (D-1, WTD, MTD, QTD, YTD); "Now" is dropped from the
  selector (it is still one of the six time-basis ramp curves in §9).
- **An event fires when either** (rule (c)):
  - (a) **Transition** — the series crosses INTO the extreme percentile band,
    or exits it, relative to the previous business day (point-in-time
    percentiles); or
  - (b) **Own-Δ percentile** — today's D-1 change is extreme relative to that
    series' OWN 10-year distribution of daily changes (`|Δ| ≥ 95th percentile
    of the series' own historical `|daily Δ|``), regardless of level.
- **Correlation collapse.** Because the 6 display tenors span only 5
  independent spread dimensions, correlated firings are collapsed by
  union-find over shared tenor legs into one line per cluster: a leading
  series plus "연관 N건" that expands on click. Expanded rows remain
  individually clickable and pan to their tiles.
- **Visible cap = 12** entries; older entries scroll. Chosen from the Pass A
  500-day replay of rule (c): p90 = 2 collapsed lines/day, max = 12 — the cap
  holds even the worst replayed day without dropping an event, while typical
  days use a fraction of it.

Replay of rule (c) over the last 500 business days: median 1, p90 2, max 12,
empty on 153/500 days — a log that can be empty, unlike the prior rule
(empty 1/500).

## 13. Explicitly out of scope for v2

- Vol tile internals (placeholder only until formula arrives).
- Any user layout customization. Panel add/remove.
- Scenario engine UI, trade capture UI (entry points only via change log).

(Removed Session 12: color/hue is now in — §9; outrights and spreads
band-views are now built — §2.)

## 14. Motion [Session 12]

Motion is a channel meaning "state change" (§5), and it is chrome only — never
animate chart path geometry.

- Library: `motion` (framer-motion's successor). Springs may overshoot
  slightly now: ~stiffness 400, damping 30; durations 200–280ms. Tune by feel.
- Band card → band view: a shared-layout animation, not a page swap.
- Detail sheet: springs up from the bottom; drag-to-dismiss follows the
  pointer and settles with the same spring.
- Briefing and change-log rows: stagger in at ~40ms intervals.
- Press feedback: scale 0.98 on every tappable card/tile.
- A number that changes re-renders with a short cross-fade. No digit-rolling
  library (a perf trap at this element count).
- `prefers-reduced-motion` collapses every animation to an instant state
  change (asserted by a test).

## 15. Voice & copy [Session 12]

Chrome copy is sentences in **해요체**, not noun labels — especially empty,
loading, and error states. The register is calm, plain, and human.

- Prefer a sentence to a label wherever one fits:
  - status: "오늘 커브는 조용해요"
  - briefing: "마지막으로 보신 뒤로 새로운 게 3건 있어요"
  - a move: "장기 구간이 연초 대비 22bp 내려왔어요"
  - placeholder: "변동성은 아직 준비 중이에요"
  - error: "불러오지 못했어요. 잠시 뒤 다시 시도해 주세요"
- **Never translate instrument nomenclature.** Tenor and series names stay
  technical and English/numeric: `1.5Y`, `3s10s`, `2s5s10s`, `1YF`, `SPOT`,
  `1Yx1Y`. A sentence may wrap them ("`10Y`가 조용해요") but never renames them.
- Numbers keep their units (bp, %) and signs; the sentence supplies the tone,
  the number supplies the fact.
- Direction words follow the market: 올랐어요/내려왔어요 map to red/blue (§9).

## Provisional [Session 12 — review these]

Choices made to keep the build green where the prompt did not fully specify.
Each should be confirmed or overridden by the owner.

- **Direction colors** `#E5484D` (up) / `#1D6FD8` (down) are starting values,
  verified ≥4.5:1 on white and on the dark tile. Swap for house values freely.
- **Forwards home sparkline**: the 1Yx1Y forward has no stored history (the
  backend serves history only for outrights and spreads/flies, and that is
  frozen). The forwards band card therefore draws the current SPOT forward
  strip (a cross-sectional shape line), not a time sparkline. Everything else
  on the card (hero 1Yx1Y, delta) is real.
- **Briefing "since you last looked"**: last-visit time is kept in
  localStorage; the count shown is the current event-cluster count from the
  (D-1-fixed, snapshot) events endpoint, since the log does not accumulate
  across the day. Good enough for the briefing framing.
- **Deprecated, pending removal**: the wall pan machinery (`useWallPan`,
  `panToElement`) is unused and marked `@deprecated` (Session 12). Remove once
  the three-level layout is accepted. The tile registry is retained and
  repurposed for scroll-to-element.
- **Level-3 six-base control**: renders the six basis reference levels as a
  segmented readout beside the history chart (not six overlaid curves) — the
  history chart is a single series, so the ramp appears as selectable reference
  points, which is the closest faithful realization of "the full ramp lives
  here."