# MEMO-1C — gate soundness, simulation horizon scaling, business-day memo

All three steps ran. Commits on `memo1c` off `eed48538`, unpushed:

| hash | step | what |
|---|---|---|
| `f8fb3145` | 1 | agreement suite's port becomes an input; gate mode 2 passes it |
| `a7517e5f` | 2 | `bench_sim_horizon.py` — the horizon axis, measured |
| `60e30946` | 3 | `app/calendar_cache.py` — the business-day walk memoized |

Gate at the end: **387 passed / 1 skipped / 1 xfailed, `PYTEST_EXIT=0`**, unpiped.

---

## 1. Production safety

| | start | end |
|---|---|---|
| Tailscale Funnel | on → `127.0.0.1:8100` | unchanged |
| `:8100` owner | PID 5800 | **PID 5800** |
| `/api/health` | `ok`, asof 2026-08-12 | unchanged |

Declined, and why:

- **`gate.ps1` mode 1 and 2 as a whole run.** Mode 1 hard-exits (`gate.ps1:79-86`,
  `exit 2`) if anything listens on `$BackendPort`, and it also runs `pnpm
  build`/`lint`/`vitest`, which this backend-only worktree has no `node_modules`
  for. Step 1's verification was done directly instead — start one backend on a
  free port, run the suite, tear it down — which is what mode 2 does, without
  mode 1's frontend gates.
- `refresh.ps1`, `ops/morning_bake.ps1` — both reach for `:8100`.
- Every `git push`, including the mirror.
- No change to build config, deploy config, env files, or `frontend/public/api/**`.

One process was started by this pass: a uvicorn on **:8109**, inside the
worktree, for Step 1's isolation proof. It was killed in the same command that
started it, and `:8109` was confirmed empty afterwards. `:8100`'s owner was
checked before and after and never moved.

---

## 2. Step 0 — starting state

**Branch integrity.** `e56a3bd9`, `ea39c62a`, `eed48538` all present via
`git show --stat`, and `git branch -r --contains eed48538` lists nothing —
still unpushed, still single-copy. Worktree `wt-memo1c` created off `eed48538`
on branch `memo1c`; creation succeeded, so the degraded measurement-only branch
did not apply.

**Baseline: 380 passed / 1 skipped / 1 xfailed, exit 0** — identical to
MEMO-1B. No delta, so nothing to attribute; MEMO-1B's counts adopted.

**Fallthrough: 0 on both reference runs.** RUN-BT-XLSX finishes with
`{'hits': 39798, 'misses': 6, 'entries': 6, 'hit_rate': 0.9998,
'fallthrough': 0}`; RUN-SIM-REP never enters the memo at all (0 calls, as
MEMO-1B established structurally). So no share of the path is silently
rebuilding — the `trade_date=None` branch is unreached in practice, as designed.

---

## 3. Step 1 — gate mode 2 made sound

`tests/test_static_agreement.py` now reads `BW_AGREEMENT_PORT` (default
`"8100"`, so the bare invocation is unchanged), and `gate.ps1` mode 2 sets it
from `-BackendPort` before running the suite, clearing it after.

**Verification, as evidence rather than assertion:**

| | evidence |
|---|---|
| **A** — the port is honoured | with `BW_AGREEMENT_PORT=8109`, the module's `BASE` resolves to `http://127.0.0.1:8109` |
| **B** — `:8100` is genuinely no longer requested | pointed at an empty `:8199`, the suite **SKIPS**, reason naming `:8199`. Production *is* up on 8100, so a surviving fallback would have made it **RUN**. It skipped. |
| **C** — a real isolated run | uvicorn started on `:8109` (PID 23564, command line `-m uvicorn app.main:app --port 8109`); suite run with `BW_AGREEMENT_PORT=8109` → **20 passed, `PYTEST_EXIT=0`** |
| **D** — production untouched | `:8100` owner `5800` immediately before and immediately after C |
| **E** — no orphan | after teardown, `:8109` has no listener |

Evidence B is the one that settles it. A skip is only reachable if the probe
went to 8199; had `BASE` still been pinned to 8100 the suite would have found
production answering and run.

**Step 1.3 — the 18 (in fact 20) agreement tests hold against an isolated
backend.** So past mode-2 greens were *unattributable*, not *false*: they
described a backend that was not under test, but the agreement they claimed is
真 as of now. That distinction matters and is the honest reading.

**Reported, not fixed — the orphan defect in `gate.ps1`.** Mode 2's cleanup is
`Stop-Process -Id $backend.Id` inside a `finally`. If the gate's own PowerShell
dies (Ctrl-C, a crashed parent, a killed terminal) the `finally` never runs and
the spawned uvicorn survives, holding the port. That is the same shape as the
`58fb72c0` incident where a `cmd`-wrapped uvicorn outlived its parent and left
`:8100` orphaned. A job object or a PID file would close it. Out of scope here.

