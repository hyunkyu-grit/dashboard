# Sauron — Session Handoff

> Living context for the next Claude Code session. Read this **after**
> `CLAUDE.md` and `docs/DESIGN.md` (the design spec still outranks everything
> here). Update the "Current state" and "Open / provisional" sections at the
> end of each session.

---

## 1. What this project is

- **Sauron** — a standalone KRW IRS (interest-rate-swap) monitor. One screen,
  two panes: a **list-first instrument table** on the left (the Toss ranking
  table is the reference), a **curve/preview** pane on the right.
- The product name is **Sauron**; the repo, npm package, and mirror script keep
  the old name **braveworld**. A path rename is deliberate churn we skip.
- **NEW and standalone.** It does **not** replace `krw-fi-pms`, which is frozen.
  Nothing under `krw-fi-pms` (`:3000`/`:8000`) may be read or modified from
  here. Do not port its DESIGN.md or its rulings.
- Only the **curve-side engine** (bootstrap, discount factors, forwards, CD-IRS
  conventions) was ported from the frozen engine, byte-identical, with a
  provenance header — see `docs/PORT_PROPOSAL.md`. No portfolio / MtM /
  scenario / trade code exists here.

### Ports & backup

| | |
|---|---|
| Frontend (Next.js, App Router, TS, Tailwind v4) | `:3100` |
| Backend (FastAPI + ported curve engine) | `:8100` |
| Data | `data/irsdata.xlsx` — daily KRW IRS closes, 2016→present |
| Git remote | **none** (no `gh`, no credentials) |
| Backup | mirror to `D:\Backups\braveworld.git` |

There is no private remote. **After every commit, run the mirror:**

```powershell
powershell -File scripts/mirror-to-d.ps1
```

---

## 2. How to run & gate

```powershell
# run (two shells)
cd backend;  python -m uvicorn app.main:app --port 8100
cd frontend; pnpm install; pnpm next dev --port 3100

# gates — all must be green before a commit
cd backend;  python -m pytest tests -q
cd frontend; pnpm vitest run; pnpm lint; pnpm build
```

**Gotchas about the gates (learned the hard way):**

- Do **not** rely on a bare `pnpm exec tsc --noEmit` as "the typecheck". It
  pulls in test files that use a newer regex flag and errors spuriously. The
  real typecheck is inside `pnpm build` ("Running TypeScript…"). vitest
  transpiles via esbuild and doesn't care.
- vitest **now HAS the `@/` alias** (added in the strip session for the first
  runtime `@/…` import inside src, `data/calendar.json`). Guard tests in
  `guards/` still import with **relative paths** by convention. The old trap
  is worth remembering: a type-only `@/` import appears to "work" because it
  is erased — before the alias, a value import failed at resolve time.
- `pnpm lint` prints a `$ eslint` banner to stderr; PowerShell wraps that as a
  scary-looking `NativeCommandError` even on success. Check the **exit code**
  (run it via the Bash tool: `pnpm lint; echo EXIT=$?`).
- Git warns `LF will be replaced by CRLF` on commit — expected on Windows,
  harmless. Goldens are pinned; don't let autocrlf rewrite fixture bytes.

---

## 3. Architecture map

### Frontend `frontend/src/`

- `ui/App.tsx` — the shell. One continuous surface pinned to the viewport;
  owns the lifted `tab` + `pinned`/`hovered` state; right pane = `PreviewPane`
  when a row is active, else `CurveView`. Uses `useMeasure` for pane width.
- `ui/InstrumentTable.tsx` — left pane. Sliding-underline tabs, controlled
  `filter`/`onFilter`, sortable columns, forward start-filter + matrix toggle,
  group headings, the quoted/interpolated dot marker.
- `ui/rows.ts` — **the data model.** `buildRows(summary, forwards)` produces the
  unified `Row[]`; `orderRows()` (THE ordering, lifted out of the component so
  it is testable without a DOM), `traderName()`, `cmpKey()`. Start here for any
  list/label/sort change.
- `ui/RangeCells.tsx` — the table's last column: 52주 고점/저점/평균. Ink, and
  not sortable; both pinned by `guards/range-column.test.ts`.
- `ui/cells.ts` — the table's two LEVEL call sites (`levelText`, `rangeText`),
  side by side so they cannot drift. Both are `fmtLevel`.
- `ui/CurveView.tsx` — idle right-pane curve: the IRS par curve, on every tab
  (pass M — it no longer dispatches on the tab). Hovering a node opens the
  shared readout card (pass N).
- `ui/ReadoutCard.tsx` — THE hovered-point readout card, shared by the idle
  curve and the preview chart (pass N). One card, one label map, one formatter
  path; pinned by `guards/readout-parity.test.ts`.
- `ui/PreviewPane.tsx` / `PreviewChart.tsx` / `CalendarHeatmap.tsx` — hover
  state: series history (blue SVG) + tooltip + calendar heatmap.
- `ui/EnlargedView.tsx` — the `?tile=…` sheet; **the only place
  `lightweight-charts` is allowed**.
- `ui/tint.ts` — shared grid background-tint scale (forward matrix + heatmap).
- `ui/useMeasure.ts` — **callback-ref** ResizeObserver width hook (see gotcha).
- `ui/motion.ts` — shared springs / press-scale / reduced-motion instants.
- `theme/tokens.css` — **the only file allowed raw hex** (lint-guarded).
- `guards/*.test.ts` — the invariant gates (see §4).

### Backend `backend/app/`

- `main.py` — FastAPI routes: `/api/wall/summary`, `/api/forwards`,
  `/api/series/{id}` (ids containing `x` route to forward history).
- `dataset.py` — loads the xlsx; `DISPLAY_TENORS = [1Y,1.5Y,2Y,3Y,5Y,10Y]`.
- `derive.py` — **all** server-side derivation: `basis_dates`, deltas,
  `spread_series`, `fly_series`, `summarize`. The browser never derives a
  series.
- `curves.py` / `forwards.py` — curve bootstrap + `forward_history` (per-date
  reprice, lazily cached).
- `engine_port.py` — the byte-identical ported engine. Do not edit.

---

## 4. Invariants that MUST stay green (do not weaken)

These are load-bearing and owner-mandated. Every one has a guard or is a hard
rule:

- `guards/no-raw-hex.test.ts` — **zero raw hex in components**; color only via
  semantic tokens. Raw hex lives solely in `theme/tokens.css`.
- `guards/canvas-var.test.ts` (`assertNoCssVars`) — canvas-bound options carry
  **resolved hex**, never `var(...)` strings (per-element `var()` in SVG stalled
  the compositor once).
- `guards/domain-guard.test.ts` (`assertDomainRendered`) — chart clip/domain.
- `guards/tint-contrast.test.ts` — ink stays ≥4.5:1 on the darkest grid tint.
- `guards/band-hue-contrast.test.ts` — direction hues clear contrast per theme.
- `guards/reduced-motion.test.ts` / `ramp-sync.test.ts` — motion + ramp.
- `guards/sort-key.test.ts` — **every `Row` carries a finite numeric sort key**
  (added S13; see the 3M diagnosis below).
- **`currentColor` discipline** for inline SVG strokes.
- **`lightweight-charts` only in the enlarged view** (`EnlargedView.tsx`). The
  list preview + idle curve are hand-rolled SVG.
- The change-log **event/state split** and its **fixed D-1 basis** stay as-is.
- **Every backend calculation and endpoint** is frozen unless the owner asks.

### Standing design decisions

- **Monochrome-first (§5):** every encoding must work in grayscale; hue only
  layers on. **Only directional numbers take hue; levels stay ink.**
- Colors: **two hues only — red up, blue down; everything else grey by
  lightness** [palette cut]. up `#d92d3c` / down `#0064FF` (Toss convention,
  red=up; up deepened from `#f04452` in S15 E1 so change TEXT clears 4.5:1).
  **Chart line is BLUE** (`#0064ff` light / `#4c93ff` dark, S16 E; same as the
  down colour — a line has no sign). Every non-directional interactive state
  (primary action, selection, focus, pins, tab underline, heatmap marker, gauge
  marker, product lockup, Pay/Receive accent) is **ink/grey** — `bg-ink` inverts
  with the theme so a filled pill is legible both ways. Orange (`#F58220`) and
  navy (`#043B72`) are defined but **unreferenced** and blocked by the §9 colour
  guard. Levels stay ink. All values live only in `theme/tokens.css`.
- **No elevation / no floating cards** (S13). Depth = surface steps + hairlines.
  The single sanctioned drop-shadow is the chart tooltip overlay.
- **Volatility is built** [Session 14] — relative ATR (mean ATR 5 / mean ATR
  60), close-only form; see DESIGN §4/§16 and `## Provisional`. Not a placeholder.
- Band 3 and any strategy/scenario tooling are **owner-gated**; leave reserved
  regions, build nothing speculative.

---

## 5. Conventions read from code — document, do NOT change

- **Instrument notation** (identical across label / command bar / id):
  - outright `10Y`; spread id `1Y-10Y` → label `1s10s`; fly id `2Y-5Y-10Y` →
    label `2s5s10s`; forward id `{start}x{tenor}` e.g. `2Yx1Y`.
  - `traderName` drops only the trailing `Y`, so a **1.5Y leg → `1.5s`**
    (`1Y-1.5Y` → `1s1.5s`).
