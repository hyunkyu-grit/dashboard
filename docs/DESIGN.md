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
screen, two panes, no navigation: a dense instrument **table on the left** that
is always visible, and a **preview pane on the right** that responds to the
table. Reference: the Toss ranking table.

**Width [Session 15].** The surface spans the viewport (a small margin, no
max-width — the earlier cap was a casual-app leftover). Panes split by content
need, not percentage: the table pane sizes to its columns (~880px) and the
preview takes everything left over with a **~600px floor**. On an ultrawide the
chart grows; the table does not stretch into a sparse mess. Below the point
where the preview would drop under its floor (~1520px viewport, see
`## Provisional`) the shell falls back to a **single column** — table full
width, preview as a bottom sheet opened by a row click — rather than squeezing
two panes into a space that cannot hold them. The idle curve fills the full
height of the right pane.

### Left pane — the instrument table

Columns, left to right:

| Instrument | 현재 | Yesterday | WTD | MTD | QTD | YTD | 한 줄 |

- **Instrument** — `10Y`, `3s10s`, `2s5s10s`, `2Yx1Y`, `SPOT`. Never
  translated (§15). Notation is defined once in **§ Instrument notation**
  below and is identical across labels, the command bar, and ids.
  - **Quoted vs interpolated [Session 13]:** outright nodes carry a small
    leading **dot** — filled = a live-quoted tenor, hollow = interpolated
    (`4Y/6Y/7Y/8Y/9Y`). A dot, not a badge (§5 channel discipline); it marks
    provenance without adding a column. Spreads/flies/forwards get no dot (the
    distinction does not apply).
- **현재** — the current level, in ink, no hue (a level has no direction).
  Existing precision (4 decimals for forwards).
- **Five change columns** — change in bp vs each basis. Red for up, blue for
  down (§9). The mini-bar is gone (Session 13, §9): hue now carries the sign,
  so the bar triple-encoded. **There is no "Now" column** — Now minus Now is
  zero, which is why the old six-basis selector was wrong; all five bases are
  columns now.
