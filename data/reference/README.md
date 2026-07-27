# Reference forward matrix — external truth for Pass A2

The product's forward matrix has never been checked against the owner's own
spreadsheet. Drop that spreadsheet here and the comparison harness
(`backend/tests/test_reference_sheet.py`) runs automatically; until then it
skips (never invents numbers).

## What to drop in, and where

A single file named with the sheet's valuation date:

```
data/reference/forward_matrix_YYYY-MM-DD.xlsx
```

The date in the filename is the valuation date; the harness bootstraps the
curve for that same date (read from the sheet if the sheet carries one, else the
filename) rather than assuming today.

## Expected layout (first sheet)

The harness expects a plain 21 × 8 grid of forward par rates in **percent**:

- **Column A**, rows 2…22: the 21 start-point labels, top to bottom —
  `ON, 3M, 6M, 9M, 1Y, 1Y3M, 1Y6M, 1Y9M, 2Y, 2Y3M, … 5Y` (3-month steps).
- **Row 1**, columns B…I: the 8 forward-tenor headers —
  `SPOT, 3MF, 6MF, 9MF, 1YF, 2YF, 3YF, 5YF`.
- Cell (start, tenor) = the forward par rate in percent (e.g. `4.2446`).

If your sheet differs, either reshape it to the above or adjust
`_load_reference()` in the harness to match — and record the layout you used.

## What the harness reports

Per forward-tenor column: max and mean absolute difference in bp, and counts in
three bands — **< 0.1bp** (agreement), **0.1–1bp** (needs explanation),
**> 1bp** (convention mismatch). Plus the ten worst cells side by side and the
six named key forwards separately. On agreement the sheet is pinned as a golden
fixture; on disagreement the report lands in `docs/diagnostics/` and the test is
left failing with a clear message, not skipped.