- **Butterfly weighting = 1 : −2 : 1 (cash/rate-neutral), NOT DV01-neutral.**
  `derive.py::fly_series` = `2×belly − short − long`. Positive = belly cheap.
- **MTD == QTD in the first month of a quarter is correct by construction**
  (month-start and quarter-start resolve to the same prior close). Not a bug —
  do not "fix" or collapse the columns.

---

## 6. Current state (as of the 2026-08-03 session)

### Latest — passes M–Q batch 2 (2026-08-03, HEAD `406d163`)

Gates after every pass, both modes: BE **214 passed / 19 skipped / 1
xfailed**, FE **458 passed / 1 skipped (37 files)**, lint 0, build 0,
agreement 18/18. One commit per pass, each mirrored to D:. **origin pushes
after `5be9717` were blocked by the session's permission layer — run
`git push origin main` to deploy** (Vercel currently builds the data-refresh
commit; everything since is frontend-only and safe to ship together).

**A data refresh rode in first (`5be9717`, via `scripts/refresh.ps1 -Yes` —
its first real non-noop run, clean).** 2026-07-30 → **2026-08-03** (2614
observations). ⚠ The refresh REVISED history: 07-30's closes changed (3Y
3.8625→3.8925, 10Y 4.135→4.1525), which broke a backtest test twice over —
its parallel-window premise floated on exit=None AND the pinned window
stopped being parallel. Repinned on 2025-08-14 → 2026-07-24 (spread 24.5bp
at both ends, 10Y +167bp), both edges strictly inside the data (`410cfd8`).
Same family as the dv01-percentage gotcha: a data premise must be fixed
dates, never the file's last row.

The five passes (letters collide with the 2026-07-29 M/N — different work):

1. **M `187389d` — CD + base rate on spread/butterfly charts, dual axis.**
   `policyAxisMode(unit)`: % shared (unchanged), **bp secondary** (references
   keep their OWN % scale; both axes carry unit-suffixed `fmtAxis` ticks),
   ratio none. The instrument's bp path is byte-identical with the overlay
   on/off. `fmtAxis` moved to lib/format.ts (one axis grammar; CurveView
   delegates). The dead DetailChart is pinned to shared-only with a ⚠ (one
   price scale — widening its gate without a second scale puts % on a bp
   axis). Guard `policy-dual-axis.test.ts` derives its kind list from
   buildRows over the committed payloads.
2. **N `fcf9a3c` — the 52주 position track (위치).** Fourth sub-track right
   of 평균: low→high hairline + 2×12px ink marker at `(now−low)/(high−low)`,
   clamped, from the SAME `rangeValues` the numbers print (markerPct). Own
   ladder rung, FIRST to drop: **위치 671** content-px at ch 7.7431 (52주
   stays 600); the slider-only-hidden note rides the range header's filler.
   **Chips untouched** — the track is a RANGE position, the chips read the
   RANK percentile `pct`; the divergence (forwards show markers but can
   never chip; skewed years split the two statistics) is an OWNER DECISION,
   documented in DESIGN ## Provisional (pass N) with three options.
3. **O `c854aeb` — visible-window extremes + background grid** on the pane
   chart (THE detail chart now; the zoomable DetailChart is unreachable —
   choice recorded in Provisional pass O). `ui/extremes.ts::windowExtremes`,
   same scan as the y-domain; ties = first occurrence; flat window = marks
   coincide. Cost on 10Y full (2,614 pts): 4.4µs vs the ~0.97ms per-hover
   render. Grid = `stroke-edge` hairline (ink 12%/18%), horizontals at
   quarter lines, verticals on the date labels; verified both themes. The
   sanctioned exception to S14's no-vertical-gridlines default.
4. **P `ae20740` — entry level + par rate on the backtest entry row.** BOTH
   were already in the payload, computed once at backtest time (entryValue =
   quoted level lookup; legs[].entryRate = struck par from the entry-date
   bootstrap) — display-only, no backend change. Levels via `entryLevelText`
   (= fmtLevel; readout-parity pins byte-identity). Par shows only for
   one-swap positions (a package has par PER LEG, in the fold). fmtMove now
   differences DISPLAYED endpoints so `A → B (Δ)` agrees with itself on the
   0.25bp grid.
5. **Q `406d163` — back returns the backtest AS LEFT.** Root cause: close
   pushed a fresh `/` (history filled with popup entries) and the sheet's
   contents were component state. Now: `bt` nonce per open →
   `ui/backtestMemory.ts` (session Map) restores book AND result on any
   traversal (result REMEMBERED, never re-run); close IS `router.back()`
   when the app pushed (cold links replace). A pin present at MOUNT no
   longer counts as a capture (it duplicated the seed and appended a phantom
   row per traversal). Pane caption fixed ("누르면 커서 날짜부터 백테스트가
   열립니다"). Guard `backtest-back.test.ts` — its reproduction was watched
   FAIL RED on the pre-fix sheet before the fix landed.

**Open for the owner (new):** the pass-N chip/track divergence (three options
in Provisional); plus the carried items below.

## 6a. Before that (as of the 2026-07-31 session)

### Latest — the backtest (2026-07-31, HEAD `ab65fda`)

Gates: BE **232 passed / 1 skipped / 1 xfailed**, FE **418 passed / 1 skipped,
lint 0, build 0**. Static tree unchanged since `4e1b35d` (rebuilt and diffed —
only `builtAt` moved).

**A second PORT landed.** `IRS_Trade` into `engine_port.py`, and
`fixings`+`instruments`+`mtm_valuation` merged into `valuation_port.py`, bodies
byte-identical, guarded by `tests/test_valuation_port.py` (which also asserts
`CurveBundle` is the ONLY body in our file absent from the frozen source).
`docs/PORT_PROPOSAL.md` has the full record. The CLAUDE.md guardrail that said
"no portfolio valuation" was lifted by the owner for this.

**`app/backtest.py`** revalues a BOOK of positions daily on each date's own
curve, plus settled cash. Not Δrate × DV01 — that is blind to time passing.
Split into 평가손익 + 캐리손익, which is an identity, not a model.

**Things that only showed up by running numbers, all now guarded:**

- **Sub-year tenors were priced as 1-year swaps.** `VanillaSwap` annotates
  `tenor_years: int` but its body only does `round(tenor_years * 365)` — obeying
  the annotation made 1D/3M/6M/9M all 1Y and 1.5Y a 2Y. Pass the FLOAT.
- **A swap kept running past its maturity.** A 9M from 2020 was reported held
  to 2026. The cap belongs where the position's SPAN is computed, because the
  book's window is built from those spans — capping only inside the per-position
  run made the period column say 만기 while the chart drew past it.
- A maturity on a non-trading day breaks `maturity <= exit_date`; a maturity
  beyond the data clamps to the last row and falsely reads as matured.
- **Carry's sign follows the fixed rate against the CD that actually printed
  over the holding period**, not against CD on any one day. A 2025-07-30 payer
  has carry ≈ 0 because CD started below the struck rate and ended above.
- **"buy the fly" has no market standard** (Clarus and other desks define it
  oppositely; TraditionData says so outright). Directions are named by their
  LEGS. 스티프너/플래트너 IS standard and keeps its name.

**Deployment.** The site is still static and needs no backend — except the
backtest, whose answer depends on reader input. `BACKEND_ORIGIN` (server-side)
drives a Next rewrite so no origin is ever baked into the bundle; unset, the
sheet says a backend is needed. See DEPLOY_CHECKLIST. The owner's own prior
topology (krw-fi-pms: NSSM service + Cloudflare tunnel + rewrite) is the model,
and its 120s-TTFB problem does not apply here (backtest 0.6–3.4s vs simulate's
106–118s).

**Open:** `ui/EnlargedView.tsx` and `wall/DetailChart.tsx` are unreferenced —
the chart click opens the backtest now. Deleting them costs weekly/monthly
candles and the six-basis readout, which the owner has not ruled on. They carry
a ⚠ note.



### Latest — 전체 as three columns, a butterfly tab, three bases, and the base rate (2026-07-31)

Five owner changes landed together. Gates: BE **177 passed / 19 skipped / 1
xfailed**, FE **vitest 395 passed / 1 skipped (32 files), lint 0, build 0**. Static tree rebuilt:
**1229 files, 39.09 MB raw, 47.4 s**. `SCHEMA_VERSION` **3 → 4** (the forwards
payload's shape and its key set both changed — a v3 cache would have been
served with the old keys still in it).

1. **전체 is no longer a list — it is three columns** (`ui/OverviewColumns.tsx`).
   아웃라이트 · 스프레드 · 포워드 side by side, each showing only its 주요 set,
   each with its own chart underneath, taking the full surface with the side
   preview hidden. See DESIGN § The 전체 overview.
2. **WTD and QTD are deleted app-wide.** Three bases: 어제 · MTD · YTD. The
   ladder's full set now fits **129px earlier** (52주 at 600 content-px, was
   729). `derive.BASIS_KEYS` and `api.ts::BasisKey` are the two definitions.