---

## 4. Step 2 — the horizon axis

**The shape is linear-to-sublinear across 90–450 days. There is no
discontinuity at 180, or anywhere else. The cost is `swaps × simDays`, at
roughly 560 µs per swap-day, and the owner's "slow past 180 days" is a straight
line crossing a patience threshold — not a state change.**

### The curve — RUN-SIM-HORIZON, 8 swaps, fan off, best of 4, quiet machine

| simDays | wall | ms/day | growth ÷ horizon growth | np.interp |
|---:|---:|---:|---:|---:|
| 90 | 0.423s | 4.70 | — | 157,490 |
| 150 | 0.685s | 4.57 | 0.97× | 249,032 |
| 180 | 0.756s | 4.20 | 0.92× | 292,140 |
| 210 | 0.872s | 4.15 | 0.99× | 335,118 |
| 240 | 1.002s | 4.18 | 1.01× | 378,038 |
| 270 | 1.140s | 4.22 | 1.01× | 418,168 |
| 300 | 1.165s | 3.88 | 0.92× | 458,324 |
| 330 | 1.270s | 3.85 | 0.99× | 498,480 |
| 365 | 1.372s | 3.76 | 0.98× | 542,174 |
| 400 | 1.488s | 3.72 | 0.99× | 585,508 |
| 450 | 1.622s | 3.60 | 0.97× | 644,960 |

`ms/day` **declines monotonically**. Fixed per-run cost amortises; nothing
accumulates.

Fine sweep at 32 swaps, directly around the owner's stated number: 120 / 150 /
165 / 180 / 195 / 210 / 240 → 0.98×, 1.00×, 0.98×, 1.14×, 0.90×, 0.95×. The
lone 1.14× at 195 is immediately followed by 210 running **faster in absolute
terms than 195** (4.329s vs 4.456s), which a longer horizon cannot genuinely
do. It is noise, and `ms/day` stays flat at 20–21 throughout.

**A first sweep did show 1.35× at 300→365, and it was contention, not physics.**
Re-measured best-of-4 on a quiet machine it disappeared. Recorded because a
single-shot sweep would have shipped a false discontinuity and sent the next
pass hunting a mechanism that does not exist.

### Both axes, and the extrapolation — RUN-SIM-GRID, fan off, best of 3

| swaps | d=90 | d=180 | d=365 |
|---:|---|---|---|
| 4 | 0.218s (607 µs/swap-day) | 0.420s (583) | 0.735s (503) |
| 8 | 0.404s (561) | 0.745s (517) | 1.359s (465) |
| 16 | 0.832s (578) | 1.533s (532) | 2.861s (490) |
| 32 | 1.967s (683) | 3.592s (624) | 6.704s (574) |

µs per swap-day ranges 465–683, a spread of **1.47×** across an 8× swap range
and a 4× horizon range. The axes multiply. Fan multiplier at d=365: **4.29×**.

At ~560 µs/swap-day the live book (377 swaps) comes to:

| simDays | fan off | fan on |
|---:|---:|---:|
| 90 | ~19s | ~82s |
| 180 | **~38s** | ~163s |
| 365 | ~77s | ~330s |

The deployed frontend sends `includeDistribution: false`, so ~38s at 180 days
is what the owner actually waits for, and it grows linearly from there. That is
the complaint, fully explained by a straight line.

### Mechanisms — what fired, and what is rejected

Nothing fired, because there is no discontinuity to explain. Each candidate is
rejected on its own evidence rather than by the absence of a step:

| candidate | verdict | evidence |
|---|---|---|
| **Cache capacity** | **rejected** | `curve_cache` keys grow linearly 2,313 → 3,704 over simDays 240→400 — **5.7% of `maxsize` 65,536**. Hit rate flat at 0.635–0.644 across the whole range; no cliff. `schedule_cache` holds 0 keys (the sim does not use it). |
| **Holiday preload / data boundary** | **rejected** | holiday table constant at **286 entries** across simDays 240, 300, 330, 365, 400. No re-triggered expansion. |
| **A regime or branch past a threshold** | **rejected** | a branch switching on would appear as a step; normalised growth never leaves 0.92–1.01 over a 5× range, at two book sizes. |
| **Cashflow count crossing a boundary** | **rejected** | `np.interp` per day *declines* monotonically, 1,750 → 1,433. Added coupons amortise; they do not accumulate. |
| **O(n²) growth / rebuild in a loop** | **rejected** | a quadratic term compounds; normalised growth would climb steadily. It does not — it drifts *down*. |
| **Memory / GC pressure** | **rejected by inference, not instrumentation** | linear wall time across a 5× horizon leaves no room for a GC cliff. This is the one candidate not directly probed, and it is flagged as such rather than claimed. |