- **한 줄 [ladder, rewritten Session 15]** — must **never restate a value
  already visible in the same row** ("연초 26bp 상승" only re-prints the YTD
  cell). A **priority ladder**, the first rung that applies, one item per row:
  1. **today's move is extreme against the series' OWN history** →
     "일간 변동 상위 3%". The most valuable rung and the only signal invisible
     elsewhere: `+5bp` is ordinary for `10Y` and an event for `3M`. Threshold
     from the Session-15 replay (own-history move percentile ≥ 97).
  2. **the level sits in an extreme band** → the percentile as a number,
     "백분위 99" (`pct ≥ 95` or `≤ 5`). **Capped** to the few most-extreme rows
     per peer group (`LEVEL_CAP`): on a day when the whole curve sits at decade
     highs an uncapped rung printed the same label on ~20 rows — that regime
     fact belongs to the "10년 고점권" screener chip, not the column.
  3. **stands out against its neighbours today** → "단독 상승" / "단독 하락"
     (moved opposite the day's majority among outrights).
  4. **nothing.** Most rows are quiet so the few that speak are visible; the
     replay targets 3–6 speaking rows of ~44.

  The retracement rung (Session 13's "주간/월중 되돌림") is retired — it needed a
  sign flip, which almost never fires in a trending tape. Diagnosis + thresholds
  in `docs/diagnostics/color-density.md`.
- **Curve-level extreme is a banner, not a column [Session 16 §I].** When most
  of the outright curve (≥ `CURVE_REGIME_FRAC`) sits in one extreme band, "this
  tenor is at a decade high" is a fact about the *curve*, not any row. It is
  stated once in a line under the tabs — "커브 전 구간이 10년 고점권입니다" — and
  the per-row level rung (rung 2) is **suppressed on outrights**. Spreads/flies
  keep the per-row rung (a spread at a 10y extreme is genuinely distinctive, not
  restated by the banner). Backend classifies (`curve_banner`), the browser
  renders the Korean (§16).

Behaviour:

- **The global comparison-basis selector is deleted** (its state too) — the
  five bases are columns.
- **Filter chips (tabs)** above the table: 전체 / 아웃라이트 / 스프레드 /
  포워드 / 변동성. Default 전체.
- **Screener presets [§D, Session 15]** — a *second* row of chips beneath the
  tabs (never a left sidebar; one surface). A named view in plain language that
  **filters on top of the active tab**: 오늘 많이 움직인 것 (own-history move
  pct ≥ 90) / 10년 고점권 (pct ≥ 90) / 10년 저점권 (pct ≤ 10) / 되돌림 (sign
  flip between adjacent bases) / 호가만 (live-quoted only) / 주요 포워드. One at
  a time, clicking again clears; a one-line 합니다체 description shows beneath
  the row when active. Data-driven (`ui/screener.ts` — a predicate per view), so
  a new named view is a definition, not a component. Default: no chip.
- **Sortable by any change column, both directions.** Default order is
  instrument order (not a ranking). Sorting by |change| is one click = "what
  moved today".
- **Every series carries an explicit numeric sort key [Session 13, §6].**
  Default order is that key ascending: tenor-in-years for outrights, the leg
  tuple (compared lexicographically) for spreads/flies/forwards. *Diagnosis of
  the "3M lands last" bug:* 3M/CD91 was added to the roster after the original
  node set and had no sort key, so it fell to the bottom under a
  key-or-`undefined` sort. `tenorYears` now maps every tenor, and unknown →
  `Infinity` so a genuinely unmapped tenor sorts loudly to the end rather than
  silently mid-list. `guards/sort-key.test.ts` fails if any row's key is empty
  or non-finite.
- Row hover paints a subtle surface change and drives the right pane.
- **Clicking a row pins it** (hover-only would empty the pane the moment the
  pointer leaves). Pinned rows keep a marker; hovering another row previews
  without unpinning; Esc unpins.
- The spread group is 35 rows — fine in a scrollable list, do not truncate. The
  list is the dense view now.

### Instrument notation [Session 13 — read from code, do not change]

One naming scheme, used identically for the display **label**, the **command
bar** aliases, and the internal **id** (the id keeps the raw tenor form; the
label is the trader shorthand — both resolve to the same row).

| Kind | id (raw) | label (shorthand) |
|------|----------|-------------------|
| Outright | `10Y` | `10Y` |
| Spread (2 legs) | `1Y-10Y` | `1s10s` |
| Butterfly (3 legs) | `2Y-5Y-10Y` | `2s5s10s` |
| Forward | `2Yx1Y` | `2Yx1Y` |

- **Shorthand rule** (`traderName`): split legs on `-`, drop the trailing `Y`
  from each, join with `s`, append a final `s`. Only the `Y` is removed — a
  **fractional tenor keeps its point**, so a `1.5Y` leg is written **`1.5s`**
  (e.g. spread `1Y-1.5Y` → `1s1.5s`, fly `1Y-1.5Y-2Y` → `1s1.5s2s`). The
  display tenor set that legs are drawn from is `1Y, 1.5Y, 2Y, 3Y, 5Y, 10Y`.
- **Forward id** is `{start}x{tenor}` with the backend's `F`/`SPOT` suffixes
  cleaned off the tenor (`1YF`→`1Y`): `2Yx1Y`, `5Yx5Y`, `ONxSPOT`.
- **Butterfly weighting is 1 : −2 : 1 (cash/rate-neutral), NOT DV01-neutral.**
  The backend computes the fly in bp as `2 × belly − short − long`
  (`derive.py::fly_series`): +2 on the belly, −1 on each wing. A positive
  number = the belly is cheap (high) relative to the wings. This convention is
  load-bearing for the sign of every fly on the wall — **document only, do not
  change it.**

**MTD == QTD in the first month of a quarter is correct, not a bug.** In
Jan/Apr/Jul/Oct the month-start and quarter-start bases resolve to the same
prior close (`derive.py::basis_dates`), so the two columns are identically
equal by construction. Do not "fix" it, and do not collapse the columns — they
diverge the moment the quarter advances a month.

### Right pane — curve (idle) + preview (on hover)

- **Idle state is the curve for the active tab [Session 13, restored]** —
  curve viewing is priority 1 (§1). No row hovered → outrights show the IRS
  par curve (9 equal-spaced nodes 3M…10Y); forwards show the 1YF forward
  ladder (x = start point); spreads show the two-point-spread curve; volatility
  shows the relative-ATR curve across tenors [Session 14]. Blue line, two
  lines only (Now + D-1) — the six-basis ramp is enlarged-view only. Hand-rolled
  SVG (§11).
- Hovering a row replaces the curve with that series' history line; leaving the
  table returns to the curve; pinning keeps the history until Esc.
- On row hover, after a ~120ms delay (so crossing the table does not strobe),
  the chart springs in (§14).
- Chart: that series' 10-year history, **blue line** (§9 Pass E), from the stage-2
  endpoint. `assertDomainRendered` still applies.
- Hovering the chart shows a floating card near the cursor: **날짜 · 레벨 ·
  구간 최고 · 구간 최저 · 구간 평균 · 당일 변화**. This tooltip is the **sole
  readout for a hovered date** (§I) — the preview calendar heatmap was removed
  (it plotted the slope of the line drawn right above it; volatility clustering
  is now answered numerically by the relative-ATR series).
- Clicking the chart opens the enlarged view.
- **Forwards now have history [Session 13]** — a forward rate on any past date
  is derived from that date's curve (stage-2, rebuilt lazily per series and
  cached). **Volatility now has history too [Session 14]** — the relative-ATR
  ratio series per tenor (`vol:<tenor>`), served through the same stage-2 path.
  Every group now has a preview chart.
- **Forward tab [Session 13]:** every forward in the matrix (21 starts × 8
  tenors, named `2Yx1Y` / `2YxSPOT`) is a row; the six quoted key forwards pin
  to the top under a "주요 포워드" heading; a start-point secondary filter
  narrows the list; a "표로 보기" toggle flips to the 21×8 matrix (Pass-2 tint).

### Enlarged view

A full-screen sheet over the list (§14: springs up; Esc / backdrop / downward
drag dismiss; `?tile=series:<id>` keeps working).

- Large chart, full history, plus a **segmented control exposing all six time
  bases** — the full opacity ramp lives here now.
- **Tenor × date curve heatmap [Session 16 §D].** Below the chart, a grid:
  rows = the 10 curve nodes (short top, long bottom), columns = ~110 date
  buckets over the 10y window (cells ≥ ~8px), cell = that node's change over the
  bucket, own-history tint (the same scale as the forward matrix, §J), contiguous
  with radius only on the block's outer corners, untinted below the floor so the
  shape emerges. It shows the **curve**, not the popup's instrument — for
  `1s2s10s` it is the context explaining why the fly moved (a column one colour
  = parallel shift; top-heavy = front-end led; light middle, dark ends = a fly
  move). This is NOT the removed preview heatmap (that was daily change = the
  slope of the line). Backend precomputes the grid (§16). **Synced to the chart
  [final §C]:** the x-domain binds to the chart's visible range (rebucket by
  slicing on zoom, cells kept ≥8px) and the crosshair runs through both — the
  hovered column takes an ink focus rule aligned to the chart crosshair.
- **Chart type: 선 · 주봉 · 월봉 [Session 16 §G].** A selector in the popup
  (line only in the preview — candles need width it lacks). Closes-only data
  means a true daily candle is impossible (open would equal close), so no 일봉;
  candles aggregate closes into weekly/monthly OHLC **server-side** (`?interval=
  w|m`, §16). Bodies use 상승 빨강 / 하락 파랑 (direction tokens, not the line
  blue, §9). The tooltip changes with the type: line → 레벨 · 당일 변화; candle
  → 시가 · 고가 · 저가 · 종가 · 등락률. Chart type lives in the URL (`?type=`).
  `assertDomainRendered` applies to candles too, and the rendered domain must
  span every supplied bar — a silently dropped bar is worse on a candle chart.
- A block beneath the chart naming and explaining the instrument (§C1): a
  subtitle plus two or three 합니다체 sentences keyed to its kind.
