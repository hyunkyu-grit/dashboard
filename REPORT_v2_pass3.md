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

## Status

| Pass | State | Commit |
|---|---|---|
| Pre-flight | done | — |
| Dependency check | done — **v9/v8 discrepancy found and resolved** | `a4cc568` |
| D0 — diagnosis and choice | **green** | `a4cc568` |
| D1 — implement | **green** | `a4cc568` → `fc46feb` |
| D2 — re-measure | **green** | `fc46feb` |
| D3 — guard reconciliation | **green** | `fc46feb` |
| D4 — visual pass | **green** (gate satisfied: D0–D3 all green) | `b814fe2` |

Gates at every boundary, three separate commands judged by exit code. Final state:
**build 0 · vitest 80 passed · lint 0**.

`a4cc568` was committed mid-D1 with the screen still wrong and said so; `fc46feb` is
where D1 actually landed. Both are kept rather than squashed — the first carries the
D0 probe evidence.

## What blocked D1, and what it was

**CDS `Table`'s `height` / `maxHeight` types lie about what they accept.**

```js
// @coinbase/cds-web/esm/tables/Table.js
'--table-height':    `${height}px`,
'--table-maxHeight': `${maxHeight}px`
```

The props are typed `React.CSSProperties['height' | 'maxHeight']`, so `'70vh'`
type-checks — and produces `70vhpx`, an invalid value, which resolves to `none`. The
scroll container stayed unconstrained, the virtualizer had no viewport, and it
windowed against the whole document. **It must be a number of pixels.**

Found by reading the shipped implementation after the rendered probe showed
`max-height: none`. Reported, not worked around.

## D2 — re-measured against the same thresholds

| # | pass 2 (CDS `Table`) | pass 3 (headless + virtual) | threshold |
|---|---|---|---|
| A1 @ 200 | 8,680 nodes | **1,028** | report shape |
| A1 @ 500 | 21,580 | **1,028** | |
| A1 @ 1,000 | 43,080 | **1,028** | |
| A1 @ 2,000 | 86,080 | **1,028** | |
| A1 @ 5,000 | — | **1,028** | |
| A2 @ 1,000 | 2,498 ms | **26.3 ms** | ≤ 150 ms — pass |
| A2b @ 2,000 | — | **24.1 ms** | report |
| A2b @ 5,000 | — | **53.8 ms** | report |
| A3 @ 1,000 | 1,000 rows | **0 rows** | ≤ 200 — pass |
| A4 `/scale` | 194 kB | **214 kB** | report |
| A4 `/` | 203 kB | **222 kB** | report |
| A5 mid-scroll | 43,080 nodes, nothing recycled | **1,374 nodes, recycled** | report |

**A1's shape is the answer, not its value.** Flat — identical at 200 and at 5,000
rows — so node count is bound by the viewport, not by the row count. That is the
property that was missing.

**A2 is not perfectly flat and is not reported as such.** 26.3 / 24.1 / 53.8 ms at
1,000 / 2,000 / 5,000 rows: 5× the rows costs about 2× the time. The residual is the
comparator's O(n log n) over the full set plus row-model construction — real per-row
work that is not component instantiation.

**A5**: 1,374 nodes mid-scroll, 985 at the end, and the first row in the DOM is
`SYN414-…` rather than the top row. Rows are genuinely recycled.

### The pass-2 diagnosis is CONFIRMED

Per-row cost fell from ~2.5 ms to ~0.026 ms at 1,000 rows — 95×. **The comparator
still sorts all 1,000 rows on every click**; only rendering was virtualized. Had the
cost been comparator work, virtualizing the render could not have moved the number.
It was per-row component instantiation.

### A3 = 0, stated honestly

Zero is under the cap, but the reason matters: a full re-sort replaces every row in
the window, so no row has a previous position to fly from. Nothing animates "from a
position it never occupied" — the failure mode the prompt warned about — but the
reorder animation is effectively **absent** for a full re-sort, surviving only where
rows stay inside the window. A behavioural change, not a win.

## D3 — guard reconciliation

| guard | state |
|---|---|
| sort-key (`Infinity`, loud, enumerable) | **untouched** — written against the contract, survived as predicted |
| column ladder | **untouched** |
| colgroup single source | **still valid** — the real-`<table>` choice kept `<colgroup>` as the one width declaration |
| sticky-header opacity | **still valid** — `<thead sticky>` + `TableRow backgroundColor` unchanged |
| `cds-tablerow-dom` | **kept** — `TableRow` is still the row element |
| `cds-tablecell-dom` (Interactable probe) | **kept** — `TableCell` still renders cells; the finding still explains where `onClick` binds |
| **virtualization (new)** | asserts 2,000 rows renders **under 2×** the DOM of 200 rows. Pre-virtualization that ratio was exactly 10×. Also asserts spacers are `aria-hidden`, carry no `data-sr-row`, and that `ROW_H` is a number |

