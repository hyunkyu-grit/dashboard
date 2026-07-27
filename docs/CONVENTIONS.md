# Curve conventions — read from the code, not from what KRW IRS "should" be

Every value in Sauron descends from one bootstrapped zero curve. This records
the conventions that curve actually uses, read out of the source (final session
Pass A3), so a convention error is visible rather than buried. Where a
convention lives in `engine_port.py` it is **frozen** (byte-identical to
krw-fi-pms @ 570a2ff) and must not be edited here — a bug there is the owner's
call and the frozen system carries it too.

## Instruments feeding the curve

| Node | Source column | Enters as | Frozen? |
|---|---|---|---|
| `1D` | 콜금리 (overnight call rate) | year fraction `1/365`, simple-interest single payment | node placement here; simple-interest in `engine_port` |
| `3M` | CD 91일 (CD91) | year fraction `91/365 = 0.2493`, simple-interest single payment | as above |
| `6M…10Y` | 원화 IRS MID종가 (par swap quotes) | par-swap identity, quarterly fixed | `engine_port.bootstrap_zero_curve` |

`1D` and `3M` are **real curve nodes from the call rate and CD91**, not synthetic
anchors — `curves.par_rates_at` reads them straight from the dataset with the
year fractions in `curves.TENOR_T`. (`engine_port._inject_short_anchors` would
synthesise them from a float rate when absent, with `TOL_DUP = 0.02y ≈ 7d`; it
is not exercised here because both columns are present.)

## Bootstrap (`engine_port.bootstrap_zero_curve`, frozen)

- **T ≤ 3M** (`SHORT_THRESHOLD = 0.25·1.04 = 0.26`): simple interest,
  `DF(T) = 1/(1 + c·T)`, `r = −ln DF / T`. Single-payment money-market form.
- **T > 3M**: a **backward quarterly** schedule from the actual maturity `T`
  (steps of 0.25y; any remainder is a **stub** absorbed into the *first/oldest*
  period), solving the par-swap identity in DF space
  `1 = DF(T)·(1 + c·0.25) + c·Σ interim accrual·DF(tᵢ)` closed-form for `DF(T)`
  (brentq only as a fallback for a non-positive `DF(T)`).
- **Fixed leg**: quarterly, accrual `0.25` per full period (nominal ACT-style
  year fractions, not 30/360 or ACT/365 day-counting of real dates).
- **Single-pass sequential**, not iterated — see the round-trip finding below.

## Discount-factor interpolation

- **`df()` — the consumer path** (used by forwards, DV01, the heatmap): **log-
  linear on DF** (linear in `ln DF = −r·T`).
- **`df_linear_rate()`**: linear on the zero rate (used for KRD bucketing, and
  it matches the interim interpolation the bootstrap uses internally).
- The bootstrap's *internal* interim interpolation is **linear-on-zero-rate**
  (`_df_interp`), i.e. a different method from the `df()` consumers use — a
  deliberate split the engine comments defend on accuracy grounds. It is one
  source of the round-trip residual below.

## Schedules, settlement, calendar

- **Forward par rate** (`forwards.forward_par_rate`): quarterly annuity
  `A(s,e) = 0.25·Σ DF(s + 0.25·i)`, `fwdpar = (DF(s) − DF(e)) / A(s,e)`;
  sub-quarterly (ON) falls back to the simple money-market rate. `SPOT`
  = spot-starting to maturity `start`.
- **Forward start dates** (`forwards.start_date_for`): calendar-month offsets
  from the as-of date, **Modified Following** adjusted (`_modfol_bd`) — next
  business day, rolled back if it crosses the month.
- **Settlement / spot lag**: `next_kr_business_day` = **T+1** business day. The
  product convention (main.py) reports an "N-dated" value as of N's settlement
  (N+1 BD). NOTE the curve bootstrap itself uses the raw year fractions in
  `TENOR_T` with **no explicit spot-lag shift** — spot lag enters valuation, not
  the par→zero bootstrap.