- **DV01-neutral leg weights [Session 16 §B].** Curve trades are executed
  DV01-neutral, and once weighted so (`N_short·d_short = N_long·d_long`;
  `N_wing·d_wing = ½·N_belly·d_belly`) the quoted value *is* the P&L driver — a
  rise in the displayed spread/fly is profit for a Pay position, no
  qualification. (There is **no** residual-duration caveat; the 1:−2:1 quoting
  convention is not a notional convention.) The popup shows the notional ratio
  a trader has to execute (`1Y 442 : 2Y 100 : 10Y 22`, belly/long = 100),
  numbers only, plus a line noting it is indicative at the current curve; an
  outright shows its DV01 alone. DV01 = the par-swap annuity off the
  bootstrapped curve (`backend/app/dv01.py`); the browser never computes it
  (§16). No notional entry / P&L / sizing — those stay in the reserved region.
- **Pay/Receive curve diagram [rebuilt as a MODE picture — diagram session 3].**
  Beside the DV01 block, a ≥320×180 sketch with a 페이/리시브 control. **One rule
  for every kind — Pay profits when the displayed value rises, Receive when it
  falls** (no residual-duration caveat — the DV01-neutral weights make the quoted
  value the P&L driver). The two earlier builds failed for the same reason: they
  tied the picture to today's par curve (a ~136bp sweep that drowns a few-bp
  butterfly) and to specific tenors (which the name + DV01 block already give).
  **This build draws a FIXED SCHEMATIC arc — no relation to today's data — and
  says only which of the three curve MODES the instrument bets on, and which
  way:**

  | Mode | Reads as | Instruments |
  |---|---|---|
  | **레벨** (level) | the whole curve shifts up | outright |
  | **기울기** (slope) | the curve tilts, steeper/flatter | spread, forward |
  | **곡률** (curvature) | the curve arches, belly bulging/sagging | butterfly |

  Two curves only: the **current** shape (thin ink, ~35%) and the **wanted**
  shape (full-weight ink). Deformation, for Pay (Receive = exact negation):
  **level** translates the whole curve up parallel; **slope** pivots about the
  midpoint (far up, near down); **curvature** holds the ends and arches the
  middle up; **forward** is a slope confined to a soft unlabelled band (near-half
  down, far-half up, meeting the current curve at the band ends), positioned by
  the forward's period. The deformation is **exaggerated** (~25% of plot height,
  comparable to the arc's own rise) — a subtle diagram is a failed diagram. A
  **direction-coloured fill** between the two curves (up-red where wanted is
  above current, down-blue where below, ~16% alpha) is what makes the mode
  legible at a glance — an arch for curvature, a wedge for slope, an even band
  for level. **No leg markers, no tenor labels, no axis** (reverses the previous
  build — the tenors already appear twice on the panel). One label only, in the
  established register: 금리 상승/하락 · 스티프닝/플래트닝 · 벨리 약세/강세.
  **Volatility** has no curve statement → the region renders empty with one line
  saying so. Colours follow the palette (§9): ink structure + red/blue fill, no
  accent. Pure model (mode mapping, negation, in-bounds, labels) in
  `ui/payReceiveModel.ts`; SVG in `ui/PayReceive.tsx`; pinned by
  `guards/pay-receive-mode.test.ts`. **The test is readability: can you tell what
  the trade wants without reading the label?** Verified live in both themes
  (diagram session 3, Pass C): level reads as an even parallel band, slope as a
  blue-near/red-far bowtie, curvature as a central arch, forward as a confined
  tilt in a soft band — each mode legible before the label. The ~25%
  exaggeration and 16% fill were sufficient; no tuning needed.
- (The calendar heatmap that used to sit here was removed in §I — see the
  preview note above.)
- A **clearly-marked empty region reserved for future strategy tooling** — a
  labelled placeholder is the entire deliverable; build nothing in it.
- For forward instruments the enlarged view shows the **forward matrix**
  section (§8) instead of a history chart.

The object taxonomy (outrights, spreads, forwards, volatility) is unchanged;
it is now the filter-chip set, not physical bands.

## 3. Global chrome

- **Header band** (full-bleed chrome, §H — this replaced the "top status strip"
  in the list-first redesign): the Sauron / KRW IRS wordmark, the change-log
  trigger, the **data-freshness indicator** (Pass C — the "data timestamps" this
  bullet once promised, now with business-day staleness), and the theme toggle.
  The global comparison-basis selector was **deleted** (§4). Compact risk
  numbers (total DV01, day P&L) remain **Band 3 / [TBD]** — owner-gated, a slot
  only.
- **Change log** [surfaced as a header POPOVER, Pass D — not a bottom strip; the
  list-first shell gives its vertical space to the table]: outlier-event
  clusters as single lines; clicking a line focuses that instrument (switch to
  its tab, pin, pan) via the tile registry. This is how off-screen anomalies are
  surfaced. Empty by design ~31% of days.
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
- Volatility: **relative ATR = mean(ATR over 5 obs) / mean(ATR over 60 obs)**
  [OWNER, Session 14]. Close-only form (`TR_t = |r_t − r_{t−1}|` in bp) since the
  export carries no intraday high/low; see `## Provisional` for the constants
  and `backend/app/volatility.py` for the implementation.
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
| Text weight 600| **Structure** — the row anchors (instrument name + `현재` level), NOT outliers (§ revised Session 15) |
| Color intensity (alpha) | **Outlier magnitude vs the series' OWN history** (own-history percentile, §16). Forward matrix: a graded background wash, pct70→floor..pct97→**0.45**, ink on tint (dropped the cross-sectional grid-max, which lit 96–99% of cells). Change columns: NO background fill — the number is coloured text and a fill can't clear its contrast; the outlier cue is a **leading-edge rule** (`columnCue`, final §B), full hue, off the glyph. |
| Cell border    | Structural: live-quoted (non-interpolated) point |
| Marker dot     | Live-quoted node on charts                |
| Mini-bar       | Delta sign+magnitude in tables (center-zero, right=+, left=−) |
| **Direction hue** | **Sign of a number: red = up, blue = down (Korean market convention, §9)** |
| **Motion**     | **State change (§14) — a value updated, a level opened/closed** |

**Weight is structural, not an outlier channel [Session 15].** Weight 600 was
reserved for outliers; it caught nothing across 44 uniformly-faint rows. It now
anchors every row — the instrument name and the `현재` level render at 600, the
five change columns at 400 — and outlier emphasis moves entirely to **color
intensity** (alpha relative to the series' own history; scale chosen from the
Pass E2 replay). Weight says *this is the row's identity and level*; alpha says
*this move is worth looking at*.

