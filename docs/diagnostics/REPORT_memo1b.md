# MEMO-1B — schedule memo installed; simulation path measured

**Outcome: the memo is in, on branch `memo1b`, unpushed.** GATE 1 passed
authoritatively (exit code 0, 380 passed / 1 skipped / 1 xfailed against a
366/1/1 baseline). Step D was skipped under its own rule. Step F measured and
implemented nothing, as instructed.

Commits, on `memo1b` off `38325497`:

| hash | what |
|---|---|
| `e56a3bd9` | named reference runs (`bench_backtest.py`, `bench_simulate.py`) |
| `ea39c62a` | the schedule memo, its guard, and 14 tests |

---

## 1. Production safety

### What this tree serves

**Both, and the live path is reachable from here right now.** Tailscale Funnel
is ON and proxies the public internet straight into this machine:

```
https://e110430.tailc7b701.ts.net (Funnel on)
|-- / proxy http://127.0.0.1:8100
```

The deployed Vercel site serves committed static JSON for most endpoints, but
`/api/backtest`, `/api/simulate`, `/api/market-data/*`, `/api/positions*` and
`/api/instruments*` are LIVE-ONLY by design — `frontend/next.config.ts:74`
rewrites them to `BACKEND_ORIGIN`, and that origin is the funnel above.
(The comment at `next.config.ts:70` still says "Unset — the local default and
the current deployment"; the running funnel says otherwise. Treat the comment
as stale, not the funnel.)

### Processes on the serving path

