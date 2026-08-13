# Sauron v2 on CDS — pass 3: headless table inside CDS chrome

Session date: 2026-08-13. Continues `REPORT_v2.md` and `REPORT_v2_pass2.md`, which stay
authoritative for passes 1–2.

## Pre-flight

```
$ git -C sauron-v2 status --short      (empty — clean)
$ git -C sauron-v2 log --oneline -1
bb481c8 REPORT_v2_pass2 — 스케일 판정과 차트 판정
```

Clean at `bb481c8`, as expected.

**braveworld baseline recorded for this session's closing check** — it moved again
between sessions, as anticipated:

```
$ git -C braveworld status
On branch main
Your branch is ahead of 'origin/main' by 3 commits.
Changes not staged for commit:
	modified:   data/irsdata.xlsx
no changes added to commit

$ git -C braveworld log --oneline -1
47122287 인트로 커튼 — 시작할 때 커브 아홉 장이 피어난다
```

The concurrent session **committed** its IntroCurtain work (ahead 2 → 3, HEAD `f5de1fa7`
→ `47122287`), and the tree is back to a single dirty file. **This is the baseline. The
closing check compares against it, not against pass 2's.**

Ports: `:8200` answered (`asof=2026-08-12`), `:8100` held by braveworld's pid 5800,
`:3100` free, `:3200` free (nothing to kill — checked by port, not by name).

---

## Dependency discrepancy — reported, not worked around

`pnpm add @tanstack/react-table` resolved **9.1.2**, and v9 is not the API this prompt
describes. Measured from the installed package, not from recollection:

- `@tanstack/react-table@9.1.2` exports `useTable`, `createTableHook`, `flexRender`,
  `ReactTable` — **no `useReactTable`, no `getCoreRowModel`, no `getSortedRowModel`.**
- `@tanstack/table-core@9.1.2` has `tableFeatures` / `rowSortingFeature` — a feature
  architecture. The string `sortingFn` does not appear in its `index.d.ts` at all.

The prompt's D1.1 says "register it as the column's `sortingFn`". That prop exists in
**v8**, not v9.

**Call made:** pinned `@tanstack/react-table@^8.21.3`, whose API is exactly the one the
prompt describes — verified from the installed files:

```
@tanstack/react-table@8.21.3   peers: react >=16.8, react-dom >=16.8
  useReactTable, flexRender, export * from '@tanstack/table-core'
@tanstack/table-core@8.21.3
  getCoreRowModel, getSortedRowModel, createColumnHelper
  ColumnDef.sortingFn?: SortingFnOption<TData>
@tanstack/react-virtual@3.14.9  peers: react ^16.8 || ^17 || ^18 || ^19   ← React 19 explicit
```

React 19.1.2 satisfies both. Selecting the version whose API the prompt specifies is not
synthesising a replacement; recorded in `## Provisional`.

---

## Pass D0 — the virtualization / table-element conflict

**Written before any implementation code**, per the prompt. Evidence is a rendered probe
against the running `/scale` route plus the installed packages — no recollection.

### The probe

Into a live CDS `Table` at 200 rows, a virtualizer-shaped spacer row was injected at the
top of `<tbody>` (`<tr><td colspan=6 style="height:4000px">`), and widths were measured
before and after.

```
tableLayout            fixed
<colgroup> <col> count 6

header widths before   [109.9, 106.8, 71.3, 71.3, 71.3, 1440.4]
body   widths before   [109.9, 106.8, 71.3, 71.3, 71.3, 1440.4]
header widths after    [109.9, 106.8, 71.3, 71.3, 71.3, 1440.4]
body   widths after    [109.9, 106.8, 71.3, 71.3, 71.3, 1440.4]

widthsHeldUnderSpacer  true
headerMatchesBody      true
thead position         sticky
scroll container       DIV.tableContainerCss-…  overflow-y: auto
```

### 1. Can the virtualizer drive real `<tr>` inside `<tbody>`?

**Yes, via spacer rows, and the `<colgroup>` is unaffected.** Under
`table-layout: fixed` the browser takes each column's width from the `<colgroup>` and
applies it to every cell in the column. A spacer row is a row like any other; it consumes
no width authority. Measured: a 4,000 px spacer changed nothing — widths held to the
tenth of a pixel, header and body still identical.

Sticky behaviour is likewise unaffected: `<thead>` is already `position: sticky` and the
spacer lives in `<tbody>`.

The scroll container is CDS's own `DIV.tableContainerCss-*` (`overflow-y: auto`). CDS
does not hand out a ref to it — the same gap as `TableRow` — but it is reachable by
walking up from the `<table>` to the first ancestor with a scrolling overflow. That is the
pattern already in use for rows, so it is not a new kind of dependency.