Direction hue is a **deliberate, owner-mandated exception** to the old "sign
never by color" rule: a KRW rates trader reads red/blue before the digits.
Sign is carried by BOTH hue and the mini-bar direction — the mini-bar keeps it
legible in grayscale, so nothing DEPENDS on hue alone. **Only numbers with a
direction get hue**: a change, a percentage, a mini-bar, a heatmap cell. A
level has no direction, so the `현재` column and any level readout stay ink.
The plain line chart is blue (a line has no per-point up/down sense — §9 Pass E);
a directional mark (heatmap cell, candle body) is red/blue. The product lockup
and every non-directional mark are ink/grey — the palette is red/blue/grey (§9).

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
- **A mode, not a panel [Session 15 §F].** Opening 표로 보기 takes the **full
  surface width** and hides the preview pane; closing it restores the split. The
  matrix scrolls horizontally inside its own `overflow-x-auto` (a visible
  affordance), the pinned 시작/날짜 columns are sticky-left with an **opaque**
  background (§G) so scroll never loses row identity, and the key-forward block
  **wraps below** the matrix rather than clipping off the right edge.
  `guards/scroll-affordance.test.ts` fires if a silent clip returns.
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
| Sheet         | #FFFFFF  | #262626  |
| Ink           | #1A1A1A  | #EDEDED  |
| Border        | ink 12%  | ink 18%  | tables + live-quote marker ONLY |
| Live border   | ink 40%  | ink 55%  |

- **Cards and tiles have no borders.** Separation comes from the surface step
  plus spacing. Hairlines survive only inside tables and as the live-quote
  cell marker.
- **Radius:** card 16, sheet 20 (top corners only). Nothing above 20.
- **No elevation.** [Session 13, revised from Session 12.] The floating,
  shadowed card is gone, and with it the `--bw-card-raised` /
  `--bw-shadow-card` tokens — depth is surface steps + hairlines only, in both
  themes. The single sanctioned drop-shadow left in the app is the chart
  tooltip overlay (Tailwind `shadow-lg`), a transient popover, not a surface.
- **Sticky layers are opaque [Session 15 §G].** Every `position: sticky`
  element (the table header, the matrix's pinned 시작/날짜 columns and header,
  their intersection corner) carries an **opaque** background token so rows
  disappear cleanly behind it while scrolling — no shadow, a hairline marks the
  boundary. A muted look on such an element must come from a **text-colour
  alpha** (`text-ink/50`), never element `opacity` (which sinks the opaque bg
  and lets rows bleed through — the exact bug that had shown rows through the
  header). `guards/sticky-opaque.test.ts` enforces both: a bg token on every
  sticky class, and no element opacity on a sticky element or a `<tr>` wrapping
  sticky cells.

#### The shell is one continuous surface [OWNER, Session 13]

Reference again: the Toss table sits on one uninterrupted white sheet, not a
mosaic of floating cards. Sauron matches it.

- The whole app is **one surface** (radius 16, no shadow, no border) filling
  the viewport minus a thin `p-3` grey margin. Header, tabs, table, and the
  right preview all live *inside* it. Grey (`page`) shows only as that margin
  and as the row-hover / active tint.
- **The page never scrolls.** The surface is pinned to viewport height
  (`h-screen` → inner `h-full`, `overflow: hidden` on `body`). Scrolling
  happens *inside* the surface: the table body is the scroll container; the
  header, the tabs, and the forward controls stay fixed above it; the right
  pane scrolls independently. The rounded corners clip the overflow.
- **Row rhythm:** row height 48 (`h-12`), vertical padding 12 (`py-3`), a
  single hairline (`border-edge`) between rows and nowhere else on the screen —
  it is the *only* border. Group headings (forward "주요/전체") take a heavier
  rule *above* (`border-t-2`) and no rule below.
- Charts inside the panes must fit their measured pane width — a callback-ref
  `useMeasure` feeds live width into the hand-rolled SVGs so they reflow with
  the viewport (they are not `lightweight-charts`; §11 still owns the enlarged
  view alone).

[OWNER: default theme = LIGHT; dark = neutral dark-gray #1A1A1A family, not
pure black, not blue-gray. Theme is user-switchable.]

Implementation: every color goes through semantic CSS custom properties with
light/dark pairs; zero raw hex in component code (enforce with a lint guard).
Chart canvases cannot resolve CSS variables: the theme bridge injects RESOLVED
hex into canvas-bound options and triggers redraw on theme switch — gated by a
test that rejects `var(` strings in canvas-bound option objects.

### Color — two hues and nothing else [OWNER; palette cut to red/blue/grey]