| PID | port | what | verdict |
|---|---|---|---|
| **5800** | **8100** | `uvicorn app.main:app --port 8100` | **LIVE PRODUCTION.** Funnel target. Untouched. |
| 13852 | 3100 | `next start --port 3100` (this tree's FE) | local only; left running |
| 9452 | 8200 | `uvicorn app.main:app --port 8200` | sauron-v2's copy; not mine |
| 22448 | 3200 | `next start -p 3200` (sauron-v2) | not mine |
| 4796 | 8101 | `uvicorn app.main:app --port 8101` | another session's; not mine |
| 532 | 8777 | `http.server` | not mine |

`:8000` has no listener — the frozen krw-fi-pms is not running and nothing here
went near it.

### Protection rules derived, and what was declined

1. **Never bind, stop or restart :8100.** All verification ran in-process under
   `pytest`; no server was started by this pass at any point.
2. **`scripts/gate.ps1` mode 2 — SKIPPED for safety, and the port override does
   not rescue it.** Mode 2 spawns `uvicorn … --port $BackendPort` (default
   8100) and then runs the agreement suite. With production already bound, the
   spawned process cannot bind, `Test-PortListening 8100` sees *production*
   still listening, and the gate would report "backend up" and run the suite
   against the live service. Passing `-BackendPort 8109` does **not** fix it:
   `tests/test_static_agreement.py:41` hardcodes
   `BASE = "http://127.0.0.1:8100"`, so the backend would move and the test
   would still probe production. Mode 2 is unrunnable here without taking the
   live port. Not scheduled, not retried.
3. **`scripts/refresh.ps1` — declined.** Also spawns a backend on :8100, and
   performs a data refresh besides.
4. **`ops/morning_bake.ps1` — declined.** Its stage 1 kills the :8100 listener
   directly (`58fb72c0`), which is precisely the 502 this pass must not cause.
5. **No `git push`, to any remote.** Including the mirror — see §9.
6. No change to build config, deploy config, env files, or
   `frontend/public/api/**`.

**HALT condition not triggered.** The memo is verifiable entirely in-process:
`pytest` imports the app directly and the two lifespan-entering tests use
`TestClient`, which needs no port. Nothing about installing or gating it
requires the live path.

---

## 2. Step A — isolation, baseline, reference run

**Worktree:** `…/scratchpad/wt-memo1b`, branch `memo1b`, created off
`38325497`. Creation succeeded, so the degraded measurement-only branch did not
apply.

Isolation earned its keep: while this pass ran, the other session committed
`ef98badc` (테너별 세타) to `main` in the shared tree. The worktree is branched
from `38325497` and never saw it.

**Baseline (Step A.2): 366 passed, 1 skipped, 1 xfailed — identical to
MEMO-1's.** No delta, so no source to identify and MEMO-1's counts are adopted
unchanged. The skip is `test_reference_sheet.py` (no sheet in
`data/reference/`); the xfail is `test_validation.py::test_round_trip_swap_tenors_to_1e8`,
a strict xfail documenting an accepted bootstrap limitation.

**Step A.3:** no dev server was started against the worktree. The `:3100` and
`:3200` servers belong to other trees and were left alone, so all wall times
here carry ambient contention — they are internally comparable (same machine,
same session, memo off vs on) and should not be compared across sessions.

### Step A.4 — the reference-run ambiguity, resolved

MEMO-1 quoted "~4–5s of a ~18s post-memo run" beside a 14.92s baseline. Those
cannot be reconciled by arithmetic **because they are not the same clock**:

```
14.92s baseline / 8.26s post-memo        <- WALL   (no profiler)
37.7s total / 19.4s in _build_schedule   <- PROFILED (cProfile attached)
```

cProfile costs ~2.16× on this workload (measured below: 38.28s profiled vs
17.74s… on the *same* configuration whose wall time is 8.23s). The "~18s" was
*profiled-minus-19.4*, silently compared against *wall* savings. Same engine,
two units, one sentence.

Committed in `e56a3bd9`:

| run | fixture | reproducible? |
|---|---|---|
| **RUN-BT-XLSX** | `data/irsdata.xlsx` | no — stamps size + mtime each run |
| **RUN-BT-SYNTH** | `tests/characterization.py` | yes — reads nothing from disk |
| **RUN-SIM-REP** | `tests/data/simulate_request_representative.json` | yes |

Both scripts take `--mode wall|profile` and `--memo on|off`.

**One caveat on comparability with MEMO-1.** The worktree checks out the
*committed* `irsdata.xlsx` — 776,011 B, 2,616 rows, ending **2026-08-05**.
MEMO-1 measured the shared tree's *uncommitted working copy* — 2,621 rows,
ending 2026-08-12 (the bake writes this file but the data commits go to the
`deploy` branch, so `main`'s copy lags). That is why the memo-off figures below
land at 6.02 / 6.55 / 15.07 against MEMO-1's 5.93 / 6.49 / 14.67 rather than
exactly on them. Call counts, which do not depend on the extra five rows, match
to the unit: 14,376 + 25,428 = **39,804**.

---

## 3. Step B — holiday invariant across the whole key space

All 6 schedules built twice, in **separate processes** so build order is
genuinely reversed: one cold (preload table), one with expansion to 2059 forced
*before* any build.

```
cold process: holiday table 375 -> 375
warm process: holiday table 375 -> 695  (expanded BEFORE building)

schedule    pays       start     maturity  verdict
10Y           40  2021-08-03   2031-08-01  IDENTICAL
3Y            12  2021-08-03   2024-08-02  IDENTICAL
10Y-sp        40  2021-08-03   2031-08-01  IDENTICAL
2Y             8  2021-08-03   2023-08-03  IDENTICAL
5Y            20  2021-08-03   2026-08-02  IDENTICAL
10Y-fly       40  2021-08-03   2031-08-01  IDENTICAL
```

Every pay date, accrual and boundary date compared. **6 of 6 identical → the
key was NOT widened.**

### Append-only, with the mechanism

MEMO-1 said expansion happens because `__contains__` populates before
answering. The location was wrong and the conclusion was right — worth
correcting because the wrong location suggests the wrong fix. `__contains__`
calls `dict.__contains__` directly; the expansion is one level up, in
`__keytransform__`, which runs *first*:

```python
if self.expand and dt.year not in self.years:
    self.years.add(dt.year)
    self._populate(dt.year)
```

So a bare `in` does expand (375 → 395 on a 2044 lookup), and it expands
*before* the lookup, so the answer never depends on prior state. And
`_populate(year)` only adds that year — populating 2036..2059 leaves 2021's 18
holidays byte-identical (measured). **Expansion can only append beyond the
preload horizon; it cannot revise a date the narrower table already covered.**

Note the cold run stayed at 375: this book's longest maturity is 2031-08-01,
inside the preload. Expansion is reachable in ordinary operation — a 10Y struck
2026-08-12 matures 2036-08-10 — which is why the invariant needed proving, and
that case is pinned in `test_schedule_cache.py`.

---

## 4. Step C — what was installed

`backend/app/schedule_cache.py`, new, wrapper not edit — `install()` rebinds
`VanillaSwap.to_irs_trade`, exactly as `curve_cache.py` rebinds
`bootstrap_zero_curve`. That shape is forced, not stylistic:
`test_valuation_port.py::test_nothing_was_quietly_added_to_the_port` asserts
that the top-level bodies of `app/valuation_port.py` minus the frozen repo's
are exactly `{"CurveBundle"}`, so adding a memo *into* that module fails the
suite even without touching a ported line.

Wired into the app lifespan in `backend/app/main.py`, beside `curve_cache`.

| aspect | decision |
|---|---|
| key | swap identity, 7 fields (`tenor_years`, `notional`, `fixed_rate`, `pay_fixed`, `float_spread`, `trade_date`, `maturity_date`). Not widened. |
| `trade_date=None` | **fallthrough** to the uncached original, not an `assert` — see below |
| immutability | tuples + frozenset + `_FrozenIRSTrade` re-class refusing `__setattr__`/`__delattr__` |
| kill switch | `BW_SCHEDULE_CACHE=0`, plus `uninstall()` at runtime |
| eviction | `lru_cache(maxsize=4096)` |

**Sizing.** `MAX_POSITIONS` is 12 and a fly is 3 legs, so one request mints at
most 36 keys (the reference book mints 6). 4,096 is >100× the worst single
request at roughly 12 MB — deliberate headroom against the silent LRU cliff
`curve_cache.py:110-127` documents, where a cyclic pattern exceeding capacity
by a few percent collapsed the hit rate to ~0.

**The fallthrough is a deliberate deviation from the GATE guidance**, which
said to encode the never-`None` invariant as a runtime `assert`. Reasons, all
three of which point the same way: `trade_date=None` is a legal and *correct*
input, so an assert converts correctness into a 500 on a live endpoint;
`assert` is stripped under `-O`, so it is not a guarantee anyway; and
`curve_cache._bootstrap_memoized` sets the house precedent of falling back to
the original on any unkeyable input, "so memoization can never change
behaviour — worst case it stops helping". A fallthrough cannot produce a wrong
answer *or* a new failure mode. Visibility is preserved by
`stats()["fallthrough"]` plus two tests: one that the fallthrough path returns
schedules that differ by valuation date, and one that the repo never takes it.

### Call counts

RUN-BT-XLSX, `_build_schedule` calls:

| configuration | memo off (bt / recon) | memo on |
|---|---|---|
| 1pos-1y-10Y | 764 / 4,770 | 1 / 0 |
| 1pos-5y-10Y | 2,396 / 4,770 | 1 / 0 |
| 3pos-5y-mixed | **14,376 / 25,428** | **5 / 0** |

Across the whole sweep: **39,804 → 7 builds**, final `entries=7`,
`hit_rate=0.9999`. The 3-position book alone mints 6, the predicted shape; the
seventh key is the 1-year config's different entry date. Recon drops to zero
builds because the backtest pass has already cached every schedule it needs.

---

## 5. GATE 1

| check | result |
|---|---|
| characterization pin (`38325497`) green | yes, within the 380 |
| full suite vs the adopted 366/1/1 baseline | **380 passed, 1 skipped, 1 xfailed** = 366 + exactly the 14 new tests; same skip, same xfail, no new xfail |
| exit code | **`PYTEST_EXIT_CODE=0`**, run unpiped |
| immutability guard fails on revert | **proven** — see below |
| wire-format / parity tests green | `test_wire_format.py` green (it drives the real app via `TestClient`, so it exercises this code) |

**On piping.** My first gate run was `pytest … | tail -8`, which reports
`tail`'s exit code, not pytest's — the exact failure mode the ritual warns
about. It was re-run as `pytest … > file 2>&1; echo $?`. Both agreed, but only
the second is evidence.

**Guard-revert proof.** `_freeze`'s body was replaced with `return trade`,
`test_cached_trades_are_frozen` was run, and it failed with
`Failed: DID NOT RAISE AttributeError`. The body was restored from a backup,
the marker string confirmed absent, and the module's 14 tests re-run green.

**One honest limit on `test_static_agreement.py`.** It passed inside the 380,
but it probes the hardcoded `127.0.0.1:8100` — which is *production*, running
code that predates this branch. It therefore validates the committed static
files against the live API; it says nothing about the memo. `test_wire_format.py`
is the one that exercises this branch's code end to end.

---

## 6. Step D — skipped, under its own rule

The rule permits it only if it is "a few lines and does not change any
signature outside the endpoint". It cannot be:

```
backtest.py:827  def run_backtest(dataset, positions) -> dict
backtest.py:903  def book_recon(dataset, positions) -> dict
```

Both build their curve dict internally. Sharing one requires an optional
parameter on **both**, and they have **38 call sites across the test suite**.
That is a signature change well outside the endpoint, for a win MEMO-1 measured
at 0.19s of 14.92s (1.3%) — most of the duplicate work is already absorbed
elsewhere. Skipped.

---

## 7. Step E — re-profile

### Wall clock — RUN-BT-XLSX (2,616 rows, ending 2026-08-05)

| configuration | memo off | memo on | ratio | MEMO-1 published (different xlsx) |
|---|---:|---:|---:|---:|
| 1pos-1y-10Y | 6.02s | **4.68s** | 1.29× | 5.93s |
| 1pos-5y-10Y | 6.55s | **4.72s** | 1.39× | 6.49s |
| 3pos-5y-mixed | 15.07s | **8.23s** | **1.83×** | 14.67s (14.92s monkeypatch → 8.26s, 1.81×) |

The 3-position figure reproduces MEMO-1's monkeypatch experiment to two
decimal places, which is the result that matters — the memo as built performs
exactly as the throwaway probe predicted.

### Profiled clock — same configuration, memo off vs on

```
memo=off   38.28s   94,485,710 calls
memo=on    17.74s   35,777,045 calls      2.16x, 58.7M fewer calls
```

| function | calls off | calls on | cumtime off | cumtime on |
|---|---:|---:|---:|---:|
| `_build_schedule` | 39,804 | **6** | **19.627s** | **0.003s** |
| `_next_business_day` | 1,141,073 | 197 | 3.242s | 0.001s |
| `_modfol_bd` | 1,061,440 | 160 | 3.345s | 0.001s |
| `_is_kr_business_day` | 2,801,912 | **1,090,598** | 4.126s | **1.515s** |
| `df_linear_rate` | 1,684,676 | 1,684,676 | 7.201s | 7.004s |
| `bootstrap_zero_curve` | 4,374 | 4,374 | 5.314s | 5.289s |
| `prev_seoul_business_day` | 515,473 | 515,473 | 2.368s | 2.377s |

**The predicted side effect happened, and partially.** `_is_kr_business_day`
lost 61% of its calls and **2.61s of its 4.13s**. It did not vanish, and the
reason is worth recording rather than filing as noise: the surviving 1,090,598
calls come from `prev_seoul_business_day` (515,473 calls, unchanged), which is
`select_fixing` walking back one Seoul business day to find F(R). That is
fixing resolution, not schedule building, and no schedule memo can touch it.

**The profile re-weighted as predicted.** `df_linear_rate` is now the single
largest item by tottime: its share went **18.8% → 39.5%** of the profiled run
without its absolute cost moving at all. `bootstrap_zero_curve` went
13.9% → 29.8% the same way.

### Recon vs backtest after the fix

| clock | run_backtest | book_recon | recon share |
|---|---:|---:|---:|
| profiled | 6.162s | 11.441s | 65% |
| wall (3pos) | 3.00s | 5.37s | 64% |

Recon was 63.9% of the *builds* before and is ~65% of the *time* after. The
memo did not change which half dominates; it removed a cost both halves paid.

---

## 8. Step F — simulation path (measured; nothing implemented)

### F.1 Where it lives, and whether the memo can reach it

`POST /api/simulate` → `simulation_service.run_simulation` →
`orchestrator._run_simulation_profiled` → `chart.build_chart_data` →
`quant_engine.simulate_irs_path_fm` per swap, plus `recon.build_irs_daily_recon`
and `carry_split.base_cash_carry_paths`.

**It cannot reach the memo, structurally.** The simulation uses a *different*
`IRS_Trade` (`irs_pricer/engine/quant_engine.py`) from a *different*
`VanillaSwap`, and it never calls `to_irs_trade` at all — it constructs
`qe.IRS_Trade(...)` directly in four places (`quant_engine.py:1253`,
`enrichment.py:60`, `recon.py:70`, `swap_inputs.py:133`). The sim's own
`to_irs_trade` (`instruments.py:23`) is called only from `pricing.py`,
`risk.py` and `mtm_valuation.py`, and no module under `services/simulation/`
imports any of the three — they are re-exports on `__init__.py` only.

### F.2 Free win: **none, and measured rather than assumed**

RUN-SIM-REP, wall, best of 2:

| | memo off | memo on | multiple |
|---|---:|---:|---:|
| fan off | 0.14s | 0.14s | **1.00×** |
| fan on | 0.45s | 0.45s | **1.00×** |

with an instrumented counter reporting **0** calls into
`app.valuation_port.to_irs_trade` from the simulation path in every run. The
free-win check is negative, by construction and by measurement.

### F.3 Profile

RUN-SIM-REP is 5 positions / 2 swaps and answers in 0.14s — it is not the slow
case. The live 377-swap book needs `Portfolio Data.xlsx`, which this tree does
not carry (only the gitignored `AS_data.zip`), so the fixture's swaps were
cloned with fanned maturities. **RUN-SIM-SCALE-*n* is not the live book** — the
swaps are clones, not the real distribution — so read it for shape, not as a
prediction.

| swaps | fan off | fan on | fan share |
|---:|---:|---:|---:|
| 2 | 0.14s | 0.45s | 69% |
| 10 | 0.53s | 2.24s | 76% |
| 40 | 2.61s | 11.97s | 78% |
| 100 | 6.36s | 29.54s | 78% |

Linear at ~64 ms/swap (fan off), ~295 ms/swap (fan on). Extrapolated to the
live book's 377 swaps that is ~24s and ~111s — and the repo's own s18 note
records the real book at **109.9s**. The shape model lands within a couple of
percent of the documented reality, which is the most that can be claimed for it.

RUN-SIM-SCALE-100, fan off (what the deployed frontend actually sends),
PROFILED — total 13.95s, 29,353,515 calls:

| cumtime | tottime | ncalls | function |
|---:|---:|---:|---|
| 13.012s | 0.010s | 1 | `chart.py:100(build_chart_data)` |
| **11.103s** | 0.148s | 100 | `quant_engine.py:1116(simulate_irs_path_fm)` |
| **10.339s** | **4.141s** | **2,587,506** | `quant_engine.py:274(df_linear_rate)` |
| 10.314s | 0.663s | 27,300 | `quant_engine.py:1054(compute_npv)` |
| 6.373s | 2.266s | 2,826,883 | `numpy …:1549(interp)` |
| 5.360s | 0.338s | 632,041 | `quant_engine.py:303(forward_rate_simple)` |
| 2.793s | 2.793s | 2,826,883 | `numpy … C interp` |
| 1.233s | 0.018s | 200 | `quant_engine.py:627(compute_irs_krd_map)` |
| 1.025s | 0.003s | 1 | `recon.py:77(build_irs_daily_recon)` |
| 0.852s | 0.003s | 1 | `enrichment.py:14(enrich_irs_pvbp)` |
| 0.851s | 0.069s | 21,825 | `curve_cache.py:147(_bootstrap_memoized)` |
| 0.806s | 0.593s | 2,826,883 | `numpy …:265(iscomplexobj)` |

Two things stand out. **The simulation's number-one cost is the same defect as
the backtest's number-two** — scalar `np.interp` inside a `df_linear_rate`,
here 2.59M calls of it, with 0.81s going to `iscomplexobj` dispatch alone. And
**`curve_cache` is working**: 21,825 lookups collapsed to 915 real bootstraps,
95.8% hit rate, 0.85s total. There is no second schedule-memo-shaped win
waiting on this path.

### F.4 Decision table

**Reachable without a port-pin exemption**

| # | target | measured | rough cost |
|---|---|---|---|
| 1 | **The distribution fan.** 78% of the run at every size — 23.18s of 29.54s at 100 swaps. Already opt-out, and the deployed FE already sends `includeDistribution: false` (`scenario-curves.ts:272`). The residual exposure is that the **backend default is `True`**, so any client that omits the flag silently pays 4.6×. | 23.18s of 29.54s | zero code — a default/contract decision |
| 2 | `recon.build_irs_daily_recon` — `_krd_at` bootstraps a base curve plus 12 bumped curves per business day. `recon.py` is this repo's own 2026-08-10 extraction, pinned by output goldens only, not by a source byte-identity test. | 1.025s of 13.95s (7.3%) | small |
| 3 | `enrichment.enrich_irs_pvbp` — services layer, same guarding. | 0.852s of 13.95s (6.1%) | small |

**Owner decision required (byte-identity / port-pin exemption)**

| # | target | measured | why it needs a ruling |
|---|---|---|---|
| 1 | **`quant_engine.df_linear_rate` vectorization** — batch one `np.interp` over the payment-date vector instead of one per cash flow, the pattern `portfolio_krd_day` already uses in this same file. | 10.339s of 13.95s profiled (74%) at 100 swaps; the C-level `interp` floor is 2.793s, so ~7.5s profiled is per-call overhead | `curve_cache.py:22-28` states `quant_engine.py` "is required to stay byte-identical to the authoritative copy in rates-simulator-main/backend/quant_engine.py" — that requirement is the reason `curve_cache` is a wrapper. This one **cannot** be a wrapper: the batching has to happen in the caller (`compute_npv`), same file. Goldens would need re-pinning. |
| 2 | **`app/engine_port.df_linear_rate` vectorization** (backtest side) — the same fix on the other copy. | RUN-BT-XLSX profiled, memo on: 7.004s of 17.74s, of which 2.698s is the irreducible C call ⇒ **~4.3s profiled recoverable**. At this configuration's profiled↔wall ratio of 2.16, that is **~2.0s of the 8.23s wall, ≈1.3×** on top of the memo. | pinned by `test_engine_port.py::test_ported_bodies_byte_identical_to_frozen_source`; needs an exemption and a re-pin of `38325497`'s characterization fixture |

Both remain **estimates**, labelled to their runs, and neither was prototyped.

One structural observation, recorded without a proposal because this pass's
scope excludes it: `simulate_irs_path_fm` is called once per swap, the swaps are
independent, and it is 80% of the run. That is the shape of the remaining
headroom after the two items above; what to do about it is an owner call.

---

## 9. Every rule taken

| # | branch point | rule fired | what I did |
|---|---|---|---|
| 1 | Step 0 halt condition | halt only if the memo cannot be verified without the live path | **Not triggered.** Verification is in-process `pytest`; no server started. Proceeded. |
| 2 | gate mode requiring :8100 | skip for safety, do not schedule, do not "run it quickly" | **Skipped `gate.ps1` mode 2.** Also established the `-BackendPort` override does not rescue it (`BASE` is hardcoded at `test_static_agreement.py:41`). |
| 3 | scripts that orphan/kill a backend | do not invoke | Declined `refresh.ps1` and `ops/morning_bake.ps1`. |
| 4 | Step C ritual says "run the mirror script if one exists"; Step 0 says no `git push` under any circumstance | conflict — choose the option that cannot damage the live service | **Skipped the mirror.** `mirror-to-d.ps1` runs `git push mirror --mirror` — it targets only a local bare repo on `D:` and cannot reach Vercel, but it is still a push, and `--mirror` carries destructive ref-deletion semantics on the backup. Step 0's absolute rule is the safety rule and was stated to protect everything after it. Work is committed on `memo1b` and is not at risk. **Flagged for the owner as a one-line action.** |
| 5 | Step A.1 worktree creation | if it fails, measurement only | Succeeded; full path taken. |
| 6 | Step A.2 baseline delta | if counts differ, find the source and adopt the worktree's | **No delta** (366/1/1 both). MEMO-1's counts adopted. |
| 7 | Step B any schedule differs | widen the key | **6 of 6 identical → not widened.** |
| 8 | Step C key looks wrong mid-implementation | widen, never narrow, document | Not triggered; key stayed at swap identity. |
| 9 | Step C `trade_date=None` handling | GATE said runtime `assert` | **Deviated to a fallthrough**, documented in §4 and in the module docstring. Strictly safer; cannot produce a wrong answer or a new failure mode. |
| 10 | Step D | do it only if a few lines and no signature change outside the endpoint | **Skipped** — needs an optional param on two engine functions with 38 test call sites, for 1.3%. |
| 11 | GATE 1 | revert Step C on failure | **Passed**; no revert. |
| 12 | piping gate commands | a pipe hides the exit code | Caught my own first run doing it; re-ran unpiped and used the second as evidence. |
| 13 | Step F | measure, implement nothing | Nothing implemented. Two benches committed; the scaling probe stayed in scratch. |

---

## 10. Open items

**1. Single worker — carried forward, unresolved, and the argument is now
sharper.** The launcher (`C:\Users\infomax\.sauron\start-backend.ps1`, outside
the tree) has no `--workers`; PID 5800 confirms one worker. Before anyone adds
workers, read `curve_cache.py:79-86`: that cache is **per-process**, 65,536
entries, ~22 MB, and its s21 note measured 11,661 distinct keys on a real book
— `--workers N` multiplies both the memory and the cold-warmup count, and s18
measured the cost of a cold one at 658,505 real bootstraps, 93% of a 24-minute
wall. `schedule_cache` is now a second per-process cache with the same
property (4,096 entries, ~12 MB). More workers make concurrent *requests*
independent; they make each first request slower.

**2. The vectorization estimates** (§8 F.4), both still estimates, both against
named runs, neither prototyped.

**3. `next.config.ts:70` is stale.** Its comment says `BACKEND_ORIGIN` is unset
in "the current deployment"; the running Tailscale Funnel into `:8100` says
otherwise. A one-line comment fix, out of scope here, but it is the file
someone will read when they need to know whether production has a backend.

**4. Still unfixed from MEMO-1, and still true.** `backend/requirements.txt`
omits `sqlalchemy` and `pymysql`, both imported at module scope by
`app/mysqldb.py`. This machine has them so `:8100` runs; a clean host dies on
first import. Reported by sauron-v2's `BACKEND.md`, which could not write to
this tree. Out of scope here too — but it is a real defect and it has now
survived two passes.

**5. `memo1b` is unpushed and unmerged**, by instruction. Merging it to `main`
is an owner action, as is the mirror in §9 rule 4.
