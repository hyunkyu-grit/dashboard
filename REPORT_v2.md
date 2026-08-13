# Sauron v2 on CDS — spike report

Session date: 2026-08-13. Node `v24.18.0`, pnpm `11.10.0`.

## Status

| Pass | State | Evidence |
|---|---|---|
| Pre-flight | done, **stopped once as designed** | §0 ahead-of-origin; owner ruled proceed |
| V0 — isolation + own backend | **green** | `c7b95ef`, `3b5976c` |
| V1 — token bridge | **green** | `dbfbaa9` |
| V2 — table on CDS `Table` | **green** | `3ec9d1c` |
| V3 — chart candidates | **NOT COMPLETE** — API verified, candidates not built | see below |
| V4 — shell and chrome | **not started** (gated on V3) | — |

**V3 and V4 are not done and nothing about them is claimed.** What V3 evidence
exists is recorded below as verified API facts, not as a verdict. The session ran
out of room after V2; the honest handoff is that the spike answered its **first**
question and not its second.

---

## Pre-flight

```
$ git -C braveworld status
On branch main
Your branch is ahead of 'origin/main' by 2 commits.
Changes not staged for commit:
	modified:   data/irsdata.xlsx

$ git -C braveworld log --oneline -1
f5de1fa7 선 · 주봉 · 월봉 — 캔들을 팝업 밖으로, 전역 모드 하나로
```

Ahead by 2 → **stopped and reported**, per §0. The two commits are `f5de1fa7` and
`b5f8b56e`.

The stop's stated reason ("an unpushed tree has no recovery point") turned out not
to hold: the mirror already had HEAD.

```
HEAD        = f5de1fa74de475d801128b113c0a8060f434129f
mirror/main = f5de1fa74de475d801128b113c0a8060f434129f   ← identical
origin/main = 2bb3f345c894f3679974bcd0a213f1db740539f6   ← 2 behind
```

Owner ruled proceed. Recorded under Provisional.

Ports at start: `:3100` free, `:3200` free, `:8200` free, `:8100` LISTEN (pid 5800,
braveworld's own backend — left alone all session). No `gate.ps1`, no dev server.

---

## V0 — isolation proof and v2's own backend

`sauron-v2` is a sibling of `braveworld` under `Projects_AS`. Scaffolded from
`coinbase/cds/templates/next-app`; every pinned version verified installed:

```
@coinbase/cds-common@9.15.0  @coinbase/cds-icons@5.21.0
@coinbase/cds-illustrations@4.48.0  @coinbase/cds-web@9.15.0
framer-motion@10.18.0  next@15.4.8  react@19.1.2
```

### The market data is not one workbook

The prompt's V0.2 says "the market-data file it reads". There isn't one.

| Source | Role |
|---|---|
| **MySQL** `sim_portfolio.mkt_irs_close` @ `miraebond2.kro.kr:4004` | primary since 2026-08-07 |
| `data/irsdata.xlsx` (776,519 B) | fallback workbook |
| `data/bokbaserate.xlsx` (640,795 B) | BOK base rate |
| `data/` incl. `AS_data.zip` (23.9 MB), `reference/` | the simulation's `DATA_DIR` |

**Consequence:** the MySQL database is a shared external dependency, read-only, and
is NOT copied. v2 and v1 read the same live rows. `BACKEND.md` therefore scopes the
divergence sentence to code: *the code forks, the data does not.*

### The three v2-local edits

Each carries a `V2-LOCAL EDIT n of 3` marker in place.

1. `backend/app/main.py`, the `CORSMiddleware` block — added `http://localhost:3200`
   and `http://127.0.0.1:3200`. v1 allowed `:3100` only, so v2 was blocked at the
   preflight. Verified: preflight from `:3200` returns 200 with
   `allow-origin: http://localhost:3200`.
2. `backend/requirements.txt` — added `sqlalchemy>=2.0`, `pymysql>=1.1`. See finding
   below.
3. `backend/serve.ps1` — new launcher, binds `:8200`. The port was never in the
   source; v1 passes it from `C:\Users\infomax\.sauron\start-backend.ps1`, outside
   the repo.

**The cache-dir edit was not needed.** `app/cache.py` derives it as
`Path(__file__).resolve().parent.parent / ".cache"`, which in this copy resolves to
`sauron-v2/backend/.cache`. `POLICY_PATH` and `irs_pricer.config.DATA_DIR` are
`__file__`-relative too. Verified at runtime: the log prints
`simulation data dir: …\sauron-v2\data`.

### FINDING — `requirements.txt` is incomplete in braveworld

`app/mysqldb.py` imports `sqlalchemy` at module scope and builds a
`mysql+pymysql://` URL. Neither `sqlalchemy` nor `pymysql` is listed. v1 runs
because the machine already has both; **a clean host dies on the first import.**

The file's own header documents having been incomplete once before (numpy, scipy,
holidays, python-dateutil) — the same defect recurred when the SQL source landed.
**Not fixed in braveworld** (write ban). Fixed in v2's copy only.

