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

### The 전체 overview — three columns, not a list [OWNER, 2026-07-31]

전체 used to be every instrument in one table, which is the least useful
arrangement of them: outrights, spreads and forwards interleaved by a sort key,
so the thing a rates screen is opened for — *where are the three blocks right
now* — took scrolling to answer. 전체 is now a fixed overview and **takes the
whole surface**: 아웃라이트 · 스프레드 · 포워드 side by side, each column
showing only its **주요** set, each with **its own chart underneath**.

- **One column owns one chart.** Clicking a tenor draws it in that column and
  nowhere else, so three comparisons can be on screen at once and moving
  between columns never costs the one already up. Each column opens on its own
  first row — the space is never empty and the affordance needs no click.
- **The side preview pane is hidden here**, by the same flag that widens the
  left pane (`fullWidth` in `App.tsx`, the matrix mode's mechanism). A fourth
  chart beside three would answer a question nobody asked, in the space the
  columns need.
- **버터플라이 and 변동성 are not in it.** Three columns is the point; a fourth
  and a fifth would make it the list again.
- **It IS the instrument table's grid** [OWNER — "이거랑 동일하게"]. Header
  text, column template (`gridTemplate(ALL_COLUMNS)`), row height, 13px type
  and the 52주 sub-grid all come from the modules the tabs use (`columns.ts`,
  `RangeCells`), so a column here and the 아웃라이트 tab print the same row the
  same way. Each column is titled with that tab's own divider heading —
  **주요 아웃라이트 / 주요 스프레드 / 주요 포워드**.
  - It never drops a column: `ALL_COLUMNS`, never the ladder. Showing all six
    figures at once is the entire reason the tab exists.
  - **Do not re-fork this grid.** It shipped as a bespoke eight-track grid at
    its own type size, and that second definition of one thing drifted twice in
    one session — a level track sized by a header it did not print, and labels
    clipped at three successive widths because `ch` is the ZERO advance while
    `M` is far wider. The shared template had already solved both. If the
    overview needs a column the table lacks, that is a change to `columns.ts`.
  - The only track that differs is the elastic **52주** one, which sits at its
    floor here (211px) and absorbs pane slack in the tab (433px). That is the
    column doing its designed job, not drift; the five fixed tracks are
    byte-identical.
- **Left / centre / right, with the outer margins EQUAL to the inner gaps**
  [OWNER]. `max-content` columns + `justify-evenly`: the tracks are the table's
  own width and every spare pixel is split four ways — edge, column, column,
  edge. Equal thirds spent the same pixels as trailing slack *inside* each
  column, which put the widest gap on the screen between one column's last
  number and the next column's 종목; `justify-between` then pinned the outer
  columns to the window, giving 138px separations against a 20px margin.
  - **This tab takes no page gutter and no scrollbar gutter.** Both sit
    outside the content box the gaps are computed in, so either one would add
    itself to the outer two margins only — the exact asymmetry `evenly`
    removes. The 16px `scrollbar-gutter: stable` exists to stop the *table's*
    grid shifting when a filter crosses the overflow boundary; the overview is
    a fixed set with no filters and nothing to scroll.
- **The charts sit on the floor at a FIXED height** (200px). They first grew
  into whatever each list left, which filled the space but made the curve the
  subject: 369px of chart under ~250px of table, and three charts of three
  sizes. A constant also makes "three charts, one height" true by
  construction — it replaced a measured agreement (each column reporting its
  leftover, shortest wins) that could disagree with itself and needed a
  height measurement to exist at all.
  - **The chart is measured OUT OF FLOW, and that is load-bearing.** Sizing an
    in-flow child from a ResizeObserver on its own parent is a feedback loop:
    the chart grows to the measured height, which grows the box, which reports
    larger. It does not settle — the first attempt ran the charts off the
    bottom of the page. Absolute positioning inside the measured box is what
    makes the loop impossible.
  - The container fills its space with **flex**, not `min-h-full`: a percentage
    min-height resolves against the content box while the scroll container's
    `pt-3 pb-8` sit outside it, so `min-h-full` overshoots by 44px and puts a
    permanent scrollbar on a page that fits.
- `ui/OverviewColumns.tsx`; pinned by `guards/overview-and-divider.test.ts`.

### 주요 / 전체 — the divider, on every instrument tab [OWNER, 2026-07-31]

The forward tab's two-block layout is now every instrument tab's: 주요 members
first under a **주요 <group>** heading, everything else under **전체 <group>**.
변동성 does not divide (six rows do not need it) and 전체 is not a list at all.

The 주요 sets are the owner's, defined **once, server-side** (`derive.py`
`KEY_OUTRIGHTS` / `KEY_SPREADS` / `KEY_FLIES`, `forwards.py::KEY_FORWARDS`);
each row carries a `key` boolean and the browser never re-derives it (§16).

| tab | 주요 |
|---|---|
| 아웃라이트 | `1D 3M 6M 9M 1Y 1.5Y 2Y 3Y 5Y 10Y` — exactly the live-quoted node set |
| 스프레드 | `1s2s 1s3s 2s3s 2s5s 2s10s 3s5s 3s10s 5s10s` |
| 버터플라이 | `6M/9M/1Y 1s1.5s2s 2s3s5s 2s5s10s` |
| 포워드 | `3Mx3M 6Mx3M 9Mx3M 1Yx1Y 2Yx1Y 5Yx5Y` |

- **주요 must be a SUBSET of 전체**, or the divider names rows that are not in
  the list beneath it. `6M/9M/1Y` is why `DISPLAY_TENORS` gained 6M and 9M
  (spreads 15→28, flies 20→56 — the combinatorics are quadratic and cubic in
  that list, so do not widen it casually). Pinned by
  `test_derive.py::test_key_sets_are_subsets_of_what_the_universe_produces`.
- **The 주요 pin is an ordering, not just a heading**: `orderRows(…, keyFirst)`
  puts 주요 first, so the two cannot disagree. **Sorting a change column
  overrides both** — "what moved most" is asked of the whole tab — and the
  headings are suppressed in exactly that state.
- A heading is never drawn over a block whose counterpart is empty (a screener
  can filter one side away; a lone 주요 heading would state a split that is not
  on screen).

### The two reference lines, on every % and bp chart [OWNER, 2026-07-31 / 2026-08-03]

**CD 91d and the BOK base rate, always drawn together** — on every **%-unit**
chart (outrights and forwards) AND, since 2026-08-03, on every **bp-unit**
chart (spreads and butterflies): the preview pane, the bottom sheet, and the
전체 columns. Volatility charts are ratio and stay **excluded** — a policy
rate says nothing about a dimensionless ratio.

**On a bp chart the references keep their OWN % scale** (`policyAxisMode` =
`"secondary"`): the instrument's bp domain is exactly what its own points
make it, the references are scaled to their own extent over the same plot,
and **both axes carry unit-suffixed tick labels** (`fmtAxis` grammar —
orientation marks, not data). Never a shared scale — 2.75 on a ±30bp axis
flattens the spread into a hairline — and never a rebasing to a common
index, which destroys the LEVEL the overlay exists to be read against.
Pinned by `guards/policy-dual-axis.test.ts`, whose chart-kind list comes from
`buildRows` over the shipped payloads, not from a hand-written list.

The pairing is one instruction, not two. CD is the floating leg every KRW IRS
quote is struck against and the base rate is what CD tracks, so a rate is read
against both or against neither. A first pass drew **only** the base rate,
reasoning that the 3M node IS CD91 so CD was already on screen where it
mattered — true of exactly one chart out of twenty, and the wrong reading of
the instruction.

- Told apart by **DASH PATTERN, not colour** (§5): CD dotted (`1 2`), the base
  rate a longer dash (`3 3`), both in ink under the instrument's blue line. A
  **legend names them on the chart** — they are the same ink at the same weight,
  and "the flat one is policy" stops being true the moment CD is flat too.
- **CD is skipped on the 3M chart itself**, where the reference is the subject.
  `useCdReference` owns that decision so every caller answers it the same way.
- **CD is aligned BY DATE, never by position** (`alignSeries`). Two ~150-point
  previews are downsampled independently, so index *i* is a different trading
  day in each; zipping them would plot a CD level from one week against an
  instrument level from another — a chart that looks entirely plausible and is
  wrong. It is `null` before CD's first observation and the line **breaks**
  there rather than drawing a flat lead-in nobody measured.

- **Data**: `data/bokbaserate.xlsx` (Infomax `한국:기준금리`, 2016→). A static
  snapshot like the IRS workbook, refreshed by hand and separately.
- **It is a STEP.** Square corners, never interpolated — the rate holds flat
  and jumps on a Board decision. ~3,850 daily rows are served as ~23 **corners**
  (`policy.decisions`); the flat days would be one number sent thousands of
  times (§20). On the cross-sectional idle curve the step degenerates to a
  single horizontal reference at the current level.
- **One axis PER UNIT.** On a % chart the caller widens its y-domain to hold
  both — clipping the step to the instrument's own domain would pin it
  against an edge and read as "equal to the minimum", and a second axis would
  compare two rates in the SAME unit at two different scales. On a bp chart
  the units differ, so the references get the secondary % scale above — the
  same reasoning, landing on the other side.
- **Ink, dashed, under the instrument line** — the dash pattern carries it in
  grayscale, the reduced opacity is a layer (§5). It is the reference the
  instrument is read against, not a second subject, and it is excluded from
  the crosshair.
- **Carrying it forward is a claim, and it is bounded.** The payload's
  `through` is the last date the backend can vouch for: if a Board meeting
  falls between the workbook's last date and the dataset's as-of date, the step
  **ends at the workbook's last date** and a warning is logged, rather than
  drawing the old rate across the day it may have changed — on every chart at
  once, with nothing on screen to say so. **`through` is not the axis end**;
  running the line to the axis end undoes the whole guard and looks completely
  normal. `backend/app/policy.py`, `src/ui/policyLine.ts`; pinned by
  `tests/test_policy.py` and `guards/policy-line.test.ts`.
- MPC dates are duplicated into `policy.MPC_DATES` from the frontend's verified
  `calendar.json` (the backend must not read the frontend tree at runtime);
  `test_mpc_dates_match_the_calendar` fails if the copies drift.

### The backtest [OWNER, 2026-07-31]

**"그때 들어갔으면 지금 얼마였을까."** Clicking the CHART opens it; a row click
still pins. It took the enlarged chart's slot, because the pane chart is now
pane-sized and a popup whose job was "the same line, bigger" had nothing left
to do.

**A BOOK, NOT ONE TRADE** [OWNER]. Positions are rows: instrument, side, size,
entry AND exit, each independent — you leg in on different days and out on
different days. The chart click seeds the first row; more come from the row's
own dropdown or by clicking another instrument in the table behind (the sheet
stays open and captures it). Capped at 12: past that the sheet is unreadable
and each row is another full daily revaluation pass.

- **A closed position freezes and keeps counting.** After its exit its
  contribution stops responding to the market but stays in the total — money
  that was made does not un-make itself, and a position that kept marking after
  it was closed is the classic way a backtest flatters itself.
- **A position contributes nothing before its entry**, or the book pays out on
  a trade the desk had not put on.
- **Every position is sampled on the SAME dates**, so the totals add point for
  point. Sampling each on its own grid and summing would add figures from
  different days — which would look right and be wrong.
- **The chart draws the BOOK total only**; per position there are numbers, not
  lines. Three or four curves on one axis is a chart nobody reads, and "which
  one carried it" is answered faster by a column of figures.
- The book total rounds the SUM while each position rounds its OWN figure, so
  they can differ by up to half a won per position. Both cannot be exact; the
  tests assert the difference is bounded rather than zero.
- Positions are named the way the rest of the product names them (`3s10s`, not
  the `3Y-10Y` id the server echoes) and the direction reads in the
  instrument's own words (스티프너, not "롱").

- **Full revaluation, not Δrate × DV01.** Each day the position is revalued on
  THAT day's bootstrapped curve, so the number carries roll-down and carry. The
  approximation is first-order in the rate and blind to time: it cannot see
  that a 10Y entered a year ago is a 9Y today, and it books no coupon.
  Measured divergence: −4.9% over 7 days, −12.7% over 209, −43.1% over 2401.