- **Business-day convention**: Modified Following, weekends + KR public
  holidays.
- **Holiday calendar**: `holidays.KR(years=2016–2035)` (a ported deviation:
  years widened from the source's 2020–2035; a missing `holidays` package
  raises rather than degrading to weekends-only). No dataset date may fall
  outside 2016–2035 (asserted).
- **CD91 fixing**: one Seoul business day before the reset date (the ported
  CD-IRS convention; §0).

## What is frozen (`engine_port.py`)

`bootstrap_zero_curve`, `df`, `df_linear_rate`, `zero_rate`,
`forward_rate_simple`, the business-day helpers (`_modfol_bd`,
`_next/prev_business_day`, `next_kr_business_day`), `_subtract_months`, and the
holiday calendar. braveworld owns only the *node placement* (`curves.TENOR_T`),
the forward **schedule/label** layer (`forwards.py`), and the DV01 annuity
(`dv01.py`).

## Round-trip finding (Pass A1) — accepted by the owner

The bootstrap does **not** reprice its own par inputs to 1e-8:

- **Exact** (≈1e-12) at the `1D` and `3M` money-market anchors.
- A **≤ 0.25bp residual** on swap tenors, growing with tenor (~2e-4bp at 6M–1Y,
  0.22bp worst at 3Y, ~0.05bp at 10Y).

Cause — **not a convention error** (day count / compounding / spot lag would
break the short end grossly, and it is exact there): (1) the CD91 `3M` node
sits at `0.2493y` while payments fall on the `0.25y` grid, and (2) sub-annual
cashflows (1.25Y, 1.75Y, …) are interpolated between the sparse curve nodes in
a **single-pass** bootstrap. A curve that reprices its inputs to machine
precision needs an **iterated** bootstrap.

**Owner decision (closing session, part 2): this residual is ACCEPTED.** It is
not to be fixed, wrapped, or re-ported. The strict `xfail`
(`test_round_trip_swap_tenors_to_1e8`) is kept as documentation of an accepted
limitation, not a flag of a defect. It stays strict so that if the frozen
engine is ever re-ported with an iterated bootstrap, the test xpasses and the
change is noticed.

**What it does and does not affect** — the residual is a smoothly, slowly
varying function of curve *shape*, roughly common to neighbouring points on the
curve:

- **Change columns (what the product mostly shows) are barely affected.** A
  1일/1주/1개월 change is a difference of two same-shape curves, so the residual
  largely **cancels** — the bias on a move is far smaller than the ≤0.25bp bias
  on the level it is derived from.
- **A *level* read carries the full residual.** Anyone quoting a displayed
  forward or spread level for pricing inherits up to ~0.25bp of fit bias
  relative to a self-consistent curve.
- **Relationships are exact regardless** (forward-annuity identity to 1e-17):
  spreads, flies, and the DV01 ratio between forwards are unaffected — the
  residual is a level bias in the fit, common to the whole curve, not a
  per-instrument error.

The residual is in **frozen** ported code, so it is reported, not patched.
`engine_port.py` is byte-identical to the frozen krw-fi-pms engine (@570a2ff),
so **that system carries the identical residual** — noted here so it is not
diagnosed a second time from scratch; fixing it there is not this repo's call.
Full detail in `docs/diagnostics/curve-validation.md`; pinned by
`tests/test_validation.py`.

## Displayed precision vs. accuracy of a level

Forwards, spreads, and flies are shown to **four decimals** (e.g. `4.2675`).
That precision **exceeds the absolute accuracy of a level**: the last one or two
digits of a level are below the ≤0.25bp fit residual above. The extra digits are
still meaningful for **comparing cells within a single snapshot** (the residual
is common to the snapshot, so relative ordering and small differences between
cells are real), but they are **not** meaningful for **quoting a level** to that
precision. Four decimals is kept deliberately for intra-snapshot legibility, not
as a claim of four-decimal absolute accuracy.