**The product carries two hues and nothing else. Red means up, blue means
down. Anything not carrying direction is neutral, differentiated by lightness
alone.** Reference: the Toss ranking table — almost entirely achromatic
(light-grey page, white panes, no borders, near-black numbers, grey labels).
Hue appears only on a directional number/mark and on the line chart (a line has
no sign, so its blue can't be confused with the down colour). Everything else —
selection, focus, primary action, the product lockup, dividers, chips, markers
— is grey at the appropriate lightness. When in doubt, leave it grey.

Orange and navy were each reintroduced twice (chart-line recolouring freed
orange to selection/focus/action; the Pay/Receive diagram took orange as an
accent) and are now removed in one sweep. See the reversed entries in
`## Provisional`.

#### Direction (red up / blue down)

Semantic direction marks, not a brand palette. Korean market convention
overrides the old "sign never by hue" rule (§5). **Only numbers with a
direction get hue**: changes, percentages, grid tints. Levels stay ink.

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

#### Chart line — blue [revised Session 16 Pass E]

A plain line chart has no per-point up/down sense, so it is one colour: **blue**
(kept from the Session 16 recolouring). It is the **same blue as the down-delta**
— a line has no sign, so there is nothing to confuse, and the line and the
down-numbers live in different panes. (If a blue line ever reads as "down" beside
a column of blue numbers, move strokes to ink — see `## Provisional`.) Navy was
rejected for strokes because §9 keeps everything non-directional grey.

| Role | Light | Dark |
|---|---|---|
| Chart line (stroke) | `#0064FF` (4.92:1 on white) | `#4C93FF` (5.37:1 on the dark tile) |

**Candles are the exception [Session 16, write it here so a later session does
not reinvent it].** A candle body has a sign (close vs open), so it uses the
**domestic convention: 상승 빨강 / 하락 파랑** — the direction tokens
(`--bw-up` / `--bw-down`), NOT the blue line colour. Line charts stay blue;
only candle bodies take the red/blue direction pair.

#### Selected / focus / action / pulse — INK [palette cut; re-reverses Session 16 Pass E]

Every non-directional interactive state is **ink/grey**, not a hue:

| Role | Treatment |
|---|---|
| Primary action (filled button) | ink fill, light label (`bg-ink` / `text-page`) |
| Selected state (tab, segmented, list item) | dark ink pill, light label — the reference tab control |
| Focus ring (`:focus-visible`) | ink outline |
| Selection (`::selection`) | ink background, light text |
| Active-tab underline / pinned-row marker | ink |
| Heatmap / cell pulse | ink |
| Pay/Receive diagram | no accent — the curve takes the chart-stroke blue, arrows take the direction colours |

Because `bg-ink` inverts with the theme (near-black in light, near-white in
dark), an ink pill is dark-on-light in light mode and light-on-dark in dark
mode — legible in both, no dark-on-dark failure. (This RE-reverses the Session
16 Pass E "orange for selection/focus/action" note; that note itself reversed
Session 15's "focus/selection are ink". We are back to ink, now permanently: the
palette is red/blue/grey.)

#### What stays grey

The **product lockup is ink** (navy removed). Levels, axes, gridlines, labels,
dividers, chips, and every non-directional marker stay ink/grey, differentiated
by lightness. Series separation inside the enlarged view is the opacity ramp,
unchanged. Orange (`#F58220`), navy (`#043B72`), and the sub-palette (`#CB6015`,
`#84888B`, `#AD624E`, `#0086B8`, …) remain **defined but unreferenced** in the
token module; no component may reference them (gated — §9 colour guard).

`band-hue-contrast.test.ts` gates what ships: the chart-line blue at the 3:1
stroke floor on both surfaces, and both direction colours at the 4.5:1 text
floor (§ Session 15 Pass E1 split the guard by usage). Mechanism unchanged: hex
lives only in the token layer (raw-hex lint); SVG lines take the stroke colour
via `currentColor`; canvas lines resolve it to hex through the theme bridge and
pass `assertNoCssVars()`.

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
    pops in blue + floating tooltip + calendar heatmap); enlarged view
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
- **Event detection is fixed to the D-1 basis.** It always reads "what changed
  since the previous business day," independent of any comparison basis shown
  elsewhere. (The global comparison-basis selector this once coordinated with was
  removed in the list-first redesign, §4 — the fixed D-1 basis stands on its own.)
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
  individually clickable and focus their instrument (switch tab, pin, pan).
- **No hard visible cap [implemented Pass D].** The popover renders every
  cluster and scrolls (`max-h-[70vh]`); a numeric cap proved unnecessary because
  rule (c)'s own distribution keeps the list short — p90 = 2 collapsed lines/day,
  max = 12 over the 500-day replay, so even the worst day fits without dropping
  an event. (The earlier spec proposed a cap of 12; the scroll container makes
  it moot and can never silently drop an event.)

Replay of rule (c) over the last 500 business days: median 1, p90 2, max 12,
empty on 153/500 days — a log that can be empty, unlike the prior rule
(empty 1/500).

## 13. Explicitly out of scope for v2

- Strategy tooling in the enlarged view (the reserved empty region stays empty).
- Any user layout customization. Panel add/remove.
- Scenario engine UI, trade capture UI (entry points only via change log).

(Removed Session 12: color/hue is now in — §9; outrights and spreads
band-views are now built — §2. Removed Session 14: the volatility engine is now
built — relative ATR, §4/§16 and `## Provisional`.)

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

## 15. Voice & copy [rewritten Session 15]

This is a desk tool, not a consumer app. 해요체 came from the casual-app pivot
and made definitional text sound like it was addressing a beginner. Two rules,
enforced as rules so a later session matches them instead of re-deriving them.

### Register — 합니다체

Everything **declarative** is 합니다체; labels stay noun-final; nothing is
playful. The only survivor of the softer register is the **error state**.
Interaction hints stay short and human but are now 합니다체 too. Sweep the whole
product, not just new copy — empty states, loading text, tooltips, the change
log.

Before → after:

| context | before (해요체) | after (합니다체) |
|---|---|---|
| preview empty (hint) | 행을 올려두면 그래프가 나와요 | 행에 올려두면 그 종목 흐름이 나옵니다 |
| loading | 불러오는 중이에요 | 불러오는 중입니다 |
| no history | 과거 흐름을 볼 수 없어요 | 과거 흐름을 볼 수 없습니다 |
| open hint | 눌러서 크게 볼 수 있어요 | 눌러서 크게 볼 수 있습니다 |
| reserved region | 전략 도구가 …들어올 예정이에요 | 전략 도구가 …들어올 예정입니다 |
| command empty | 찾는 종목이 없어요 | 찾는 종목이 없습니다 |
| **error (survivor)** | 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요 | *(kept)* |

- The `한 줄` column is a compact fragment, not a sentence: `일간 변동 상위 3%`,
  `백분위 99`, `단독 상승` (§2 ladder).
- **Never translate instrument nomenclature.** `1.5Y`, `3s10s`, `2s5s10s`,
  `1YF`, `SPOT`, `1Yx1Y` stay technical; a sentence may wrap them, never rename
  them.
- Numbers keep their units (bp, %) and signs.

### Terminology — the standard desk words, never paraphrased

A reader of this product knows what a butterfly is, or is about to learn the
real word; teaching them "나비" teaches nothing usable. Use the standard terms
directly:

- 버터플라이 스프레드, 벨리, 윙, 확대·축소
- 커브 스프레드, 스티프닝, 플래트닝
- 내재 선도금리, 파 금리, 스왑 스프레드
- 약세·강세 for rate direction, bp for units

**Forbidden** (examples of the failure mode): `나비`, `양옆`, `싼지 비싼지`,
`얼마나 거친지`, `묶어 보는`. If a phrase would not appear in a desk note, it
does not go in the product. The instrument glosses (§C1, `ui/gloss.ts`) are the
reference for the register + vocabulary; `gloss.test.ts` pins their wording.

## 16. The computation boundary [OWNER, Session 14]