**Translate-based windowing was rejected**: `transform` on a `<tr>` moves the row but does
not create scroll height, so the container would have no distance to scroll. Spacer rows
give the container real height. It also keeps `transform` free for the FLIP reorder, which
already owns that property on the same elements — two mechanisms writing one property is a
conflict waiting to happen.

### 2. Is the `div` + `role="table"` + CSS-grid alternative needed?

**No, and it costs more than it buys.** It would replace the `<colgroup>` with a
`grid-template-columns` string. One declaration *can* feed both header and body (a custom
property on the container), so it is not automatically the drift defect returning — but it
is only single-source by convention, whereas `<colgroup>` is single-source **structurally**:
there is exactly one element that may declare a column width, and no row can override it.

Since the probe shows the real-table route works, taking the div route would trade a
structural guarantee for a conventional one and gain nothing.

### 3. Which choice keeps `data-*`, `tabIndex`, `role`, `aria-selected` on the row?

Both would, but the real-table route keeps them **on the elements already proven to carry
them**: `guards/cds-tablerow-dom.test.tsx` measured CDS `TableRow` forwarding all four to
the `<tr>`. Event delegation and focus management continue against the same contract with
no new assumptions.

### Choice, and its cost

**Real `<table>`, real `<tr>`, spacer rows above and below the window.** The `<colgroup>`
stays the single source of width truth and the colgroup guard stays meaningful as written.

The costs, stated plainly:

1. **Row height must be a known constant.** Spacer heights are computed from it. This is
   D1.2's `ROW_H` — the product wanted one anyway, but virtualization makes it mandatory
   rather than a preference.
2. **The scroll element is found by DOM query, not by ref**, because CDS does not expose
   it. Same class of workaround already accepted for rows, and it fails loudly (the
   virtualizer gets no scroll element and renders nothing) rather than silently.
3. **Variable row heights are out.** Any future two-line row would need measurement-based
   virtualization, which reintroduces exactly this question.

---

## Status — read this before anything else

| Pass | State |
|---|---|
| Pre-flight | done |
| Dependency check | done — **v9/v8 discrepancy found and resolved** |
| D0 — diagnosis and choice | **done** (above) |
| D1 — implement | **PARTIAL, and the screen is currently wrong** |
| D2 — re-measure | **not reached** |
| D3 — guard reconciliation | **not reached** |
| D4 — visual pass | **not reached** (gated on D0–D3 green; they are not) |

Commit: `a4cc568`. The gates are green (build 0, vitest 73 passed, lint 0) but **green
gates do not mean the feature works** — at 1,000 rows the table renders 9 rows into a
48,044 px container. Nothing below claims otherwise.

## What D1 achieved, measured

| | before (pass 2) | after (`a4cc568`) |
|---|---|---|
| table subtree nodes @ 1,000 rows | 43,080 | **469** |
| rendered `<tr data-sr-row>` | 1,000 | 9 |
| row height | 52.58 px | **47.99 px** (= `ROW_H` 48) |
| header vs body column widths | identical | **identical** — `[109.9, 106.8, 71.3, 71.3, 71.3, …]` |

The colgroup contract survived the branch, which was D0's whole reason for choosing the
real-`<table>` route.

**`ROW_H` landed by tuning, not by accident.** An inline `height` on `<tr>` is a
*minimum*: the 48 px was present in the DOM and the row still rendered 52.58, because
CDS's cell content is taller. The height comes from the cell's inner padding
(`--space-1`, 8 px top and bottom), so the theme's space scale was tuned 8 → 6. Measured
result 47.99.

**The comparator was not reimplemented.** `manualSorting: true`; TanStack owns sorting
*state* and the header affordance only. A registered `sortingFn` cannot express the
contract — "a row with no print keeps tenor order **behind** the ones that have one, in
both directions" — because TanStack inverts a `sortingFn` wholesale for the descending
pass, floating the no-print rows to the top. Its `sortUndefined` escape hatch keys on
`undefined`; these values are `null`.

**Focus survival** is implemented: the focused row's identity is remembered, the
container holds focus while that row is unmounted, and focus returns to the row when it
re-mounts.

## What blocks D1, precisely

**The scroll container is never height-constrained, so the virtualizer has no viewport.**

- CDS `Table`'s `maxHeight` prop computes to `max-height: none` on the scroll container
  (measured on the live DOM).
- Switching to the documented `height` prop did not constrain it either:
  `clientHeight === scrollHeight === 48044`.
- With no constrained viewport the virtualizer windows to ~9 rows while the container
  keeps full document height — the node count falls for the wrong reason and the screen
  is wrong.