- **Dirty NPV + settled cash.** A swap's dirty NPV drops by the net coupon on
  every payment date, because the flow leaves the valuation schedule the moment
  it is paid; marking on NPV alone draws a sawtooth that is pure accounting
  artefact. The correction's size is asserted: notional × (fixed − CD fixing) ×
  accrual, to within 1%.
- **A position ends at its own maturity.** A 9M struck in 2020 runs to 2021,
  not to the end of the file. The cap is applied where the position's SPAN is
  computed, so the book's window uses it too — computing the window from the
  requested exit while capping separately made the period column read 만기 while
  the chart drew a flat line past it. 만기 and 청산 are reported as different
  facts. A maturity beyond the data is NOT a maturity: `_index_on_or_before`
  clamps to the last row, so a 10Y struck in 2020 would otherwise claim to have
  matured on the final date.
- **Every tenor is priced at its own length.** `VanillaSwap` annotates
  `tenor_years: int` but its body only does `round(tenor_years * 365)`, so the
  float is what it wants. Obeying the annotation silently made 1D, 3M, 6M and
  9M all ONE-YEAR swaps (`round(0.25)` is 0, and an `or 1` finished the job) and
  1.5Y a 2Y — only whole-year tenors were ever right.
- **Legs are DV01-neutral at the ENTRY curve**, so the quoted spread or fly is
  the P&L driver rather than a lopsided outright bet. The notional goes on the
  reference leg (longest for a spread, belly for a fly) and the others follow.
- **No look-ahead.** Curves come from the row AT each date; floating periods
  take the CD91 print of F(R) = reset − 1 Seoul business day through the ported
  `select_fixing`, and the fixing store handed to each valuation is truncated
  at that date so the port's guard is not the only thing in the way.
- **손익 = 평가손익 + 캐리손익**, and that is an IDENTITY, not an attribution
  model [OWNER]. `pnl = (clean_t − clean_0) + (accrued_t − accrued_0 + cash)`:
  the first half is mark-to-market on the clean price (the rate move and
  roll-down), the second is interest actually earned or paid, settled plus
  still accruing. They reconstruct the headline to the rounding, which is
  asserted — a split that only roughly added up would be a model nobody agreed
  to, presented as arithmetic. Carry's sign follows the struck fixed rate
  against the CD that ACTUALLY printed over the holding period, not against CD
  on any one day.
- **The P&L chart has a hovered readout**: date, cumulative, and the ONE-DAY
  change. The change is SERVED, not differenced in the browser (§16) —
  differencing a rounded series client-side gives a number that disagrees with
  the difference of the two figures on screen.
  - **It is a real day even where the line is thinned.** A ten-year book draws
    400 of ~2,600 business days, so consecutive dots are ~6 days apart; the
    server therefore values the business day BEFORE every published point.
    Measured on the same chart: 당일 +789만원 against a −3,801만원 step between
    dots — the step was never a daily move. Costs one extra valuation per
    point (10y: 0.6s → 1.2s), which is not a trade worth agonising over.
  - `complete` says whether every business day is DRAWN. It no longer has
    anything to do with `d`, which is one day either way.
  - **Curves are bootstrapped once per date per run**, shared across positions.
    A three-position book was rebuilding the same array three times — 0.7ms
    each, 0.8s of a 2.2s run. The cache is per-request on purpose: a
    module-level one would survive a data refresh and serve a stale curve.
  - The readout is local, not the shared `ReadoutCard`. That card owns
    `fmtLevel`/`fmtDelta` so the preview chart and idle curve cannot drift into
    two grammars for one quantity; this axis is MONEY (`fmtKrw`, 억/만), and
    teaching the shared card a money mode would dissolve the property it exists
    for.
