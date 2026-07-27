# Curve validation — findings (final session Pass A)

Reproducible via `backend/tests/test_validation.py` (permanent gates) against
`data/irsdata.xlsx` (asof 2026-07-24). No UI was touched. Nothing here was
tolerance-fudged: the one check that fails is left failing (as an `xfail` with
a strict reason) and reported.

## Headline

Seventeen sessions had never checked the numbers against anything. Now checked:

- **Derived quantities are algebraically exact.** The forward-annuity identity
  `par(0,e)·A(0,e) == par(0,s)·A(0,s) + fwdpar(s,e)·A(s,e)` holds to **2.8e-17**
  across the start×tenor grid. So every forward, spread, fly, and DV01 the
  product shows is exactly consistent with the curve's discount factors.
- **Discount factors are well-behaved** — strictly decreasing, all in (0, 1]
  on the current positive-rate curve; no short-end interpolation blowup.
- **No calendar blowup** — bootstrap + round-trip over 200+ scattered past
  dates including year-ends, 설, and 추석 stays bounded (< 1bp); every dataset
  date is inside the ported 2016–2035 holiday range.
- **BUT the bootstrap does not reprice its own par inputs to 1e-8.** This is the
  A1 stop condition and it is genuine.

## The round-trip (A1), asof 2026-07-24, via the public `df()`

| tenor | input % | round-trip error (bp) |
|---|---|---|
| 1D (1/365) | 2.8000 | ~3e-11 (exact) |
| 3M (91/365) | 2.9100 | ~1e-12 (exact) |
| 6M | 3.1800 | 0.0006 |
| 9M | 3.3550 | 0.0002 |
| 1Y | 3.5075 | 0.0002 |
| 1.5Y | 3.7500 | 0.11 |
| 2Y | 3.8875 | 0.08 |
| 3Y | 4.0225 | **0.22** (worst) |
| 5Y | 4.1425 | 0.11 |
| 10Y | 4.2675 | 0.05 |

Exact at the `1D`/`3M` money-market anchors; a **≤ 0.25bp residual** on swap
tenors, largest in the 3Y–5Y region.

## Diagnosis — an artefact, not a convention error

It is **not** a day-count / compounding / spot-lag error: those would break the
short end grossly, and the short end is exact to 1e-12. Two mechanical causes,
both benign and both in frozen code:

1. The **CD91 `3M` node sits at `0.2493y`** (91/365) while the quarterly payment
   schedule lands on the `0.25y` grid — so even "node" tenors have a payment a
   few days off a node, interpolated.
2. **Sub-annual cashflows** (1.25Y, 1.75Y, 2.25Y, …) fall **between the sparse
   curve nodes** (nodes are 1D·3M·6M·9M·1Y·1.5Y·2Y·3Y·5Y·10Y), and the
   bootstrap is **single-pass sequential**: when it solves the 3Y node, the
   payments beyond the 2Y node are extrapolated flat, but a later query
   interpolates them between 2Y and 3Y. The two disagree by the residual. The
   error grows with tenor because longer swaps have more between-node payments —
   the pattern the session brief attributes to "day count or compounding" for
   the *external* sheet, but here it is purely this sparse-grid interpolation.

A curve that reprices its inputs to machine precision needs an **iterated**
bootstrap (or every payment date as a node). This one is single-pass, and it is
in `engine_port.bootstrap_zero_curve`, which is **frozen** — so it is reported,
not patched (krw-fi-pms carries the same behaviour, worth knowing on its own).

## Impact

Small but real, and at the product's display precision. A forward shown as
`4.2675` could be ~0.2bp off what a self-consistent curve would give. Because
the annuity identity is exact, the *relationships* between forwards (spreads,
flies, the DV01 ratio) are unaffected — the residual is a level bias in the fit,
common to the whole curve, not a per-instrument error.

## Recommendation (owner's call — frozen code)

1. Decide whether ≤0.25bp fit residual is acceptable for a monitor (likely yes)
   or needs an **iterated re-port** of `bootstrap_zero_curve` (the only real
   fix). If re-ported, `test_round_trip_swap_tenors_to_1e8` will xpass and its
   `xfail` should be removed.
2. Run **Pass A2** — drop the owner's forward-matrix sheet into
   `data/reference/` (see its README). The internal checks prove
   self-consistency but not correctness against the desk's own numbers; A2 is
   the only test of that and it has never run.

## A2 status

No reference sheet was present, so the harness (`tests/test_reference_sheet.py`)
skips. It is committed and ready: drop in `forward_matrix_YYYY-MM-DD.xlsx` and
it compares all 21×8 cells, banding differences at 0.1bp / 1bp.
