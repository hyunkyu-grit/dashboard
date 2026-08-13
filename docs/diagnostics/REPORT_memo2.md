# MEMO-2 — the simulation, actually faster

**The simulation is 2.6–3.8× faster and the backtest 1.4×, bit-identical, with
no frozen body edited and no owner exemption used.** 32 swaps × 180 days:
3.72s → 1.05s. 64 swaps × 365 days: 13.75s → 3.66s. Daily resolution untouched
— the fix is the cost *per* swap-day, exactly as constrained.

Commits on `memo2` off `f52c948b`, unpushed:

| hash | what |
|---|---|
| `fa1b7494` | `bench_sim_http.py` — the real-request harness |
| `7dcc643c` | `app/df_cache.py` — per-curve discount-factor memo + 9 tests |

GATE 2: **396 passed / 1 skipped / 1 xfailed, `PYTEST_EXIT=0`**, unpiped.

---

## 1. Production safety

| | start | end |
|---|---|---|
| `:8100` owner | PID 5800 | **PID 5800** |
| Funnel | on → `127.0.0.1:8100` | unchanged |
| `/api/health` | ok, asof 2026-08-12 | unchanged |

Declined: `refresh.ps1`, `morning_bake.ps1`, the mirror script, all pushes, and
any change to build/deploy config, env files or static artifact dirs. Two
uvicorns were started on **:8109** inside the worktree (Step 1's measurement and
GATE 2's isolation); each was killed in the same command that started it and
`:8109` confirmed empty afterwards. `:8100`'s owner was checked before and after
both and never moved.

---

## 2. Step 1 — the real run vs the model

**No gap. The HTTP path costs 1.07× the engine, the harness was hiding nothing,
and the 109.9s figure never contradicted the model — it is a fan-ON number.**

RUN-SIM-HTTP, 32 swaps (35 positions) × 180 days, fan off, against an isolated
backend on `:8109`:

| component | seconds | share |
|---|---:|---:|
| engine (`run_simulation`) | 3.68s | 93% |
| response validate + serialise | 0.00s | 0% |
| request validation | 0.00s | 0% |
| transport + executor + rest | 0.26s | 7% |
| **HTTP end-to-end, warm best of 3** | **3.95s** | 100% |

Cold 4.61s; warm 3.95 / 4.23 / 4.24. Response 201,416 bytes. **Ratio 1.07×.**
So every prior in-process number was a fair proxy, and the serialization
hypothesis is rejected on evidence.

Against the model: 32 × 180 swap-days at MEMO-1C's ~560 µs = 3.23s predicted
vs 3.68s measured, **1.14×** — inside the 1.47× spread MEMO-1C already
documented. **The model matches the real run**, so Step 1's rule 4 applies.

### Reconciling 109.9s

The premise that "110s implies roughly 520 days, not 180" treats 109.9s as a
fan-off number. It is not. `orchestrator.py:51` records it explicitly: *"총
109.9초 중 82.8초. 나머지 26초가 실제 손익이다"* — 109.9s **total, of which
82.8s was the distribution fan**, leaving ~27.1s of base run.

At 377 swaps and ~560 µs/swap-day, 27.1s implies **~128 days** — an ordinary
horizon, and no contradiction at all. The fan multiple corroborates
independently: documented 109.9 / 27.1 = **4.05×**, measured here **4.29×**.

So the 109.9s figure is not stale and not wrong; it was being read as the wrong
quantity. Nothing about MEMO-1C's model needs revising.

---

## 3. Step 2 — redundancy, measured

Instrumented at every call site including the def-time defaults (a module-global
patch alone under-counts — MEMO-1C hit that and it is corrected here):

| config | calls | distinct (curve, t) | repeat |
|---|---:|---:|---:|
| 8 swaps × 180d | 266,496 | 13,109 | **20.3×** |
| 32 swaps × 180d | 1,506,454 | 28,320 | **53.2×** |
| 32 swaps × 365d | 2,832,982 | 29,028 | **97.6×** |
| 64 swaps × 180d | 3,008,500 | 40,847 | **73.7×** |

Far above the ≥5× threshold, and it **improves** with both book size and
horizon — the direction the owner's complaint points. The cause is structural:
quarterly swaps across one book land on heavily overlapping payment dates, and
every swap on a given simulated day discounts against the same curve object.

**Mean cost per call: 2.24 µs**, against **1.78 µs** for a bare scalar
`np.interp` on the same array and 0.026 µs for an empty loop. So ~79% of it is
numpy's dispatch path, not arithmetic — the hypothesis is confirmed, not assumed.

**Decision rule → memoize.** The preferred branch: wrapper/rebind, no frozen
body edited, no deviation from `curve_cache.py:23-24`, no owner sign-off. The
batching branch was not needed and was not taken.

---

## 4. Step 3 — what was installed

`backend/app/df_cache.py`, wired into the app lifespan beside the other three
memos. Kill switch `BW_DF_CACHE=0`; `uninstall()` restores everything.

### Curve identity, and why it is sound

Not a date, not a bootstrap input, not a bare `id()`. The key is **live object
identity enforced by a weakref**: a per-curve table is stored under `id(zc)`
together with `weakref.ref(zc)`, and used *only* while that weakref is alive.
A live object's id cannot be reused, so `id(zc) == key` plus a live referent
proves `zc` **is** the array the table was built for. When the array is
collected the callback drops the entry, so a recycled id can never hit a stale
table.

This is stronger than a content hash: two distinct arrays with identical
contents get separate tables — a missed hit, never a wrong answer. Curves are
`writeable=False` (set by `curve_cache`), so a live array cannot change under
its table.

**Cache lifetime cannot outlive the curve, structurally.** The table *is* the
weakref entry's payload, so the callback that invalidates identity also frees
the table. No TTL, no eviction pass. Confirmed empirically: `live_curves`
returns to **0** after a run's curves are collected.

### Two traps, and one of them bit

`df_linear_rate` is reachable three ways, and missing any one leaves the memo
partly inert:

1. the defining module's attribute;
2. **def-time defaults** — `df_fn=df_linear_rate` captured in
   `compute_npv`, `forward_rate_simple`, `compute_irs_npv`, `compute_irs_pvbp`,
   across both modules;
3. **direct imports** — `app/valuation_port.py`, `irs_pricer/engine/mtm_valuation.py`
   and `pricing.py` do `from … import df_linear_rate`, binding at import time.

I anticipated (2) and missed (3). The first version measured **8.77s → 8.84s on
the backtest with `hits: 0`** while `stats()` reported `installed: True`. A memo
that is installed and inert is worse than one that is absent, because it reports
success. `install()` now finds every holder by scanning `sys.modules` at install
time rather than from a hand list, and
`test_the_real_backtest_path_reaches_the_memo` pins it — verified by
reintroducing the defect (test went red), then restoring (green).

The other eight tests all passed *with* the defect present, which is the useful
lesson: they exercised `app.engine_port` directly, and the real path goes
through `valuation_port`'s own binding.

**Two modules, two installs.** The two `df_linear_rate` are different function
objects. There is no incidental sharing — the backtest gain below is a
deliberate second installation, not a side effect.

---

## 5. GATE 2

| check | result |
|---|---|
| **bit-identity** | 3 curves × 45 real query points (quarterly to 10y, plus the 1D anchor, a 0.2493y CD node and stubs), compared with `struct.pack("<d", …)` byte equality. **Zero differences**, on both the first pass and a second served entirely from cache. Identity is by construction — a hit returns the stored float, not a recomputation. |
| characterization pin `38325497` | green (inside the 396) |
| full suite | **396 passed / 1 skipped / 1 xfailed**, `PYTEST_EXIT=0` = baseline 387 + exactly the 9 new tests |
| gate mode 2, isolated | backend on `:8109` (PID 22816), `BW_AGREEMENT_PORT=8109` → **20 passed, exit 0**; `:8100` owner 5800 before and after; `:8109` gone after teardown, no orphan |

---

## 6. Before / after

**Simulation** — RUN-SIM-GRID, fan off, best of 3:

| config | before | after | speedup | hit rate |
|---|---:|---:|---:|---:|
| 8 swaps × 180d | 0.77s | **0.30s** | 2.56× | 0.984 |
| 32 swaps × 180d | 3.72s | **1.05s** | 3.54× | 0.994 |
| 32 swaps × 365d | 7.05s | **1.98s** | 3.55× | 0.997 |
| 64 swaps × 180d | 7.62s | **2.01s** | 3.80× | 0.996 |
| 64 swaps × 365d | 13.75s | **3.66s** | 3.76× | 0.998 |

The speedup *grows* with the book, tracking the repeat ratio.

**Backtest** — RUN-BT-XLSX, best of 3: **8.50s → 6.09s, 1.40×**; 4,652,742 hits
against 401,286 misses, hit rate 0.921.

**Owner-scale extrapolation.** At 560 µs/swap-day MEMO-1C put the live book
(377 swaps) at ~38s for 180 days. At the measured 3.5–3.8× that becomes
**~10–11s**, and 365 days goes from ~77s to **~21s**. Fan-on requests still
carry their 4.29× on top; the frontend sends `includeDistribution: false`.

---

## 7. Step 4 — residual profile

RUN-SIM-GRID 32 swaps × 180 days, fan off, memo on: **4.43s profiled,
13,612,408 calls** (MEMO-1C, same config: 8.56s / 19,381,840).

| cum | tot | ncalls | function |
|---:|---:|---:|---|
| 4.228s | 0.005s | 1 | `chart.py:100(build_chart_data)` |
| 2.498s | 0.067s | 32 | `quant_engine.py:1116(simulate_irs_path_fm)` |
| 2.007s | 0.335s | 17,376 | `quant_engine.py:1054(compute_npv)` |
| **1.623s** | 0.534s | 1,506,454 | `df_cache.py:142(memoized)` |
| **1.506s** | 0.005s | 1 | `recon.py:77(build_irs_daily_recon)` |
| 1.465s | 0.003s | 122 | `recon.py:165(_krd_at)` |
| 1.334s | 0.036s | 14,175 | `curve_cache.py:147(_bootstrap_memoized)` |
| 1.262s | 0.114s | 1,781 | `quant_engine.py:180(bootstrap_zero_curve)` |
| 1.070s | 0.009s | 122 | `quant_engine.py:755(build_bumped_curves)` |

**Is the remainder arithmetic or overhead? Both, and the split decides whether
another pass is worth running.**

- **Real arithmetic, structurally redundant — `recon.py`, 1.506s (34%).** The
  daily reconciliation calls `_krd_at` once per business day, and each call
  bootstraps a base curve plus 12 bumped ones: 122 × 13 ≈ 1,586 of the run's
  1,781 real bootstraps, **89%**. The arithmetic is genuine but it is being
  redone per day for bump sets that mostly repeat. **`recon.py` is this repo's
  own extraction, not a ported body** — pinned by output goldens only. So this
  is reachable without an exemption.
- **Residual overhead — `df_cache` itself, 0.534s tottime (12%).** 0.35 µs per
  call for the wrapper plus a dict get, against 2.24 µs before. Real, but 6×
  reduced and now near the floor for a Python-level memo.
- **`quant_engine.py` 1.298s tottime (29%)** is spread thin across the FM loop;
  no single hot leaf remains.

**Is a fourth pass warranted? Yes, but a narrow one, and not on a frozen body.**
The single largest remaining item is the recon block's per-day curve bumping in
`recon.py`, worth up to ~1.5s of 4.43s at this config — and it sits outside
every port pin. The vectorization of `df_linear_rate` that MEMO-1B and 1C both
costed is now **not worth its exemption**: the memo already removed ~80% of that
cost, and what remains is the wrapper's own overhead, which batching would not
touch. That estimate should be considered retired.

---

## 8. Every rule taken

| # | branch point | rule | what I did |
|---|---|---|---|
| 1 | halt condition | halt only if the work needs the live path | Not triggered; two isolated backends on `:8109`, both torn down. |
| 2 | Step 0.1 worktree | on failure, measurement only | Succeeded. |
| 3 | Step 0.2 baseline delta | identify, record, adopt own | **No delta** (387/1/1). MEMO-1C's adopted. |
| 4 | Step 1.3 real run >1.5× model | the excess is the finding; decompose | **Did not fire** — 1.07× HTTP/engine, 1.14× vs model. |
| 5 | Step 1.4 real run matches model | say whether 109.9s is stale or a different horizon | **Fired.** Neither: it is a **fan-ON** number (82.8s of it the fan), implying ~128 days. The premise mis-read the quantity. |
| 6 | Step 3 decision rule | ≥5× repeat → memoize | **Fired at 20–98×.** Memo branch; batching not taken, no deviation, no `## Provisional` entry needed. |
| 7 | curve identity unsound | stop the branch and report | **Did not fire** — weakref-backed live identity is exact, and lifetime is structural. |
| 8 | GATE 2 bit-identity | if not bit-identical, do not install | **Bit-identical**, byte-compared. Installed. |
| 9 | GATE 2 failure | revert, mark FAILED | Passed; no revert. |
| 10 | mid-implementation defect (backtest hits = 0) | no rule — autonomy contract: cannot damage the service, preserves measurement | Fixed `install()` to scan `sys.modules`, added the regression test, **proved it catches the defect** by reintroducing it. Reported rather than quietly corrected. |
| 11 | daily resolution constraint | never propose coarsening | Honoured — the fix is cost per swap-day; the grid is untouched. |
| 12 | piping gate commands | never pipe | Every gate `> file 2>&1; echo $?`. |
| 13 | mirror / push | declined | Not run. §9. |

---

## 9. Open items

**1. Eight commits now single-copy in this working tree** (`memo1b` ×3,
`memo1c` ×4 counting its report, `memo2` ×2 — heads `f52c948b` and `7dcc643c`).
This is the largest risk in the work and it grows every pass. Worth noting for
the owner's decision: **pushing a non-`main` branch would not touch the Vercel
production deploy** — `0ad318d2` moved production to the `deploy` branch, and
`390ffa0c` recorded the switch — so `git push origin memo2` is safe *if* the
owner confirms the production branch setting. That confirmation is theirs to
give; this pass did not push.

**2. Single worker.** Per-process caches are now **four**: `curve_cache`
(65,536 entries, ~22 MB), `schedule_cache` (4,096), `calendar_cache` (40 on the
reference book), `df_cache` (weakref-scoped, self-freeing). `--workers N`
multiplies all four and their cold warmups. Read `curve_cache.py:79-86` first.

**3. `next.config.ts:70` still stale** — claims `BACKEND_ORIGIN` is unset in
"the current deployment" while the funnel proxies the public internet into
`:8100`.

**4. `requirements.txt` still omits `sqlalchemy` and `pymysql`** — imported at
module scope by `app/mysqldb.py`. **Fourth pass reporting it.** This machine has
them; a clean host dies on first import. It is a two-line fix that no pass has
been scoped to make.

**5. `recon.py`'s per-day bumped-curve rebuild** — §7, ~34% of what is left,
outside every port pin.

**6. The `df_linear_rate` vectorization estimate is retired**, not carried
forward. The memo took ~80% of that cost without an exemption; batching would
now buy little and still cost the deviation.