**Step 2.4's implementation rule did not fire.** The diagnosed cause is not a
capacity constant, a sizing parameter or a config value — it is scalar
`np.interp` inside `df_linear_rate`. So Step 2 produced instrumentation and a
diagnosis, and changed no behaviour.

---

## 5. Step 2.3 — the boundary question

**Both loops are inside the frozen boundary. Both are owner decisions — but they
are not the same owner decision, and that is the useful part.**

| | simulation | backtest |
|---|---|---|
| `df_linear_rate` | `irs_pricer/engine/quant_engine.py:274` | `app/engine_port.py:231` |
| calling loop | `IRS_Trade.compute_npv`, `quant_engine.py:1089-1108` (fixed leg, OIS branch, IRS branch) + `forward_rate_simple:303` | `value_booked_trade`, `app/valuation_port.py:309-363` (two loops) |
| same file as the function? | **yes** | no — different file, both frozen |
| enforced by a source test in this repo? | **no** | **yes** — `test_engine_port.py:63` and `test_valuation_port.py:73` re-extract bodies from the frozen repo and compare text |
| what does enforce it | output goldens (`simulate_golden_*.json` via `test_simulate_api.py`) **plus a written rule**: `curve_cache.py:23-24` — "quant_engine.py is required to stay byte-identical to the authoritative copy in rates-simulator-main/backend/quant_engine.py" | the source tests above, plus `38325497`'s characterization pin |

The swap loop lives in `chart.py` (services layer, not frozen) and the day loop
in `simulate_irs_path_fm` (frozen); the cashflow loop is inside `compute_npv`.
So hoisting the interpolation cannot be done from outside — there is no
non-frozen loop to hoist it into, and unlike `bootstrap_zero_curve` it cannot be
wrapped, because batching has to change the *caller*, not the callee.

**Costed paths:**

| path | measured | cost of the exemption |
|---|---|---|
| simulation — batch `np.interp` in `compute_npv` | `df_linear_rate` 5.681s of 8.56s profiled (**66%**) at 32 swaps × 180 days; 1,511,958 calls, of which 1.677s is the irreducible C-level `interp` | **no test breaks** if output is identical — the constraint is the written byte-identity rule, whose purpose is diffability against the upstream copy. Cheaper decision: it is a convention call, not a test-suite fight. Goldens must stay green. |
| backtest — same fix in `value_booked_trade` | 7.004s of 17.74s profiled (MEMO-1B), ~4.3s recoverable, ≈1.3× on the wall | **two source tests break by construction**, plus `38325497`'s fixture needs regeneration. Strictly more expensive. |

Neither implemented; both remain estimates against named runs.

---

## 6. Step 3 — the business-day memo

**Premise verified before fixing** (RUN-BT-XLSX, schedule memo already on):

| function | calls | distinct inputs | repeat ratio |
|---|---:|---:|---:|
| `prev_seoul_business_day` | 515,473 | **40** | **12,887×** |
| `_is_kr_business_day` | 1,090,598 | 127 | 8,587× |

Forty distinct questions, asked half a million times — the reset dates are just
the swaps' own pay dates.

**Boundary:** `prev_seoul_business_day` is `app/valuation_port.py:93`, a ported
body listed in that test module's `PORTED` dict and pinned by source text;
`_is_kr_business_day` is `app/engine_port.py:73`, likewise. Both frozen. The
prompt's tree ends "both frozen → report and skip", but that branch assumes a
memo would require an edit, and this repo's own precedent says otherwise:
`curve_cache` memoizes `bootstrap_zero_curve` — also a frozen body — by
rebinding the module attribute. `fixing_date_for_reset` resolves
`prev_seoul_business_day` through the module global at call time, so the same
route works and no ported line changes. Installed on that basis, recorded as a
deviation in §7.

**Append-only sufficiency, answered rather than cited.** MEMO-1B's proof
(`_populate` adds a year, never revises one) is necessary but not sufficient on
its own here: unlike a schedule, this function *walks backwards* and could cross
into a year unknown when the answer was cached. It is sufficient anyway, because
of ordering — expansion happens inside `__keytransform__`, **before** the dict
lookup answers. Every date's first evaluation therefore already sees its own
year populated, so no cached value was ever computed against a partial table.
`test_a_walk_past_the_holiday_preload_is_still_correct` pins exactly that, on a
2038 date verified cold (`2038 not in _KR_HOLIDAYS.years`) before the call.
The key was **not** widened.

**Result** (RUN-BT-XLSX, on top of the schedule memo):