`guards/setup.ts` was added: jsdom has no `ResizeObserver`. It is a stub that lets
components mount so structure can be asserted; **no test asserts a pixel there.**

## D4 — the closed list, item by item

| # | item | outcome |
|---|---|---|
| 1 | arrow glyphs on signed numbers | **applied** — `↗` / `↘`, bare `+`/`−` removed; rendered `"↘ 0.1"` |
| 2 | two-step label/value typography | **no surface** — see below |
| 3 | chart chrome removal + stipple | **partial** — chrome removed, stipple not delivered |
| 4 | period selector as pills | **style only** — no such selector exists to apply it to |
| 5 | screener chips | **applied** — CDS `Chip`, one row, full set still not exposed |
| 6 | vertical hairlines at section boundaries only | **already satisfied — verified, not changed** |

**Item 2 has nowhere to land.** v2 has no detail or gauge block; building one is a
new panel, which D4 forbids, and the table body is explicitly excluded. Applied
nowhere, and not faked.

**Item 3's stipple could not be built.** `lightweight-charts` v4's area series takes
colour strings, not patterns; a dot fill needs a custom series plugin, which is new
charting work rather than the minimum needed to read thresholds. Applied instead: no
gridlines, no axis lines, muted value labels (reading `--color-fgMuted`), unticked
date captions, and a dot marker on the last bar.

**Item 4** has a `.sr-pill` style and the screener uses it, but v2 has no time-basis
or horizon selector — the chart's interval is a query parameter, not UI — and new
selectors are forbidden.

**Item 6, verified from the shipped CSS**: `variant="ruled"` paints only
`border-bottom` on cells and `box-shadow: inset 0 -1px` on header cells. There are no
vertical borders anywhere. `bordered` paints the container edge, which is a section
boundary. The rule already holds.

### Font — Pretendard, and what it cost

The face is set **through the theme object**, not through CSS. CDS emits
`--fontFamily-*` as inline styles on its wrapper, and no stylesheet rule beats an
inline style on the same element; a `body { --fontFamily-body: … }` override was
tried first and computed to CDS's own value unchanged. Verified after the change: the
text `<span>` renders `"Pretendard Variable"`.

**No font file is self-hosted.** §0 limits stack additions to the two TanStack
packages, so the `pretendard` npm package could not be added, and fetching a binary
was outside this pass. `local()` resolution only — which works on this desk, where
Pretendard is installed. **This is a gap, not a decision.** Hotlinking was not done.

`font-display: swap` is deliberately absent: a swap relayouts the table and jumps
every column width, which is the one thing format-derived widths must never do. With
`local()`-only sources there is no fetch and so no swap moment.

#### Ladder thresholds, old vs new

| | old (CDS face) | new (Pretendard) |
|---|---|---|
| rendered column widths | `[109.9, 106.8, 71.3, 71.3, 71.3]` | `[109.9, 106.8, 71.3, 71.3, 71.3]` |
| `0` advance used by the ladder | 8.881 px | 8.881 px |
| `0` advance in the cell's text | 8.881 px | **8.813 px** |

**They did not move — and that is the finding.** `useChPx` measures the `0` advance
in the **host div's** context, whose inherited face did not change. The advance in the
**cell's text** context, which is what the columns actually render in, is 8.813 px
under Pretendard — a 0.77% difference the ladder never sees.

The ladder is therefore insensitive to the face the cells are drawn in. That is the
same class of defect the `<colgroup>` change removed: a width derived in one font
context and applied in another. **Not fixed here** — D4's list is closed and this is
not on it. It is the first correctness item for the next pass.

## Verdict

**Yes — the headless branch solved the scale problem, and for the reason claimed.**

Sort-click at 1,000 rows went 2,498 ms → 26.3 ms against a 150 ms threshold; node
count went 43,080 → 1,028 and is flat from 200 to 5,000 rows; rows recycle on scroll.
The comparator was not changed and still sorts every row, so the improvement isolates
to render cost — **confirming** pass 2's per-row-instantiation diagnosis rather than
merely being consistent with it.

The cost is 20 kB of route JS and three structural constraints: constant row height,
scroll element found by DOM query, no variable row heights.