### FINDING — DB credentials have hardcoded defaults in source

`app/mysqldb.py` reads `BW_MYSQL_HOST/_PORT/_USER/_PASSWORD/_DB` from the
environment **with committed fallback values**. That carries into v2's copy. Not
touched this session; flagged because a spike repo is one more place the values now
sit.

### V0 gate

`:8200` answers, all from v2's copy:

```
/api/health         200      427 B
/api/wall/summary   200   35,340 B   asof=2026-08-12, outrights 15, derived 84
/api/forwards       200   43,199 B
/api/series/3Y      200  103,706 B
/api/instruments    200    5,012 B
```

`pnpm build` exit 0. `pnpm dev` on `:3200` rendered the template screen.

---

## V1 — token bridge

One `ThemeProvider` at the app root (`src/app/providers.tsx`), never nested.
`sauronTheme` is a thin derivation of CDS `defaultTheme` — only `id` differs,
because this spike has one independent variable.

Direction hues live in `src/theme/direction.css`, the only file in v2 permitted to
hold a hex. `fgPositive` / `fgNegative` have **zero references** (guarded): CDS
names green positive and red negative, which is inverted for a KRW rates desk.

CDS emits its palette as **inline CSS variables** with no class or attribute to key
off, so the dark pair hangs off `data-sr-scheme`, an attribute this app sets.

### FINDING — two CDS surfaces cannot hold the frozen hues

Measured, both schemes, floor 4.5:1:

```
light · up   #d92d3c on bgAlternate / bgSecondary rgb(238,240,243) = 4.19:1   FAIL
light · down #0064ff on the same surfaces                          = 4.31:1   FAIL
```

`bgAlternate` and `bgSecondary` are the same value in CDS light. Dark clears
everywhere. Retuning a hue is forbidden (V1.3), so **the surface went instead**:
signed numbers live on `bg` / `bgElevation1` / `bgElevation2` only.

**This is a real constraint on V2 and beyond: v2 may not zebra-stripe rows with
`bgAlternate`.** v1 stripes nothing and separates rows with hairlines, so nothing
v1 had is lost. The two rejected surfaces stay measured (`REJECTED_FOR_DIRECTION`)
so a future CDS change arrives as a red test rather than as silence.

### The frozen pair is two pairs

The prompt named one pair; v1's archive has a light pair **and** a dark pair
(`#f16e77` / `#4c93ff`), because the light pair measures ~3.4:1 on a dark tile.
Both were carried. Completing the archive, not retuning it — recorded under
Provisional.

---

## V2 — instrument table on CDS `Table`

Copied and adapted: the row view-model builder, column definitions and visibility
ladder, screener predicates, glossary strings. Type dependencies followed
(`cells`, `format`, `api`, `staticPaths`, `freshness`). One behavioural change:
`staticPaths.API_BASE` now defaults to `http://127.0.0.1:8200` instead of `""`.

### FINDING — CDS `TableRow` does not accept a `ref`

It is a memo'd function component with no `forwardRef`. CDS's own
`useTableRowListener(ref, handler)` requires a `TableRowRef`
(`MutableRefObject<HTMLTableRowElement>`), so **the hook cannot be attached to the
component it is named for through any documented API.**