3. **버터플라이 is its own tab**, split out of 스프레드.
4. **The 주요/전체 divider is on every instrument tab**, generalized from the
   forward tab. The sets are the owner's and live server-side; the browser
   reads a `key` boolean and never re-derives them.
5. **CD 91d and the BOK base rate draw on every %-unit chart, together**
   (`data/bokbaserate.xlsx`, `app/policy.py`, `ui/policyLine.ts`,
   `ui/useCdReference.ts`). See DESIGN § The two reference lines.
   - **The first pass drew only the base rate** and the owner caught it: "왜
     기준금리만 그려지고 CD금리는 안 그려지냐". The reasoning had been that the
     3M node IS CD91 so CD was already on screen where it mattered — true of
     one chart out of twenty. When an instruction names two things, draw two.
   - CD is aligned **by date**, not by position: two previews are downsampled
     per series, so index *i* is a different day in each and a zip would pair
     levels from different weeks. Plausible-looking and wrong.

**Traps this session hit, worth keeping:**

- **`DISPLAY_TENORS` was doing double duty.** Widening it for the 6M/9M
  butterfly silently widened the **변동성 tab** too, because `volatility.py`
  read the same list. Split into `VOL_TENORS` (the original six). Check what
  else reads a list before widening it.
- **`traderName` produced `6Ms9Ms1s`** for `6M-9M-1Y`: it stripped a trailing
  `Y` and appended `s` unconditionally. Sub-year legs now keep their unit and
  join on a slash (`6M/9M/1Y`). This would have shipped looking like a ticker.
- **`ch` is the ZERO advance, not the widest glyph.** The overview's 종목 track
  at 6ch truncated `2s10s` → `2s1…` because the labels are semibold letters.
  Corrected after seeing it on screen — the arithmetic looked fine.
- **The overview's density was wrong on first sight and took a second pass**
  (owner: "글자가 너무 작고 여백이 너무 많아"). 11px → 13px; the level track
  stopped being sized by a header it no longer prints; the charts moved to the
  floor and grew into the leftover. Two traps in that pass:
  - **Sizing a chart from a ResizeObserver on its own parent is a feedback
    loop** — it ran the charts off the bottom of the page. The chart is
    absolutely positioned inside the measured box now, so the child cannot
    influence what it is measured from.
  - **A `python replace` with no assert silently did nothing.** The GRID track
    edit did not apply and the "fixed" gap was still on screen; the guard
    written alongside it is what caught it. Assert every scripted replace —
    and note the second failure mode, which bit later the same session: when
    an assert DOES fire mid-script, every earlier edit in that script is
    rolled back too because nothing was written yet. Re-apply the whole
    script, not just the piece that failed.
  - **Equal-thirds columns put their slack between the columns**, which is the
    one place on the screen with nothing in it.
  - **Three charts growing independently into their own leftover** filled the
    space but produced three sizes (307/372/437) and made the curve the
    subject of a tab about numbers.
- **The page gutter is 80px now, app-wide** (`ui/pageGutter.ts`) — header, tab
  strip, table, preview pane, bottom strip. It was 20px, which is a card's
  inset on a full-bleed surface. Two things to know: it must be a LITERAL
  Tailwind class (a runtime-built `pr-20` is never generated and the padding
  silently vanishes), and the 전체 tab deliberately takes NO gutter because its
  `justify-evenly` already supplies equal outer and inner gaps — padding would
  land on the outer two only.
- **The overview's grid was a FORK, and forking it was the root mistake.** It
  shipped with its own eight-track template at its own type size, and over four
  passes that second definition drifted every time: a level track sized by a
  header it did not print, then labels clipped at 6ch, 6.5ch and 7ch because
  `ch` is the ZERO advance and `M` is far wider than a digit, then a type size
  that had to be re-picked twice. It now renders `gridTemplate(ALL_COLUMNS)`
  and `RangeCells` — the instrument table's own — at 13px, and every one of
  those defects is structurally gone. **If the overview needs a column the
  table lacks, change `columns.ts`; do not re-fork.** Placement is
  `max-content` + `justify-between` (left / centre / right) and the chart is a
  fixed 200px, which also makes "three charts, one height" true by
  construction rather than by measurement.
- **`guards/pane-still.test.ts` banned `strokeDasharray`** as a proxy for the
  removed ghost curve's draw-on animation. That is the wrong proxy: a dash
  PATTERN is static. Narrowed to `strokeDashoffset`, which is what actually
  animates a dash.
- **The base-rate carry is bounded and the bound is the whole feature.** If a
  Board meeting falls between `bokbaserate.xlsx`'s last date and the dataset's
  as-of, the step ENDS at the workbook's date rather than carrying an
  unverified rate. `through` in the payload is that bound — **it is not the
  chart's axis end**, and running the line to the axis end silently undoes it
  on every chart at once.
- **The two workbooks are refreshed separately and by hand.** `refresh.ps1`
  does not touch `bokbaserate.xlsx`. As of this session it lags: base rate to
  **2026-07-16**, IRS to **2026-07-30** — safe only because the Board's last
  meeting was 07-16 and the next is 08-27. **After 2026-08-27 the step will
  truncate and warn until the workbook is refreshed.**

**Payload cost of the wider tenor set:** derived series 35 → 84 (spreads 15→28,
flies 20→56), so `summary.json` went **17,580 → 30,885 bytes raw** (+76%;
gzip is what ships). Series files 196 → 245. The combinatorics are quadratic
and cubic in `DISPLAY_TENORS` — do not widen it casually.

### Before that — data refresh to 2026-07-30, and the gate's one data-dependent test

- **The dataset now runs to 2026-07-30** (2612 observations, +4 business days:
  07-27/28/29/30). Static tree rebuilt: 984 files, 31.52 MB raw, 28.7 s,
  integrity 983 declared / 984 on disk / 0 problems. `SCHEMA_VERSION` stayed 3 —
  no payload shape changed, so no bump.
- **Freshness is `current` again**, so the red 지연 chip is gone and the level
  header reads today's date. Screenshots in this file from earlier passes show
  the stale chip; that was the 07-24 file, not a defect.
- **A backend test failed on the new data, and it was the TEST that was wrong.**
  `test_dv01.py::test_fly_weights_are_dv01_neutral` divided the shipped residual
  by the BELLY's gross DV01 and demanded <1%. But the residual is exactly the
  wings' integer rounding priced at their own DV01s, and `1Y-2Y-10Y`'s long wing
  needs ~11.7 units at a 10Y DV01 four times the belly's — half a unit of
  rounding there is 2.1% of the belly gross on its own. It passed at 0.880% on
  the 07-24 curve and failed at 1.111% on 07-30 with nothing but the data
  moving, while the same trade passed the table-wide test at 0.261% because that
  one divides by the largest leg. Two tests, one trade, two denominators.
  - **Now asserted structurally**: `|residual| ≤ ½ · Σ d` over the rounded legs,
    which holds at every curve, plus a line asserting the notionals are integers
    (the assumption that makes the bound half a unit). Verified across all 50
    derived payloads on BOTH datasets — the worst case sits at 97.9% (old) and
    99.2% (new) of the bound, i.e. the bound is tight, which is why any
    percentage picked by hand was going to expire.
  - **If you ever ship non-integer notionals**, the integer assertion is the
    line that will tell you the bound must become `½ · 10⁻ᵈ · Σ d`.
- **`~$*.xls*` is now gitignored.** Excel's lock file was sitting untracked in
  `data/` during the refresh and `git add -A` would have committed it. **It is
  HIDDEN**, so `ls`, `dir` and Explorer all report `data/` clean while it sits
  there — check with `ls -la` / `Get-ChildItem -Force`. This cost a wrong
  statement in-session: the folder was declared clean off a plain `ls`.
- **`scripts/refresh.ps1` is the morning routine** — the owner asked whether
  "open the workbook, save, close" is the whole job; it is step 1 of 3, and this
  is 2 and 3. It refuses while the lock file exists, refuses to commit unless
  the xlsx's `asof` **advanced** (holiday / no-recalculation / already-run all
  land there), checks the rebuilt manifest against the file it was built from,
  runs the 18 agreement tests against a backend started from that tree, prints
  the diff, then asks y/n before commit → mirror → push. `-FullGate`, `-Yes`,
  `-NoPush`, `-Force`.
  - Its mode-2 mechanism is lifted from `gate.ps1` deliberately (start uvicorn,
    wait on the port, `finally` stop it) rather than reinvented.
  - **Only the no-op path has been exercised end to end** — there was no new
    data left to refresh the day it was written. The rebuild / agreement /
    commit branches are the same commands run by hand that morning, and the
    file parses clean, but the first real run will be its first real test.
  - Excel rewrites the xlsx on open even when no value changes (measured
    775,811 → 775,934 bytes at an identical 2612 observations), so `git status`
    shows it modified after any peek. The script says so instead of committing
    byte churn.
- **Gates after the refresh**: see the numbers in the commit for the refresh
  itself; the two-mode gate was run to green before it landed.

### Before that — pass N: the curve got the history line's readout