## Owner decisions

1. **`ROW_H` = 48 px** (`src/table/rowHeight.ts`) — one edit, one visible effect. The
   theme space scale is tuned to land on it (`--space-1: 8 → 6`), because an inline
   `height` on `<tr>` is only a minimum and CDS's cell content overrode it upward.
2. **`@tanstack/react-table` pinned `^8.21.3`.** v9 — what `pnpm add` resolves — has
   no `useReactTable`, no `getCoreRowModel`, no `sortingFn`. Moving to v9 later is a
   rewrite of this layer, not an upgrade.
3. **D0's choice**: real `<table>` + spacer rows, and its three costs.
4. **The font width table above**: thresholds unchanged, and the reason is a latent
   measurement-context bug worth fixing next.
5. **`manualSorting`** rather than a registered `sortingFn`, to keep nulls last in
   both directions.

## How to look at it

```
cd sauron-v2
pnpm build && pnpm start          # :3200
```

- **`http://localhost:3200/`** — the product screen. Look first at the screener
  **chips** (one row, active one inverted), the **`↗` / `↘`** arrows on the change
  columns, and the type: Pretendard for Latin and Hangul alike.
- **`http://localhost:3200/scale?n=1000`** — 1,000 rows, virtualized. Scroll it: the
  scrollbar should be honest and rows should not blank out. Click `1D` to sort.
- **`http://localhost:3200/chart?c=b&n=520`** — chart with chrome removed.

**Owner verification required** — nothing here is claimed to look right:

1. **Chart drag-pan**, outstanding since pass 2. Synthetic pointer events did not
   move it; it needs a real mouse.
2. **Everything in D4.** Only what was *applied* is reported; how it reads is yours.
3. **Whether `ROW_H` 48 is right**, now that it is a dial.

## Deferred (aesthetic)

Carried forward: styling beyond D4's list; 52주 shows a bare percentage where v1 has
a position track; tint reads stronger on CDS white than on v1's `#f8f8f8`; the chart's
date axis is Korean by locale accident; zoom has no visible affordance.

New this pass:

- **The stipple fill (D4.3) is missing**, and the area under the line is simply absent
  rather than filled another way.
- **No detail or gauge block exists**, so D4.2 had nowhere to land. Whatever block
  eventually holds the two-step typography is unbuilt.
- **`.sr-pill`'s active tint uses the up-hue** for a selector that has nothing to do
  with direction. It reads as "selected" but borrows a meaning-carrying colour.
- **`--space-1: 6` was chosen to hit `ROW_H`** and also moves every other 8 px gap in
  the app. Nothing was surveyed for that side effect.
- **Spacer rows are `aria-hidden`**, but a screen reader still meets 22 rows where the
  table claims 1,000. Undecided.
- **The arrow glyphs come from the text font**, not an icon set, so their weight
  shifts with the face.

## Provisional

1. **D0's choice**: real `<table>` + spacer rows over `div`/grid — `<colgroup>` is
   single-source structurally where a grid template is single-source by convention.
2. **Pinned `@tanstack/react-table@^8.21.3`** after v9 resolved by default.
3. **`manualSorting`** instead of a registered `sortingFn`.
4. **Space scale tuned 8 → 6** to land `ROW_H` rather than fighting CDS's cell padding.
5. **`height` passed as a pixel number**, because the prop's type accepts strings the
   implementation cannot use.
6. **Committed `a4cc568` with a wrong screen**, labelled as such, rather than
   discarding the D0 probe evidence.
7. **Did not fix the `useChPx` measurement-context bug** — real and measured, but not
   on D4's closed list.
8. **Did not build a detail/gauge block** for D4.2 rather than inventing a panel.
9. **jsdom stubs in `guards/setup.ts`** rather than skipping the virtualization guard.

## Files touched outside the commits

None. Everything is in `a4cc568`, `fc46feb`, `b814fe2`, and this report.

---

## braveworld integrity check

Against the baseline recorded in pre-flight:

```
baseline  47122287 인트로 커튼 — 시작할 때 커브 아홉 장이 피어난다
          ahead 3, dirty: data/irsdata.xlsx

closing   47122287 인트로 커튼 — 시작할 때 커브 아홉 장이 피어난다
          ahead 3, dirty: data/irsdata.xlsx
```

**Identical.** No commit was made in that tree by this session and no byte was written
to it. The tree did not move during the session — the concurrent session's IntroCurtain
work was already committed before this one started, which is why the baseline contains
it and the closing check matches.