Anything that has to be **calculated** is calculated in the **backend**. The
frontend turns numbers into pixels; it does not turn market data into numbers.
The line, stated so it can be applied without a judgement call:

- **Backend — market data → numbers.** Levels, every delta, percentiles,
  ratios, forwards, spreads, flies, volatility, downsampled series, sort keys,
  and the *classification* behind any summary text. If a displayed number is the
  result of arithmetic on market data, it is produced here and travels the wire.
- **Frontend — numbers → pixels.** Colour mapping, tint alpha, layout, rounding
  for display, thousands separators, `null`→"—", and ordering rows by a key the
  backend already supplied. No arithmetic on market data: no averaging, no bp
  conversion, no delta, no percentile.

**The one deliberate exception — classify in the backend, phrase in the
frontend.** The `한 줄` column ships as a *classification*, e.g.
`{ kind: "extreme", value: 99 }`, never the finished Korean string. Copy is
presentation: if changing wording required a backend deploy, the wording would
never improve. So the backend decides *what is true* (an extreme percentile, a
retracement, or nothing); the frontend decides *how to say it*.

**Enforced by** `guards/row-vm-source.test.ts`: every field the row view-model
builder (`buildRows`) emits must be declared in `ROW_FIELD_SOURCE` as either
`dto` (read straight from the API) or `format` (pure presentation). A new field
with no declaration fails the gate; a field that needs a calculation has no
honest declaration and must move to the backend. `dto` fields are additionally
checked to equal their API source, so arithmetic cannot hide in the passthrough.

Preview series are **downsampled in the backend** (~150 points); full
resolution is a separate request for the enlarged view. Range statistics
(min/max/avg), per-point daily change, and the calendar's daily-change series
all arrive precomputed — the browser never differences a series.

## Settled decisions & open items [closed out, final session Pass E]

These accumulated as "Provisional" across sessions. As of the final session
every entry has a status: **each is a CONFIRMED decision of record unless tagged
`[OPEN]`.** Confirmed entries are the standing rationale for a choice already in
the code and spec; open entries name work genuinely not done. Do not re-litigate
a confirmed entry without a reason; do not let an `[OPEN]` one rot silently.

- **VERIFIED LIVE [closing session, part 2, Pass B] — surfaces looked at in a
  browser for the first time.** Every one held up; no defect found, no fix
  needed:
  - **Dark mode** across every surface (table, popup line + candles, forward
    matrix tint, curve heatmap, banner, screener chips): contrast is clean,
    including the blue/red direction numbers, the red banner, and the ink-on-red
    matrix wash. The theme persists across reload (`localStorage["bw-theme"]` +
    the pre-hydration init in `layout.tsx`).
  - **Single-column bottom-sheet fallback** below 1520px: table goes full width,
    a row click raises the preview as a bottom sheet with a drag handle and the
    press-to-enlarge line. (The automation window is locked at 1920px, so this
    was forced by temporarily raising `TWO_PANE_MIN`, screenshotted, and
    reverted — no code change shipped.)
  - **Deep-zoom heatmap rebucketing** confirmed: zooming the candle chart into a
    ~1-year window widened the heatmap cells into far fewer buckets and kept the
    ink crosshair-synced marker aligned.
  - **Candles never comb** at any zoom (LWC scales candle width to bar spacing);
    the interval is user-chosen (선/주봉/월봉) and labelled in the toggle, so the
    absence of an auto step-up is invisible to the reader (see the entry below).
  - **Quiet-day tint reads as calm, not broken.** The matrix/heatmap tint is an
    OWN-HISTORY PERCENTILE with an untinted floor below pct70 (`ui/tint.ts`), so
    on a calm day most cells fall below pct70 and go **untinted** (clean, numbers
    still shown) rather than washing uniformly faint. This is exactly the failure
    the percentile scale was introduced to avoid (it replaced a grid-max scale
    that lit 96–99% of cells on a big day). Confirmed against the calm 2017–2019
    region of the curve heatmap, which reads near-blank as intended. No as-of
    selector exists to replay a calm date on the main matrix (single-snapshot
    design), so the calm behaviour was verified on the shared heatmap scale.
- **RESOLVED [closing session, part 2, Pass E1] — key-forward gauges + the
  level/change header fix.** The 주요 포워드 block holds the six actually-quoted
  forwards and was the only region on screen with no visual encoding. Two things
  changed. (1) **Header ambiguity — resolved by removal.** The block used to show
  the LEVEL at each basis under Now/D-1/WTD/MTD/QTD/YTD headers, identical to the
  main table's headers which show the CHANGE. Rather than relabel or flip the
  block to deltas, the per-basis level columns were **dropped**: they were the
  ambiguous, low-value part (the main table owns the change story; the popup
  owns the full path). The block now shows only 현재 (the quoted level) + the
  gauge, so no header is shared with a different quantity. (2) **The gauge.**
  Each row gets a thin track spanning that forward's **10y level min→max**
  (`backend/app/forwards.py::_level_range`, a LEVEL distribution — distinct from
  the |Δ| move percentile that drives the tint), a fill + marker at the current
  level's POSITION in that range, and the **percentile** as a number at the
  right. At the tails (≥90th or ≤10th) the marker goes **full ink** and the
  percentile **full-strength ink**, so a 99th-percentile row is distinct from a
  72nd at a glance; away from the tails the marker is a lighter grey and the
  percentile dimmed. Distinction is by **lightness, not hue** (palette cut — the
  old accent was `--bw-interactive`). Track ends are labelled 10년 최저 / 10년
  최고 **once** above the block. This is the only place in the product that shows
  a level's position within its own range.
- **RESOLVED [closing session, part 2, Pass E2] — the matrix tint has a
  legend.** 168 tinted cells (plus the popup heatmap on the same scale) with
  nothing saying what the intensity meant. `ui/TintLegend.tsx` is a compact
  diverging swatch strip 하락 → untinted middle → 상승 with one line: intensity =
  today's move vs that series' own 10y daily-change history. Swatch alphas are
  the real scale endpoints (`MATRIX_FLOOR..MATRIX_FULL` from `tint.ts`) so the
  key can't drift from the cells; hue flips with the theme via the tokens. The
  SAME component renders under the forward matrix (표로 보기) and under the popup
  curve heatmap, so the shared scale is explained identically in both. Small and
  quiet — a key, not a feature.