One owner ask: hovering the IRS curve should say what hovering an outright's
time series says. Frontend only, no payload change — every number it shows was
already in the summary row.

- **Hovering a curve node** draws a crosshair + a fattened dot and floats a
  card: **만기 · 레벨 · 52주 최고 · 52주 최저 · 52주 평균 · 당일 변화**. That is
  `PREVIEW_READOUTS` with the **tenor where the date is**.
- **`ui/ReadoutCard.tsx` is new and is THE card** — `ReadoutCard` /
  `ReadoutLevel` / `ReadoutChange` + `READOUT_LABEL`. `PreviewChart` was
  refactored onto it in the same pass, so the two tooltips are one component;
  its tooltip markup and its `Line` helper are gone. Levels print through
  `fmtLevel`, the change through `fmtDelta` + `dirClass`, and there is **no
  `toFixed` in the card**. Same reasoning as `ui/cells.ts` for the table's two
  level cells: two call sites of one quantity must be one function.
- **§16 held**: the card reads `deltas.d1` and `range1y.max/min/avg` off the
  summary row — the same fields the table's 어제 and 52주 columns print, so the
  curve and the table cannot disagree about a node. **Do not difference
  `now − prev` in the browser** to save a field; the guard fails on it and it
  would also disagree with the table at the displayed precision.
- **The two y-axis gridline labels keep their coarser 2dp** (`axisLabel`, the
  only rounding left in `CurveView`). They are orientation marks; `4.2446` in
  that role reads as data. Deliberate, not an oversight.
- **`CURVE_READOUTS`** joins the registry in `ui/readouts.ts`, and
  `guards/readout-parity.test.ts` now pins it against the preview's set: they
  may differ **only** in `date` ↔ `tenor`. It also fails if either surface stops
  using the shared card or hardcodes a label.
- **Verified live** against the payload, not just on screen: hovering 1.5Y
  printed 3.7500 / 3.8750 / 2.3200 / 3.0155 / +4.0 and
  `/api/wall/summary` gives `now 3.75`, `range1y {min 2.32, max 3.875, avg
  3.0155}`, `deltas.d1 4.0`. 10Y printed 4.2675 / +5.0, matching the bottom
  strip's `10Y 4.2675 +5.0`. The card clamps inside the pane at the 10Y edge.
- **Gates**: FE 361 passed / 1 skipped, lint 0, build 0.

### Before that — pass M: one idle curve, and the level header is a date

Two owner asks, both about what a surface CLAIMS. No new data, no backend
change; the whole pass is in five frontend files, two guards and DESIGN.

- **The idle right pane is the IRS par curve on every tab** [OWNER]. It used to
  dispatch on the tab — the 1YF ladder on forwards, the two-point-spread curve
  on spreads, the relative-ATR curve on volatility. Those three restated
  columns the table already prints, in a shape that takes longer to read, and
  they kept the IRS curve — the product's whole subject — off three of five
  tabs. `CurveView` no longer takes `tab` / `forwards` / `volatility`; it takes
  the summary, and draws `parNodes`.
- **`VolatilityPayload.curve` is now served and rendered by nothing.** Left in
  place on purpose (it is a backend payload field with static-tree tests
  behind it), and listed under "Open" so it is a decision rather than a
  leftover. **Do not delete it without also rebuilding the static tree** — that
  is a `SCHEMA_VERSION` bump, not a component edit.
- **The level column's header is the data's date, not the word 현재** [OWNER].
  `2026-07-24`, from the payload's `asof`, via `lib/format.ts::levelHeadText`
  — shared by the table header, the 주요 포워드 block, and the idle curve's
  legend (`2026-07-24 · 어제`). The word named the quantity and not the day, and
  these are closes: on any day the xlsx has not been rebuilt, 현재 asserted a
  currency the numbers did not have. **The date is the DATASET's, never
  `new Date()`** — a header off the reader's clock would print today over last
  Friday's closes and contradict the freshness chip sitting inches away. Pinned:
  `guards/label-quantity.test.ts` fails on a rendered 현재 or a clock call in
  any of the three surfaces.
- **The level column is now sized by its HEADER** — ten glyphs of ISO date
  (`WIDEST.levelHead`), not the six a value needs — the one column whose width
  comes from its label. `LEVEL_GLYPHS` is that max; the 52주 sub-columns
  deliberately still derive from `WIDEST.level`, since letting the date's width
  leak into them would widen three columns to fit a header they do not carry.
  **Every drop threshold moved +31px** at the measured ch: 52주 729 · QTD 518 ·
  MTD 453 · WTD 389 · YTD 324 · 어제 260 · 종목+레벨 196. Ladder order
  untouched, and 729 still fits the 840px table pane.
- **Gates**: FE 357 passed / 1 skipped, lint 0, build 0 (TypeScript clean).
  Backend untouched, so its suite was not re-run in this pass.
- **Verified live** (dev server + live backend on :8100): the header reads
  `2026-07-24` above the levels with no clipping, the 주요 포워드 block carries
  the same header (its cell widened 74 → 104px), and the 포워드 tab's idle pane
  now draws the IRS curve where the 1YF ladder used to be.

### Before that — pass L: 52-week high/low/mean replaced the 한 줄 column

One pass, one commit. The last table column kept its slot, its width behaviour
and its role as the elastic column; only its contents changed, from a dynamic
Korean sentence to three numbers.

- **Deleted**: the `한 줄` column, its four-rung ladder
  (`classify_one_liner` / `apply_level_extreme` / `apply_solo_direction` and
  the `MOVE_PCT_CUT` / `LEVEL_BAND` / `LEVEL_CAP` / `SOLO_MIN_BP` thresholds),
  the `oneLiner` field on every payload row, `OneLiner`/`OneLinerKind`,
  `renderOneLiner`, and the one-liner fragment in the preview pane's header.
  The `일간 변동 상위 N%` outlier signal went with it — it was the column's
  only frequent occupant.
- **Deliberately kept, because the one-liner was only one consumer**: `movePct`
  / `day_move_pct` (the tint DENSITY scale + the 오늘 많이 움직인 것 chip),
  `range1y` (고점권/저점권 chips, tooltip stats, key-forward gauge, curve
  banner, and now the column), and the backend `kind`/legs classification
  (`ui/gloss.ts` → popup description + Pay/Receive mode diagram). **Deleting a
  consumer and leaving its feed behind** is what left a 150-point sparkline at
  92% of the payload; the reverse mistake was the one to avoid here.
- **New**: forward GRID cells gained `range1y` (`{min, max, avg}` — no `pct`,
  see Provisional). `_cell_move_pct` + `_level_range` became one repricing pass
  (`_cell_history`), so this is strictly LESS backend work than before and the
  outputs are byte-identical (verified: 0 differences across 168 cells'
  `movePct`/`values`/`deltas`, and the 6 keyForward `range1y` records).
- **Payload, measured before and after** (committed static tree, raw bytes):
  summary 19,756 → **17,747**; forwards 50,209 → **51,745**; volatility
  2,654 → **2,414**. Stage-1 total 72,619 → **71,906** — it went DOWN by 713
  bytes, not up. The ~3× growth the pass anticipated did not happen because the
  52-week stats were already in stage-1 for 56 of the 196 listed rows, and the
  `oneLiner` object cost about what `range1y` costs. gzip: summary
  3,506 → 3,430, forwards 7,121 → 8,368.