**The next session's first question is who owns the container's height**, not whether
virtualization works. Everything else in D1 is in place and measured.

Reported rather than worked around, per the standing rule. No replacement API was
synthesised.

## Verdict

**Not available.** The headless branch is not far enough along to say whether it solved
the scale problem. A2/A2b/A3/A5 were not re-measured, so the per-row-instantiation
diagnosis from pass 2 is **neither confirmed nor refuted** by this session. The 43,080 →
469 node drop is consistent with it but is not the measurement that tests it, and
inferring a verdict from an adjacent number is exactly what the prompt forbids.

## Owner decisions

1. **`ROW_H` = 48 px**, in `src/table/rowHeight.ts`, and it is now a real dial: one edit
   changes density and nothing else moves. The theme space scale is tuned to land on it
   (`--space-1: 8 → 6`).
2. **`@tanstack/react-table` pinned to `^8.21.3`**, not the `9.1.2` that `pnpm add`
   resolves. v9 is a different architecture with no `useReactTable`, no
   `getCoreRowModel`, and no `sortingFn`. If v9 is wanted later it is a rewrite of this
   layer, not an upgrade.
3. **D0's choice** — real `<table>` with spacer rows — and its three costs: row height
   must stay constant, the scroll element is found by DOM query, variable row heights are
   out.
4. The D4 font table (old vs new ladder thresholds) **does not exist**; D4 was not run.

## How to look at it

```
cd sauron-v2
pnpm build && pnpm start          # :3200
```

- `http://localhost:3200/` — the product screen.
- `http://localhost:3200/scale?n=1000` — the harness. **This currently renders 9 rows
  into a 48,044 px container.** That is the open bug, not a rendering artefact.
- `http://localhost:3200/chart?c=b&n=520` — pass 2's chart, unchanged.

Outstanding real-screen items, both still outstanding: **chart drag-pan** (pass 2) and
**everything in D4**, which was not run.

## Deferred (aesthetic)

Carried forward unchanged from pass 2 — CDS row height and 16 px body type read airier
than v1; screener still placeholder `Button`s, not chips; sort glyphs tight against the
header label; 52주 shows a bare percentage where v1 has a position track; no hairline or
geometry work; tint reads stronger on CDS white; chart harness unstyled; chart date axis
Korean by locale accident; zoom has no visible affordance.

New this pass:

- **The space scale was tuned for one number.** `--space-1: 6` was chosen to make rows
  48 px; it also moves every other 8 px gap in the app. Nothing was checked for that
  side effect, because D4 was not reached.
- **Spacer rows are `aria-hidden` but still real rows.** Whether a screen reader's row
  count should report 1,000 or 9 is undecided and unexamined.
- **The 9-row render looks like a short table, not a broken one** — which is exactly why
  it is called out in `## How to look at it` rather than left to be discovered.

## Provisional

1. **D0's choice**: real `<table>` + spacer rows over `div`/grid. Reasoning and probe
   above; the deciding factor is that `<colgroup>` is single-source structurally where a
   grid template is single-source only by convention.
2. **Pinned `@tanstack/react-table@^8.21.3`** after v9 resolved by default. Selecting the
   version whose API the prompt specifies is not synthesising a replacement.
3. **`manualSorting` instead of a registered `sortingFn`**, to keep the null-ordering
   contract. The comparator is unchanged; only who calls it moved.
4. **Space scale tuned 8 → 6** to land `ROW_H`, rather than setting a height that CDS
   would override upward.
5. **Committed a state whose screen is wrong**, clearly labelled in the commit message
   and here. The alternative — reverting to pass 2's table — would have discarded the
   D0 probe evidence and the working parts along with the bug.
6. **Stopped at D1 rather than pushing into D2–D4.** D2's measurements would have been
   taken against a table that is not rendering correctly, and D4 is explicitly gated on
   D0–D3 being green.

## Files touched outside the commits

None. Everything is in `a4cc568`.

---

## braveworld integrity check

Against the baseline recorded in pre-flight:

```
baseline  47122287 인트로 커튼 — 시작할 때 커브 아홉 장이 피어난다
          ahead 3, dirty: data/irsdata.xlsx

closing   47122287 인트로 커튼 — 시작할 때 커브 아홉 장이 피어난다
          ahead 3, dirty: data/irsdata.xlsx
```

**Identical.** No commit was made in that tree by this session and no byte was written to
it. This session's only interaction with it was the two `git status` / `git log` reads
above. The tree did not move during the session; the IntroCurtain work that changed it
was committed by the concurrent session *before* this one started, which is why the
baseline already contained it.