This is filed as a CDS API finding, not a workaround note: a table primitive that
cannot return its element constrains what can be built on it, and that is evidence
for the verdict.

**[OWNER ruling]** row interaction moved to **event delegation**: one `keydown` and
one `click` on the container, resolving the row via
`closest('tr[data-sr-row]')`. At 1,000 rows one delegated listener beats 1,000
registrations, so this is the better architecture on its own terms, not a patch.
CDS `TableRow` was not forked, wrapped or patched.

FLIP reorder is solved the same way — container scope,
`querySelectorAll('tr[data-sr-row]')`, with snapshot, culling and transform all in
the container.

### MEASURED — what `TableRow` does forward

`guards/cds-tablerow-dom.test.tsx`, rendered in jsdom:

| prop | reaches the `<tr>` |
|---|---|
| `data-*` | **yes** — delegation is possible |
| `tabIndex` | **yes** — focus management stays on the row, not the container |
| `role` | yes |
| `aria-selected` | yes |
| `ref` | **no** |

So the report does *not* need to move focus management to the container.

### The colgroup, measured

Widths moved to a single `<colgroup>` under `tableLayout="fixed"`. v1 hands the
same `grid-template-columns` string to the header and to every body row, so the two
"cannot" drift — but the tracks are sized in `ch`, and `ch` is the advance of `0`
**in each element's own font**. A `font-medium` header resolves the same `44ch`
differently from a `font-normal` body cell; this repo has shipped that defect once.

`<col>` removes the failure mode instead of re-fixing it: one element declares the
width, in px, and `table-layout: fixed` applies it to the whole column. There is no
second resolution to disagree with. Measured on the live render:

```
header cell widths : 109.9  106.8  71.3  71.3  71.3  1919
body   cell widths : 109.9  106.8  71.3  71.3  71.3  1919
```

Identical to the tenth of a pixel. Widths are still derived from format maxima
(`colPx()`); only where the number is spent changed.

### Sorting

CDS `useSort` **does not exist in 9.15.0** — the instruction not to use it was moot,
but the comparator is kept and the reason is written down so a later session does
not "simplify" it. The sort key is a vector compared lexicographically, and an
unmapped series sorts to `Infinity` **and is enumerable** (`unmappedRows()`), which
is what "loud" means. An empty vector would sort *first* and put a broken row in the
most valuable slot on the screen.

`useSortableCell` supplies the header affordance only: click target, sort glyph,
`aria-sort`.

### Guards added

`table-contract.test.ts` — sort key (unmapped → `Infinity`, loud, detectable),
column ladder (sorted column always keeps a slot; drops from the tail; the position
track never outlives its numbers), colgroup single source, sticky-header opacity in
both schemes. Plus `cds-tablerow-dom.test.tsx`.

### V2 gate

`pnpm build` exit 0 · `pnpm vitest run` 61 passed, exit 0 · `pnpm lint` exit 0.

---

## V3 — what was verified before the session ran out

No candidate was built. These are API facts, gathered, not a verdict:

- `CartesianChart` ships **inside `@coinbase/cds-web` 9.15.0** at
  `./visualizations/chart` — it is *not* the separate `@coinbase/cds-web-visualization`
  package. (That package exists separately and peer-depends on `cds-web`,
  `cds-common`, `cds-utils`, `cds-lottie-files` and `framer-motion ^10`.)
- `useCartesianChartContext()` exposes `getXScale()`, `getYScale()` and
  `drawingArea` — the escape-hatch pattern the prompt described **is** available.
- **No candle layer and no time scale exist in CDS** (grep over the shipped `dts`
  returns nothing for either). Series data is `Array<[number, number] | null>`,
  i.e. index/value pairs.

That last point bears directly on threshold #1 (calendar slots vs compressed index
slots) and should be the first thing the next session measures.

---

## Owner decisions

### V2.7 density — measured, not chosen

| | row height |
|---|---|
| v1 reference (`ROW_H`) | **48.00 px** |
| CDS default | **52.58 px** (+4.6) |
| CDS `compact` | **36.60 px** (−11.4) |
| dense space scale + `compact` | **28.59 px** (−19.4; 15 rows = 429 px) |

