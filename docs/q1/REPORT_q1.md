# q1 — research-layer attach + gs-quant borrow feasibility

Research-only pass. No product surface changed, no package added to the
application venv, no `rateslib` anywhere in this repo.

Every "pass" below names the value it passed against.

---

## 0. Corrections to the plan's premises

Five of the plan's stated facts did not hold. They are listed first because
four of them changed what the work could be.

| # | Plan said | Measured |
|---|---|---|
| 1 | Repo at `Desktop\Assistant\Projects_AS\sauron-v2` | **Path does not exist.** The tree was reorganised on the morning of 2026-09-01 (confirmed independently by `HANDOFF-test-staleness-2026-09-01.md` §2). Actual: `C:\Users\infomax\Projects\apps\sauron-v2`; braveworld at `Projects\apps\braveworld`; lanes at `Projects\research\`. |
| 2 | "compare against the existing QuantLib path — imported, not reimplemented" | **There is no QuantLib path.** Zero `import QuantLib` in the backend. QuantLib 1.42.1 is installed and imported by nothing. Substituted the ported engine — see §4. |
| 3 | `rateslib` is CC BY-NC-ND 4.0 | **No.** 2.7.1 is a bespoke dual licence from Siffrorna Technology Ltd. Same conclusion, stronger grounds — see §1. |
| 4 | `vectorbt` expected to fail on `numba` | **numba works.** It fails on `plotly`. See §1 and §9. |
| 5 | Frontend gate "vitest 575, lint 0, build 0" | **1,548 tests, 6 pre-existing failures.** See §12. |

Housekeeping done: the gs-quant clone was moved from `Desktop\gsquant-study` to
`Projects\research\gsquant-study\`, and 3 path references inside
`GSQUANT_STUDY.md` were rewritten.

---

## 1. Environment, wheel and licence table

**Environment.** Windows 11 Pro 10.0.26200.9168. Interpreter
`C:\Users\infomax\Miniconda3\python.exe`, **Python 3.13.13** — every package
below has a cp313 wheel, so nothing is gated by interpreter age. The repo
contains **no venv**; the application venv *is* the conda base
(`backend/serve.ps1:38` hardcodes that interpreter). Baseline: **336 packages**.
QuantLib **1.42.1** present, never imported.

**Material discovery:** the app venv already carries `arch 8.0.0`,
`exchange_calendars 4.13.2`, `linearmodels 6.1`, `holidays 0.100`,
`statsmodels 0.14.6`, `numba 0.67.0`. So §3, §6 T1 and §6 T5 needed **zero
installs**. Only `ruptures`, `hmmlearn`, `quantstats`, `vectorbt` went to the
throwaway `.venv-q1` at `Projects\research\q1-probe\`.

| Package | Resolved | Artifact | numpy / pandas / scipy / numba pins | Licence | Proprietary internal desk use? |
|---|---|---|---|---|---|
| `rateslib` | 2.7.1 | wheel `cp310-abi3` | numpy ≥1.21.5,<3.0 · pandas ≥1.4.1,<4.0 | **Dual: Non-Commercial Source-Available + paid Commercial Subscription** | **NO** |
| `arch` | 8.0.0 | wheel cp313 | none at runtime | NCSA (BSD-like) | Yes |
| `ruptures` | 1.1.10 | wheel cp313 | numpy, scipy unpinned | BSD-2-Clause | Yes |
| `hmmlearn` | 0.3.3 | wheel cp313 | numpy ≥1.10 · scipy ≥0.19 | BSD | Yes |
| `linearmodels` | 7.0 | wheel cp313 | none at runtime | NCSA | Yes |
| `quantstats` | 0.0.81 | wheel py3-none-any | numpy ≥1.24 · pandas ≥1.5 · scipy ≥1.11 | Apache-2.0 | Yes |
| `pyfolio-reloaded` | 0.9.9 | wheel py3-none-any | **pandas <3.0** · numpy ≥1.26 | Apache-2.0 | Licence yes, **version no** |
| `vectorbt` | 1.1.0 | wheel py3-none-any | **numpy ≥2.4.6** · numba ≥0.66 | **Apache-2.0 + Commons Clause** | Internal yes; **may not be resold** |
| `exchange_calendars` | 4.13.2 | wheel py3-none-any | numpy ≥1.26.4 · pandas ≥1.5 | Apache-2.0 | Yes |
| `holidays` | 0.103 | wheel py3-none-any | none | MIT | Yes |
| `krholidays` | — | **does not exist on PyPI** | — | — | `No matching distribution found` |

**No sdists. No GPL/AGPL.** Three flags:

1. **`rateslib` restricts by PURPOSE, not location.** Clause 1.2 forbids
   *"Install or use the software for any purpose in a commercial environment"*,
   defining commercial as *"any use primarily intended for or directed toward …
   business operations, whether direct or indirect."* Relocating the work to a
   personal folder — the plan's proposed mitigation for T2b — does not cure a
   purpose-scoped restriction. See §4 for how T2b was handled.
2. **`vectorbt` carries the Commons Clause** over Apache-2.0: internal use is
   permitted, selling a product or service deriving substantially from it is
   not. Not a blocker; flagged because it is not plain-permissive.
3. **`pyfolio-reloaded` pins `pandas<3.0`; the app venv is on pandas 3.0.5.**
   The §7 fallback is unusable without its own venv. `quantstats` has no such
   ceiling, so the primary path was clear and the fallback was never needed.

`krholidays` does not exist, so the KR bank-holiday set comes from `holidays`
alone. That is a single-source risk for exactly the comparison §3 makes, and it
is why §3 adds an explicit overlay rather than trusting one library.

---

## 2. Seam map (D0.3)

**(a) QuantLib call sites — none.** Every textual hit is a comment or a stale
docstring: `irs_pricer/core/conventions.py:3` "(QuantLib dependency removed)",
`irs_pricer/core/errors.py:7` "QuantLib-free",
`irs_pricer/engine/__init__.py:2` (stale). `app/dv01.py:8-13` states the
reason: the product prices off the byte-identical ported engine and *"introducing
a second engine risks two curves disagreeing."* Real pricers:
`app/engine_port.py` (433 loc), `irs_pricer/engine/quant_engine.py` (1,629),
`bond_valuation.py` (133), `pricing.py` (60), `risk.py` (80).

**(b) Calendar sources — five constructions, four year windows, no QuantLib.**

| Site | Construction |
|---|---|
| `app/engine_port.py:26-32` | `holidays.KR(years=range(2016, 2036))`, raises on ImportError |
| `irs_pricer/core/errors.py:22` | `holidays.KR(years=range(2010, 2036))` |
| `irs_pricer/engine/quant_engine.py:30-31` | `holidays.KR(years=range(2020, 2035))` |
| `irs_pricer/services/simulation/kr_calendar.py:20-21` | `holidays.KR(years=range(2020, 2035))` |
| `kr_calendar.py:29, 42, 126` | three per-call dynamic ranges |
| `src/data/calendar.json` | MPC dates only (`app/issuance.py:29` flags it) |

`app/calendar_cache.py:39-55` claims `holidays.HolidayBase.__keytransform__`
auto-expands past the constructed window. **Measured: true** — 0 days differ
across all four windows over 2015–2026 (§3). The five sites are functionally
one source; this is a maintainability risk, not a live correctness bug.
`exchange_calendars` is installed and imported nowhere.

**(c) Ladder — wide, dict-keyed, built three times independently.** Shape
`"krd": {label: value}` at `app/backtest.py:882,908`,
`app/cashbond.py:1139,1157`, `app/futures.py:711,730`. Each accumulates
`krd[lb] += …` into a dict **pre-seeded from its own label list** — that
pre-seeding is the manual alignment. Three grids, all confirmed against live
data: `curves.TENOR_T` (15), `creditmatrix.TENOR_LABELS` (13),
`cashbond.ASW_TENORS` (10). `app/backtest.py:719` reads
`labels = list(TENOR_T)  # insertion order == ascending tenor`, and
`:735-738` breaks out of a loop the moment `TENOR_T[lb] >= tau` — so the bump
set's correctness depends on the order the literal happens to be written in.