- **Ladder thresholds recomputed** (the 606 figure was stale the moment the
  cell's contents changed): at the live-measured ch = 7.7431 the fixed-width
  sum is now **698px** (was 607) — the last column's floor went from a flat
  120px sentence floor to three sub-columns (211px), so the table needs ~92px
  MORE room, not less. Every narrower threshold is unchanged: QTD 487 ·
  MTD 422 · WTD 358 · YTD 293 · 어제 229 · 종목+현재 165. **Verified live**:
  present at 702px of content, dropped at 698px with "1열 숨김" in its slot.
- **A defect the live check caught, which no test would have.** The header's
  `text-[11px]` sat on the GRID CONTAINER. `RANGE_TEMPLATE` is written in
  `ch`, which resolves against the element's OWN font size — so the header
  grid's tracks came out 63.3px against the body's 70.4px and every sub-label
  sat left of the numbers it named (7px, 14px, 21px). Fixed by sizing the
  spans; `guards/range-column.test.ts` now fails if a sub-grid container
  carries a text size. Also live-verified after the fix: identical 70.45px
  tracks in both grids, 0.00px label-to-number offset, 25 rows sharing one
  right edge per sub-column, one ink colour throughout, and the 52주 header
  with zero interactive descendants leaving all 196 rows in order when
  clicked.
- **`SCHEMA_VERSION` 2 → 3** and the static tree rebuilt. The bump fired
  correctly: `test_static_agreement` went red on the stale tree before the
  rebuild, which is the annual-stats session's gotcha working as designed.
- **§16 re-examined, not left standing.** The exception's most visible subject
  was the 한 줄. DESIGN §16 now names the two that remain (the instrument
  gloss, the curve banner) and says to retire the exception if both ever go.
- **New guard** `guards/range-column.test.ts` (no colour token, no sort
  affordance, a click leaves order unchanged — with a non-vacuous counter-check
  that change columns DO reorder). `readout-parity` extended to byte-identity
  between the 현재 and 52주 render paths across every kind. `wire-format`
  rewritten to the new shape: it fails on `oneLiner` anywhere, and still fails
  on a per-row series under ANY name (keyed on value shape, not field name).

## 6b. Before that — the static conversion (2026-07-29)

- **HEAD** = the static-conversion commit `550349a` on `master`, mirrored to
  D:. Gates: FE **295 passed / 1 skipped**, lint 0, build 0; BE **131 passed /
  19 skipped / 1 xfailed** (the 19 skips are 18 agreement tests that need a
  running backend, plus the parked calendar guard).

### The data ships as static JSON — read this before touching the backend

- **The deployed site has no backend.** `backend/scripts/build_static.py`
  precomputes every response into `frontend/public/api/**` (984 files, ~31 MB,
  ~20 s) and **that tree is committed**. Vercel runs `next build` only.
  DESIGN §21 and `docs/diagnostics/static-feasibility.md` have the reasoning.
- **Refreshing data is now three steps, not one**: replace
  `data/irsdata.xlsx`, run the pipeline, commit **both**. Committing the xlsx
  without rebuilding ships a site that disagrees with its own data file;
  `test_static_agreement.py::test_the_static_tree_is_current_for_this_data_file`
  catches it, but only with a backend running.
- **`backend/app/payloads.py` is the single source of every response body.**
  Both the FastAPI handlers and the pipeline call it. If you add or change an
  endpoint's content, change it there — anywhere else creates two answers.
- **Ids map to filenames through one rule, `:` → `/`** — stated in
  `app/static_paths.py`, mirrored in `lib/staticPaths.ts`, and it **raises**
  rather than guessing. Do not interpolate an id into a path by hand: on NTFS a
  colon silently redirects the write into an alternate data stream (Pass A lost
  24 files that way with a clean exit code).
- **`.gitattributes` pins `frontend/public/api/**` to LF.** This machine has
  `core.autocrlf=true`, which would otherwise rewrite every line on checkout,
  making a rebuild on unchanged data look like ~980 modified files. Verified:
  after a rebuild, `git status` reports exactly one changed file
  (`manifest.json`, whose `builtAt` is meant to change).
- **The FastAPI app is still the reference implementation** for local
  development. Set `NEXT_PUBLIC_API_BASE` in `frontend/.env.local` to use it;
  unset means "read the static files", which is what production does.
- **Deploying is the owner's step**: no git remote exists, and the Vercel
  project needs Root Directory = `frontend`. `docs/DEPLOY_CHECKLIST.md` covers
  what only a deployed site can show — the case-sensitivity sweep especially,
  which fails in production and nowhere else.

### Before that — the stability session (Passes A–F)
- **The stability session ran A–F.** A diagnosed the failure paths
  (`docs/diagnostics/failure-modes.md`); B gave the client visible failure
  (independent error boundaries, `ui/DataState.tsx`, a persistent retryable
  error, `?tile=` self-clearing, `NEXT_PUBLIC_API_BASE`); C made the server
  refuse untrustworthy data at load and recompute a torn cache loudly; D put
  every source-scanning guard on one comment/string stripper
  (`guards/_source.ts`); E measured before optimising
  (`docs/diagnostics/perf-baseline.md` — §20); F closed the two label items.
- **Read `docs/diagnostics/perf-baseline.md` before any performance work.** It
  records what was changed (per-row `spark` deleted, gzip on, chart lazy) AND
  what measured healthy and was deliberately left alone (tab render, heap,
  chart disposal, the four parallel stage-1 requests). Two traps in there:
  the automation tab is **occluded**, so rAF, paint timing and DOM polling all
  lie — use the performance timeline; and gate timings mean nothing unless the
  dev servers are stopped (201s vs 70s for the same suite).
- **Stage 1 carries no series** (§20). A summary row is numbers about an
  instrument, never history — enforced by shape, not just size, in
  `backend/tests/test_wire_format.py`.
- **"Popup-only" ≠ "loaded with the popup"** (§20). lightweight-charts obeyed
  §11 and still shipped in the initial chunk. `guards/lazy-chart.test.ts` pins
  the import edge. Note that guard uses `code()`, not `identifiers()` — a
  module specifier IS a string literal, so the stronger stripper erases the
  very thing being matched.
- **Blue's double duty was re-checked at its worst case and stands** (§9). The
  old revisit trigger is retired, not re-armed; reopen only on evidence of a
  reader misreading a stroke as a direction. `--bw-line` must stay its own
  token (`guards/label-quantity.test.ts`) — same value as `--bw-down` is fine,
  one shared name is not.
- **Carry & roll is GONE** (popup block, `app/carry.py`, its endpoint, FE
  types/fetcher, tests). Two recorded faults: the headline and the breakeven
  printed the same number, and the components did not sum to the total at the
  displayed precision. **If it returns it is a sortable table COLUMN, not a
  popup block** — screening question, so sorting is the point; and with the
  column ladder already tight it would be first to drop in a narrow window.
  **The freed popup space is deliberately empty** — two features have now
  been removed from that spot; do not fill it to balance the layout.
- **The calendar is DISCONNECTED from the UI but KEPT.** `ui/calendar.ts`,
  `data/calendar.json` and `guards/calendar.test.ts` stay, unreferenced by
  design — verified 2026 dates, sources, `verified` filtering, LPR rule. **A
  session reading only the code will see an unused module: do NOT delete
  it.** Removed: the strip's next-event slot, the chart's meeting rules (with
  their density + average-gap thresholds and the transparent-canvas underlay
  that existed only for them), and the `일정 파일 갱신 필요` state.
  **Re-wiring means restoring the strip slot, the chart rules AND the
  staleness guard together.**
- **The staleness gate is PARKED, not disabled.** It skips while
  `ui/calendar.ts` has no importer — computed by a source scan, not
  hard-coded — and the reason prints in the test title beside the skip
  marker. Adding any consumer revives it automatically (proved both ways with
  a throwaway importer).
- **Strip layout without the calendar**: the collapse chevron moved to sit
  with the anchors (it was a lone control ~1,700px from them); the collapsed
  handle keeps its centred grabber pill but the whole 12px bar is the hit
  target.
- Owner-open: real-narrow-window eyeball (carried); vol carry one-liner
  glance is now moot (carry removed); verified PRC holiday dates remain
  relevant only if the calendar is ever re-wired.

### Earlier — calendar session (Passes A–G, 2026-07-28)

- **HEAD** = the calendar-session Pass G commit on `master`, mirrored to D:.
  Gates: FE **191 vitest / 23 files**, lint 0, build 0 (BE untouched,
  79/1s/1xf).
- **The fabricated calendar is gone.** All 182 reconstructed entries were
  DELETED, not repaired (~1 in 8 was on the wrong weekday and there was no way
  to tell which from inside the file). In their place: **32 entries, 2026
  only**, read off the publishing banks and carrying their source — 금통위,
  FOMC, BOJ, ECB, eight each. **Historical entries are not replaced**; nothing
  renders before `CALENDAR_FROM` = 2026-01-01, deliberately.
- **`verified` is load-bearing and structural**: the raw file is reachable
  from one module only (`ui/calendar.ts`), which exports filtered lists — a
  render path cannot obtain an unverified row. Unverified rows do not count
  toward the horizon, so staging a 2027 cannot silence the gate. Guards
  enforce both. Staging IS allowed (the file is a staging area); presence is
  counted, never fatal.
- **PBOC LPR is generated, not listed**: the 20th of the month rolled forward
  to a business day. **`PRC_HOLIDAYS` ships EMPTY** — weekend rolling works,
  holiday rolling does not yet, so an LPR rule can sit a few days early in a
  month whose roll lands on a holiday (**check 2026-02 first, 춘절 is near the
  20th**). LPR draws chart rules only and never counts down.
- **Countdown scope**: 금통위, FOMC, BOJ only. ECB and LPR are rules, never
  the next event.
- **The staleness gate fires on 2026-10-19** (60 days before 2026-12-18). That
  is the design. The failure message and README §"Policy calendar" name the
  four sources and say to READ THE DATES OFF THE SOURCE, never from memory.
- **Defect found and fixed in Pass G**: the meeting-rule density threshold was
  count-only, which assumed events spread across the view; a 2026-only
  calendar bunches 25 rules into ~35px at the right edge of a 10y chart and
  the count passed (25 ≤ 32) while the screen showed a hatch. A minimum
  average-gap test (6px) was added alongside the count.
- Owner-open: real-narrow-window eyeball (carried); vol carry one-liner glance
  (carried); verified PRC holiday dates for `PRC_HOLIDAYS`.

### Earlier — strip session (Passes A–F, 2026-07-28)

- **HEAD** = the strip-session Pass F commit on `master`, mirrored to D:.
  Gates: FE **177 vitest / 23 files**, lint 0, build 0 (BE untouched, 79/1s/1xf).
- Passes (commits in dependency order — D lands before C, which reads it):
  1. **A — the curve gesture is REMOVED** (component, trigger, `ui/gesture.ts`).
     Too small to read at a 10px peak against a 136bp curve, big enough to
     distract; the popup's schematic diagram does the job properly. What
     survives is the pane's corner label (pinned instrument · mode).
     `guards/pane-still.test.ts`. `diagramSpec`/`toBand`/`modeShape` stay.
  2. **B — the carry block speaks the product's register**: label + total,
     breakdown + directional breakeven beneath. `carrySentence` →
     `carryReadout`. Zero components print unsigned.
  3. **D — `src/data/calendar.json`** (182 entries, 2016→2026; 금통위 + FOMC
     only) + `ui/calendar.ts`. **`verified: false` — the dates are a SEED
     reconstructed from the published-schedule pattern; ~23 fail a weekday
     cross-check, so some are wrong. The owner must check them against
     bok.or.kr / federalreserve.gov and flip the flag.** The horizon guard
     catches a file that STOPS, never one that is WRONG.
  4. **C — the bottom strip**: three anchors (10Y / 3s10s / 1Yx1Y) + the next
     meeting, fixed chrome, collapsible+remembered, app root pads by its
     height. No backend change; change shown vs D-1.
  5. **E — meeting rules** on the enlarged chart only, behind the series via a
     transparent canvas + DOM underlay; dropped above 32 in view.
  6. **F — verified** (DESIGN §2 "Verified [strip session, Pass F]").
- **Gotchas this session**: the compiler lint rejects setState-in-effect —
  client-only reads (wall clock, localStorage) go through
  `useSyncExternalStore`. `vitest.config` needed the `@/` alias for the first
  RUNTIME `@/…` import in src. Backticks in a bash-quoted commit message get
  eaten by the shell — use a heredoc (`git commit -F -`).
- Owner-open: verify the calendar dates; real-narrow-window eyeball
  (carried); vol carry one-liner glance (carried).

### Earlier — columns session (Passes A–C, 2026-07-28)

- **HEAD** = the columns-session Pass C commit on `master`, mirrored to D:.
  Gates: FE **141 vitest / 20 files**, lint 0, build 0 (BE untouched).
- **The column priority ladder** (`ui/columns.ts::visibleColumns`): when the
  measured container cannot hold every fixed-width column, columns DROP in
  priority order instead of shrinking — 종목 · 현재 · [sorted, never
  dropped] · 어제 · YTD · WTD · MTD · QTD · 한 줄 (first out, last back).
  Arithmetic against the fixed widths + a runtime-measured ch (probe span +
  fonts.ready re-measure); container via ResizeObserver on the table
  element; displayed columns keep canonical order; header/body share one
  `gridTemplate(visible)`; drops never animate; header states "N열 숨김"
  (names on hover, no picker); overflow-x-auto backstop only below
  종목+현재. Verified live by pane-width sweep — thresholds and ladder
  order recorded in DESIGN §2; sorted-QTD-at-460px keeps QTD ↓ on screen.
- **Environment gotcha (recurring)**: the occluded/emulated renderer
  delivers ResizeObserver callbacks (and rAF) only on FORCED frames — take
  a screenshot between mutating and reading when driving the app remotely.
- Owner-open: single-column narrow eyeball on a real screen (same code
  path), carried over from the carry session.

### Earlier — carry session (Passes A–E, 2026-07-28)

- **HEAD** = the carry-session Pass E commit on `master`, mirrored to D:.
  Gates: BE **79 pass / 1 skip / 1 xfail**, FE **135 vitest / 20 files**,
  lint 0, build 0 — every gate its own command, exit code read directly.
- Passes:
  1. **A — ONx\* dropped from the forward list** (spot curve in a forward's
     name; matrix keeps the ON row as the spot anchor labelled 현물).
     Forward list = 20 starts × 7 tenors = 140 rows. `guards/sort-key`.
  2. **B — no separator rules inside grids**: the matrix's year-boundary
     border-t rules removed; the live-quoted CELL border stays (a cell cue,
     not a rule). Pinned in `guards/scroll-affordance.test.ts`.
  3. **C — carry & roll replaced the curve heatmap** (endpoint + cache +
     component deleted). `app/carry.py`: carry_pay = S(T)−F(h,T−h), roll_pay
     = S(T−h)−S(T); quote-weight leg combination (dv01 ratios deliberately
     NOT re-applied — embedded in bp-of-quote); forwards pure roll; off-grid
     tenors priced on an end-anchored stub schedule (naive interpolation
     EXTRAPOLATED past the 10y node — caught by test; raw engine quantized
     1M roll to 0). FE: CarryPanel sentence (three shapes + 셈할 수 없습니다
     + vol one-liner), NEAR_ZERO_BP=0.5, horizons 1M/3M/6M/1Y default 3M,
     side LIFTED so one toggle signs diagram + sentence.
     `tests/test_carry.py` + `guards/carry-copy.test.ts`.
  4. **D — padding**: 한 줄 track floor (ONE_LINER_MIN_PX=120) +
     overflow-x-auto (narrow scrolls instead of clipping flush), pb-8 bottom,
     `devIndicators: false`. The owner's narrow screenshot state did NOT
     reproduce remotely (extension emulates a wide viewport) — fixes are
     by-construction; owner eyeball on a real narrow window open.
  5. **E — verified** (DESIGN §2 carry block "Verified"): signs hand-checked
     on the live curve (payer negative, roll exact to 0.01bp), Receive
     negation live, legs test-pinned, horizons monotone, light+dark, grids
     continuous. Open: narrow-window eyeball + vol one-liner glance.
- Backend :8100 restarted on this code; FE dev :3100; theme left dark.

### Earlier — annual-stats session (Passes A–C, 2026-07-28)

- **HEAD** = the annual-stats Pass C commit on `master`, mirrored to D:.
  Gates: BE **70 pass / 1 skip / 1 xfail**, FE **126 vitest / 19 files**,
  lint 0, build 0 — each gate run as its own command, exit code read (the
  piped-gate trap fired twice before; never gate through `tail`).
- Passes:
  1. **A — LEVEL stats are 52-week** (`range1y` {min,max,avg,pct}, trailing
     `ANNUAL_OBS`=252): gauge (+average hairline tick, ends 52주 최저/최고),
     preview tooltip 52주 최고/최저/평균, screener chips 52주 고점권/저점권,
     banner, 한 줄 level rung, event range-transitions. **CHANGE stats stay
     FULL-history on purpose** (movePct, tint, move rung, event 'move') —
     pinned by `test_move_pct_stays_on_the_full_history`. PreviewChart's
     y-domain now derives from plotted points (stats would clip the line).
  2. **B — dates under the charts**: `ui/timeAxis.ts` ladder (year→month→day
     round boundaries, 3–4 labels), PreviewChart bottom pad + DetailChart
     18px strip replacing LWC's hidden time axis; labels track zoom and
     candle buckets. `guards/date-labels.test.ts`.
  3. **C — verified**: change-based counts byte-identical (1 / 2 / 165 / 1);
     level percentiles un-saturated structurally (22→27 unique; the day's
     genuine 52w-high regime keeps outrights ~90-99 honestly); all label
     rungs seen live at five zoom depths, light + dark.
- **Gotcha (new, in cache.py):** the disk cache is keyed by data hash +
  `SCHEMA_VERSION` — the range1y rename silently served the old cached shape
  until the version was added. Bump SCHEMA_VERSION on ANY cached-payload
  shape change.
- Backend :8100 restarted on this code (uvicorn, background); FE dev :3100.

### Earlier — motion session (Passes A–F, 2026-07-28)

- **HEAD** = the motion-session Pass F commit on `master`, mirrored to D:.
  Gates: FE **119 vitest / 18 files**, lint exit 0, build clean.
- Passes (one commit each + one lint fixup):
  1. **A `fa5a8dd` — the column grid is frozen.** Widths derive from the
     FORMAT's widest rendering (`ui/columns.ts` GRID_TEMPLATE — `1s1.5s10s`,
     six tabular glyphs per numeric column), 한 줄 is the only flexible
     track, one template shared by header + body, `scrollbar-gutter: stable`.
     **The `<table>` became a CSS-grid row list** (role semantics kept) —
     transforms don't reach `table-row` and Pass C needs transformable rows.
     `guards/table-grid.test.ts`.
  2. **B `705a643` — §14 motion inventory** (present / stale-spec / missing).
  3. **C `02be623` + fix `a42fc86` — FLIP reorder** on sort & screener
     (transform-only `layout="position"`, popLayout exits fade in place,
     cause-gated, viewport-culled, `FLIP_MAX_ROWS`=400; snapshot measured at
     EVENT time — compiler lint forbids ref/DOM reads in render; NOTE the
     Pass C commit itself went in red because `pnpm lint | tail` masks the
     exit code — pipe swallows it, don't gate through a pipe).
     `guards/reorder.test.ts`.
  4. **D `aea1500` — Pay/Receive morph + preview cross-fade.** One factor
     q ∈ [−1,1] morphs the ghost (deformation is linear in sign); preview
     pane cross-fades 150ms on series switch.
  5. **E `cc2de57` — curve gesture on pin.** Dashed-ink ghost on the par
     curve springs to the wanted shape / holds / fades (400/600/300ms),
     `GESTURE_AMP_PX`=10 fixed, geometry reused via `ui/gesture.ts` +
     `modeShape` (exported from payReceiveModel). Replay = re-pin (recorded
     choice). Vol rows play nothing. `guards/curve-gesture.test.ts`.
  6. **F — verified** (see DESIGN §14 "Verified"): grid stable, morphs and
     gestures correct in both themes; reorder commits 0.6–1.4ms. **Open for
     the owner:** an eyeball frame-rate pass on a live screen (the session's
     display was occluded → rAF throttled, FPS unsampleable) and an OS-level
     `prefers-reduced-motion` check (mechanism is guarded + MotionConfig).

### Earlier — band session (Passes A–C, 2026-07-28)

- **HEAD `807b043`** on `master`, mirrored to D:. Gates: FE **97 vitest / 15
  files**, lint exit 0, build clean. Three passes, one commit each:
  1. `b586cc8` **A — orange/navy sweep confirmed.** No component carries a
     retired hue; the guard (`guards/palette.test.ts`) already existed. Only
     leftovers were six stale comments/labels still saying "orange"/"navy"
     (component headers, the band-hue-contrast test label, ramp.ts) — scrubbed.
  2. `17a026f` **B — every kind gets the positional band** in the Pay/Receive
     mode picture (`payReceiveModel.ts`): outright = tenor (narrow), spread =
     leg-to-leg, butterfly = wing-to-wing, forward = period; deformation
     confined to the band (level = smoothstep plateau), `MIN_BAND` = 30% of the
     plot, band neutral/unlabelled. Guard extended (span, min width, identity
     outside the band, single unlabelled rect).
  3. `807b043` **C — verified live both themes:** 1s2s vs 5s10s and 1s2s3s vs
     2s5s10s now distinguishable at a glance; no tuning needed.

### Earlier — closing session, part 2 (Passes A–F, 2026-07-27)

- **HEAD** = the closing-session-2 Pass F commit on `master`, mirrored to D:.
  See `docs/STATE.md` for the full works-verified / works-unverified / known-
  accepted / missing boundary.
- Gates: FE **54 vitest** (the prior handoff's "57" was a miscount — the suite
  has been 54 all session), backend **68 pass / 1 skip / 1 xfail** (skip = the
  reference-sheet harness awaiting a file; xfail = the documented, now
  owner-accepted round-trip finding), build+lint clean.
- **This session ran A–F end to end** (the earlier closing session stopped at A1;
  the owner has now decided). One commit per pass, mirrored:
  1. **A — accepted residual recorded.** The owner accepted the ≤0.25bp
     bootstrap round-trip residual (frozen code, not re-ported). The strict
     `xfail` now documents an accepted limitation; `CONVENTIONS.md` + `STATE.md`
     record what it does (level reads) and doesn't (change columns cancel)
     affect, and that byte-identical krw-fi-pms carries it too.
  2. **B — first live browser look.** Dark mode across every surface,
     single-column bottom-sheet fallback, deep-zoom heatmap rebucketing, candles
     never comb (interval user-chosen, no auto step-up), quiet-day tint reads
     clean (own-history percentile floor). No defect found.
  3. **C — stale data made loud.** `staleness.py` + `/api/health` freshness;
     header chip scales with KR-business-day age (quiet / visible / red words).
     README documents the manual refresh.
  4. **D — change log surfaced** (`ui/ChangeLog.tsx`): header popover on the
     events rule with 연관 N건 expansion + click-to-focus. Chosen over deletion
     (the rule is good; surfacing was the orphaned Pass B of the diagnostic).
  5. **E — key-forward gauges** (10y min→max track + marker + percentile, accent
     at the tails; backend `range10y`) and the shared **tint legend**
     (`ui/TintLegend.tsx`, matrix + heatmap). E1 also removed the per-basis LEVEL
     columns that shared the table's change-column headers.
  6. **F — this handover.**
- **Still the owner's call:** run **Pass A2** (drop a forward-matrix sheet into
  `data/reference/`) — the only external correctness check, never run. The
  bootstrap re-port is now closed (accepted).

