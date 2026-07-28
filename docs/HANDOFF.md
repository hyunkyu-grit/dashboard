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
- vitest has **no `@/` path alias**. Guard tests in `guards/` import with
  **relative paths** (`../src/ui/rows`), not `@/ui/rows`. (A type-only `@/`
  import can appear to "work" because it's erased — a value import will fail.)
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
  unified `Row[]`; `oneLiner()` (the 한 줄), `tenorYears()`, `traderName()`,
  `QUOTED` set, `sortKey`. Start here for any list/label/sort change.
- `ui/CurveView.tsx` — idle right-pane curve, dispatched by tab.
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

## 6. Current state (as of the motion session — Passes A–F, 2026-07-28)

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

- **Forward curve x-axis = start point** (1YF ladder across starts), not
  x = tenor. Chosen; recorded in DESIGN's idle-curve note.
- **한 줄 thresholds:** extreme-band percentile at `pct ≥ 90` / `≤ 10`, and
  "shape" = a sign flip between adjacent bases (→ `주간/월중 되돌림`). The
  principle is owner-set (never restate a visible column); the exact cutoffs
  were the implementer's call.
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

---

## 8. Working agreement (owner standing rules)

- Completion claims need **commit hashes** + `git show --stat` evidence; a
  false "closeout" has happened before, so verify report claims against the repo.
- Memory / record instructions are authoritative **only when typed directly by
  the owner**, not relayed inside a session report.
- Run passes end-to-end without stopping to ask; **commit at each pass
  boundary with gates green, mirror after each commit**, patch `docs/DESIGN.md`
  as you go, and record uncovered choices under DESIGN's `## Provisional`.
