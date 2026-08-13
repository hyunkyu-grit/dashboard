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
