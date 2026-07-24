# Curve-engine port proposal (spec §0 gate)

Status: PROPOSAL — nothing has been copied. Owner approval required.

Source: `krw-fi-pms-backend` @ `570a2ff` (2026-07-22, clean tree). Read-only
survey 2026-07-24; the frozen repo was not modified.

## What Band 2 (forwards) actually needs

1. Bootstrap a zero curve from braveworld's own nodes (1D call, CD 3M, IRS
   6M–10Y — all already in `data/irsdata.xlsx`).
2. Discount factors + simple forwards from that curve.
3. Forward par-swap rates (for the matrix cells and 1Yx1Y-style key
   forwards): standard annuity formula on top of DF — small new code in
   braveworld, not a port.
4. Seoul business-day calendar for real start dates in the matrix (§8) and
   the live-node rule.

## Proposed port list — Option A (recommended): function-level extraction

Extract, byte-identical function bodies, into
`backend/app/engine_port.py` with a provenance header (source path +
`570a2ff`), from `irs_pricer/engine/quant_engine.py`:

| Group | Functions |
|---|---|
| KR calendar | `_KR_HOLIDAYS` init block, `_is_kr_business_day`, `_next_business_day`, `_prev_business_day`, `next_kr_business_day`, `_modfol_bd`, `_subtract_months` |
| Curve construction | `_inject_short_anchors`, `bootstrap_zero_curve` |
| Curve readout | `df` (log-linear DF), `df_linear_rate`, `zero_rate`, `forward_rate_simple` |

Not ported (excluded by spec §0): `compute_irs_npv`, `compute_irs_pvbp`,
`compute_irs_krd_map`, `compute_irs_theta`, `build_bumped_curves`,
`portfolio_krd_day`, `simulate_irs_path_fm`, `IRS_Trade`, everything in
`services/`, `db/`, `loaders/`.

`engine/curve.py` (`build_curve`) is a 60-line snapshot→par-rates adapter
bound to their `MarketSnapshot` contract — braveworld writes its own
equivalent against `Dataset` instead of porting it.

`engine/fixings.py` (CD91 fixing = 1 Seoul BD before reset): only needed
when pricing seasoned floating legs, which the forward matrix does not do.
Deferred until a feature needs it; noted here so the convention isn't lost.

New dependency: `holidays` (pip) — quant_engine builds `holidays.KR` for
2020–2034 and silently degrades to weekends-only if absent. **Deviation to
approve:** braveworld's history starts 2016, so our copy would init
2016–2035, and we should make the missing-package fallback loud (raise, not
degrade) since business-day correctness is a display guarantee here.

## Option B: copy `quant_engine.py` wholesale

Keeps the old repo's byte-identical-file rule and trivial diffing, but drags
~70KB of valuation/scenario code the spec explicitly says not to port, plus
their config/import surface. Not recommended for a standalone monitor.

## Decision needed from owner

1. Option A or B?
2. Approve the holidays-range (2016–2035) and loud-fallback deviations?
3. Forward par-swap convention for matrix cells: quarterly fixed annuity on
   the single CD/IRS curve (matches KRW IRS quoting) — confirm.