- **RESOLVED [closing session, part 2, Pass D] — the change log is surfaced,
  not deleted.** The events rule (`backend/app/events.py`) is candidate (c) from
  the Session-11 500-day replay (`docs/diagnostics/changelog-firing.md`): band
  transition ∪ own-Δ percentile, correlation-collapsed, owner-confirmed. It is a
  good rule — frequently empty (~31% of days silent), p90 = 2 leading lines — so
  the answer to "surface or delete" is **surface**: the diagnostic explicitly
  anticipated a surfacing pass ("Pass B", a cap "recorded in DESIGN §12") that
  the list-first redesign orphaned, not abandoned. The surface is
  `ui/ChangeLog.tsx`: a compact **popover off the header** (not a permanent
  strip — the list-first shell gives vertical space to the table), reading
  `summary.events`. Each cluster shows its leading line with reason chips
  (구간 전환 / 큰 변동), an expandable **연관 N건** revealing the correlated lines,
  and **click-to-focus** — a line switches to the instrument's own group tab,
  pins it (preview / bottom sheet follows), and pans the table to it via the
  tile registry (§3), the same routing the command bar uses. The empty state is
  itself information (변화 없음 / "조용한 하루"), so the trigger is always present
  and shows the cluster count. No cap constant was needed: the rule's own p90 = 2
  keeps the list short; the popover scrolls if a rare burst day (replay max 12)
  arrives. Verified live (2 clusters on 2026-07-24: a 1.5Y/3Y band transition
  + the genuine 1D +12.5bp move).
- **RESOLVED [closing session, part 2, Pass C] — the product measures its own
  staleness.** `data/irsdata.xlsx` is a static snapshot and there is no feed, so
  without this the app shows yesterday's curve as today's silently — this
  project's recurring defect class. `backend/app/staleness.py` computes the
  dataset's age in **KR business days** (reusing the frozen engine's
  `_is_kr_business_day`, so freshness and the curve share one calendar; weekends
  and public holidays don't age the data), recomputed per request so the age
  advances with the wall clock even though the file does not. `/api/health`
  carries a `freshness` block (`asOf` / `today` / `ageBusinessDays` / `level`).
  The header's `DataFreshness` scales loudness with `level`: **current** (age 0,
  incl. a Friday snapshot over the weekend) shows just the date, faint;
  **behind** (1 business day) an outlined chip `{date} · 1영업일 지연`; **stale**
  (≥2) a red-outlined, bold chip stating it in words (`데이터 N영업일 지연 — 최신
  커브가 아닐 수 있습니다`). Monochrome-first: border + weight + words carry it, red
  is the layer (§5); `text-up`/`border-up` clear 4.5:1 in both themes. The
  manual refresh procedure is documented honestly in the README. Pinned by
  `tests/test_staleness.py`.
- **RESOLVED [final §C] — the curve heatmap is synced to the chart.** DetailChart
  emits its visible date window and crosshair date; the heatmap binds its
  x-domain to that window (shows the buckets in view, stretched to fill width so
  cells stay ≥8px — the 110-bucket full range is already ~8px, so no step-up is
  needed) and marks the hovered column with an ink focus rule aligned to the
  chart crosshair. Moved to §2 popup. **Rebucketing verified live [Pass B].**
- **Candle interval step-up not needed at current densities [Session 16 §G].**
  Ten years is ~550 weekly or ~130 monthly bars; both fit the popup's ~900px at
  minBarSpacing 0.05 without dropping bars, so the auto-step-up to a coarser
  interval never engages here. The safety is the bar-count / domain assertion
  (`assertDomainRendered` on the candle series): a dropped bar throws loudly
  rather than showing a plausible-looking wrong picture. Add the step-up if a
  much narrower popup or a finer interval is ever introduced.
- **`당일 변화 +0.0` diagnosis [Session 16 §F].** Not a bug in `d`. On
  2022-11-28 `ONx9M` genuinely moved +0.01bp (4.0584→4.0585) — `d` matched the
  true one-observation change exactly, and downsampling preserves it (`d` is
  computed on the full series before thinning; `test_d_is_a_true_one_observation_change_after_downsample`
  pins this regardless of the downsample ratio). The `+0.0` is honest 1-decimal
  display of a genuinely flat day for that specific forward, not the multi-day-
  as-daily error Session 14 might have introduced. Left the 1dp bp grammar as-is.
- **`구간` vs `10년` statistics scope [Session 16 §F].** The preview has no
  zoom, so its min/max/avg ARE the full history and are labelled **`10년`**. The
  popup zooms, so its stats follow the **visible range** (recompute on zoom) and
  are labelled **`구간`** — genuinely selectable there.