**(d) Backtest PnL — one source.** `app/mrbacktest.simulate()` is a single bar
loop emitting `points[].dailyPnl` / `cumulativePnl` and `trades[]`, with
`summary = summarize(points, trades)`. Trades carry a three-way decomposition
asserted to sum to `pnl` (`:354`). Measured in §8: cumulative, sum-of-daily and
sum-of-trade PnL agree to **0.0000000000**.

**(e) Futures — already compliant.** `app/futures.py:94-108` documents the split:
`mkt_futures_investor_close.CLOSE` → `price_adj` (roll-adjusted, differences
only); vendor `선물내재수익률` → `implied`, used for all levels, spreads and
percentiles. Entry/exit rates read `implied_at_index` (`:527-528`). The §7
standing restriction is satisfied by the existing code; this pass added nothing
here.

**(f) Persisted backtest run — does not exist.** `app/cache.py` caches derived
*market* payloads. `output/backtest_2021_cycle.json` is a bigfoot macro artifact
(`module`/`verdict`/`headline`/`blockers`). MR backtests are computed on demand
at `main.py:1087` and never written. The `−114,000,000` anchor appears nowhere
in the tree.

**(g) Rolling statistics — 6 of 7 guarded.** Full table in §7.

---

## 3. Calendar divergence

`backend/research/calendar/divergence.py` → `docs/q1/calendar_divergence.csv`.

**3,131 weekdays examined over 2015–2026. All four sources loaded.
Divergent days: 27.** Five patterns, every one interpretable:

| Days | Pattern | What it is |
|---:|---|---|
| **12** | holidays.KR=business, QL.Settlement=business, **KRX=holiday, XKRX=holiday** | The KRX year-end closure (12-29/30/31), one per year. Banks open, exchange shut. |
| **9** | **holidays.KR=BUSINESS**, QL.Settlement=holiday, KRX=holiday, XKRX=holiday | **근로자의 날 (May 1)**, every year it falls on a weekday. |
| 2 | holidays.KR=holiday, QL.Settlement=business | 2016-05-06, 2017-10-02 — 임시공휴일 |
| 2 | holidays.KR=holiday, QL=business, XKRX=holiday | 2025-01-27 (임시공휴일), 2025-06-03 (대통령 선거일) |
| 2 | holidays.KR=holiday, QL=business, XKRX=business | 2026-06-03 (지방선거일), 2026-07-17 (제헌절, restored 2026) |

**The finding.** The two libraries fail in opposite directions. QuantLib knows
근로자의 날 but no 임시공휴일; `holidays.KR` knows every 임시공휴일, election day
and the 2026 제헌절 restoration, but **never marks May 1** — correct as a
*public-holiday* list (근로자의 날 is not a 관공서 공휴일) and wrong as a *bank*
calendar, because banks close, the KRX is shut, and the KOFIA CD91 fixing is not
published.

**This backend uses `holidays.KR` at all five sites. It therefore answers "is
May 1 a business day?" with yes. The KRW money market answers no.** On the 9
weekday May-1s in the sample, any CD91 fixing or settlement date derived by
walking business days is off by one.

**Canonical choice: `holidays.KR` + an explicit 근로자의 날 overlay**
(`backend/research/calendar/canonical.py`). Reasoning: it is already the sole
source in use and changing to it breaks nothing; it is the only source tracking
임시공휴일 and statute change, which are announced weeks ahead and cannot be
hard-coded; its one systematic gap is a fixed calendar date, so the overlay is
one line and cannot drift. **XKRX is rejected for fixing and settlement**
because it is a *trading* calendar — it closes at year end when banks are open,
which would push a fixing off the last banking day of the year. QuantLib is
rejected because nothing imports it and it misses every 임시공휴일 in the sample.

