# Sauron — KRW IRS Monitor (Design Spec)

Status: authoritative for this repo. **Sauron** (product name as of Session 12;
the repo directory, package, and mirror script keep the old `braveworld` name —
a path rename is churn with no payoff today, see `## Provisional`) is a NEW,
STANDALONE project. It is not a rewrite of krw-fi-pms and does not replace it.
Nothing in krw-fi-pms may be modified by work in this repo — that system is
frozen pending a senior-trader review.

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
- Interaction philosophy: **list-first, take it in at a glance.** One screen,
  no navigation — a dense instrument table on the left, a preview that responds
  to it on the right (§2). Legibility over maximum density. [OWNER, Session 12]
- **Sorting is allowed and wanted.** It was banned to protect muscle memory on
  a wall that no longer exists; sorting by |change| is the "what moved today"
  answer and must be one click. [OWNER, Session 12]
- Reference: the **Toss Securities ranking table** — one screen, list + a pane
  that responds to hover/selection — informs both the interaction grammar and
  the achromatic visual model (§9).

## 2. Core layout — list-first, two panes

[OWNER, Session 12] The wall and the band-card column are both retired. One
screen, two panes, no navigation: a dense instrument **table on the left
(~55%)** that is always visible, and a **preview pane on the right (~45%,
sticky)** that responds to the table. Reference: the Toss ranking table.

### Left pane — the instrument table

Columns, left to right:

| Instrument | 현재 | Yesterday | WTD | MTD | QTD | YTD | 한 줄 |

- **Instrument** — `10Y`, `3s10s`, `2s5s10s`, `1Yx1Y`, `SPOT`. Never
  translated (§15).
- **현재** — the current level, in ink, no hue (a level has no direction).
  Existing precision (4 decimals for forwards).
- **Five change columns** — change in bp vs each basis. Red for up, blue for
  down (§9), plus the existing center-zero mini-bar so it still reads in
  grayscale. **There is no "Now" column** — Now minus Now is zero, which is
  why the old six-basis selector was wrong; all five bases are columns now.
