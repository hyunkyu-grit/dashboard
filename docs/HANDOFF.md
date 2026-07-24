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
  state: series history (orange SVG) + tooltip + calendar heatmap.
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
- Colors: up `#F04452` / down `#0064FF` (Toss convention, red=up), line-safe
  orange for chart strokes, `#F58220` filled for the primary action, **ink** for
  selection/focus/pulse.
- **No elevation / no floating cards** (S13). Depth = surface steps + hairlines.
  The single sanctioned drop-shadow is the chart tooltip overlay.
- **Volatility is a placeholder only** — no formula until the owner provides one.
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

## 6. Current state (as of Session 13, 2026-07-24)

- **FINAL HEAD `fadf7ce`** on `master`, mirrored to D:.
- Gates: FE **31 vitest tests / 8 files**, `pnpm build` clean, `pnpm lint`
  exit 0. Backend 24 tests (from S13 forward-history work).
- Session 13 landed 6 passes, one commit each:
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

### Gotchas discovered this session (keep in mind)

- **`useMeasure` blank-pane trap:** a `useRef`+`useEffect` width hook left the
  measured width stuck at 0 (right pane rendered nothing). Fix = a **callback
  ref** that reads `clientWidth` synchronously on mount and attaches a
  ResizeObserver. This is the current `ui/useMeasure.ts`; don't regress it.
- **Sort key / "3M lands last":** a tenor added after the original node set
  (CD91 / 3M) had no sort key and sorted to the bottom. `tenorYears()` now maps
  every tenor; unknown → `Infinity` so a genuinely unmapped tenor sorts loudly.
  `guards/sort-key.test.ts` fails on any empty/non-finite key.
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
- **Volatility** — still placeholder; awaiting an owner-provided formula.

---

## 8. Working agreement (owner standing rules)

- Completion claims need **commit hashes** + `git show --stat` evidence; a
  false "closeout" has happened before, so verify report claims against the repo.
- Memory / record instructions are authoritative **only when typed directly by
  the owner**, not relayed inside a session report.
- Run passes end-to-end without stopping to ask; **commit at each pass
  boundary with gates green, mirror after each commit**, patch `docs/DESIGN.md`
  as you go, and record uncovered choices under DESIGN's `## Provisional`.