- **The entry date is the date you clicked** [OWNER: "커서가 가는 곳에서
  누르면 그 날부터 스타트해야지"]. The preview chart's crosshair is the only
  thing that knows which day the reader is pointing at, so it reports it and
  the click carries it into `?from=`. Only the FIRST row is seeded that way —
  rows added afterwards are new questions and fall back to a year before the
  data's end.
- **Direction is named by its LEGS**, not by a coined term — see
  `BacktestSheet.directionLabel`. 스티프너/플래트너 is a genuine market
  standard and leads with the legs spelled out after it; a butterfly gets the
  legs alone, because "buy the fly" has no market standard at all.
- **The instrument dropdown is grouped by kind** (`optgroup`): ~240 entries
  running 1D → 10Y → 6M/9M → 1s2s → 3Mx3M with nothing marking the boundaries
  required the reader to know the naming convention to know what they were
  looking at.
- **The sheet opens at 78vh**, not at its content height. Sized by content it
  opened as a strip and jumped to full height when a result arrived, so the
  reader met it twice.
- **LIVE BACKEND ONLY.** Every other surface reads a baked JSON file; this
  answer depends on inputs the reader chooses, so it cannot be one. Vercel runs
  the frontend and a backend runs behind it [OWNER] — which is also what keeps
  §16 intact, since the browser still computes nothing. With no backend
  configured the sheet says so rather than drawing an empty chart.
- **It does not run on its own.** The reader presses 실행. A backtest is a
  question someone asks, not something that happens while they are still typing
  the date, and each run is a full daily revaluation.
- Toss-style is a constraint on the NUMBERS as much as the paint: one big
  figure in plain Korean, controls that read as a sentence, and everything that
  is machinery (per-leg notionals, DV01, settled cash) under a fold.
- `ui/BacktestSheet.tsx`, `backend/app/backtest.py`, `/api/backtest?positions=`
  (`id,direction,notional,entry[,exit]` joined by `;` — a book is a URL you can
  paste to a colleague, the same property `?tile=` gives the rest of the product).

**Orphaned by this and NOT yet deleted:** `ui/EnlargedView.tsx` and
`wall/DetailChart.tsx` (the app's only lightweight-charts use). The swap costs
weekly/monthly candles and the six-basis readout, which the owner did not ask
to lose — see the ⚠ note at the top of EnlargedView.

### Stacking order

**A modal is above chrome, always** (`ui/layers.ts`). The bottom strip is
chrome at `z-40` and the backtest sheet was a modal at `z-30`, so the strip
painted over the sheet — the numbers said the opposite of what the product
means. The preview sheet at `z-20` had the same bug and nobody had opened it
beside the strip yet. Named layers rather than a number at each call site,
because these are picked in five files and the conflict is invisible until two
of them are on screen together.

### The page gutter [OWNER, 2026-07-31]

**80px off the window edge, on every surface that reaches it** — the header
band, the tab strip, the table's scroll container, the preview pane's outer
edge, the bottom strip. Defined once in `ui/pageGutter.ts` (`PAGE_X`,
`PAGE_R`, `PAGE_X_PX`), because those five reach the edge independently and
four agreeing while the fifth does not is invisible until they are on screen
together.

The app sat at 20px before this: a card's inset applied to a full-bleed
surface. The 전체 columns landed on a much wider margin first and the rest of
the product looked cramped beside it.

- 80 is a **plain number, not derived**. The 전체 tab's margin is a quarter of
  its own leftover width (79px at the owner's window, different at every other
  width); matching that exactly everywhere would mean every surface running the
  overview's arithmetic. 80 is that figure rounded and fixed — measured live at
  83 vs 80, which read as one decision.
- It must be a **literal class**. Tailwind scans source text, so a class built
  at runtime (`PAGE_X.replace("px-", "pr-")` — the first attempt) names a rule
  that was never generated and the padding silently does not exist. Both edges
  carry their own spelled-out constant.
- The table pane keeps the full column set at this gutter: 702px of content
  against the 600px threshold where 52주 drops (measured on all five tabs).

### Left pane — the instrument table

Columns, left to right:

| Instrument | *the level* (header = the data's date) | Yesterday | MTD | YTD | 52주 고점·저점·평균 |

**Three change bases, not five [OWNER, 2026-07-31].** WTD and QTD were
deleted app-wide. Between 어제 and MTD a week is rarely the interval anyone
reasons in, and QTD differs from MTD in only two months of three — two
columns that mostly restated their neighbours. A day, a month, a year; the
52주 statistics carry the longer view. The set is defined once in
`derive.BASIS_KEYS` and mirrored by `api.ts::BasisKey`.

- **Instrument** — `10Y`, `3s10s`, `2s5s10s`, `2Yx1Y`, `SPOT`. Never
  translated (§15). Notation is defined once in **§ Instrument notation**
  below and is identical across labels, the command bar, and ids.
  - **Quoted vs interpolated [Session 13]:** outright nodes carry a small
    leading **dot** — filled = a live-quoted tenor, hollow = interpolated
    (`4Y/6Y/7Y/8Y/9Y`). A dot, not a badge (§5 channel discipline); it marks
    provenance without adding a column. Spreads/flies/forwards get no dot (the
    distinction does not apply).
- **The level column** — the current level, in ink, no hue (a level has no
  direction). Existing precision (4 decimals for forwards).
  - **Its header is the DATA'S DATE, not the word 현재 [OWNER, pass M].** The
    column reads `2026-07-24`, from the payload's `asof`
    (`lib/format.ts::levelHeadText`). 현재 named the quantity and not the day it
    belongs to, and against a dataset that is a file those are different facts:
    these are CLOSES, and on any day the xlsx has not been rebuilt the word
    asserts a currency the numbers do not have. The date says the same thing
    when the data IS current — that is the point — and says something true when
    it is not.
    - **The date is the dataset's, NEVER the reader's clock.** A header off
      `new Date()` would print today over last Friday's closes, which is the
      silent-staleness failure §21 exists to prevent, restated on the surface a
      reader trusts most. It would also contradict the freshness chip in the
      chrome, which sits inches away and says `asof`. Pinned by
      `guards/label-quantity.test.ts`.
    - **Every level surface carries the same header**: this column, the 주요
      포워드 block (§8), and the idle curve's legend (`2026-07-24 · 어제`). One
      quantity, one label, one source.
    - **The column is sized by its HEADER now** (ten glyphs, not the six a
      value needs) — `WIDEST.levelHead` in `ui/columns.ts`. It is the one
      column whose width comes from its label rather than its format, and the
      drop thresholds all moved +31px because of it. The 52주 sub-columns
      deliberately did NOT grow: they hold level VALUES under their own labels,
      so they still derive from `WIDEST.level` (`guards/table-grid.test.ts`).
  - Elsewhere in this document the column is still called `현재` where the
    subject is its QUANTITY (a level: ink, no hue, one formatter) — §5, §9 and
    the 52주 rulings below. That is the name of what it holds, not of what its
    header says.
- **Five change columns** — change in bp vs each basis. Red for up, blue for
  down (§9). The mini-bar is gone (Session 13, §9): hue now carries the sign,
  so the bar triple-encoded. **There is no "Now" column** — Now minus Now is
  zero, which is why the old six-basis selector was wrong; all five bases are
  columns now.
- **52주 고점 · 저점 · 평균 [pass L]** — the last column, three numbers, in
  that order. The trailing 52-week high, low and mean of the row's own level
  (`range1y.max/min/avg`, `ANNUAL_OBS` = 252 observations — the LEVEL-window
  ruling below).
  - **Rendered by the 현재 formatter, verbatim** (`lib/format.ts::fmtLevel`,
    reached through `ui/cells.ts`). One quantity, one grammar: outrights and
    forwards in percent at 4dp, spreads and flies in bp at 1dp, volatility as
    a 2dp ratio, `null` → em dash. Two displays of one quantity at different
    precision has already shipped here once — the carry & roll block's
    components summed to −3.2 against a −3.1 headline purely from display
    digits. `guards/readout-parity.test.ts` now asserts the two paths produce
    byte-identical strings for every instrument kind.
  - **Three fixed sub-columns**, each the width of 현재 (the same format
    maximum), `tabular-nums`, so the numbers line up vertically down the whole
    table. Slack stays at the **trailing** edge, so the column keeps its role
    as the elastic one. Labels are required and live in the header — the order
    high/low/mean does not read as a number line — and the window is named
    once, on the first: **52주 고점 · 저점 · 평균**.
  - **These are LEVELS, so they are ink.** No hue, no tint, no emphasis
    weight; colour stays reserved for signed change values (§5, §9), which is
    why 현재 is ink too.
  - **Not sortable.** Three statistics do not rank rows, so the header carries
    no button, no hover state promising one, and clicking it changes nothing.
    That silence is a property of the COLUMN and is deliberate; it is not the
    same condition as a ROW with no sort key, which must still fail loudly to
    `Infinity` (§6). Pinned by `guards/range-column.test.ts`.

  **What this replaced, and why [pass L].** The 한 줄 column shipped a
  *classification* (`{kind, value}`) that the frontend phrased into Korean — a
  four-rung ladder: an own-history move extreme, a capped level extreme, a solo
  direction, or silence. It is **deleted**, ladder and all, including the
  `일간 변동 상위 N%` outlier signal that was its only frequent occupant. The
  column's slot now says something on every row instead of on three or six of
  them. Deleted with it: `classify_one_liner`, `apply_level_extreme`,
  `apply_solo_direction`, `MOVE_PCT_CUT` / `LEVEL_BAND` / `LEVEL_CAP` /
  `SOLO_MIN_BP`, and the `oneLiner` field on every payload row.
  **What deliberately survived, because the one-liner was only one of its
  consumers:** `movePct` and `day_move_pct` (the tint DENSITY scale — the 어제
  column's outlier rule and the forward matrix wash — plus the
  "오늘 많이 움직인 것" chip); `range1y` in full (the 고점권/저점권 chips, the
  tooltip stats, the key-forward gauge, the curve banner, and now this column);
  and the backend `kind`/legs classification (`ui/gloss.ts`, the popup
  description and the Pay/Receive mode diagram). Deleting a consumer and
  leaving its feed behind is what once left a 150-point sparkline at 92% of the
  stage-1 payload; deleting a feed that had other consumers would have been the
  same mistake pointing the other way.
- **LEVEL statistics are 52-week; CHANGE statistics are 10-year [annual-stats
  session — THE ruling of that session].** Every statistic about a level's
  RANGE (gauge, tooltip stats, 고점권/저점권 screeners, curve banner, 한 줄
  level rung, event range-transitions) uses the **trailing one year, 252
  observations** (`derive.py::ANNUAL_OBS`), labelled **52주**. Why: the
  ten-year window straddles the 2020-21 near-zero regime and today's 4%
  handle, so every tenor sat at the 99th-100th percentile of it permanently —
  the statistic had no discriminating power left ("백분위 9X" down nine
  consecutive rows). Trailing, not calendar-YTD: a January YTD range is a
  handful of days; trailing is always full and matches the reference's
  52-week convention. The **average** ships alongside high/low — high and low
  alone say how wide the range is, not where the level sits inside it.
  **Percentiles of a CHANGE (movePct, the tint scale, the move-extreme rung,
  the event 'move' reason) deliberately keep the FULL history**: daily changes
  are far more stationary than levels, the regime break does not distort
  them, and the longer window estimates the distribution better. This split
  is intentional asymmetry, not an inconsistency to fix. The history charts
  still show ten years — only the statistics narrow. (Marking the trailing
  window on the chart was considered and left out: a wash over ~10% of a 10y
  chart plus the new date labels read as clutter; revisit only if readers
  misattribute the stats' scope.)
  **Verified (annual-stats session, Pass C):** change-based firing counts are
  byte-identical before/after (move_extreme 1, movePct≥90 rows 2, matrix tint
  cells ≥70th 165 and ≥97th 1; per-row movePct equal), so the right window
  was narrowed. Discrimination: unique level-percentile values rose 22 → 27
  over 50 rows and permanent saturation is structurally gone; note honestly
  that on the verification day the curve genuinely sat at 52-week highs (the
  year's rally), so outright percentiles legitimately read 90-99 — the
  difference is they can now decay as the regime persists, which the 10y
  window could not do for a decade. One extra change-log event appeared
  (2 → 3): the range-transition reason is level-based and now uses the annual
  window — expected. **Gotcha that fired:** the forwards disk cache is keyed
  by data hash, so the range10y→range1y rename silently served the OLD shape
  until `cache.py SCHEMA_VERSION` was added to the key — bump it on any
  cached-payload shape change.
- **Curve-level extreme is a banner, not a column [Session 16 §I].** When most
  of the outright curve (≥ `CURVE_REGIME_FRAC`) sits in one extreme band, "this
  tenor is at 52-week highs" is a fact about the *curve*, not any row. It is
  stated once in a line under the tabs — "커브 전 구간이 52주 고점권입니다" — and
  the per-row level rung (rung 2) is **suppressed on outrights**. Spreads/flies
  keep the per-row rung (a spread at a 52-week extreme is genuinely
  distinctive, not restated by the banner). Backend classifies
  (`curve_banner`), the browser renders the Korean (§16).

Behaviour:

- **The global comparison-basis selector is deleted** (its state too) — the
  three bases are columns.
- **Filter chips (tabs)** above the table: 전체 / 아웃라이트 / 스프레드 /
  버터플라이 / 포워드 / 변동성. Default 전체.
  - **버터플라이 is its own tab [OWNER, 2026-07-31].** Flies used to ride on
    the spread tab, where 20 of them buried 15 spreads; with 6M and 9M in the
    tenor set that would have been 56 under 28. Two-leg and three-leg are
    different instruments read for different reasons.
  - **전체 is no longer a list** — see § The 전체 overview below.
- **Screener presets [§D, Session 15]** — a *second* row of chips beneath the
  tabs (never a left sidebar; one surface). A named view in plain language that
  **filters on top of the active tab**: 오늘 많이 움직인 것 (own-history move
  pct ≥ 90, FULL-history change distribution) / 52주 고점권 (level pct ≥ 90,
  52-week window) / 52주 저점권 (pct ≤ 10) / 되돌림 (sign
  flip between adjacent bases) / 주요 포워드. One at
  a time, clicking again clears;
  **호가만 was deleted [OWNER, 2026-07-31]** — its job, separating live-quoted
  maturities from interpolated ones, is now done permanently and in place by
  the 아웃라이트 tab's 주요/전체 divider, whose 주요 set IS the quoted node
  list. A chip that must be found and pressed to reveal a distinction the list
  can simply show was the worse of the two. The screener chips are hidden on
  전체, which has no rows to filter.
  Note 되돌림 now tests three bases rather than five, so it fires on fewer
  rows — the honest consequence of having fewer bases, not a threshold to
  compensate. a one-line 합니다체 description shows beneath
  the row when active. Data-driven (`ui/screener.ts` — a predicate per view), so
  a new named view is a definition, not a component. Default: no chip.
- **The column grid is format-derived and frozen [grid session, Pass A].**
  Column widths come from each column's widest possible RENDERING — `1s1.5s10s`
  for 종목, six tabular glyphs for a LEVEL (`−100.5` / `4.2446` / `12.00`) and
  for each change column (`−999.9`) — never from today's data, so the grid is
  byte-identical across tabs, sorts, and filters and the header never moves.
  **One exception since pass M:** the level column is sized by its HEADER, ten
  glyphs of ISO date (`WIDEST.levelHead`), because that is now the widest thing
  it renders. Still a format, still frozen, just the label's format rather than
  the value's. 52주 is the only flexible column: its three sub-columns are fixed
  at the level VALUE width (six glyphs — they did not follow the header) and all
  horizontal slack sits at the cell's trailing edge, never between the numbers. One template string (`ui/columns.ts
  GRID_TEMPLATE`) is shared by the header row and every body row (a CSS-grid
  row list, not `<table>` — §14's press-feedback note already recorded that
  transforms don't reach `table-row`, and the reorder motion needs
  transformable rows). `scrollbar-gutter: stable` keeps the usable width
  constant when the scrollbar appears. Pinned by `guards/table-grid.test.ts`.
  **Columns give way, not shrink [columns session].** Fixed widths stopped
  the header from jumping, but the full column set sums to ~680px; below that
  neither squeezing nor scrolling reads well. `ui/columns.ts::visibleColumns`
  renders the longest PREFIX of a priority ladder that fits the measured
  container — 종목 · 현재 · [the sorted column] · 어제 · YTD · MTD ·
  52주 (first to go, last to return) — pure arithmetic against the
  fixed widths and a runtime-measured `ch` (no magic breakpoints; the maths
  stays correct if a width changes). **The sorted column is never dropped**:
  a list ordered by a column the reader cannot see is unreadable, so it takes
  slot 3 and whatever it displaced falls off. Displayed columns keep the
  CANONICAL order (어제 · MTD · YTD) — the ladder decides which,
  never where. Header and body derive from the same `visible` set and share
  one `gridTemplate(visible)` string, so they cannot disagree. Dropping and
  restoring never animates (a layout change, not a state change — the FLIP's
  layoutDependency does not include it). When anything is hidden, the
  header's flexible tail states it — "N열 숨김", names on hover — a
  statement, not a control; no column picker. `overflow-x-auto` stays as the
  final backstop below even 종목+현재, unreachable in practice. Pinned by
  `guards/table-grid.test.ts` (prefix property, forced sort column,
  canonical order, fit arithmetic, shared template).
  **Drop thresholds [recomputed and re-verified live, pass L].** The 52주
  cell's content width is not the sentence's, so the old 606 figure was a
  stale constant the moment the contents changed. The floor is now
  format-derived — three sub-columns, `RANGE_SUBS × colPx().rangeSub`,
  replacing a flat `ONE_LINER_MIN_PX = 120` sized for a sentence — so it
  tracks the level grammar automatically. At the runtime ch (measured live:
  **7.7431px**) the thresholds in TABLE-content px were: **52주 698** · QTD 487
  · MTD 422 · WTD 358 · YTD 293 · 어제 229 · (종목+현재 165). Only the last
  column moved: **606 → 698**, so the full table needs ~92px MORE width than
  it did, not less — three fixed sub-columns (211px at this ch) cost more than
  the 120px sentence floor they replaced. Every narrower threshold is
  unchanged. Pinned numerically by `guards/table-grid.test.ts`.
  **Thresholds, pass M.** The level column grew from six glyphs to ten so its
  header can be the data's date, so every figure above moved **+31px** at the
  same ch and the ladder ORDER is untouched: **52주 729** · QTD 518 · MTD 453 ·
  WTD 389 · YTD 324 · 어제 260 · (종목+레벨 196). The full set still fits the
  table pane with room to spare (880 − 40 padding = 840 content), so no layout
  loses a column to this. Pinned numerically by `guards/table-grid.test.ts`.
  **Thresholds, 2026-07-31 (WTD/QTD deleted).** The per-column figures are
  unchanged — the ladder simply ends three columns in, so the full set fits
  **129px earlier**: **52주 600** · MTD 389 · YTD 324 · 어제 260 · (종목+레벨
  196). The ladder is now 어제 · YTD · MTD and the canonical display order
  어제 · MTD · YTD, so with three slots MTD lands BETWEEN the two ladder
  heads — which is the point of keeping the two orders separate. Pinned by
  `guards/table-grid.test.ts`. Not re-verified live; the arithmetic is the
  same function and only its input list got shorter.
  **The 52주 POSITION TRACK, and its threshold [pass N, 2026-08-03].** A
  fourth sub-track right of 평균: a low→high line (ink at 25% alpha, 2px)
  with a 2×12px full-ink marker where the current level sits — the marker
  position is `(now − low) / (high − low)`, clamped, from the SAME
  `rangeValues` the three numbers print, so the two surfaces cannot disagree
  (`ui/RangeCells.tsx::markerPct`, pinned by `guards/range-slider.test.ts`).
  It is one more range sub-column wide (6ch + 24px — a graphic has no format
  to derive a width from, so it borrows the numbers' track and scales with
  the font), has its OWN ladder rung, and is FIRST to drop: **위치 671** at
  the measured ch 7.7431, with 52주 at 600 and everything narrower unchanged.
  When only the track is dropped the "1열 숨김" note rides in the range
  header's filler track — the one slot that still exists in that state.
  Degenerate cases are explicit: at or outside an extreme the marker clamps
  to the track end (the current print being the new high IS the right end);
  a zero-width range or missing statistics render an empty cell, the
  graphic's em dash. **It is NOT the chips' percentile** — `range1y.pct` is a
  rank percentile and stays exactly what the 고점권/저점권 chips read; see
  `## Provisional` (pass N) for the divergence this leaves on screen.
  **Verified live (pass L)** by driving the pane width directly (the same
  measurement path, and the same forced-frame caveat as below — the occluded
  renderer delivers ResizeObserver callbacks one frame late, so every read has
  to be separated from its mutation by a forced frame): the column is present
  at 702px of content and dropped at 698px, with the header's "1열 숨김" note
  taking its slot — the computed 697.8 sits inside that pixel. Also verified
  at full width: header and body sub-grids resolve to identical 70.45px
  tracks, all three sub-labels sit exactly on their numbers' right edges (0.00
  offset), 25 sampled rows share one right edge per sub-column, and every
  glyph in the cell is the same ink as 현재 (`rgb(26,26,26)`), with the longest
  sub-label clearing its track by 13.7px. **The defect this found:** the
  header's `text-[11px]` was on the GRID CONTAINER, and `ch` resolves against
  the element's own font size — so the header's tracks came out 63.3px against
  the body's 70.4px and every label sat left of the numbers it named, by 7px,
  then 14px, then 21px. Sizing the spans instead is what makes the two grids
  agree; `guards/range-column.test.ts` now fails if a sub-grid container
  carries a text size.
  **Not sortable, verified live:** the 52주 header has zero interactive
  descendants and `cursor: auto`, and clicking the container and all three
  sub-labels left all 196 rows in identical order — while a change-column
  header is a real `<button>`.
  **Verified live (columns session, Pass C)** with a container-width sweep
  (the session's viewport is emulated, so the PANE was resized — same
  measurement path); the figures quoted below are that session's, taken with
  한 줄 in the last slot (pane ≈ content + ~58: px-5 padding 40 +
  stable scrollbar gutter
  ~17 + 1px divider). Observed pane sweep 700→640→520→460→400→330→260→150:
  columns left in exact ladder order (한 줄, QTD, MTD, WTD, YTD, 어제), the
  header note counted 1열…6열 숨김, the header never drifted, and no
  horizontal scrollbar appeared until the sub-현재 backstop at 150px.
  Sorted-by-QTD then narrowed to 460px: QTD ↓ stayed on screen (WTD/MTD
  dropped instead) with rows visibly ordered by it. Light and dark both.
  Environment note: the occluded renderer delivers ResizeObserver callbacks
  only on forced frames (same class as the motion session's rAF throttle) —
  irrelevant on a live screen; the single-column layout itself remains
  owner-eyeball (same component and measurement path).
  **Padding at the card edges [carry session, Pass D; floor revised pass L]:**
  the card keeps its ~20px inner horizontal gutter (px-5) in every layout; the
  last column has a track FLOOR (now three 현재 widths, `RANGE_SUBS`) and the
  scroll container is `overflow-x-auto`, so a viewport narrower than the
  columns scrolls horizontally instead of crushing the numbers flush against
  the card edge;
  the scroll container's bottom padding (pb-8) keeps the last row off the
  card's edge. The dark circle bottom-left in dev screenshots is the Next.js
  dev indicator, NOT the product — now disabled via `devIndicators: false`
  in next.config; never design layout around it. (The exact flush-edge
  state in the owner's narrow-layout screenshot did not reproduce in the
  session's verification environment, whose viewport is emulated wide — the
  fixes above make that state impossible by construction; an eyeball pass
  on a real narrow window remains with the owner.)
- **Sortable by any change column, both directions.** Default order is
  instrument order (not a ranking). Sorting by |change| is one click = "what
  moved today". **Only change columns sort** — 종목, 현재 and 52주 carry no
  sort control, and the 52주 column's silence is pinned by a test (pass L).
  The ordering itself lives in `ui/rows.ts::orderRows`, lifted out of the
  component so it is testable without a DOM.
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

- **Idle state is the IRS par curve, on every tab [OWNER, pass M]** — curve
  viewing is priority 1 (§1), and "the curve" is the par curve: 9 equal-spaced
  nodes 3M…10Y. No row hovered → that is what the pane shows, whichever filter
  chip is active. Blue line, two lines only (the data's date + D-1, labelled
  `2026-07-24 · 어제`) — the six-basis ramp is enlarged-view only. Hand-rolled
  SVG (§11).
  - **Superseded: one idle curve per tab [Session 13/14].** The pane used to
    switch with the filter — the 1YF ladder on forwards, the two-point-spread
    curve on spreads, the relative-ATR curve on volatility. Three faults, one
    ruling: the other three curves restate, in a shape that takes a moment to
    identify, columns the table beside them already prints as numbers; a pane
    whose SUBJECT changes under a filter chip is a second piece of state to
    track for no gain; and the IRS curve — the thing the product is for — was
    absent from three of five tabs. The tab moves the list only.
  - `VolatilityPayload.curve` is still served and no longer rendered by
    anything. Left in place rather than removed with the component (the payload
    is shared with the static build and its tests); see HANDOFF "Open".
- **Hovering a curve NODE gives the same readout the history line gives
  [OWNER, pass N].** A crosshair, a fattened dot, and a floating card:
  **만기 · 레벨 · 52주 최고 · 52주 최저 · 52주 평균 · 당일 변화**. It is the
  preview tooltip's set with the **tenor where the date is** — the question is
  the same one ("what is this number, where does it sit in its own 52 weeks, how
  far did it move"), asked of the curve instead of a series.
  - **One card, two surfaces.** `ui/ReadoutCard.tsx` is the component and
    `READOUT_LABEL` the wording; `PreviewChart` was refactored onto it in the
    same pass. Two tooltips answering one question in two grammars is the
    failure being prevented — the same reasoning as `ui/cells.ts` for the
    table's two level cells. `CURVE_READOUTS` declares the set and
    `guards/readout-parity.test.ts` pins it against `PREVIEW_READOUTS`: they may
    differ only in `date` ↔ `tenor`.
  - **Every number is read from the payload (§16)** — `deltas.d1` for the
    change, `range1y.max/min/avg` for the window, the same fields the table's
    어제 and 52주 columns print, so the curve and the table cannot disagree about
    a node. Differencing `now − prev` in the browser is forbidden and is also
    wrong at the displayed precision; the guard fails on it.
  - **§I is untouched**: that ruling makes the chart tooltip the sole readout for
    a hovered DATE. This is a readout for a hovered TENOR and adds no second
    answer for a date. A level stays ink; only 당일 변화 takes a direction hue
    (§5/§9). Levels print through `fmtLevel`; the curve's two y-axis gridline
    labels keep their coarser 2dp, which is an orientation mark and not a
    readout.
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
- **REMOVED — the tenor × date curve heatmap [carry session, Pass C].** Its
  intent (was a move parallel or led by one part of the curve?) is answered
  faster by reading the 어제 column down the outright tab, and at daily
  resolution over ten years the picture was noise. Endpoint, cached payload
  and component are gone.
- **REMOVED — carry & roll [built carry session; deleted removal session,
  Pass A].** It replaced the heatmap in the same region of the popup, was
  presented two ways, and neither worked. The popup block, `app/carry.py`,
  its endpoint and its tests are all gone. **Two faults, recorded so the
  removal is not mistaken for taste:**
  1. **The headline and the breakeven printed the same number** — `−3.1bp`
     over `3.1bp 올라야 본전`. The breakeven clause was supposed to earn its
     place by naming a DIRECTION; in practice it read as repetition. (The
     first presentation, a full sentence, had already failed for saying the
     figure twice in words — so the fault survived the rewrite that was meant
     to fix it.)
  2. **The components did not sum to the total at the displayed precision** —
     `캐리 −0.9 · 롤 −2.3` beside a headline of `−3.1`. Whatever the rounding
     rule, a reader who adds the parts and gets a different total stops
     trusting the panel, and that distrust is not confined to the panel.
  **If carry returns, it is a sortable table COLUMN, not a popup block.**
  Sorting is the point: "which of these pays me to hold it" is a SCREENING
  question, and percentile plus carry together is how the choice actually
  gets made — neither is answerable one instrument at a time in a popup. Note
  that the column ladder is already tight (§2 "Columns give way"), so a carry
  column would be **first to drop** in a narrow window, below 한 줄; it must
  earn its slot against that.
  **The freed popup space is deliberately left EMPTY.** Two features have now
  been removed from it; the next one that fills it should be there because it
  belongs, not because there is a hole.
- **Bottom strip [strip session, Pass C].** A slim bar pinned to the bottom
  of the viewport, above everything, on every tab and in both layouts. **Why:**
  five tabs and two hundred rows — deep in the forward tab a reader has no idea
  where 10Y is, and 10Y is the reference every other number is judged against.
  **Left: three anchors** — `10Y`, `3s10s`, `1Yx1Y`: a level, a slope and a
  forward, so all three curve modes are represented. Each shows its current
  value and its change, in the direction colour. Every figure comes from the
  summary payload the table already holds — **nothing was added to the
  backend**, and the strip issues no fetch of its own. The change is shown
  against **D-1 (어제)**: the global basis selector was deleted in Session 16,
  so D-1 is the product's only remaining "active basis" [recorded].
  **Right: the next policy meeting** and its countdown (`금통위 8월 27일 ·
  D-30`), from the calendar below; when the file has run out it says
  `일정 파일 갱신 필요` rather than showing nothing or a stale date.
  *(The next-event slot was removed with the calendar — removal session,
  Pass B. The anchors are, and always were, the reason the strip exists.
  **Layout without it [Pass C]:** the collapse control moved to sit WITH the
  anchors rather than at the far edge — measured on a 2,133px bar it was
  otherwise a lone 18px chevron ~1,700px from the thing it controls, which
  reads as an artefact. Everything the strip offers is now one group at the
  left and the rest of the bar is quiet chrome. The COLLAPSED handle keeps
  its centred grabber pill — the same shape the sheets use, so it reads as
  something folded away — but the whole 12px bar is now the hit target,
  because a centred 32px pill at that height is a cruel one.)*
  Clicking an anchor **pins** that instrument, exactly as clicking its row
  does (`setPinned`, no tab switch). Collapsible, remembered in
  `localStorage` (`bw-strip`); collapsed leaves a thin handle. It is chrome:
  `fixed` above the card, never scrolling with content, and **the app root
  pads by the strip's height** in either state — one border-box padding
  shortens every pane and scroll container at once, so the last row is never
  underneath it. Client-only reads (the wall clock, the collapsed flag) go
  through `useSyncExternalStore`, not an effect — the compiler lint rejects
  setState-in-effect and it would cascade a render on every mount. Pinned by
  `guards/bottom-strip.test.ts`.
- **REMOVED — meeting rules on the enlarged chart [built strip session Pass E;
  removed removal session, Pass B].** They went with the calendar's other UI
  consumers (below). The density threshold and the average-gap test existed
  only to serve them and went too, as did the transparent-canvas + DOM-underlay
  arrangement that let them paint behind the series — the chart's background is
  an opaque tile colour again.
- **Verified [strip session, Pass F].** Strip present on all five tabs
  (전체/아웃라이트/스프레드/포워드/변동성) and in the narrow single-column
  layout, light and dark. The scroll container's bottom edge lands exactly on
  the strip's top in both states (978px open / 1000px collapsed) and the last
  of 196 rows clears it (947 < 978); collapsed leaves the handle and the flag
  persists (`bw-strip`). Clicking the 3s10s anchor pinned it — the pane's
  corner label then read `3s10s · 스티프닝`, which also confirms Pass A's
  survivor. Countdown correct: on 2026-07-28 the strip read `FOMC 7월 29일 ·
  D-1`; D-0 and the weekend crossing are unit-pinned. Truncating the calendar
  fired the staleness guard with an actionable message ("runs out in 1 days
  … Top it up"), and truncating it entirely into the past made the strip say
  `일정 파일 갱신 필요` rather than showing nothing — file restored after.
  Meeting rules: 0 at the 10y view, 25 at ~1.6y. Pay/Receive flips the carry
  block: `−4.6bp · 4.6bp 올라야 본전` ↔ `+4.6bp · 4.6bp 올라도 본전` — the
  same physical move, the modality flipping with who you are. Nothing
  animates in the pane on pin. *(Dated record: the carry block and the
  calendar's UI consumers named here were both removed in the removal
  session — see the REMOVED entries above.)*
- **DISCONNECTED FROM THE UI [removal session, Pass B] — but built, verified
  and KEPT.** The economic calendar is its own concern, not part of this
  monitor, so it was unwired here rather than tuned further. **The module,
  its data and its tests stay** (`ui/calendar.ts`, `data/calendar.json`,
  `guards/calendar.test.ts`): the verified 2026 dates, their sources, the
  `verified` filtering and the LPR generation rule were the hard part and
  none of it is wrong — it simply has no consumer in this product for now.
  **A later session reading only the code would see an unused module and
  delete it. Do not.**
  What was removed: the strip's next-event slot and countdown, the chart's
  meeting rules, and the `일정 파일 갱신 필요` state (nothing displays the
  calendar, so there is nothing for it to warn about).
  **Re-wiring means restoring all three together** — the strip slot, the
  chart rules, and the staleness guard. The guard is PARKED, not disabled: it
  skips while `ui/calendar.ts` has no importer, the skip is computed from a
  source scan rather than hard-coded, and the skip message says so, so adding
  any consumer brings the gate back by itself. It must never be switched off
  by hand. (Verified: a throwaway importer flipped it from skipped to live.)
- **Verified [removal session, Pass D].** Backend restarted on the new code:
  `/api/carry/{id}` returns 404 and is absent from the OpenAPI paths, which
  now read health / wall.summary / series / forwards / dv01 / volatility;
  wall.summary and dv01 still 200. No reference to `CarryPanel`,
  `carryReadout`, `fetchCarry`, `carry_payload` or `/api/carry` survives
  anywhere in `backend/app`, `backend/tests`, `frontend/src` or
  `frontend/guards`. The popup shows no 캐리 text, and its DV01 block and mode
  diagram are intact. The strip shows its three anchors and no event on all
  five tabs and in the narrow single-column layout. The enlarged chart draws
  0 meeting rules at every zoom tried (10y, ~2y, ~6m, ~1m). Sorting still
  reorders (어제 ↓), and pinning still works from a strip anchor — the pane's
  corner label read `3s10s · 스티프닝`. Calendar module: 25 of its own tests
  pass and the horizon gate skips with its reason printed. Both themes.
- **Policy-meeting calendar [strip session Pass D; REBUILT ON VERIFIED DATA,
  calendar session].** A hand-maintained JSON file in the repo
  (`frontend/src/data/calendar.json`) — no feed, no API. **Every entry was
  read off the publishing central bank and carries the source it came from**;
  for two-day meetings the date is the DECISION day (the second day).
  Four banks, eight 2026 meetings each: **금통위** (한국은행 통화정책방향
  결정회의 — note the BOK holds 24 regular meetings a year and only these
  eight set the policy rate; the 금융안정회의 in March/June/September/December
  are not rate decisions and are excluded), **FOMC**, **BOJ** (no fixed
  announcement time, so the date is stored and no time is displayed), and
  **ECB** (no January meeting in 2026).
  **2026 only, and the gap before it is deliberate.** The previous file's
  2016-2025 history was reconstructed from memory; ~23 of 182 entries landed
  on the wrong weekday and there was no way to tell which from inside the
  file, so all of it was DELETED rather than repaired. Chart rules drawn on
  wrong dates are worse than no rules — a reader would attribute a curve move
  to a meeting that never happened — so **nothing renders before
  `CALENDAR_FROM` = 2026-01-01**, including the generated LPR (generating it
  backwards would re-introduce invented history through the side door, and
  would draw rules across a decade that has no meeting rules).
  **`verified` is LOAD-BEARING, not documentation [Pass C].** An entry with
  `verified: false` renders NOWHERE — not in the strip, not in the countdown,
  not as a chart rule — and does not count toward the staleness horizon, so
  staging an unverified 2027 cannot silence the guard. `MEETINGS` is the
  filtered list and the only export a render path may read; the raw file is
  not exported. That is stronger than an "unverified" badge: bad data cannot
  appear at all. The file may still be used as a staging area.
  **Staleness** stays a hard gate: `guards/calendar.test.ts` fails when the
  last verified LISTED entry is under **60 days** out. With the data ending
  2026-12-18 it fires on **2026-10-19** — correct behaviour, not a defect.
  The failure message and the README §"Policy calendar" both name the four
  sources (bok.or.kr / federalreserve.gov / boj.or.jp / ecb.europa.eu), say
  **read the dates off the source and never fill a gap from memory** (that is
  what produced the file this one replaced), and note that the FOMC usually
  publishes ~2 years ahead while the others publish ~1, so the next year
  arrives piecemeal and a partial year is fine.
  **D-0 [recorded choice]:** the countdown shows `D-0` on the meeting day
  itself and the event stays on screen through that day. Dates compare as ISO
  strings in the LOCAL calendar (`todayISO`), so a countdown never shifts with
  the browser's side of UTC midnight; `daysBetween` parses at UTC noon so DST
  cannot round it wrong.
- **PBOC LPR — generated, not listed [calendar session, Pass D].** The PBOC
  holds no scheduled meeting: the LPR is announced at 09:30 CST on the 20th of
  each month, so it is COMPUTED. Rule: start at the 20th and advance one day
  at a time until the date is a business day — Saturday/Sunday roll to Monday,
  and a holiday on that Monday rolls to Tuesday, chaining as far as needed.
  The holiday list is scoped to PRC public holidays that can fall between the
  20th and the 25th — in practice 춘절, 단오, 중추절 (원단, 청명, 노동절 and
  국경절 cannot reach the 20th). **`PRC_HOLIDAYS` ships EMPTY**: no verified
  PRC holiday dates were available, so **weekend rolling works and holiday
  rolling does not yet** — an LPR rule can sit a few days early in a month
  whose roll lands on a holiday (2026-02 is the one to check first, 춘절 falls
  near the 20th). **LPR draws chart rules only and never counts down**: it is
  MLF-dependent and rarely surprises, so a countdown to it would train the
  reader to ignore the strip, and a one-day error in a rule is harmless where
  a wrong countdown is not.
- **Countdown scope [calendar session, Pass E].** The strip counts down to
  **금통위, FOMC and BOJ only** (`COUNTDOWN_KINDS`) — what moves the KRW
  curve, in that order. ECB and LPR render as chart rules but are never the
  next event.
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
  shape (full-weight ink). **Every kind carries a positional band** (band
  session — forwards had one first; leaving the rest bandless made `1s2s` and
  `5s10s` render identically): outright = its tenor, narrow; spread = leg to
  leg; butterfly = wing to wing; forward = its period, all on a 10y schematic
  x-domain. The deformation is **confined to the band** — outside it the wanted
  curve coincides with the current one, so the eye goes straight to the region
  the trade is about. For Pay (Receive = exact negation): **level** lifts the
  banded stretch (smoothstep plateau, tapering to the band ends); **slope**
  tilts inside the band, meeting the current curve at each end (near-half down,
  far-half up); **curvature** arches, band ends holding. Band rules: it is a
  **region, not a measurement** — no labels, no boundary marks, no tenors ever;
  it is **neutral** (faint ink wash, ~5% alpha — never a direction colour, which
  is reserved for the fill); and it never shrinks below **30% of the plot**
  (`MIN_BAND`) so a narrow-span instrument like `1s1.5s` still shows a legible
  deformation instead of a sliver — the band is impressionistic, exact
  proportionality would make short-span trades invisible.
  The deformation is **exaggerated** (~25% of plot height,
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
  (band session, Pass C): pairs that previously rendered identically are now
  distinguishable at a glance — `1s2s` tilts in a front-end band while `5s10s`
  tilts in the long half; `1s2s3s` arches in a narrow front band while
  `2s5s10s` arches belly-to-long; an outright reads as a flat-topped lift in a
  narrow band, distinct from a butterfly's arch. The 5%-ink band wash is
  visible on both surfaces; the ~25% exaggeration and 16% fill carried over
  unchanged; no tuning needed.
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

## 14. Motion [Session 12, list-first; inventory + reorder/morph/gesture — motion session]

Motion is a channel meaning "state change" (§5), chrome only — never animate
chart path geometry. (The Pass-E curve gesture, which animated a GHOST copy,
was REMOVED by the strip session — see below. The rule stands with nothing
left to except.)

### Inventory [motion session, Pass B — what exists in the CURRENT structure]

Most of Session 12's motion assumed the home → band → detail structure; the
list-first restructure removed those transitions, and the signature moment (a
band card expanding into its view) went with them. This list is what later
sessions work from — do not reinstate motion designed for the retired layout.

**Present:**
1. **Tab underline** — single sliding indicator (`layoutId`), SPRING.
2. **Enlarged sheet** — backdrop fade (200ms) + sheet slide-up (SHEET_SPRING)
   + drag-to-dismiss; the single-column preview sheet mirrors it.
3. **Preview chart entrance** — fade + scale-from-0.98 pop-in, keyed by
   series, after the ~120ms hover delay.
4. **Press-scale (0.98)** — on the preview chart block only. NOT on table
   rows: the old `<table>` couldn't transform rows; §14's press rule kept it
   to isolated targets. (The Pass-A grid conversion makes rows transformable
   again; row press-scale stays out until a session decides it.)
5. **Changed-number cross-fade** (AnimatedNumber, ~180ms).
6. `prefers-reduced-motion` → MotionConfig collapses everything to instant.

**Recorded in §14 but NOT in the current build (stale spec):** the heatmap
hover pulse (the calendar heatmap has no pulse) and "rows scale to 0.98"
(they never did in the list-first table).

**Missing — structural losses this session addresses:**
- Row reorder on sort / screener filter teleports → **Pass C** (functional:
  position continuity is what keeps "which row is which" across a re-sort).
- Pay/Receive toggle hard-cuts between two static drawings → **Pass D** morph.
- Preview pane hard-swaps series on hover → **Pass D** cross-fade.
- Pin has no curve-side acknowledgment → **Pass E** ghost gesture, since
  REMOVED (strip session, Pass A — see the entry below). Pinning is
  acknowledged by the row's pin rule, the preview swap, and the pane's corner
  label; it needs no motion.

### Row reorder [motion session, Pass C]

Sorting and screener-filtering slide rows to their new positions (transform-
only FLIP, `layout="position"`, the standard SPRING — may overshoot slightly).
Rows leaving the set fade out in place (`popLayout` pops them from the flow so
survivors slide simultaneously); entrants fade in at their destination.
Rules, pinned by `guards/reorder.test.ts`:
- **Cause-gated**: only sort and screener toggles animate — same view, new
  arrangement. A tab or start-filter switch is a view change and snaps.
- **Viewport-culled**: a row animates only if its old or new position is
  within one viewport-height of the visible window; everything else jumps.
- **Threshold = 400 rows** (`FLIP_MAX_ROWS`): above it the reorder is instant.
  With culling, the 168-row forward tab and ~200-row 전체 stay animated —
  only ~15–30 rows actually move on screen; the threshold bounds the
  per-row DOM-read bookkeeping, not the paint cost.
- `prefers-reduced-motion` reorders instantly (MotionConfig).

### Pay/Receive morph + preview cross-fade [motion session, Pass D]

- The 페이/리시브 toggle **morphs** the diagram instead of cutting: the
  deformation is linear in the sign, so one factor q ∈ [−1, +1] (animated
  with the standard SPRING) carries the ghost curve through the base curve to
  its mirrored position, the fill recomputing and flipping colour as q
  crosses 0 — one transformation, not two drawings. The solid current curve
  never moves. An instrument change (different mode/band) snaps — morphing
  between two different trades would be a lie. (The old spec's "arrows rotate
  through" predates the mode picture: the current diagram has no arrows; the
  ghost + fill carry the whole morph.) Reduced motion snaps.
- The **preview pane cross-fades** on a series switch (~150ms, popLayout so
  the outgoing pane leaves the flow immediately) — moving between rows is the
  most frequent action in the product and it hard-swapped before.

### REMOVED — the curve gesture [motion session Pass E; deleted, strip session Pass A]

The right pane's ghost-curve animation on pin is **gone**: component,
trigger, and `ui/gesture.ts`. **Why, so it does not come back:** at a 10px
peak against a curve spanning ~136bp the deformation was too small to read as
an intent and large enough to draw the eye — illegible and distracting at
once. The popup's mode diagram already makes the same statement on a
SCHEMATIC curve, where the exaggeration can be large enough to work, so the
gesture was the worse of two attempts at one job. The premise that motion is
perceptible below the static-shape threshold was right in the abstract and
wrong here: perceptible is not the same as legible.

What survives: **the pane's corner label** — the pinned instrument and its
mode (`3Mx2Y · 스티프닝`), sticky at the pane's bottom-left, no motion. It
costs nothing visually and says what is selected. It follows §G (opaque bg,
muted by a text alpha, never element opacity — the sticky-opaque guard caught
that on the first attempt).

The diagram's geometry (`diagramSpec` / `toBand` / `modeShape`) STAYS — the
popup still renders it; only the curve-view rendering is gone. Pinned by
`guards/pane-still.test.ts` (no motion import in CurveView, no gesture module,
plain `onPin={setPinned}`, corner label present).

### Verified [motion session, Pass F]

- **Grid**: header pixel-stable across tab switch, sort, screener toggle, and
  during reorders/gestures (screenshot-compared).
- **Reorder cost**: sort/screener commit measured 0.6–1.4ms main-thread on
  the 147-row forward view and 203-row 전체 — the slide itself is
  compositor-side transforms on ≤~30 culled rows. Caveat: the verification
  environment's display was occluded (Chrome throttles rAF to zero), so
  on-screen frame-rate could not be sampled; the mechanism (transform-only +
  cull + tiny commits) leaves no jank path, but an eyeball pass on a live
  screen remains for the owner.
- **Gesture**: pinned a spread (`1s10s`), a fly (`1s2s3s`), a forward
  (`1Yx2Y`) in dark — dashed-ink ghost springs out, holds, fades; the data
  line never moves; the pane settles into the pinned preview. Reads as a
  demonstration (dashed + `label · term` caption), not a live tick.
- **Morph**: spread mid-frame caught passing THROUGH the base curve (one
  transformation); outright and fly settle to exact mirrors with labels and
  fill colour flipped (light theme); forward shares the spread path.
- **Reduced motion**: MotionConfig `reducedMotion="user"` +
  `guards/reduced-motion.test.ts` (instant()). (The static-ghost path this
  line also cited went out with the gesture — strip session, Pass A.)
  OS-level emulation was not run (needs an OS toggle or a Chrome relaunch
  flag, neither available mid-session).
- **Themes**: passes A–E exercised in dark; grid + morphs re-checked in
  light.

### Rules (carried forward)

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
frontend.** A *classification* may travel the wire; a finished Korean string
may not. Copy is presentation: if changing wording required a backend deploy,
the wording would never improve. So the backend decides *what is true*; the
frontend decides *how to say it*.

**Its subjects, named [re-examined pass L].** The `한 줄` column was this
exception's most visible subject and is gone, so the exception was re-checked
rather than left standing over nothing. Two subjects remain, and they are the
whole list:

1. **The instrument gloss** (`ui/gloss.ts`) — the backend ships `kind` and the
   legs (already present as `kind`/`id`); the frontend renders the subtitle and
   the two-or-three-sentence description in the popup, and the same
   classification drives the Pay/Receive **mode** diagram
   (`ui/payReceiveModel.ts`).
2. **The curve banner** (`CurveBanner`) — the backend ships
   `{ kind: "curve_high" | "curve_low" | null }`; the frontend writes
   "커브 전 구간이 52주 고점권입니다".

Neither is a table column, and neither is a row view-model field, so the
`ROW_FIELD_SOURCE` guard is untouched by both. If both ever go, the exception
goes with them — do not leave it standing over an empty set.

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

## 17. Failure states [stability session, Pass B]

The diagnosis in `docs/diagnostics/failure-modes.md` found one appearance for
every backend failure: backend stopped, a 500, and a 200 carrying a truncated
body all rendered `불러오는 중입니다`, permanently — still "loading" at 81
seconds. A reader could not tell a slow morning from a dead service, and had
nothing to do about either. Four rules follow.

**A failure looks different from a wait.** `LoadingState` and `ErrorState`
(`ui/DataState.tsx`) are separate components with different shapes. The error
names what failed in the reader's terms (`커브를 불러오지 못했어요`), offers
the likeliest cause, and carries `role="alert"`.

**A failure is retryable in place.** The error state holds a **button**, not a
toast — nothing dismisses itself, and recovery never requires knowing to
reload. It calls the failing query's own `refetch`, so it does not wait on the
fetch layer's retry budget (which, in the diagnosis, never expired). Both the
first fetch and stage-2 detail have one; the button disables and says
`다시 시도하는 중` while a retry is in flight.

**Regions fail independently.** Four boundaries — `table`, `pane`, `popup`,
`strip` — each wrap one region. Before this, a single throw anywhere under the
root unmounted the whole tree: one bad row took the header, the preview and the
strip with it. The strip's boundary is `compact`: it stands in as a 34px bar in
the strip's own place, because a centred block inside fixed chrome would push
the layout it is pinned under.

**A URL that names nothing says so.** An unknown `?tile=` is replaced with
`?missing=<id>` and a line naming the id, rather than leaving a bogus parameter
rendering an ordinary screen with no sheet. The notice is *derived from the
URL*, never held in state — `setState` inside the clearing effect is what the
compiler lint rejects, and the URL is the honest home for it. Clearing waits
for rows to load, or a cold shared link would clear itself before it could
resolve.

**API base.** `NEXT_PUBLIC_API_BASE`, defaulting to `http://localhost:8100`
(`lib/api.ts`); template in `frontend/.env.example`. `NEXT_PUBLIC_` is inlined
at **build** time — pointing at another host needs a rebuild, not a restart.

**Enforced by** `guards/failure-visible.test.ts`.

## 18. The data file must earn trust [stability session, Pass C]

`data/irsdata.xlsx` is hand-updated, so it is where breakage will actually
come from. Pass A mutated a synthetic copy one cell at a time; four mutations
loaded **without a word** and produced confidently wrong numbers. The loader
now refuses them.

**Unusable — `DataFileError`, and the server does not start.** A duplicated
date, a swapped pair, any non-ascending step, a value outside
`−5%..25%`, text where a number belongs, a wholly blank series, a missing
`일자` header, two columns claiming one tenor, no data rows.

The first three matter more than they look. Every date lookup in the product
is `derive.value_at`, a bisect over an assumed-ascending, assumed-unique list:
a duplicate or a swap does not crash it, it silently returns the **wrong row**,
so D-1/WTD/MTD/QTD/YTD are all wrong while the levels look perfect. The
orientation check reads `dates[0] < dates[-1]` alone, so a mid-file swap used
to sail straight past it — the check is now every step.

The band is a **magnitude** check, not a view: wide enough that no rate this
market has printed would fire it, narrow enough to catch a decimal slip
(`4135` for `4.135`) or a sign error. Its limit is on the record as a test —
a rate written as a fraction (`0.0413`) sits inside the band and is not caught.

**Every message names the CELL** — `C6`, not "row 6, third series". The person
fixing this is looking at a spreadsheet, and a cell reference goes into the
name box.

**Stale ≠ unusable.** A gap over 10 days, a last observation over 10 days old,
or a blank cell: the file loads, and the reason lands in `Dataset.warnings`
and the startup log. Refusing to start on an old file would take the product
down for something the reader can ride out.

**Cache.** Any unreadable `.cache/*.json` — truncated, empty, valid JSON that
is not an object, binary — recomputes with a warning; that was already true
and is now pinned by test, because the risk is someone tightening the `except`
later. Writes go through a temp file and `os.replace`, so a killed process
leaves the old file or the new one, never a torn one.

**Concurrency.** `forward_history` and `_historical_curves` fill their caches
under a lock. Two readers asking for the same uncached series used to compute
it twice (~3.7s of duplicated bootstraps, growing with the number of readers);
endpoints run in FastAPI's threadpool, so this was real. The forward lock is
**per series**, so different forwards still build in parallel, and id
validation happens outside it so a typo fails immediately.

**Enforced by** `tests/test_dataset_validation.py`, `tests/test_cache.py`,
`tests/test_forward_history.py`.

## 19. Guard hygiene [stability session, Pass D]

Most guards work by scanning source text for a token that must be present or
absent. The absent case has a recurring failure with four occurrences on
record — pane-still, carry-copy, calendar, bottom-strip:

1. a guard bans a token
2. the thing is removed, and a comment explains why
3. the comment contains the token
4. the guard fails on the explanation of its own success

Each was fixed in place with a hand-rolled regex pair, so the next guard
started the cycle over. **`guards/_source.ts` is now the only reader.**

| | strips | use for |
|---|---|---|
| `code(path)` | comments | a banned **value** — a raw hex, a class name, a Korean phrase. A string occurrence *is* the violation. |
| `identifiers(path)` | comments **and** string contents | a banned **identifier** — an import, a hook, a component. A mention inside a label is not a use. |
| `css(path)` | block comments | token files |
| `walk(dir)` | either | whole-tree scans |

It is a scanner, not a regex pair, because both cheap approaches are wrong:
`//` inside a URL is not a comment, and a whole-line-only regex leaves every
**trailing** comment intact — which is how the old version let tokens through.
Removed text becomes spaces and newlines, so reported line numbers still match
the real file.

**Enforced by** `guards/guard-hygiene.test.ts`, which checks the stripper
against each trap (trailing comment, URL, quote inside a comment, escaped
quote, template literal), checks it does **not** over-strip (real files keep
their declarations and their line count — an over-eager stripper fails
silently, forever), and fails any guard that reads a file without importing
the shared stripper.

## 20. Payload and bundle discipline [stability session, Pass E]

Measured before changed. The full baseline, method and all, is
`docs/diagnostics/perf-baseline.md`; three rules come out of it.

**Stage 1 carries no series.** A summary row is one screen of numbers about an
instrument — levels, deltas, a percentile, a classification. It carries no
history, ever. The rule exists because it was broken invisibly: a 150-point
`spark` line rode on all 50 rows, **92.3% of a 235 KB payload**, read by no
component, left behind when the band-card layout that drew sparklines was
retired. A line comes from `/api/series` at stage 2. Enforced by
`test_wire_format.py` (a size ceiling plus a per-field shape check over the
whole table, so the next such field fails even under a different name).

**Responses are compressed.** Every endpoint answered with no
`Content-Encoding`; these payloads are long lists of short numeric records and
compress ~6×. `GZipMiddleware(minimum_size=1024)` — negotiated, never assumed,
so a caller that sends `Accept-Encoding: identity` still gets plain JSON.
Compression is middleware, so it is tested through the ASGI stack; a
handler-level test cannot see it, which is how its absence survived.

**"Used only in the popup" is not "loaded only with the popup."** §11 confines
lightweight-charts to the enlarged view and was obeyed — and all 196 KB of it
still landed in the initial chunk, because `EnlargedView` imported it plainly
and `App` imports `EnlargedView` at module scope. Confinement is about *where a
thing renders*; cost is about *which import edges are static*. It is now behind
`next/dynamic` with the shared `LoadingState`, fetched on first popup (56 KB,
10 ms). `guards/lazy-chart.test.ts` pins the import edge. Any future dependency
that is large and reachable from one surface gets the same treatment — and a
type-only import is fine, it is erased.

**And the discipline that produced all three: measure first.** Tab render times
(~120 ms for the 143-row forward table), peak heap (17.8 MB, no growth, charts
disposed), and the four parallel stage-1 requests were all checked and all came
back healthy; they were left alone, and that is recorded so a later session does
not "optimise" them on a hunch. The warm load did not get faster and was never
going to — it is backend latency plus committing 197 rows, not bytes.

## 21. The data ships as static JSON [static conversion]

The deployed product has **no backend**. A local FastAPI process behind an
HTTPS page is blocked by the browser twice over — mixed content, and Private
Network Access — so every response is precomputed into
`frontend/public/api/**` by `backend/scripts/build_static.py`, and that tree is
committed. Vercel runs `next build` and nothing else. The pipeline needs
QuantLib, and installing a heavy native dependency in a build image is risk
with no payoff, so it runs where it already works: locally, on the same manual
rhythm as today — re-export the xlsx, run the script, commit, push.

**This was only possible because the payload was already time-free**, and that
is the finding to preserve. `basis_dates` computes the WTD/MTD/QTD/YTD
boundaries from `dataset.asof`; `ANNUAL_OBS` slices the last 252 *observations*,
not 252 days from now; `day_move_pct` uses the whole history; forward start
dates are ModFol-adjusted off `asof`. Nothing market-facing reads the clock, so
freezing it at build time cannot make the page answer yesterday's question.
**Keep it that way**: a `date.today()` anywhere in a payload path would
reintroduce exactly the silent staleness this product was built to avoid. See
`docs/diagnostics/static-feasibility.md`.

**Freshness is the one exception, and it moved to the client.** "How old is
this data" *is* a question about now. `api/manifest.json` carries `asof` plus
the next 400 KR business days after it, generated by the frozen engine's own
`_is_kr_business_day`; `lib/freshness.ts` counts how many have passed. The
calendar therefore is not duplicated in TypeScript — only the answer is
shipped.

**Holiday coverage behind the ladder [Pass J] — diagnosed, and the premise did
not hold.** The concern was that past the last year the engine's holiday table
covers, `_is_kr_business_day` degrades to a weekend-only test and the ladder
fills with plausible wrong dates, invisibly, at the tail. Measured instead:

- The table is constructed for **2016–2035** (375 entries), ending 2035-12-31.
- The **400th business day from `asof` lands 2028-03-08** — inside that range
  by **2,854 days**, with **0** ladder entries past coverage. 2,316 business
  days remain inside coverage from today.
- And there is no cliff to run off anyway: `holidays.KR` **populates further
  years on demand**. Probed at 2050 it returned 22 correct entries including
  lunar 설날 (2050-01-23) and 추석 (2050-09-30) and the 대체 휴일 substitutes —
  computed, not extrapolated.

So there was nothing to truncate, and truncating at 2035 would have been a
change with no effect today and a wrong one later. What was added is the
verification that the reasoning above stays true, since both facts are
properties of a dependency rather than of this code: `_business_days_after`
now **asserts every emitted date falls in a populated calendar year** and
raises `HolidayCoverageError` otherwise, and a test shrinks the apparent
coverage to prove the assertion bites. The manifest publishes
`holidayCoverage` (`constructedThrough`, `ladderThrough`, `ladderDays`) so the
horizon is auditable from the artifact. A separate test fails when fewer than
**60 business days** of ladder remain ahead of today — the same shape as the
calendar horizon guard, firing as a prompt to rebuild rather than as a break.

**The gate runs in two modes [Pass K].** `scripts/gate.ps1` runs everything
with the backend **stopped** (mode 1 — the static paths, as deployed) and then
starts uvicorn to run the static-vs-live agreement suite (mode 2), printing
pass/skip/fail per mode and exiting non-zero if either fails. It exists because
a suite that skips by default never goes red: mode 1 reports 19 skips, and mode
2 turns 18 of them into results. The structural argument still does the real
work — `payloads.py` is the single source of every body — but "runnable and
recorded" beats "quietly absent". It refuses to start if anything holds :8100,
since mode 1 must not have a backend available; nothing is piped, because a
pipe hides the exit code; and `pnpm lint`/`pnpm build` write to stderr on
success, so stderr is never read as failure.

**Anchored to `Asia/Seoul`, at the reader's instant [Pass I].** The reader's
*instant* is the right input; the reader's *local date* is not. The data is
KRW IRS closes and the ladder counts KR business days, so "which day is it" is
a question about Seoul. Reading the reader's own calendar date meant a reader
in London at 22:00, or New York at 21:00, derived tomorrow's date and counted a
business day early — every working evening, and only for readers outside KST,
which is exactly the kind of defect that never reproduces where it is reported.
`marketIsoDate()` uses `Intl.DateTimeFormat` with `timeZone: "Asia/Seoul"`; no
library, and **no hardcoded +9**, because KST having no DST is a fact about the
world and belongs in the platform's timezone database, not in a source file
nobody would think to revisit. The formatter is constructed once — it is built
per render otherwise, and this runs in the header.

Tested at instants, never at wall-clock constructions, so the runner's own
timezone cannot colour the result, and asserting the **verdict** (`age`,
`level`) rather than a formatted string: `23:30Z` on the 29th is the 30th in
Seoul; `14:00Z` on Friday is still Friday evening there; and an instant that is
Saturday in New York is Sunday in Seoul and rolls no further, since the weekend
adds no business day.

**One source of every body.** `backend/app/payloads.py` builds all of them, and
both the FastAPI handlers and the pipeline call it. The live app stays the
reference implementation for local development; `tests/test_static_agreement.py`
compares the two for a sample of paths but **skips without a backend**, so the
structural guarantee, not the test, is what prevents drift.

**Filenames, and the hazard behind them.** A static host cannot select a file
with `?res=`, so the resolution rides in the name:
`api/series/<id>.<full|preview|w|m>.json`, plus `api/dv01/<id>.json` and the
three fixed payloads. Ids map to paths through one rule — **`:` becomes `/`**,
so `vol:1Y` → `series/vol/1Y` — stated once in `app/static_paths.py` and
mirrored in `lib/staticPaths.ts`. It is not cosmetic: on NTFS a colon is the
alternate-data-stream separator, and writing `vol:1Y.json` silently produces a
zero-byte file named `vol` with the content hidden in a stream. Pass A lost 24
files that way with a clean exit code. `static_paths.slug()` therefore **raises**
on any id it cannot round-trip, and `guards/static-paths.test.ts` checks every
id the app can build against a directory listing **compared as strings** —
`existsSync` is case-insensitive on NTFS and would pass while production 404s.

**The build vouches for what it wrote [Pass G].** Writing is not evidence of
having written. After emitting, the pipeline verifies every artifact the
manifest declares: it **exists**, is **non-empty**, and **parses as JSON** —
three checks because the failure this guards leaves a real file with the right
name and zero bytes, so existence alone passes on it. Then the tree is
reconciled against the declaration **in both directions**: a missing file and
an orphan are equally defects, the orphan being the rename failure (an id
changes, the new artifact is written, the old one survives, and the client goes
on resolving a series that no longer exists). `manifest.json` carries
`artifacts` and `artifactCount`; it is not in its own list, and `verify_tree`
accounts for that rather than fudging the count.

Separately, `assert_writable_path()` runs on the **finished path** immediately
before every write — including the fixed paths, which never pass through
`slug()` and would otherwise be the one unchecked route to the writer. It
rejects `: ? * | < > "`, backslashes, control characters, any segment ending in
a space or a dot (Windows strips those on create, so the file written is not
the file requested), and the reserved device names (`CON`, `NUL`, `COM1`…),
which are not files on NTFS in any directory. **It never sanitises**: a silent
rename would desynchronise the file from the id in the manifest, and the build
would succeed while the client 404s on exactly one instrument. See
`## Provisional` for why `vol:1Y` maps rather than raises.

**Request paths are reconciled against artifact paths, both ways [Pass H].**
Three independent descriptions of one set must agree exactly: what the client
can **request** (the real URL builders in `lib/` run over the real row model),
what is **on disk**, and what the build **declared**. Compared as strings,
byte-for-byte including case — `existsSync` answers case-insensitively on NTFS
and would pass while production 404s, so it is never used. Live: 984 / 984 /
984, all six differences empty.

That is the static half. The **empirical** half serves the export behind a
logging proxy and walks the built site — five tabs, sorting on every change
column, all six screener chips, pinning across every group, the popup with all
three chart modes plus DV01 and Pay/Receive, matrix mode, cold `?tile=` links,
both themes. Result: **23 distinct API paths requested, 0 that would 404, 0
non-2xx, 0 outside the declared set**, and status codes `{200, 304}` — the 304s
being independent confirmation that the Pass F revalidation policy works
through a real browser. The 961 unrequested files are the untouched rows; the
walk samples, it does not enumerate.

The empirical half earned its place by finding two things the static half
could not:

- **`.env.local` leaked into the production build.** Next loads it for
  `next build`, not just `next dev`, so `pnpm build` compiled
  `http://localhost:8100` into the bundle and every gate went green on it —
  the artifact the gates certified was **not** the artifact that would deploy.
  Deployed it would have sent every request to the reader's own machine and
  failed as mixed content, the exact failure the static conversion removed. The
  fix is structural: the override lives in `.env.development.local`, which
  `next build` cannot see, and `guards/production-env.test.ts` checks both the
  config and the emitted chunks.
- **A cold shared link to a forward or volatility series cleared itself.** The
  unknown-`?tile=` guard waited on `rows.length === 0`, but the summary lands
  first and contributes only outrights and spreads, so during the window before
  the other two payloads arrive `rows` is non-empty while every forward and vol
  id in it is still unknown. `?tile=series:vol:10Y` opened cold landed on
  `?missing=` every time. It now waits for the row set to be **complete** —
  every contributing payload settled, not merely the first rows present.

**One observation per line** in `points`, `bars` and `calendar`. A storage
decision, not formatting: a daily refresh appends a line to each of ~196
histories and git deltas the commit down to a few KB, where single-line blobs
would rewrite ~31 MB per refresh (~7.5 GB a year). Everything else stays
compact — summary rows are rewritten wholly each day anyway.

**Deterministic output**: keys sorted, no timestamps inside payloads, floats
left at the rounding the API already applies. A rebuild on unchanged data is
byte-identical or every commit shows the whole tree as modified and diffs stop
meaning anything. `api/manifest.json` is the single exception (it carries
`builtAt`) and the determinism test compares it with that field removed.

**Cache policy: `no-cache` on everything [revised, Pass F].** Both the manifest
and every artifact revalidate on use. No `immutable`, no
`stale-while-revalidate`, no positive `max-age`, no content-hashed filenames.

The failure is **tearing**. These URLs are stable while their contents change
on every refresh, so any positive age admits a window in which the reader holds
a *fresh manifest* and a *stale series* — the header prints today's as-of date
over last week's line, and nothing errors. `stale-while-revalidate` has the
same defect and serves the stale copy on first paint, the one paint that
matters. Content-hashed names would remove the tearing but add a full artifact
set (~31 MB) to the repo per refresh and open a 404 race for a reader still
holding the previous manifest.

`no-cache` does not mean "do not store"; it means "revalidate before use".
Measured: a conditional GET returns **304 with a 0-byte body**, so correctness
costs one conditional request per artifact, not a re-download.

**Two things the earlier policy got wrong**, both found by measuring rather
than reading:

- It lived in `vercel.json`, which **`next start` ignores entirely**. Local
  served `public, max-age=0` (Next's default for `public/`) while the deployed
  config said `s-maxage=31536000`. The two could not be compared, which is how
  the mismatch survived a whole pass. The policy now lives in
  `next.config.ts::headers()`, which Next applies to `public/` **both** under
  `next start` and on Vercel; `vercel.json` carries no headers at all.
- The artifact rule's `s-maxage=31536000` was the tearing window in numbers:
  **31,536,000 s (365 days)** during which a shared cache could serve an old
  artifact beside a revalidated manifest. Nominally bounded by Vercel's
  per-deployment invalidation, but that is a property of the host, unverifiable
  from here, and it was the only thing standing between the config and a year
  of silent tearing.

`guards/cache-policy.test.ts` derives its scope from the config — it expands
each rule's `source` against the real files in `public/api` and fails on any
uncovered artifact, so a rule that is correct but does not *reach* the file
nobody remembered is caught. It also refuses to interpret a `source` pattern it
does not understand rather than silently matching nothing.

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
  gauge, so no header is shared with a different quantity.

  **RE-VERIFIED against the code [stability session, Pass F]** — carried into
  that session's brief as still open, and it is not. `KeyForwardBlock`
  (`wall/ForwardMatrix.tsx`) renders exactly four headers — 주요 포워드 / the
  level (headed by the data's date since pass M, `levelHeadText`, the same
  header the table's level column carries) /
  the 52주 최저–최고 track / 백분위 — and reads only `kf.values.now`; no basis
  key is rendered anywhere in the block, so nothing shares a header with the
  main table's change columns. The neighbouring matrix is headed by *tenors*,
  not bases, and its cells are levels. **Recorded resolution: relabelling and
  flipping to deltas were both rejected in favour of removal**, because the
  main table already owns the change story at those exact bases and the popup
  owns the full path — a per-basis level strip here was restating one and
  duplicating the header of the other. Nothing to do; do not reintroduce
  per-basis columns in this block. (2) **The gauge.**
  Each row gets a thin track spanning that forward's **52-week level min→max**
  (annual-stats session; `backend/app/forwards.py::_level_range`, a LEVEL
  distribution — distinct from the |Δ| move percentile that drives the tint,
  which stays FULL-history), a fill + marker at the current level's POSITION
  in that range, a **hairline tick at the 52-week average**, and the
  **percentile** as a number at the right. At the tails (≥90th or ≤10th) the
  marker goes **full ink** and the percentile **full-strength ink**, so a
  99th-percentile row is distinct from a 72nd at a glance; away from the tails
  the marker is a lighter grey and the percentile dimmed. Distinction is by
  **lightness, not hue** (palette cut — the old accent was
  `--bw-interactive`). Track ends are labelled 52주 최저 / 52주 최고 **once**
  above the block. This is the only place in the product that shows a level's
  position within its own range.
- **RESOLVED [closing session, part 2, Pass E2] — the matrix tint has a
  legend.** 168 tinted cells (plus the popup heatmap on the same scale) with
  nothing saying what the intensity meant. `ui/TintLegend.tsx` is a compact
  diverging swatch strip 하락 → untinted middle → 상승 with one line: intensity =
  today's move vs that series' own 10y daily-change history. (The tint scale
  is a CHANGE percentile and stays on the FULL history on purpose — see the
  LEVEL-window ruling; do not narrow it to 52 weeks.)
  **No separator rules inside grids [carry session, Pass B].** Cells share
  edges and form one continuous field — the tint makes the shape; structure
  comes from the pinned header and left columns. The year-boundary border-t
  rules that had crept into the matrix are removed and pinned against in
  `guards/scroll-affordance.test.ts` (no dedicated contiguity guard existed,
  so the rule lives there with the matrix's other structural pins). The
  live-quoted CELL border (§8) is a property of one cell, not a rule between
  cells, and stays. Swatch alphas are
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
- **`구간` vs `52주` statistics scope [Session 16 §F; window narrowed by the
  annual-stats session].** The preview has no zoom, so its min/max/avg are the
  backend's **52-week** stats and are labelled **`52주`** (the chart still
  draws the full history — its y-domain comes from the plotted points, never
  from the stats, or the 2020-21 trough would clip). The popup zooms, so its
  stats follow the **visible range** (recompute on zoom) and are labelled
  **`구간`** — genuinely selectable there.
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
  back to the idle curve (the IRS par curve since pass M, not the tab's own).
- **`{start}xSPOT` dropped from the forward LIST [Session 16 §I].** A
  spot-starting par rate is the outright at that start with no forward period —
  a duplicate. It stays in the 표로 보기 matrix as the spot reference column but
  no longer appears as a forward row (so no confusing `1Y3MxSPOT` label in the
  list).
- **`ONx*` dropped from the forward LIST too [carry session, Pass A].** An
  overnight start IS today, so `ONx3M` is the spot 3M rate wearing a
  forward's name and the whole ON row restates the outright tab — identical
  by construction, not coincidence (the only such degenerate family besides
  `{start}xSPOT` above). In the matrix the ON row STAYS as the grid's spot
  anchor but its row label reads **현물**, so it is presented as the spot
  curve rather than as forwards. Pinned by `guards/sort-key.test.ts`. The
  forward list is now 20 starts × 7 tenors = 140 rows.

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
  table on the left. So strokes stay blue.

  **RE-CHECKED and CONFIRMED [stability session, Pass F], this time against the
  trigger rather than around it.** The old revisit condition — "a blue stroke
  inside the same visual group as a column of blue down-numbers" — was already
  satisfied and nobody had noticed: `PreviewPane`'s header prints the signed D-1
  delta ~30px **directly above** the blue stroke, same pane, same group, and
  `--bw-down` and `--bw-line` are not merely similar but the **identical token
  value** (`#0064FF` light / `#4C93FF` dark). So the case was constructed and
  looked at rather than reasoned about: every instrument was up on D-1 in the
  live snapshot, so the rendered deltas were flipped to `text-down` **in the DOM
  only** (no code changed; page reloaded after) to produce the exact scenario —
  a full table of blue negatives beside a blue chart, with a blue `−5.0` sitting
  above the stroke. Checked in both themes.

  The verdict is unchanged and the reason is better than the old one. The line
  does **not** read as "down", because in that constructed frame it visibly
  *rises* across a screen where every number is negative — if hue were carrying
  direction that would look like a contradiction, and it does not; the eye takes
  slope from the line and sign from the glyph. Sign on a number is already
  carried three ways (the U+2212 prefix, the column header, the grayscale
  mini-bar), so hue there is the redundant third channel; on the stroke hue
  carries nothing at all. The everyday state is the proof: on a normal up day a
  **red** `+5.0` sits above the same **blue** line and reads as no contradiction
  either — which is what it means for two encodings not to share a scale.

  **The trigger is therefore retired, not re-armed.** It has now been exercised
  at its worst case and survived, so reopening on proximity alone would be
  re-litigation. Reopen only on evidence of a reader *misreading* a stroke as a
  direction. The fix, if that ever comes, is unchanged: move strokes to ink (the
  chart is signless, so ink loses nothing) — never a third hue.
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
- **OBSOLETE — forward idle curve = the 1YF ladder** (the 1-year forward rate
  at each start point, one line, x = start point). Chosen at the time over "one
  line per tenor" (8 same-colour lines are unreadable) and "x = tenor for a
  selected start" (needs an extra selector). **Superseded in pass M**: the idle
  pane is the IRS par curve on every tab, so there is no per-tab idle curve to
  choose. The reasoning is kept only because it also rules out those two shapes
  if a forward curve ever returns somewhere else.
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
---

## Provisional

Live section. Entries here are decisions taken *without* the owner because a
pass could not complete otherwise — the smallest reversible choice, with the
evidence that forced it. Referenced from several places above; it did not exist
as a heading until the hardening session, which is itself worth noting: the
references pointed at a section that had been absorbed into "Settled decisions"
and stopped being a live record.

### Pass N (2026-08-03) — the position track shows a statistic the chips do not use

**The track was shipped WITHOUT touching the chip predicate**, as the brief
directed. What this leaves on screen, named rather than resolved:

- **The marker is a RANGE position** — `(now − low) / (high − low)` over the
  52-week min–max — because that is what a low→high slider depicts, and
  because it derives from `range1y.{min,max}` + `now`, fields EVERY row
  carries, forwards included. The 고점권/저점권 chips read `range1y.pct`, a
  RANK percentile over the 252 observations, which forwards deliberately do
  not ship (Pass L, item 2 above).
- **Two visible consequences.** (1) Every FORWARD row now shows a marker,
  including one sitting hard against the track's right end, while the 고점권
  chip can never return a forward — the chip reads a field the forward
  payload does not carry. (2) On any row, a skewed year separates the two
  statistics: a series that spent most of the window near its high can print
  the 90th RANK percentile mid-range on the track, so a row the 고점권 chip
  returns can show a marker that does not hug the end. Rank answers "how
  unusual is this level"; the track answers "where is it between the
  extremes". Both are true at once.
- **Why not resolve it by wiring the track to `pct`:** that either strips the
  track from 168 forward rows (the rows a position gauge helps most) or
  ships the forward percentile — and shipping it silently changes which rows
  the chips return, which item 2 above records as an owner decision, not a
  side effect of a column change.

**Owner decisions open:** (a) whether the chips should start returning
forwards (= emit `pct` from `forwards.py::cell`, a SCHEMA_VERSION bump); (b)
whether the chip threshold should move to range-position so chip and track
agree by construction; (c) leave both as documented. **To reverse** the track
itself: delete `markerPct`/`RangeTrack`/`SLIDER_LABEL` in `RangeCells.tsx`,
the `slider` rung in `columns.ts`, and `guards/range-slider.test.ts`.

### Pass L — the three arbitrary choices in the 52주 column

**1. Sub-labels are `52주 고점 · 저점 · 평균`, and the window is named once.**
The brief required labels (high/low/mean does not read as a number line) and a
header in noun form, but not their wording. `고점`/`저점` are the words the
screener chips and the curve banner already use, so the column reuses them
rather than inventing `최고`/`최저`. The `52주` qualifier sits only on the first
label and scopes the other two by adjacency — repeating it three times would
cost width the numbers need. The column's full noun, `52주 레인지`, is what the
hidden-column note calls it when the ladder drops it. Sub-labels render at 11px
(the same size as that note), which is what lets the longest fit a sub-column;
the body numbers are the table's normal 13px, and the size is set on the SPANS
— see the `ch`-resolution note in the drop-threshold entry above. **To
reverse:** `RANGE_LABELS` and `RANGE_COL_NAME` are the only two places, but
re-measure item 3's cushion against any longer label.

**2. A forward's level PERCENTILE is computed but not shipped.** Adding the
52-week range to the 168 forward grid cells makes `pct` available for the first
time — the same repricing pass produces it. It is dropped from the grid cell
(`{min, max, avg}` only; `KeyForward` keeps the full record because its gauge
reads it) and `Row.pct` stays `null` for forwards. Two reasons: §20 says a
payload carries what a consumer reads, one pass after a field nobody read was
cut for being 92% of the payload; and wiring it would silently change which
rows the `52주 고점권`/`저점권` chips return, which is a product decision, not a
side effect of a column change. The `ForwardCell.range1y` type has no `pct`, so
the compiler enforces this rather than a comment. **To reverse:** emit the full
record from `forwards.py::cell` and read it in `rows.ts` — one line each, plus
a line in the chip descriptions if forwards should be named there.

**3. The sub-column cushion is 24px, not 현재's 18px.** Every other width here
is the format maximum; this one is not, because a sub-column has to fit its
header LABEL too and `52주 고점` is Korean — its advance scales with font size,
not with `ch`, so it does not shrink as the column does. Measured live at 11px:
44.76px of ink. 현재's 18px cushion leaves that 7.7px at the runtime ch of
7.7431; 24px leaves 13.7px, for 18px of table width. Verified live and pinned by
a margin assertion in `guards/table-grid.test.ts`, so the cushion cannot be
"simplified" back without the test naming why. **To reverse:** measure the
longest label first — the arithmetic alone will not tell you it clips.

### Pass G — `slug()` maps `vol:1Y`; it does not reject it

**The instruction** was: a test that constructs an id containing a colon, runs
the path derivation, and asserts it **raises**, on the exact shape that shipped
the bug (`vol:1Y`).

**Why it was not implemented literally.** `vol:1Y` is not a malformed id — it
is the real, current id of a volatility series, one of six that the 변동성 tab
and its stage-2 history depend on. `slug()` has mapped `:` → `/` since the
static conversion (§21), so `vol:1Y` becomes `series/vol/1Y` and no colon ever
reaches the filesystem. Making `slug()` raise on it would not harden anything;
it would delete the volatility tab, and it would do so as a side effect of a
guard, which is the worst way to remove a feature.

**What was implemented instead**, which satisfies what the instruction is
protecting against:

- `assert_writable_path()` — a **second, separate** check on the finished path,
  run immediately before every write, including for the fixed paths that never
  go through `slug()`. It raises on `api/series/vol:1Y.full.json`, the literal
  string that shipped the bug, with the alternate-data-stream explanation in
  the message.
- A test asserting that `series_path("vol:1Y", …)` produces **no colon at any
  resolution** and lands under `series/vol/`.

So the colon raises where it is dangerous (a path about to be written) and maps
where it is meaningful (an id naming a namespace). The two checks live at
different layers because the failure lived at the write, not at the id.

**To reverse**: if the owner wants `vol:` ids gone from the wire entirely,
rename the series ids themselves in `volatility.py` (e.g. `vol-1Y`) and drop
the mapping from both `static_paths.py` and `staticPaths.ts`. That is a data
change with a guard update, not a guard change.