`sauronDenseTheme` exists so the third number is a real render rather than an
extrapolation. **It is not selected.** The committed state is neutral: default
theme, no `compact`.

### V3 verdict

**Not available.** No candidate was built; nothing is claimed either way.

---

## Deferred (aesthetic)

- **CDS default row height is 4.6px taller than v1's**, and the type scale under it
  is CDS's (body 16px vs v1's 13px). The table reads noticeably airier than v1. Not
  touched: density and numeric type steps are both explicitly deferred (§2).
- **The screener is rendered as `Button`s, not chips.** `chips` is a V4 component
  and V4 was not reached; the buttons are a placeholder shape, not a design choice.
- **Sort glyphs sit tight against the header label.** CDS places them via the
  `end` slot with its own spacing; it looks cramped at caption size.
- **The 52주 column currently shows a bare percentage.** v1 has a position track
  (a low→high slider with a marker). The ladder rung for it is ported and measured,
  the graphic is not drawn.
- **No hairline/geometry work at all.** v2 wears CDS `variant="ruled"` + `bordered`
  as they ship. v1's axis rule (horizontal = hairline, vertical = round) has not
  been applied, and §4's "no vertical rules" has not been re-verified against what
  CDS actually paints.
- **Tint ramp reads stronger on CDS's white than on v1's `#f8f8f8`.** Same alphas,
  lighter ground.

## Provisional

Every call made without asking:

1. **Proceeded past the ahead-of-origin stop** on the owner's instruction, after
   reporting that the mirror already held HEAD.
2. **Node `v24.18.0` instead of the pinned `^22`**, owner-approved. `engines` was
   widened to `>=22` so pnpm does not fight it.
3. **Read braveworld during V2.** §0 permits reads only in V0; V2.1 orders four
   artifacts copied. The binding constraint is the *write* ban ("must end
   byte-identical"), which reading cannot violate, and V2.1 is the later, more
   specific instruction. Read exactly the four named artifacts, their type
   dependencies, and `ROW_H` / the reorder implementation that V2.8 names.
4. **`color-source` strips comments but NOT string literals.** The prompt asked for
   both. In a `.ts` file a colour *is* a string literal, so stripping them would
   blind the guard to what it exists to catch. Purpose kept, letter not.
5. **Carried v1's dark direction pair** (`#f16e77` / `#4c93ff`) alongside the named
   light pair. Completing the archive; without it the contrast guard cannot pass in
   dark at all.
6. **`api.ts`, `staticPaths.ts`, `freshness.ts`, `cells.ts`, `format.ts` copied**
   beyond the four named artifacts — they are type dependencies without which the
   four do not compile.
7. **`App.tsx` deleted** from the template (dead duplicate of `page.tsx` with broken
   imports) and `outputFileTracingRoot` pinned in `next.config.ts` (a stray
   `package-lock.json` in the home directory made Next pick `C:\Users\infomax` as
   the workspace root).
8. **`vitest` inlines `@coinbase/cds-*`** — CDS ships ESM with extensionless
   relative imports that node's resolver rejects.
9. **Killed an orphan `node` holding `:3200`** (a stopped dev server that did not
   die with its task — the known trap). `:8100` and `:8200` untouched.

## Files touched outside the commits

None in `sauron-v2` — everything is committed.

Outside it: nothing was written anywhere. The measurement toggles (dense theme,
`compact`) were applied and reverted before the V2 gate, and the reverted state is
what `3ec9d1c` contains.

---

## braveworld integrity check

```
$ git -C braveworld status
On branch main
Your branch is ahead of 'origin/main' by 2 commits.
Changes not staged for commit:
	modified:   data/irsdata.xlsx

no changes added to commit

$ git -C braveworld log -1
f5de1fa74de475d801128b113c0a8060f434129f 선 · 주봉 · 월봉 — 캔들을 팝업 밖으로, 전역 모드 하나로
```

Identical to pre-flight: same HEAD, same ahead-2, same single dirty file
(`data/irsdata.xlsx`, 776,519 B — the bake's normal state on a pure-SQL day, dirty
before this session started). **No commit was made in that tree and no byte was
written to it.**