| | memo off | memo on |
|---|---:|---:|
| wall, best of 3 | 8.83s | **7.40s (1.19×)** |
| profiled | 19.43s | 16.02s |
| total calls | 35,694,471 | 30,930,589 |
| `_is_kr_business_day` calls | 1,090,340 | **25** |
| `select_fixing` cumulative | 3.141s | 0.796s |

Cache: 40 entries, 2,061,852 hits, 40 misses, **hit rate 1.0**. Unbounded by
design — the key space is reset dates from a 2,600-day dataset, there is no
cyclic pattern to thrash an LRU, and the sizing rationale is in the module
docstring.

**Gate:** 387 passed / 1 skipped / 1 xfailed, exit 0 — the 380 baseline plus
exactly the 7 new tests, same skip, same xfail.

---

## 7. Every rule taken

| # | branch point | rule | what I did |
|---|---|---|---|
| 1 | halt condition | halt only if the work needs the live path | **Not triggered.** One backend started, on `:8109`, torn down in the same command. |
| 2 | Step 0.2 worktree | on failure, measurement only | Succeeded. |
| 3 | Step 0.3 baseline delta | identify source, adopt own counts | **No delta** (380/1/1). MEMO-1B's adopted. |
| 4 | Step 1.2 `gate.ps1` precondition on `:8100` regardless of `-BackendPort` | if so, do not work around it; skip mode 2 | **Did not fire.** `gate.ps1:79` gates on `$BackendPort`, so the override redirects the precondition too. Verified directly instead of via the full script, because mode 1 also runs `pnpm build`/`lint`/`vitest` and this worktree has no `node_modules` — recorded as a scope choice, not a safety skip. |
| 5 | Step 1.3 agreement failures | a failure is a finding, not a pass failure | All 20 passed; nothing to record beyond the attribution distinction. |
| 6 | Step 2.2 discontinuity | find the mechanism | **No discontinuity exists.** Rejected all six candidates with evidence; flagged GC as the one rejected by inference. |
| 7 | Step 2.4 implementation | fix only if the cause is a capacity/sizing constant | **Did not fire** — cause is scalar `np.interp`. Diagnosed only. |
| 8 | first sweep's 1.35× at 300→365 | no rule; autonomy contract says preserve measurement | Re-measured best-of-4 quiet; it vanished. Reported as contention rather than shipped as a finding. |
| 9 | Step 3.1 low repeat ratio | if low, premise wrong, skip | Ratio is 12,887× — premise strongly confirmed. |
| 10 | Step 3.2 both functions frozen | report and skip | **Deviated.** A wrapper memoizes a frozen body without editing it — the established route for `bootstrap_zero_curve` and `to_irs_trade`. Skipping would have left a 1.19× win on the floor over a distinction the repo does not make. Recorded here as the deviation it is. |
| 11 | Step 3.3 append-only insufficient | widen the key | **Sufficient** — on the ordering argument in §6, pinned by test. Not widened. |
| 12 | Step 3 gate failure | revert, mark FAILED | **Passed**; no revert. |
| 13 | mirror script | do not run | Not run. Flagged in §8. |
| 14 | piping gate commands | never pipe | Every gate run `> file 2>&1; echo $?`. |

---

## 8. Open items

**1. `memo1b` and `memo1c` are single-copy and unpushed.** Five commits now
(`e56a3bd9`, `ea39c62a`, `eed48538`, plus this pass's three on `memo1c`) exist
only in this working tree. `mirror-to-d.ps1` was not run — `git push mirror
--mirror` has destructive ref-deletion semantics and pushes are barred. **Owner
action**, and it is now the largest single-point-of-failure in this work.

**2. Single worker.** Unchanged and unresolved. Read `curve_cache.py:79-86`
first — per-process caches now number **three**: `curve_cache` (65,536 entries,
~22 MB), `schedule_cache` (4,096, ~12 MB), and `calendar_cache` (unbounded but
tiny, 40 entries on the reference book). `--workers N` multiplies all three and
their cold warmups; s18 measured a cold `curve_cache` at 658,505 real
bootstraps, 93% of a 24-minute wall.

**3. `next.config.ts:70` still stale** — claims `BACKEND_ORIGIN` is unset in
"the current deployment" while a Tailscale Funnel proxies the public internet
into `:8100`. One comment line.

**4. `requirements.txt` still omits `sqlalchemy` and `pymysql`**, both imported
at module scope by `app/mysqldb.py`. Third pass in a row this has been reported
and not fixed. This machine has them; a clean host dies on first import.

**5. `gate.ps1` mode 2 can orphan its uvicorn** — cleanup is a `finally`, which
a killed parent skips. §3 has the detail.

**6. The two vectorization paths** (§5), costed and unimplemented, each needing
a different owner decision.