### Earlier — the preceding session landed 5 passes (A–E):

- **FINAL HEAD** = its Pass E commit on `master`, mirrored to D:.
- Gates: FE **57 vitest tests**, `pnpm build` clean, `pnpm lint` exit 0.
  Backend **53 tests**.
- **Backend startup: ~17s cold, ~2s warm.** The own-history distributions are
  persisted to `backend/.cache/` keyed by a SHA-256 of `data/irsdata.xlsx`
  (final §D); recomputed (loudly logged) only when the data changes. `.cache/`
  is gitignored.
- The final session landed 5 passes (A–E), one commit each:
  1. `4a773a4` **A — Pay/Receive curve diagram** (`ui/PayReceive.tsx`): the
     missing feature (spec'd S15 Pass J, dropped). Beside the DV01 ratio; one
     rule (Pay profits when the value rises); arrows + desk-term per kind.
  2. `8340b4d` **B — outlier cue is a leading-edge rule**, not the invisible
     0.04 fill (a fill behind coloured text can't clear contrast). `columnCue`.
  3. `9153559` **C — curve heatmap synced to the chart**: x-domain bound to the
     visible range, crosshair through both.
  4. `d292507` **D — own-history cache** (`app/cache.py`), 17s→2s warm boot.
  5. **E — closeout** (this): resolved the Provisional list, settled vol
     warm-up 65→**61** and floor 0.05→**0.1** (max ratio 3M 12.0 / 1D 6.0 is
     genuine step-behaviour, not an artefact), removed dead `usePan.ts`,
     reconciled docs, confirmed the mirror.
- **Earlier: Session 16 landed 10 passes (A–J):**
  1. `2d998d9` **E — chart line → blue**, orange back to selection/focus.
  2. `8f062e7` **H — full-bleed**: dropped the outer card, header is a
     full-width band.
  3. `7fad8ed` **I — curve-level 한 줄 banner** (커브 전 구간이 10년 고점권),
     pin clears on tab change, `{start}xSPOT` dropped from the forward list.
  4. `7dfbdd9` **B — DV01-neutral leg weights** (`dv01.py`, par-swap annuity off
     the bootstrapped curve; `/api/dv01/{id}`; popup ratio).
  5. `c150df1` **J — own-history colour scale**: change-column binary tint 0.04
     (not 0.12 — text contrast), forward matrix graded 0.45, grid-max dropped.
  6. `a3af070` **F — 당일 변화 +0.0 diagnosed** (genuine flat day, d correct);
     구간 vs 10년 stat labels.
  7. `505007c` **C — popup ⊇ preview**: DetailChart crosshair tooltip + stats +
     last-value badge; `readout-parity.test.ts`.
  8. `fc19cb9` **G — candlesticks** 주봉/월봉 (`?interval=w|m`, OHLC from closes,
     상승 빨강/하락 파랑, `?type=` in URL).
  9. `3fc5a52` **D — tenor × date curve heatmap** in the popup (own-history
     tint, shows the curve not the instrument).
- **New backend endpoints:** `/api/dv01/{id}`, `/api/curve-heatmap`;
  `/api/series/{id}?interval=w|m` for OHLC. **New DTO fields:** ForwardCell
  `movePct`; WallSummary `curveBanner`.

### Session 15 (superseded head, kept for the pass ledger)

- Session 15 FINAL HEAD was `94931a3`, landing 9 passes (A–I; E split E1
  autonomous / E2 report-and-stop):
  1. `a088f4c` **A — whole window.** No max-width; table pane 880px, preview
     fills the rest (floor 600), curve fills height; single-column bottom-sheet
     fallback below ~1520px (`ui/useIsWide.ts`).
  2. `557a746` **B — weight is structure.** Instrument name + `현재` at 600,
     changes at 400; outlier emphasis moved to colour intensity (§5 updated).
  3. `a53b7b9` **C1 — popup gloss.** Subtitle + 합니다체 explanation keyed to
     kind (`ui/gloss.ts`, rendered from kind+legs; `gloss.test.ts` pins copy).
  4. `70fed5a` **C2 — 한 줄 ladder.** move-extreme (own-history) → level
     extreme (capped) → solo direction → empty. `day_move_pct` new BE input.
  5. `fa07d9d` **D — screener chips.** `ui/screener.ts` predicates; `movePct`
     exposed on the DTO.
  6. `7236fe8` **E1 — up-color.** `#f04452`→`#d92d3c` (4.5:1 text); hue-contrast
     guard split by usage (text 4.5 / stroke 3).
  7. `7269c9e` **E2 — colour-density diagnostic (report, STOP).**
     `docs/diagnostics/color-density.md` + `backend/scripts/color_density.py`.
     Colour normalization NOT implemented — owner picks the scale.
  8. `ebfca5a` **F — matrix full-width mode.** pinned 시작/날짜, key block
     wraps; `scroll-affordance.test.ts`.
  9. `0f78ecd` **G — sticky opaque.** header `<tr>` opacity → text-ink/50 alpha;
     `sticky-opaque.test.ts`. `94931a3` **H — 합니다체 + terminology (§15)**.
     `e2f8d5d` **I — removed the preview heatmap** (tooltip is the sole readout).
- **Owner decision pending (Pass E2):** the colour-intensity normalization —
  recommended own-history percentile (floor pct70, full pct97), same scale for
  the forward-matrix tint (which today lights ~96–99% of cells). Backend needs a
  normalized magnitude per cell (§16). Not built.

### Session 14 (superseded head, kept for the pass ledger)

- Session 14 FINAL HEAD was `04bce8f`, landing 4 passes, one commit each:
  1. `0dda57c` **Computation boundary (§16).** Backend computes, frontend
     renders. Moved FE→BE: the 한 줄 classification (ships as `{kind,value}`,
     rendered on the client — the §16 exception), sort keys, the quoted flag,
     series range stats (min/max/avg), per-point daily change, the calendar's
     daily-change series, and preview downsampling (`?res=preview` ~150 pts;
     `res=full` for the enlarged view). New guard `row-vm-source.test.ts`:
     every `buildRows` field is declared `dto|format` in `ROW_FIELD_SOURCE`,
     dto fields checked against the API source.
  2. `0e33443` **Volatility engine.** `relative_atr` in `volatility.py`:
     `mean(ATR 5) / mean(ATR 60)`, close-only form `TR=|Δr|` bp (no intraday
     high/low in the export). Warm-up 65 obs→null, 60-obs mean floor 0.05 bp→
     null, windows in observations. Generic over any series id, cached.
  3. `908b030` **Vol endpoints.** `/api/volatility` (SeriesSummary-shaped rows
     + across-tenor curve) and `/api/series/vol:{tenor}` (history via the
     shared builder, unit `"ratio"`). Nulls stay null end to end.
  4. `04bce8f` **Vol tab, display-only.** unit `"ratio"` (2dp, no bp suffix),
     ratio-difference changes, `null`→"—", direction colour, idle relative-ATR
     curve. Placeholder + reserved-slot removed. Verified live (tab, hover
     preview, enlarged chart) — no console errors, domain guard passes.

### Session 13 (superseded head, kept for the pass ledger)

- Session 13 FINAL HEAD was `fadf7ce`; it landed 6 passes, one commit each:
  1. `affae6f` Tabs — sliding underline (`motion` `layoutId`), press-scale
     removed from tabs (§14: no transform press-feedback on alignment-sharing
     elements).
  2. `9b7993d` Heatmap/cells — `MiniBar` deleted; change columns = colored text;
     grids use shared background tint (`ui/tint.ts`).
  3. `ad16a42` Forwards — full 21×8 list, 6 pinned key forwards, start-filter,
     matrix toggle, and **real history** (per-date curve bootstrap).
  4. `f527e9e` Curve — idle right pane shows the tab's curve (`CurveView`);
     forwards render the **1YF ladder, x = start point**.
  5. `cc536fb` Shell — one continuous surface, page never scrolls, table body is
     the scroll container, rows h-12 + hairline. Shadow tokens removed.
  6. `fadf7ce` Correctness — 한 줄 never restates a column; quoted/interpolated
     dot; `sort-key` guard; notation + fly weighting documented.

### Gotchas — Session 14 (keep in mind)

- **Preview vs enlarged share `/api/series/{id}` — key by resolution.** Preview
  fetches `?res=preview` (~150 pts) under `["series", id, "preview"]`; the
  enlarged chart fetches `?res=full` under `["series", id, "full"]`. Same key
  for both would clobber the full series with the downsampled one.
- **`sort-key.test.ts` fixtures now carry the DTO fields** (`sortKey`, `quoted`,
  `oneLiner`) because those moved to the backend. `tsconfig` typechecks
  `guards/`, so a fixture missing a DTO field fails `pnpm build`, not just
  vitest.
- **Vol needs a third unit.** `unit: "ratio"` (2dp, no bp suffix, ratio-diff
  changes) lives alongside `%`/`bp`; `fmtLevel`/`fmtDelta` in `lib/format.ts`
  are the unit-aware formatters — use them, don't re-inline `toFixed`.
- **`relative_atr` is scale-invariant** (the ratio cancels units); `scale` only
  sets the denominator floor's unit (bp). Don't rely on `scale` to change the
  ratio.

### Gotchas — Session 13 (keep in mind)

- **`useMeasure` blank-pane trap:** a `useRef`+`useEffect` width hook left the
  measured width stuck at 0 (right pane rendered nothing). Fix = a **callback
  ref** that reads `clientWidth` synchronously on mount and attaches a
  ResizeObserver. This is the current `ui/useMeasure.ts`; don't regress it.
- **Sort key / "3M lands last":** a tenor added after the original node set
  (CD91 / 3M) had no sort key and sorted to the bottom. Every tenor now maps
  through `tenor_years()`; unknown → `inf` so a genuinely unmapped tenor sorts
  loudly. `guards/sort-key.test.ts` fails on any empty/non-finite key.
  (Session 14: this map moved to the backend `dataset.py`; the FE reads
  `sortKey` from the DTO.)
- Don't chain `pnpm vitest run | grep … && git commit` in one shell line — a
  non-matching grep breaks the `&&` chain and the commit silently doesn't run.
  Run the gate, then commit as a separate step.

---

## 7. Open / provisional (confirm or override with the owner)

- **MOOT since pass M — forward curve x-axis = start point** (1YF ladder across
  starts), not x = tenor. There is no per-tab idle curve any more, so the choice
  has no live subject; the reasoning stays in DESIGN only because it still rules
  out "one line per tenor" if a forward curve returns elsewhere.
- **OPEN (pass M) — `VolatilityPayload.curve` is served and rendered by
  nothing.** The vol tab's idle curve was its only consumer. Two options: keep
  it (a small dormant field, ~240 bytes, and the vol curve is the obvious first
  thing to want back) or remove it with `_vol_curve` in the backend, which is a
  `SCHEMA_VERSION` bump + a static-tree rebuild + golden updates. Kept for now
  — deliberately, not by oversight. **The precedent cuts both ways**: leaving a
  feed behind after deleting its consumer is what left a 150-point sparkline at
  92% of the payload (see pass L), so this should not sit open indefinitely.
- **CLOSED by deletion (pass L) — 한 줄 thresholds.** The ladder's cutoffs were
  an open implementer's call for several sessions; the column is gone, so the
  question is moot rather than answered. The last column now shows the 52-week
  high/low/mean, which has no threshold to tune. What replaced the open item:
  three choices recorded under DESIGN `## Provisional` → "Pass L" (the
  sub-label wording, the unshipped forward percentile, and the un-eyeballed
  drop threshold).
- **Volatility = relative ATR [Session 14, built; constants SETTLED final
  session].** `mean(ATR 5)/mean(ATR 60)`, close-only form `TR=|Δr|` bp (the
  export has no intraday high/low). Generic over any series id. Constants are no
  longer "to confirm": **warm-up = 61 observations** (the mathematical minimum,
  corrected from 65) and **denominator floor = 0.1 bp** on the 60-obs mean
  (raised from 0.05 to trim the divide-by-near-zero tail). Recorded in DESIGN
  `## Provisional`. Open only: whether the tab is *useful* (unreviewed by a user).
- **This session's features are CONFIRMED (Passes C–E), not provisional:**
  stale-data freshness, the change-log popover, the key-forward gauges, and the
  tint legend — all built, gated, and verified live. See DESIGN's "Settled
  decisions" for each.
- **Computation boundary (§16) is now enforced** — if you add a row field,
  declare it `dto|format` in `ROW_FIELD_SOURCE` or the guard fails. Anything
  that needs a calculation goes in the backend.
- **CLOSED by the stability session, do not carry forward as open:** the
  key-forward level/change header collision (resolved earlier by removal,
  re-verified against the code in Pass F) and blue's double duty (re-checked
  at its worst case in Pass F, strokes stay blue, trigger retired).
- **Still open, and NOT exercisable from a headless session** — these need a
  real screen and stay with the owner: the real-narrow-window eyeball
  (carried), frame rate, the single-column narrow layout, and OS-level
  `prefers-reduced-motion`. Pass E could not measure true first paint or
  frames-to-pixels for the same reason (occluded renderer); it measured
  time-to-DOM-committed instead and says so.
- **No longer out of scope, and now decided:** the stability session left
  deployment open on purpose. The static conversion settled it — Vercel, no
  runtime backend, data committed as JSON. See DESIGN §21.
- **Open for the owner, in order:** create the git remote; set the Vercel
  project's Root Directory to `frontend`; work `docs/DEPLOY_CHECKLIST.md`. The
  case-sensitivity sweep in §1 of that file is the one that matters — Windows
  builds it, Linux serves it, and a case mismatch resolves locally while 404ing
  in production for perhaps one instrument out of 196.

---

## 8. Working agreement (owner standing rules)

- Completion claims need **commit hashes** + `git show --stat` evidence; a
  false "closeout" has happened before, so verify report claims against the repo.
- Memory / record instructions are authoritative **only when typed directly by
  the owner**, not relayed inside a session report.
- Run passes end-to-end without stopping to ask; **commit at each pass
  boundary with gates green, mirror after each commit**, patch `docs/DESIGN.md`
  as you go, and record uncovered choices under DESIGN's `## Provisional`.