- **RESOLVED [final §B] — change-column outlier cue is a leading-edge rule, not
  a fill.** Session 16 §J tried a same-hue background wash and had to cap it at
  0.04 to keep the coloured number ≥4.5:1 — but 0.04 (≈#fef8f8) is invisible, so
  it marked nothing. A fill behind coloured text can never work here. The cue
  is now a 3px leading-edge rule (`columnCue`) in the direction hue, off the
  glyph, with no fill. The matrix's 0.45 wash stays (its text is ink). Moved to
  §5.
- **Pin clears on tab change [Session 16 §I].** A pinned row from another tab
  was showing silently in the preview. Of the two offered cures — clear the pin,
  or keep it and mark which tab it belongs to — the pin is **cleared** on a tab
  change (simplest, removes the ambiguous state entirely). The preview falls
  back to the tab's idle curve.
- **`{start}xSPOT` dropped from the forward LIST [Session 16 §I].** A
  spot-starting par rate is the outright at that start with no forward period —
  a duplicate. It stays in the 표로 보기 matrix as the spot reference column but
  no longer appears as a forward row (so no confusing `1Y3MxSPOT` label in the
  list).

- **Two-pane breakpoint = 1520px [Session 15].** The prompt said "about 1440",
  but that assumed a narrower table; with the table at 880px and the preview
  floor at 600px plus the surface margin, the preview actually reaches its floor
  at ~1520px viewport, which is where the single-column fallback engages
  (`ui/useIsWide.ts::TWO_PANE_MIN`). Table width 880 and floor 600 are the
  low end of the spec's "roughly 880–1100" / "about 600"; adjust freely.

- **Volatility = relative ATR [Session 14].** `mean(ATR over 5 obs) /
  mean(ATR over 60 obs)`, a dimensionless short-vs-long realised-vol ratio
  (~1.0 normal, >1 = the recent window is hotter). **Close-only form:** the
  export carries daily `MID종가` closes with **no intraday high/low column**, so
  true range collapses to `TR_t = |r_t − r_{t−1}|` in bp — the measure is the
  ratio of the 5-obs to the 60-obs mean absolute change. Someone reading a
  number needs to know it is *this* form, not the high−low ATR. Implemented as a
  generic transform over any series id (`backend/app/volatility.py`); only the
  tenor set is exposed for now. Constants **settled final Pass E**: **warm-up
  61 observations** — the mathematical minimum (60 daily changes need 61
  points), no buffer, corrected from 65; **denominator floor 0.1 bp** on the
  60-obs mean, raised from 0.05 to trim the clearest divide-by-near-zero tail;
  windows counted in **observations, not calendar days**.
  **Max-ratio finding (Pass E):** over 10y the max relative-ATR is **3M = 12.0**
  and **1D = 6.0** (all swap tenors ≤ 4.5). This is NOT a floor artefact — it
  barely moves at a 0.5 bp floor — it is genuine: policy/fixing rates (1D call,
  3M CD91) are step-like (pinned for weeks, then jump), so their short-vs-long
  ratio legitimately spikes. It does not dominate a sort because the vol tab's
  default order is by tenor, not by the ratio level. A display cap could be
  added later if the large 3M value ever reads as spurious; not done.

- **Name split**: the product is Sauron (header, `<title>`, all user-facing
  copy). The repo directory, npm package, mirror script, and internal
  identifiers stay `braveworld` — a path rename is churn with no payoff today.
- **Direction colors**: up `#D92D3C` / dark `#F16E77`; down `#0064FF` (Toss
  Blue) / dark `#4C93FF`. Up was the owner's `#F04452` (Toss Red) but at 3.71:1
  on white it was too light to read as change-number text — the one colour
  covering most of the table — so Session 15 Pass E1 deepened it to `#D92D3C`
  (4.78:1 tile / 4.58:1 page), hue and saturation kept. `#0064FF` is ~3.9:1 on
  the dark tile, so dark lightens to `#4C93FF`. All four now clear the **4.5:1
  text floor**; `band-hue-contrast.test.ts` gates by usage (text 4.5, stroke 3).
- **Blue does double duty (down-direction + chart stroke) — evaluated, ACCEPTED
  [palette cut, Pass D].** With the palette cut to red/blue/grey, blue is both
  the down-delta colour and the (signless) line-chart stroke. Checked live in
  both themes: a blue preview/chart line does **not** read as "down" because the
  line and the change-column numbers live in **separate panes** with unambiguous
  context — a large titled price chart on the right, small signed figures in the
  table on the left. So strokes stay blue. **Revisit only if** a future layout
  ever places a blue stroke *inside the same visual group* as a column of blue
  down-numbers; the fix then is to move strokes to ink (the chart is signless,
  so ink loses nothing) — do not reach for a third hue.
- **REVERSED [palette cut] — "orange = action/selection" is withdrawn.** The
  Session 16 §E decision (line → blue, freeing orange for primary action /
  selection / focus / hover pulse) was CONFIRMED and is now **reversed**: the
  product carries only red/blue/grey. Chart stroke stays blue (`#0064FF` / dark
  `#4C93FF`, ≥3:1 stroke floor); candle bodies keep 상승 빨강 / 하락 파랑. But
  every non-directional interactive state — primary action, selection, focus,
  hover pulse, the active-tab underline, the pinned-row marker, the heatmap
  crosshair marker, the key-forward gauge marker, the product lockup, and the
  Pay/Receive diagram accent — is now **ink/grey**, not orange or navy. Orange
  (`#F58220`) and navy (`#043B72`) remain defined but unreferenced; §9 colour
  guard fails any component that references them. (This also withdraws the
  reintroduction of orange as the Pay/Receive diagram accent.)
- **OBSOLETE — heatmap pulse.** The calendar heatmap it described was removed
  in Session 15 §I, so there is no pulse. (Kept only so the reference isn't
  mistaken for a live feature.)
- **한 줄 column** [superseded Session 13 — see the Left-pane spec]. It no
  longer prints "10년 고점권" or a basis magnitude (that restated the columns);
  it now emits an extreme-band percentile number, a retracement shape, or
  nothing. No new backend data; all fields already exist.
- **Every group now has stage-2 history [Session 14].** Forwards derive theirs
  from each date's curve; volatility serves its relative-ATR ratio series
  (`vol:<tenor>`). The forward enlarged view still shows the forward matrix
  instead of a line chart. (Superseded the Session-13 note that forwards and
  volatility had no history and showed placeholder sentences.)
- **Forward idle curve = the 1YF ladder** (the 1-year forward rate at each
  start point, one line, x = start point). Chosen over "one line per
  tenor" (8 same-colour lines are unreadable) and "x = tenor for a selected
  start" (needs an extra selector). It is the standard 1y-forward curve.
- **Calendar heatmap removed [Session 15 §I].** It plotted daily change — the
  slope of the line drawn directly above it — and the one thing it added
  (volatility clustering) is now answered numerically by the relative-ATR
  series. The hovered-date readout is the chart tooltip. The forward-matrix tint
  stays (a genuine start × tenor grid a line cannot replace), and `ui/tint.ts`
  stays, now used only by the matrix. A tenor × date heatmap may return later in
  a curve context (parallel vs led moves) — not now. The heatmap pulse / focus
  notes elsewhere in this doc refer to the removed component.
- **RESOLVED [final §E] — dead wall-pan code removed.** The list-first UI never
  pans, so `wall/usePan.ts` was dead (no importers); deleted this session. The
  tile registry is retained and repointed at table rows for the command bar.
- **Detail-open root cause (fixed)**: the earlier failure was the wall pan's
  click-suppression swallowing taps. The list has no pan; the chart-open click
  is a plain handler and the enlarged view is wrapped in an error boundary so a
  thrown guard renders a message, not a blank region.
- **Row press feedback**: CSS transforms do not apply to `display: table-row`,
  so table rows use a surface (bg) change on hover/press instead of the 0.98
  scale; scale press is on the controls (filter chips, preview, sheet).