### The fix was attempted, measured, and reverted [2026-09-01]

The owner said it could simply be fixed, so it was — and then reverted, because
"simply" turned out to be wrong and the measurement is worth more than the patch.

**What was written.** A `_KRBankHolidays(SouthKorea)` subclass overriding
`_populate` to add May 1, placed in `app/engine_port.py`'s **holidays init
block** — the same block that already carries the port's two approved
deviations, so no ported function body was edited and
`_is_kr_business_day` stayed byte-identical. `_populate` was overridden rather
than a date list appended, because `holidays` auto-expands to years outside the
constructed range on lookup and an appended list would silently not cover them.
Verified: 20 years → 20 dates added, all May 1, **0 removed**, 제헌절 and the
임시공휴일 preserved, and the overlay still applied in auto-expanded year 2045.
The patch is kept at `Projects\research\q1-probe\may1_patch_engine_port.py`.

**What it broke.** Full suite: **6 failed, 1,179 passed** (was 1,185 / 0).

| Failing test | Why |
|---|---|
| `test_backtest_characterization.py::test_payload_is_unchanged` | the payload's **key set** changed — valuation dates moved, not just values |
| `…::test_raw_valuation_floats_are_unchanged` | same |
| `test_rebake.py` × 4 | the bake pipeline produced a transiently partial `engine_status.json` (`KeyError: 'basis_as_of'`, `'staleness'`) |

**A misreading, caught.** The scorecard assertion moved from `(9, 13)` to
`(12, 13)`, which first looked like the fix improving agreement with the paper
anchors. It is the opposite: `test_rebake.py:105-107` records that **12/13 was a
discarded overfit** — "Table 8 값의 순열을 그 밴드에 맞춰 고른 과적합이라
기준선이 아니다" — and 9/13 is the deliberate baseline. Reading the test's own
docstring reversed the conclusion.

**Why it was reverted rather than blessed.**

1. The characterization tests exist precisely to catch valuations moving. They
   did their job. Re-blessing them (`python -m tests.regen_characterization`)
   accepts that every historical backtest number near a May 1 changes, which is
   an owner decision, not a research lane's.
2. The knock-on reached the **bake pipeline**, which belongs to another lane
   that was actively working in this repo throughout this session.
3. Leaving a repo red for three concurrent sessions to trip over is worse than
   leaving a correct finding with a measured blast radius.

**Handover.** The fix is right, the patch is written and verified in isolation,
and the cost is now known rather than guessed: **2 characterization fixtures to
re-bless and 4 bake tests to re-green**, plus whatever the four other
`holidays.KR` sites need (`irs_pricer/core/errors.py`,
`irs_pricer/engine/quant_engine.py`, `kr_calendar.py` ×2 — none touched here).
That is a scoped pass with a known shape, which it was not before today.

**Upgrade guard:** `research/tests/test_calendar_canonical.py`, **39 tests**,
pins behaviour on all 27 divergent dates. Two of them assert the *current*
disagreement explicitly, so the day someone fixes `app/engine_port.py` those
tests flip and the fix is visible rather than silent.

---

## 4. Cross-check

`backend/research/xcheck/` → `docs/q1/xcheck_residuals.csv` (37 rows).
As-of **2026-08-28**, real instruments from the live universe: the 민평 credit
matrix and the IRS close dataset. No synthetic instruments.