- **한 줄** — a short generated 해요체-adjacent phrase (the analogue of the
  reference's AI-summary column) from data already present: percentile standing
  and the largest of the five changes. e.g. "10년 고점권", "연초 대비 22bp 하락".
  Aim for ≤ ~12 characters.

Behaviour:

- **The global comparison-basis selector is deleted** (its state too) — the
  five bases are columns.
- **Filter chips** above the table: 전체 / 아웃라이트 / 스프레드 / 포워드 /
  변동성. Default 전체.
- **Sortable by any change column, both directions.** Default order is
  instrument order (not a ranking). Sorting by |change| is one click = "what
  moved today".
- Row hover paints a subtle surface change and drives the right pane.
- **Clicking a row pins it** (hover-only would empty the pane the moment the
  pointer leaves). Pinned rows keep a marker; hovering another row previews
  without unpinning; Esc unpins.
- The spread group is 35 rows — fine in a scrollable list, do not truncate. The
  list is the dense view now.

### Right pane — preview

- Empty state before any hover: one sentence, not a blank box (§15).
- On row hover, after a ~120ms delay (so crossing the table does not strobe),
  the chart springs in (§14).
- Chart: that series' 10-year history, **orange line** (§9), from the stage-2
  endpoint. `assertDomainRendered` still applies.
- Hovering the chart shows a floating card near the cursor: **날짜 · 레벨 ·
  구간 최고 · 구간 최저 · 구간 평균 · 당일 변화** (a rate series, so the
  reference candle's open/close become level + daily change).
- **Below the chart, a calendar heatmap** of daily changes across the visible
  window — weeks × weekdays, cell shade by magnitude, hue by direction (red up
  / blue down). As the pointer moves along the chart, the hovered date's cell
  pulses with an **ink outline** (not orange — orange is the chart line now;
  not blue — blue is a direction; see §9 and `## Provisional`).
- Clicking the chart opens the enlarged view.
- Forwards and volatility have no stage-2 history; their preview is a sentence,
  and forwards open the forward matrix in the enlarged view instead.

### Enlarged view

A full-screen sheet over the list (§14: springs up; Esc / backdrop / downward
drag dismiss; `?tile=series:<id>` keeps working).

- Large chart, full history, plus a **segmented control exposing all six time
  bases** — the full opacity ramp lives here now.
- The calendar heatmap comes along, larger.
- A **clearly-marked empty region reserved for future strategy tooling** — a
  labelled placeholder is the entire deliverable; build nothing in it.
- For forward instruments the enlarged view shows the **forward matrix**
  section (§8) instead of a history chart.

The object taxonomy (outrights, spreads, forwards, volatility) is unchanged;
it is now the filter-chip set, not physical bands.

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
Sign is carried by BOTH hue and the mini-bar direction — the mini-bar keeps it
legible in grayscale, so nothing DEPENDS on hue alone. **Only numbers with a
direction get hue**: a change, a percentage, a mini-bar, a heatmap cell. A
level has no direction, so the `현재` column and any level readout stay ink.
The plain line chart is orange (a line has no per-point up/down sense); a
directional mark (heatmap cell, mini-bar, a future candle) is red/blue. Navy
is freed to the product lockup only and never touches data (§9).

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

### Color — achromatic + semantic direction + orange line [OWNER, Session 12]

Reference: the Toss ranking table. **Almost entirely achromatic** — light-grey
page, white panes, no borders, near-black numbers, grey labels. Hue appears
only on: a directional number, the line chart, the primary action, and
selected/focus state. When in doubt, leave it grey.

#### Direction (red up / blue down)

Semantic, not brand — these sit beside the Mirae brand colors, they do not
replace them. Korean market convention overrides the old "sign never by hue"
rule (§5). **Only numbers with a direction get hue**: changes, percentages,
grid tints. Levels stay ink.

**Encoding by surface [Session 13]:** the mini-bar under a change figure is
gone — it was the sign channel when the build was monochrome; now that hue
carries direction the bar triple-encodes and adds noise. Instead:

- **A number in a list column** (the five change columns): coloured text only,
  nothing under it.
- **A cell in a grid** (forward matrix, calendar heatmap, any tenor×date
  grid): a **background tint** — red up / blue down, alpha scaled by magnitude
  within that grid (~8–45%, near-zero untinted, darkest tint keeps ink at
  ≥4.5:1, gated by `tint-contrast.test.ts`). The number stays ink so it reads
  on the tint. One shared scale (`src/ui/tint.ts`) so a cell means the same
  everywhere.

| Role | Light | Dark | Notes |
|---|---|---|---|
| Up (양) | `#F04452` | `#F16E77` | Toss Red (owner). Light clears 4.5:1 on white; dark lightened for the dark tile |
| Down (음) | `#0064FF` | `#4C93FF` | Toss Blue (owner). `#0064FF` fails 4.5:1 on the dark tile, so dark lightens |

`## Provisional` records the exact verified values; both clear 4.5:1 on their
surface, gated in `band-hue-contrast.test.ts`.

#### Chart line — orange, and it must be line-safe

A plain line chart has no per-point up/down sense, so it is one color: orange.
But `#F58220` on white is only ~2.6:1 — under the 3:1 floor for a graphical
object; a thin orange line washes out. Light mode uses a **line-safe orange**
(hue kept, deepened until ≥3:1 — measured, not assumed). Dark mode uses
`#F58220` directly (comfortably above the floor there).

| Role | Light | Dark |
|---|---|---|
| Line-safe orange (chart stroke) | `#C2560F` (measured ≥3:1 on white) | `#F58220` |
| Primary action (filled button) | `#F58220` (near-black `#1A1A1A` label) | `#F58220` |

Note the action fill and the chart stroke are different oranges: the button is
a filled shape (2.6:1 is fine for a large fill with a dark label); the line
needs the deeper 3:1 stroke.

#### Selected / focus / pulse — ink, not orange

Because the chart line is orange now, selection and focus move **off** orange
to avoid two oranges on one pane (reference: the ranking screen's tab control
is a dark filled pill). Selected = a dark ink-filled pill with a light label;
focus ring and the calendar-heatmap pulse are an **ink outline**. (The owner
asked for a blue pulse; blue means "down"; an earlier note said orange, but
orange is now the line — so ink. Chain recorded in `## Provisional`.)

#### What stays grey / navy

Navy `#043B72` is freed to the **product lockup only** and never touches data.
Levels, axes, gridlines, labels stay ink/grey. Series separation inside the
enlarged view is the opacity ramp, unchanged. The sub-palette (`#CB6015`,
`#84888B`, `#AD624E`, `#0086B8`, …) stays defined in the token module and
**unreferenced on data**.

`band-hue-contrast.test.ts` is rewritten for what ships: the line-safe orange
at every ramp step it is used at, and both direction colors against both
surfaces. Mechanism unchanged: hex lives only in the token layer (raw-hex
lint); SVG lines take orange via one `currentColor` on a wrapping `<g>` (never
per-element `var()`); canvas lines resolve orange to hex through the theme
bridge and pass `assertNoCssVars()`.

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

4px base grid. Pane padding 20, section gap 32, panes gap 24. **Table row
height 40** (up from 26 — the reference rows are generous and that is what
makes them scannable), table header height 40. Whitespace is a feature.

## 10. Interaction rules [revised Session 12 — list-first]

- One screen, two panes (§2); the page does not navigate. The table scrolls;
  the preview pane is sticky.
- **Row hover** (after ~120ms) drives the preview and paints a subtle row
  surface. **Clicking a row pins it**; hovering another previews without
  unpinning; **Esc unpins**.
- **Sorting** by any change column, both directions, is one click; default is
  instrument order.
- The floating chart tooltip is the ONE sanctioned floating element (§2); it
  never reflows the table (the predecessor's shrink-to-fit tooltip that broke
  column alignment stays banned — this one is absolutely positioned, measured,
  and never wraps a table cell).
- Press feedback: rows and controls scale to 0.98 (§14).
- **Enlarged view** opens on chart click; Esc / backdrop / downward drag
  dismiss. Its content must never be swallowed by the drag handler; a thrown
  guard renders inside an error boundary, not a blank region.
- URL reflects state: `?tile=series:<id>` (enlarged) is deep-linkable.
- Keyboard: `/` or Cmd+K command bar (scrolls to a table row via the tile
  registry), Esc unpins / closes the enlarged view.
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
11. ~~Session 12 three-level column~~ — superseded by the list-first redesign.
12. **Session 12 (final) — Sauron list-first (§2):** two panes, no navigation;
    left instrument table (현재 + 5 change columns + 한 줄, filter chips,
    sortable, hover→preview, click→pin); right preview (empty state → chart
    pops in orange + floating tooltip + calendar heatmap); enlarged view
    (chart + six-basis ramp + heatmap + reserved strategy region). Basis
    selector deleted. New tokens (§9), motion (§14), voice (§15). Backend,
    endpoints, and all guards unchanged. Renamed braveworld → Sauron
    (user-facing only).

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

## 14. Motion [Session 12, list-first]

Motion is a channel meaning "state change" (§5), chrome only — never animate
chart path geometry.

- Library: `motion` (framer-motion's successor). Springs may overshoot: ~stiff
  400, damping 30; durations 200–280ms.
- **Right-pane chart entrance is the signature moment** — it pops in: fade +
  scale from 0.98 with the spring (~180ms), AFTER the ~120ms hover delay.
- **Tooltip** follows the cursor with no spring lag — it should feel attached.
- **Heatmap pulse**: two cycles ~600ms each, then settle to a static ink
  outline while the date stays hovered.
- **Enlarged sheet** springs up from the bottom; drag-to-dismiss follows the
  pointer.
- **Tabs** use a single sliding underline (`motion` shared-layout `layoutId`),
  not a fading pill — one element moving reads as a pointer; two fading
  elements read as a blob. Same spring (~200–260ms). The active tab's label
  goes weight 600 (no colour change beyond ink strength). Under reduced motion
  the underline jumps.
- **Press-feedback rule [Session 13]:** transform-based press-scale (0.98) is
  applied ONLY to isolated targets — table rows and standalone buttons — never
  to an element that shares an alignment with its neighbours. Tabs, table
  headers, and table cells get colour/background transitions only; a scale on
  them wobbles and breaks the shared baseline. (In practice table rows use a
  background change too, since CSS transforms do not apply to `table-row`.)
- A changed number cross-fades. No digit-rolling library.
- `prefers-reduced-motion` collapses every animation to instant (asserted by a
  test).

## 15. Voice & copy [Session 12]

Chrome copy is sentences in **해요체**, not noun labels — especially empty,
loading, and error states. The register is calm, plain, and human.

- Prefer a sentence to a label wherever one fits:
  - preview empty: "행을 올려두면 그래프가 나와요"
  - status: "오늘 커브는 조용해요"
  - a move: "장기 구간이 연초 대비 22bp 내려왔어요"
  - placeholder: "변동성은 아직 준비 중이에요"
  - error: "불러오지 못했어요. 잠시 뒤 다시 시도해 주세요"
- The `한 줄` table column is the one place a compact fragment beats a full
  sentence (≤ ~12 chars): "10년 고점권", "연초 대비 22bp 하락". Still Korean,
  still calm; just clipped to fit a cell.
- **Never translate instrument nomenclature.** Tenor and series names stay
  technical and English/numeric: `1.5Y`, `3s10s`, `2s5s10s`, `1YF`, `SPOT`,
  `1Yx1Y`. A sentence may wrap them ("`10Y`가 조용해요") but never renames them.
- Numbers keep their units (bp, %) and signs; the sentence supplies the tone,
  the number supplies the fact.
- Direction words follow the market: 올랐어요/내려왔어요 map to red/blue (§9).

## Provisional [Session 12 list-first — review these]

Choices made to keep the build green where the prompt did not fully specify.
Confirm or override.

- **Name split**: the product is Sauron (header, `<title>`, all user-facing
  copy). The repo directory, npm package, mirror script, and internal
  identifiers stay `braveworld` — a path rename is churn with no payoff today.
- **Direction colors**: up `#F04452` (Toss Red) / dark `#F16E77`; down
  `#0064FF` (Toss Blue) / dark `#4C93FF`. `#0064FF` is ~3.9:1 on the dark tile,
  so dark lightens to `#4C93FF`; light values clear 4.5:1 as given. Gated in
  `band-hue-contrast.test.ts`.
- **Line-safe orange**: chart stroke light `#C2560F` (measured ≥3:1 on white),
  dark `#F58220`. The action-button fill stays `#F58220` in both themes (a
  large filled shape with a near-black label tolerates the lower ratio). Swap
  for house values freely.
- **Heatmap pulse = ink outline.** The chain: owner asked blue → blue means
  "down" → an earlier note said orange → orange is now the chart line → so ink.
  An ink outline reads as focus, never as a direction.
- **한 줄 column** is generated from `range10y.pct` (≥95 → "10년 고점권", ≤5 →
  "10년 저점권") else the largest of the five basis changes ("연초 대비 22bp
  하락"). No new backend data; all fields already exist.
- **Forwards & volatility have no stage-2 history.** Forward rows use the key
  forwards (`1Yx1Y`, …); their preview is a sentence and the enlarged view
  shows the forward matrix instead of a chart. Volatility rows are a
  placeholder sentence (no formula yet).
- **Calendar heatmap window**: the visible chart window is the full 10y, which
  is too many weeks for a legible calendar; the heatmap therefore shows the
  most recent ~26 weeks of daily changes. Adjust when the enlarged view lands a
  window control.
- **Deprecated, pending removal**: the wall pan machinery (`useWallPan`,
  `panToElement`) and the whole three-level column build of the previous
  Session-12 draft are unused; `useWallPan` stays `@deprecated`. The tile
  registry is retained and repointed at table rows for the command bar.
- **Detail-open root cause (fixed)**: the earlier failure was the wall pan's
  click-suppression swallowing taps. The list has no pan; the chart-open click
  is a plain handler and the enlarged view is wrapped in an error boundary so a
  thrown guard renders a message, not a blank region.
- **Row press feedback**: CSS transforms do not apply to `display: table-row`,
  so table rows use a surface (bg) change on hover/press instead of the 0.98
  scale; scale press is on the controls (filter chips, preview, sheet).