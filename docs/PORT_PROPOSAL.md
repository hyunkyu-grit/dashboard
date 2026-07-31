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

---

# Port 2 — the single-swap valuation core (2026-07-31)

**Decided and executed the same day.** The owner lifted the CLAUDE.md guardrail
that read *"no portfolio valuation / MtM / scenario / trade code"* to allow the
backtest, and directed that the frozen code be **brought over rather than
rewritten** ("풀고 새로만들 필요없이 코드 가져와도").

## What crossed

| frozen source | into |
|---|---|
| `engine/quant_engine.py :: IRS_Trade` | `app/engine_port.py` (appended, byte-identical) |
| `engine/fixings.py` — all 5 bodies | `app/valuation_port.py` |
| `engine/instruments.py :: VanillaSwap` | `app/valuation_port.py` |
| `engine/mtm_valuation.py` — all 4 bodies | `app/valuation_port.py` |

Source of record: `krw-fi-pms-backend/irs_pricer/engine/`, the same checkout
the curve-side port pins. There is a second copy under
`krw-fi-pms/backend/irs_pricer/engine/`; the two were compared byte-for-byte
and differ **only in line endings** (LF vs CRLF), so either is the same code.

`IRS_Trade` came across whole, including `compute_npv`, which nothing here
calls. A port is of a thing, not of the parts of it we happen to want, and
trimming it would end the byte-identity that makes the parity test mean
anything.

## What did NOT cross, and why

- **`engine/curve.py :: build_curve`.** It consumes a `MarketSnapshot`
  assembled by a DB-backed market-data service. braveworld bootstraps the same
  array from the xlsx (`app/curves.py`). Only the `CurveBundle` container
  crossed, and `test_valuation_port.py` asserts it is the *only* body in our
  file that is not in the frozen source.
- **`services/npv_trace_service.py`**, which does roughly what this repo's
  backtest does. It reaches for a SQLAlchemy `Session`, trade and trace
  repositories, booked position ids, `funding_basis`, `mtm_service` and
  `market_data_service`. braveworld has no database — it reads one workbook —
  so the service layer is written natively in `app/backtest.py`.
- Still excluded from `engine_port.py`: PVBP, KRD, theta, bumped curves, path
  simulation.

## Deviations from byte-identity

Import lines only, because the frozen package layout does not exist here:
`.quant_engine` and `.curve` become `.engine_port`, and `CurveBundle` is
declared locally. Every class and function BODY is byte-identical, re-extracted
from the frozen source and compared by
`tests/test_valuation_port.py::test_ported_bodies_byte_identical_to_frozen_source`.

`mtm_valuation.py` carries a UTF-8 BOM in the frozen repo; it is read with
`utf-8-sig`, which is a file-encoding artefact and touches no body.

## The unit trap this port inherits

Every rate crossing into `valuation_port` is an annualized **decimal**
(0.0251 == 2.51%). Percent exists only inside `IRS_Trade`'s `*_pct` arguments,
and `VanillaSwap.to_irs_trade()` is the single decimal→percent conversion. The
frozen repo shipped a bug here once — a second `/100` on an already-decimal CD
fixing, which crushed the floating stub ~100x and silently corrupted every P&L
surface downstream. Our test pins it from both sides: a missing `/100` and a
doubled one each move the NPV by >50x and fail.

The check that would catch almost any other mistake in the chain is
`test_a_swap_struck_at_par_is_worth_about_nothing`: enter a 10Y payer at
today's own 10Y par rate, value it on today's curve, and the NPV must be ~0
against the notional.