**Comparison target substituted** (correction #2). The engine actually in the
product path is imported, never reimplemented: `app.cashbond.price` for bonds,
`app.engine_port.IRS_Trade.compute_npv` for swaps.

**Independence is structural, not just separate code.** The engine accumulates
the float leg stub-by-stub with an explicit forward rate per period; the
independent pricer derives it by **telescoping** to `DF(t₁) − DF(t_N)`. Agreement
therefore tests the forward-rate construction and the DF interpolation, not
arithmetic. Both honour dirty basis (clean is only ever `dirty − accrued`, never
carried) and CD91 fixing = reset − 1 **bank** business day on §3's calendar.

### Residual distribution — |independent − engine|

| Metric | n | max | median | p95 |
|---|---:|---:|---:|---:|
| bond clean (face 1) | 26 | 2.22e-16 | 0 | 2.22e-16 |
| bond dirty (face 1) | 26 | 2.22e-16 | 0 | 2.22e-16 |
| bond accrued (face 1) | 26 | **0** | 0 | 0 |
| bond DV01 (face 1) | 26 | 4.44e-16 | 0 | 3.33e-16 |
| IRS NPV (KRW, 10bn notional) | 11 | 7.15e-06 | 3.58e-06 | 7.15e-06 |
| IRS NPV (bp of notional) | 11 | **7.15e-12** | 3.58e-12 | 7.15e-12 |

**Worst five**, all IRS, all the same mechanism (accumulated float64 rounding
growing with the number of pay dates): IRS 10Y −7.15e-12, 9Y −6.20e-12,
8Y −5.72e-12, 7Y −4.77e-12, 6Y −3.81e-12 bp of notional.

**Diagnosis of the largest.** 7.15e-12 bp of notional on a 10bn clip is
7.15e-06 KRW — six-millionths of a won. It scales monotonically with pay-date
count (11 rows, 6Y→10Y strictly increasing), which is the signature of
accumulated rounding in a summation, not of a convention difference. There is no
convention mismatch to diagnose: the two derivations agree to the last
representable bit.

### Proposed threshold, for sign-off

Implementation residuals sit at **1e-16 (bond, face 1)** and **1e-12 (IRS, bp of
notional)**. The smallest *real* convention effect measured is **0.15bp of
price** (below). Those are separated by ten orders of magnitude, so a threshold
anywhere in the middle distinguishes "same definition, different code" from
"different definition" with no ambiguity.

> **Proposed: 1e-10 on face 1 for bonds, 1e-8 bp of notional for IRS.**
> Six orders of magnitude above observed noise, four below the smallest genuine
> convention difference. Not a tolerance chosen to make anything pass — nothing
> currently sits between 1e-16 and 1.5e-5.

### The actual finding: coupon frequency

`app/cashbond.py:61` sets `FREQ = 4` — KTB cash flows are discounted
**quarterly**. Korean Treasury Bonds pay **semi-annual** coupons. Both were
priced; the comparison is only run on the 22 tenor/seasoning pairs where the
quarterly period count is even, because halving an odd count would move the
maturity and compare two different bonds (KTB 3M and 9M are excluded for that
reason, and the exclusion is stated in the output rather than hidden).

| Convention gap (semi-annual vs quarterly) | n | max | median | p95 |
|---|---:|---:|---:|---:|
| dirty price, bp of price | 22 | **0.6245** | 0.1468 | 0.6147 |
| DV01, % of DV01 | 22 | **0.4476%** | 0.4046% | 0.4419% |

Worst case **KTB 30Y at t+90d: −0.6245 bp of price = −6,245,108 KRW on a 100bn
clip**. The DV01 gap is systematic at ~0.4% across every tenor.

**[OWNER 2026-09-01] `FREQ = 4` is intentional.** Asked and confirmed. The model
is a synthetic on-the-run par bond discounted at a single yield, with the coupon
set to that day's 민평 yield rather than read from a bond master, so quarterly
discounting is a modelling choice and not an oversight. Nothing to change.

What this pass adds is the size of the resulting offset, which was not
previously quantified: **DV01 runs ~0.4% below the semi-annual term-sheet
convention, systematically, at every tenor.** That is a known one-directional
bias now, rather than an unknown one. It matters only where a DV01 from this
model is compared against one computed on term-sheet conventions — e.g. against
a broker's or a risk system's number — and 0.4% is small enough that it will
look like noise rather than a convention gap unless someone knows to expect it.

### T2b — not run

**Skipped on the licence, not on convenience.** rateslib 2.7.1 restricts by
purpose (§1), so the plan's mitigation of relocating outside the repo does not
apply. Raised with the owner, who stated the environment is not commercial;
the recommendation stands that T2a is the stronger check regardless — the plan
says so itself — and that a third opinion is worth buying only if T2a's
residuals had shown something. They did not: they are at machine epsilon.
Nothing about rateslib entered this repo in any form.

---

## 5. Ladder shadow

`backend/research/ladder/` → `docs/q1/ladder_equivalence.csv`,
`docs/q1/ladder_grid_case.csv`. Adapted from gs-quant (Apache-2.0); no code
vendored, no dependency added — attribution is in the module docstring.

### §5.3 equivalence, full live book

As-of 2026-08-28. **52 positions** — every KTB tenor the 민평 matrix carries,
long and short, fresh and seasoned — over **13 tenors** = **676 cells**. Wide
ladders produced by the product's own `app.cashbond._krd_bond`, imported.

```
per-instrument residual   : max |Δ| = 0        <- exactly zero, 676/676 cells
non-zero cells            : 0
book gross KRD            : 2,267,971,182.26 KRW/bp
```

**The gate is met: exactly zero, not "small".**

At **book** level the two paths differ by **2.98e-08 KRW/bp**, which needs
explaining rather than rounding away. It is float summation order: the wide path
accumulates `+=` in book order, the long path sums inside a `groupby`. Measured
against `math.fsum` (exactly rounded, order-independent):

```
wide vs exactly-rounded : 2.98e-08
long vs exactly-rounded : 7.45e-09     <- the long path is CLOSER to truth
relative to gross       : 1.31e-17     <- below float64 epsilon (2.2e-16)
```

So the disagreement is not about what was computed. The long path is
incidentally the more accurate of the two.

*(The book nets to zero by construction because it holds matched long/short
pairs; the gross column is reported alongside so the cells are visibly
non-trivial — e.g. 7Y gross 232,025,730 KRW/bp.)*

### §5.4 differing grids — the case the wide format cannot handle

Two real instruments: a KTB bond ladder on the 민평 grid (13 nodes) and an IRS
DV01 strip on the curve grid (15 nodes).

```
only on the bond grid : ['2.5Y', '20Y', '30Y']
only on the swap grid : ['1D', '4Y', '6Y', '8Y', '9Y']
```

- Long format: **28 rows, 18 distinct buckets, no alignment code.**
- Wide format keyed on the bond grid would **silently drop** 1D, 4Y, 6Y, 8Y, 9Y.
- Wide format keyed on the swap grid would **silently drop** 2.5Y, 20Y, 30Y.

And the ordering, on the union of the two grids:

```
string sort   : 1.5Y 10Y 1D 1Y 2.5Y 20Y 2Y 30Y 3M 3Y 4Y 5Y 6M 6Y 7Y 8Y 9M 9Y
tenor_days    : 1D 3M 6M 9M 1Y 1.5Y 2Y 2.5Y 3Y 4Y 5Y 6Y 7Y 8Y 9Y 10Y 20Y 30Y
```

**No product surface was changed.** The existing ladder is untouched.
`research/tests/test_ladder_longform.py` (15 tests) pins ordering, the
zero-vs-absent distinction, and cross-grid aggregation.

---

## 6. Regime comparison — a comparison, not a recommendation

`backend/research/stats/regimes.py`, run in `.venv-q1` on
`KTB_10Y_bp` daily **changes** (T4 convention), n=1,633, 2020-01-03 … 2026-08-28.
→ `docs/q1/regime_comparison.csv`, `docs/q1/regime_sensitivity.csv`.

All three label the same series over the same window; states are ordered by
fitted volatility so "high-vol" means the same thing in each, rather than
whichever index the optimiser numbered first.

### Where they agree

| Pair | Agreement |
|---|---:|
| MarkovRegression(k=2) vs hmmlearn(states=2) | **98.2%** |
| ruptures(pen=20) vs hmmlearn(states=2) | 69.2% |
| ruptures(pen=20) vs MarkovRegression(k=2) | 67.9% |
| all three identical | 67.6% |

| Method | high-vol share | sd hi / lo (bp) | switches |
|---|---:|---|---:|
| ruptures(pen=20) | 0.0% | — / 5.00 | 0 |
| MarkovRegression(k=2) | 32.1% | 7.20 / 3.51 | 12 |
| hmmlearn(states=2) | 30.8% | 7.27 / 3.56 | 8 |

**Where they disagree, and why.** The 98.2% agreement between the two
likelihood-based methods is genuine corroboration: two independent
implementations find the same ~31% of days at roughly double the volatility.
The disagreement is entirely ruptures, and it is not a modelling difference —
**at pen ≥ 20, PELT finds zero breakpoints**. "0.0% high-vol" therefore means
"no change points detected", not "no volatile days", which is why the
breakpoint count is reported separately from the label.

### Hyperparameter sensitivity

| Method | Param | Breakpoints | High-vol | Switches | Agrees with base |
|---|---|---:|---:|---:|---:|
| ruptures | pen=5 | 2 | 26.9% | 2 | 73.1% |
| ruptures | pen=10 | 2 | 26.9% | 2 | 73.1% |
| ruptures | pen=20 | **0** | 0.0% | 0 | 100% |
| ruptures | pen=50 | 0 | 0.0% | 0 | 100% |
| ruptures | pen=100 | 0 | 0.0% | 0 | 100% |
| MarkovRegression | k=2 | — | 32.1% | 12 | 100% |
| MarkovRegression | k=3 | — | 23.9% | 10 | 91.7% |
| hmmlearn | seed=0…4 | — | 30.8–31.0% | 8–9 | 99.8–100% |
| hmmlearn | states=3 | — | 15.7% | **502** | 84.8% |
| hmmlearn | states=4 | — | 21.9% | 8 | 91.1% |

Each method's fragility is in a different place. **ruptures** falls off a cliff
between pen=10 and pen=20 — 26.9% to nothing. **hmmlearn** is reassuringly
seed-stable (identical for 4 of 5 seeds) but state-count-fragile: at 3 states it
produces **502 switches against 8**, which is not a regime series, it is noise.
**MarkovRegression** is the steadiest across its own knob (91.7% agreement
between k=2 and k=3).

No recommendation is made. If one were forced, the pair that agrees 98.2% is the
evidence, and ruptures' penalty would need to be selected on a stated criterion
before it could be used at all.

---

## 7. Warm-up guard audit

`backend/research/stats/guards_audit.py` → `docs/q1/warmup_audit.csv`.
**7 rolling-statistic sites audited: 6 guarded, 1 gap.**

| Site | Statistic | Floor | Guarded |
|---|---|---|---|
| `app/mrbacktest.py:64` rolling_series | SMA / population σ / z | `lookback` | ✅ |
| `app/mrregime.py:43` realized_vol | realised vol of diffs | `win` (exact) | ✅ |
| `app/mrregime.py:59` vol_percentile | expanding percentile | 1 prior obs | ✅ |
| `app/derive.py:57` | moving average | window | ✅ |
| `app/rv.py:578` vol_3m | 3M realised spread vol | 26 changes | ✅ |
| `app/volatility.py` | short/long vol ratio | 60 obs | ✅ |
| **`app/rv.py:735` z_score** | **z-score** | **2** | ❌ |

Call sites of the unguarded one: `rv.py:956` (`z52`), `:957` (`zAll`),
`:1173`, `:1180`, `:1184`.

**The mechanism.** `window_vals()` (`rv.py:572-575`) slices the last 252 rows and
*then* drops `None`s, so a nominal "52-week" window on a sparse credit series can
reach `z_score` holding two observations. `z_score` rejects only `n < 2`.

**Why it matters, measured:**

```
n=  2  [100.0, 101.0]     z = 0.7071067811865475
n=  2  [100.0, 180.0]     z = 0.7071067811865475
n=  2  [3.0, 3.0001]      z = 0.7071067811896876
n= 60  60-point ramp      z = 1.6891650862259129
```

With n=2 the sample sd is |a−b|/√2, so **z collapses to ±0.7071 for any two
distinct values**. `[100, 101]` and `[100, 180]` produce an identical z. It is a
sign, printed as though it were a magnitude. The `obs` count travels alongside
in the payload but does not gate the value.

The codebase already applies the correct principle one function away —
`rv.vol_3m` refuses below 26 changes, with the comment *"지어낸 σ 로 나눈 배수는
숫자처럼 보이는 잡음이다"*. That reasoning simply was not applied to `z_score`.

**Not fixed in this pass.** `research/tests/test_warmup_guards.py` — **2 passed,
7 xfailed (strict)**. The xfails assert the wanted behaviour; the day a real
floor lands they become XPASS and fail the suite, which is the notification that
the gap closed.

### Recommended floor: 26

The floor is not a taste question, because the maximum attainable |z| is bounded
by the sample size: with sample sd (ddof=1), `max|z| = (n-1)/sqrt(n)`.

| n | max attainable \|z\| |
|---:|---:|
| 2 | 0.71 |
| 3 | 1.15 |
| 5 | 1.79 |
| **6** | **2.04** |
| 8 | 2.47 |
| 10 | 2.85 |
| 20 | 4.25 |
| **26** | **4.90** |
| 252 | 15.81 |

So a z-threshold of ±2 is **mathematically unreachable below n=6** — the cell
cannot flag, however the market moves — and anywhere near the bound the z is
pinned by the sample size rather than measured from the data.

**Recommend 26**, matching `rv.vol_3m`. Three reasons: it is already this
codebase's stated floor for a thin-sample refusal and carries a written
rationale, so it needs no new justification; it puts the bound at 4.90, which
leaves the thresholds actually in use comfortably attainable rather than pinned;
and one number for both means one thing to remember instead of two. The
floor-of-the-floor is 6 — below that the estimator cannot express the thresholds
the screen uses — but 6 would only make the value *attainable*, not *stable*.

### T4 — spread volatility convention: already correct

Every site that measures spread vol **differences** the spread:
`rv.vol_3m` (`seq[i] − seq[i−63]`), `mrregime.realized_vol` (`vals[i] − vals[i−1]`),
`app/volatility.py` (mean absolute change). **No defect to report.**

Quantified on real zero-crossing series (KTB minus its own 60-day mean, bp), so
the finding is falsifiable rather than an assertion:

| Series | Range (bp) | Crosses zero | sd of differences | sd of returns | Ratio |
|---|---|---|---:|---:|---:|
| KTB 3Y | −59.2 … 116.5 | yes | **4.83 bp** | 233.2% | 48× |
| KTB 5Y | −63.7 … 112.5 | yes | **5.08 bp** | 1548.9% | 305× |
| KTB 10Y | −70.1 … 94.4 | yes | **4.99 bp** | 1240.7% | 249× |

The returns column is what the wrong convention would have produced.

### T1 — GARCH

`backend/research/stats/garch.py` → `garch_conditional_vol.csv`, `garch_params.csv`,
`garch_conditional_vol.png`. Fitted to daily **changes in bp**, so conditional σ
is in bp/day and needs no rescaling downstream.

| Series | ω | α₁ | β₁ | α+β | Uncond. σ | Cond. σ range |
|---|---:|---:|---:|---:|---|---|
| KTB 3Y | 0.1236 | 0.1004 | 0.8996 | **1.00000** | **does not exist** | 1.42 – 16.27 bp/day |
| KTB 10Y | 0.1381 | 0.0643 | 0.9330 | 0.99733 | 7.19 bp/day | 2.49 – 11.37 bp/day |

**Implication for a breakeven-volatility calculation.** KTB 3Y sits **exactly on
the IGARCH boundary**: variance shocks never decay and the unconditional variance
is undefined. There is no long-run σ to quote a breakeven against — it must be
quoted against the conditional σ of the day, which spans **11.5×**. For 10Y the
unconditional value exists but overstates by 2.9× in calm and understates by 1.6×
in stress, and its 259-day half-life makes the "long-run average" a 1.0-year
concept, not an anchor for a trade held weeks.

### T5 — skipped: no panel source

`app.creditmatrix` is keyed `(bond_type, tenor)` where `bond_type` is an
instrument **class** (8 of them: KTB, 통안채, and rated credit buckets), giving a
class × tenor × date cube. **There is no issuer × date panel in the database
this backend reads.** Reported as "no panel source available" and skipped; no
panel was manufactured from swap data.

---

## 8. Tearsheet validity

`backend/research/tooling/run_backtest_export.py` (app venv) →
`backend/research/tooling/tearsheet.py` (`.venv-q1`) →
`docs/q1/tearsheet_bss3y.html`.

No persisted run and no `−114,000,000` anchor exist (§2f), so per the owner's
instruction a run was computed in-process: the product's own engine
(`app.mrbacktest.simulate`) on the product's own series (`app.mr.series_points`),
BSS-3Y, lookback 120, entry z 2.0, exit z 0.5, stop z 4.0, cost 0.5bp one-way,
notional 1e8 KRW/bp, tradable direction −1 only (the desk does not short cash),
2014-06-03 … 2026-08-28, 3,015 bars, 30 trades.

### The gate

| | KRW |
|---|---:|
| engine cumulative PnL | 5,885,000,000.00 |
| exported series last value | 5,885,000,000.00 |
| exported series sum(daily) | 5,885,000,000.00 |
| **delta (engine − exported)** | **0.0000000000** |
| **EXACT MATCH** | **True** |

Headline reconciliation: max drawdown engine 1,730,000,000.00 vs recomputed
1,730,000,000.00; win rate 0.7667; open PnL −150,000,000 (included in the total,
not a separate bucket).

**Caveat stated plainly:** the anchor is the engine's own total for the run this
pass computed. That proves the tearsheet consumes the series faithfully; it does
**not** independently validate the engine. It is a weaker gate than the plan
intended, and it is weaker because the reference run the plan assumed does not
exist.

### The unit finding

quantstats is built for returns on a capital base; this strategy has none — PnL
is `notional × Δspread` in KRW. Feeding a PnL series to it as returns would
silently produce a different Sharpe, so the equity curve is formed against a
**declared** 10bn KRW base and both conventions are reported:

| Convention | Sharpe |
|---|---:|
| engine `summary['sharpe']` (PnL-Sharpe) | 0.650124 |
| recomputed PnL-Sharpe | 0.650016 |
| return-Sharpe on 10bn base | **0.662585** |

The engine and this desk quote the PnL-Sharpe (the same convention gs-quant's
`summary_stats` uses). quantstats reports the return one. They are not
interchangeable and the 1.9% gap is entirely the choice of base. The 1.08e-04
gap between the two PnL-Sharpes is a population/sample σ detail, not a defect.

---

## 9. vectorbt

**Cleared on packaging, then failed stage 1, so the sweep was not run.**

The plan predicted numba would block it. **numba 0.67.0 compiles `@njit` fine**
on py3.13 + numpy 2.5.1. vectorbt 1.1.0 nonetheless failed to import — on
`plotly`: it references `scattermapbox`, removed in plotly 6. Pinning
`plotly<6` (5.24.1) in `.venv-q1` resolved it. Different blocker, different fix.

Stage 1 was run layer by layer, because a headline PnL that matches while trade
dates differ is not a replication.

| Layer | Result |
|---|---|
| 1 signal — rolling z, population σ, trailing-inclusive | reproduced; warm-up boundary exact (z[118] NaN, z[119] finite) |
| 2 positions | engine in-market 382 bars, values {−1, 0} |
| 3 trades | engine 30, replica 30 entries / 29 exits — **count matches** |
| 3′ bar-by-bar mask | **2,986 / 3,015 agree (99.04%) — 29 bars disagree** |
| **STAGE 1 EXACT** | **False** |

**Diagnosis, from the measurement.** The 29 disagreeing bars fall in **29 runs of
exactly 1 bar**, against **29 exits**, and the replica holds 411 bars vs the
engine's 382 — a difference of exactly 29. That is an **exit-bar convention
difference**: the engine is already flat on the bar the exit signal fires; the
replica still counts it as held.

This is precisely the class of error a parameter surface hides. One bar in a
hundred, moving every cell slightly, and nothing on the surface would look
wrong. **Stopped, as the plan requires.**

**Verdict.** vectorbt is the wrong shape here regardless: `from_signals` models
long/short on a *price*, while this book trades a bp *spread* sized in KRW/bp —
there is no price series to consume and no share count that means anything.
Matching the engine exactly would mean reimplementing `mrbacktest.simulate`
inside vectorbt, creating a second place for the logic to drift, for no gain:
that engine is already a fast pure loop and a sweep should call it directly.

---

## 10. Design notes — borrows #2 and #3

### Two-pass engine (Trigger / Action / Handler + CalcType)

**The ratio, which is the argument.** Reading `app/mrbacktest.py:256-410`, the
rules the current backtest actually contains:

| Rule | Input | Class |
|---|---|---|
| entry `_entry_signal(z, i, entry_z, mode)` (`:300`) | exogenous z | **pre-computable** |
| stop `abs(z) >= stop_z` (`:328`) | exogenous z | **pre-computable** |
| exit `abs(z) <= exit_z` (`:329`) | exogenous z | **pre-computable** |
| reverse-exit (`:333-334`) | exogenous z | **pre-computable** |
| gate `gate[i]` (`:384`) | exogenous series | **pre-computable** |
| time-stop `(i - entry_idx) >= time_stop` (`:335`) | entry index | sequential |
| one-position-at-a-time `hold != 0` (`:300`) | prior state | sequential |

**5 of 7 are pure functions of exogenous series. Zero are path-dependent in the
gs-quant sense** — nothing reads a risk measure, a PnL level or a drawdown. The
two sequential rules depend only on the entry schedule, which is itself derivable
once the entry signals are known.

That is the argument, and it is stronger than the aesthetic case: **every entry
and exit date in this engine is knowable before anything is priced.** A two-pass
restructure would materialise the whole position book in pass 1 and price the
entire (date × instrument) grid in one batch, with no day loop at all for the
current rule set. The day loop only becomes necessary when a genuine risk-state
rule is added — which is exactly when the split starts paying.

**Files that would change:** `app/mrbacktest.py` (the loop, split into
schedule-build and evaluate), `app/backtest.py:719-745` (the position/label
seeding, which is where the pre-computable set is already implicitly built),
`app/main.py:1087` (the call site). `app/mr.py` unchanged.

**What would break:** the LCG KPI fixture in `tests/test_mrbacktest.py` locks
the engine to a PMS-original vector; a restructure must reproduce it
bit-for-bit or the lock is meaningless. That fixture is the reason to do this as
its own pass.

### Declarative shocks (Pattern × Shock)

**Scenario functions that exist today:** `app/labscenario.py`,
`app/policy.py` (MPC path overrides), the `basis`/`scenario_basis` artifacts, and
the RV `_cross_sector_rel` / `_curve_rel` axes. The MPC override path
(`rv.parse_meetings`, `2026-08-27:-25;2026-10-22:0`) is *already* a declarative
shock in string form — a date-keyed set of absolute bp moves — which is
encouraging: the vocabulary exists, it is just not composable.

**How many collapse:** a single
`CurveShapeScenario(pattern, parallel_bp, slope_bp, pivot_tenor)` covers the four
bull/bear × steepener/flattener corners plus parallel, i.e. **five named
scenarios become one object with four numbers**. The MPC path is a second object
(`ShockScenario` with date-keyed absolute shocks).

**What would break:** persisted scenario definitions in
`backend/output/scenario_basis.json` and `src/lab/scenario/basis.json` (shape
change); the `/api/labscenario` payload; and the golden fixtures in
`guards/scenario-parity.test.ts` and `guards/model-strategy-basis.test.ts` —
**which are 2 of the 6 tests already failing at baseline** (§12), so their
current state must be resolved before they can serve as a migration check.

### Which first, and why

**The ladder (§5), which this pass already did as a shadow — then declarative
shocks, then the two-pass engine.**

The ladder is done and proven at zero residual; migrating it is a mechanical
change to three call sites with an equivalence test already written. Declarative
shocks come next because the vocabulary already half-exists and the blast radius
is a payload shape plus two fixtures. The two-pass engine last: it is the largest
win but it rewrites the loop that a bit-exact KPI fixture locks, and there is no
performance pressure yet — 3,015 bars run in under a second.

### What gs-quant's absence means for this stack

The study found gs-quant has **no walk-forward, no purged CV, no
multiple-testing correction, no multi-seed protocol, no randomised-entry
control**. This pass corroborated the shape of that gap from the other side:
§6 shows that a regime label from a single method and a single hyperparameter is
not a result (ruptures: 26.9% → 0% between pen=10 and pen=20; hmmlearn: 8 → 502
switches between 2 and 3 states), and §9 shows a 1%-of-bars convention error
would have propagated silently into a parameter surface.

So the division is clean: **borrow the execution skeleton — when to act, what to
do, how to book it, how to batch it — and borrow none of the validation
statistics, because there are none to borrow.** The existing lanes' machinery
(purged CV, DSR, pre-registration) is ahead of gs-quant here and should stay the
authority.

### ORE — still deferred

`app/labscenario.py` and the `scenario_basis` artifacts are the backend's
portfolio-scenario path, and they are curve-shape driven rather than
XML-configured. ORE's analogue would be its scenario generator plus sensitivity
framework, which is worth *reading* for its shock taxonomy (parallel / bucketed /
custom curve, with a documented shift-type vocabulary) if declarative shocks
proceed. It is not worth installing: it is a C++ build with a QuantLib
dependency this repo has deliberately avoided (§2a), and the taxonomy is
readable from documentation without it. No installation attempted.

---

## 11. Blocked items

| Item | Blocked by |
|---|---|
| §4 T2b rateslib | Licence restricts by purpose (§1). Recommendation stands; nothing entered the repo. |
| §6 T5 linearmodels panel | No issuer × date panel exists in the database this backend reads (§7 T5). |
| §7 T2 vectorbt sweep | Stage 1 replication failed at 99.04% — a 1-bar exit convention gap (§9). Stopped as instructed. |
| §7 T1 independent anchor | No persisted run and no `−114,000,000` reference exist. Gate weakened to the engine's own total, stated as such (§8). |
| pyfolio-reloaded fallback | Pins `pandas<3.0`; app venv is 3.0.5. Never needed — quantstats worked. |
| `krholidays` | Does not exist on PyPI. |

---

## 12. Gate results

| Gate | Compared against | Result |
|---|---|---|
| App venv `pip freeze` diff | 336 packages at start | **NOT EMPTY — 337 at end, `olefile==0.47` appeared. See note.** |
| braveworld HEAD | `25fa243bd915a99055c513b61fade8450b051489` | **identical — PASS**, zero bytes written |
| Backend pytest | 976 collected at start (968 passed / 7 skipped / 1 xfailed per `HANDOFF-test-staleness-2026-09-01.md` §7) | **1,185 passed / 7 skipped / 8 xfailed / 0 failed** (726s) — PASS |
| New research tests | — | **211 + 9 = 220**, enumerated below |
| Frontend files changed by me | 6 files modified at start | **same 6 — zero changed by me** |
| Frontend vitest | 1,548 tests, 6 pre-existing failures | unchanged set (§below) |
| Guard: `app/` imports `research/` | 0 | **0 — PASS** (157 production files scanned) |
| Ladder equivalence | exactly 0 | **0 across 676/676 cells — PASS** |
| Cross-check residual | no threshold set pre-hoc | max 2.22e-16 (bond), 7.15e-12 bp (IRS); threshold **proposed** for sign-off, not applied |
| Tearsheet total | engine 5,885,000,000.00 | **5,885,000,000.00, delta 0.0000000000 — PASS** |

### Note on the venv gate — it did not stay clean, and it was not fixed

The app venv held **336** packages at session start and **336** at the
mid-session snapshot (`appvenv_freeze_END.txt`, taken after the first full
suite run). At the end it holds **337**: `olefile==0.47`, installed at
**2026-09-01 11:10:13**.

What can be said with evidence:

- **No `pip install` was issued against the base interpreter in this session.**
  Every install went to `Projects\research\q1-probe\.venv-q1` via
  `./.venv-q1/Scripts/python.exe -m pip`, and the mid-session snapshot at 336
  confirms the venv was still clean after all of this pass's installs and after
  matplotlib had already written its PNG.
- The 11:10:13 timestamp falls inside the clean-rerun window, during which the
  only thing this session ran was `pytest`, which installs nothing.
- `olefile` is a Pillow companion package. Nothing in `backend/research/` needs
  or imports it.
- **Three other sessions were active on this machine throughout** (futures,
  control-typography, model-baking lanes; 54 files modified in this repo by
  them).

What cannot be said: which session installed it. That is not provable from here,
and this report does not assert it.

**It was deliberately not removed.** Uninstalling from a venv another session may
be depending on is a destructive cross-session action, and a package that arrived
for a reason should not be reverted by a lane that does not know the reason. The
gate is reported as failed rather than made to look green.

### New tests, by name

`backend/research/tests/` — **220 tests: 211 passed, 2 passed + 7 xfailed.**

- `test_calendar_canonical.py` — **39**: 9 × workers-day-not-a-business-day, 9 × backend-disagrees-here, 6 × temporary/statute holidays, 12 × KRX year-end still a bank day, 3 × CD91 fixing convention.
- `test_ladder_longform.py` — **15**: tenor ordering (incl. 7 parametrised day values), unparseable label raises, round-trip exactness, zero-vs-absent, cross-grid aggregation, instrument dimension survives.
- `test_no_app_imports_research.py` — **157**: one per production module under `app/`, `irs_pricer/`, `bigfoot/`, `wiring/`, plus a self-check that the scan is non-empty.
- `test_warmup_guards.py` — **9**: 2 passed (the ±0.7071 fact; the guarded sites stay guarded), **7 xfailed strict** (z_score should refuse n=2; should refuse thin windows ×5; window should count observations not rows).

### Frontend

Baseline and end are the same 6 pre-existing failures, all in `guards/`:
`model-contracts` (engine_status byte equality), `model-strategy-basis`,
`model-strategy-note`, `scenario-parity`, and 2 in `production-env`. Four are the
model-artifact basis drift that recurs on every backend restart; two are `.next`
build-artifact checks. None is in an area this pass touched, and no frontend file
was modified by this session.

The plan's stated gate (`vitest 575`, all green) does not describe this repo:
the suite is **1,548 tests** and is **not green at baseline**. The defensible
gate — and what is claimed here — is *zero frontend files changed by this
session*, provable from `git status` and the commit paths below.

### Commits

Per the standing owner rule in `HANDOFF-test-staleness-2026-09-01.md` §1
("커밋 금지 … 오너가 명시적으로 지시할 때까지"), the owner was asked and granted
permission for this pass. Commits use explicit paths only:

```
git commit --only -- backend/research docs/q1
```

Nothing outside those two trees is staged. 40 files modified by concurrent lanes
(futures, control-typography, model-baking) were present throughout and were
left untouched.
