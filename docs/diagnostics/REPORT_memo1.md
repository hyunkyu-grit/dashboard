# MEMO-1 — schedule memoization, diagnose-first

**Ruling: NO-GO for Step 1.** A characterization pin was written and landed
(`38325497`); the memoization was **not** installed. Steps 2 and 3 were not
executed, because the NO-GO branch ends the pass at the pin.

Filed in `docs/diagnostics/` rather than the repo root: that is where this tree
keeps its measurement reports (`perf-baseline.md`, `curve-validation.md`,
`failure-modes.md` and four others). No prior pass moved reports to `docs/`
root — the session prompt's note about that describes a different tree (see R1).

---

## R0 — Environment precondition

**PASS.** The dataset is fully loaded; the profiling numbers stand.

| | |
|---|---|
| rows | 2,621 |
| span | 2016-01-04 .. 2026-08-12 |
| `asof` | 2026-08-12 |
| `missing_nodes` | `[]` |
| CD91 fixing store | 2,611 dated prints, 2016-01-18 .. 2026-08-12 |
| nodes non-null on 2021-08-02 / 2025-08-01 / 2026-08-12 | 15/15, 15/15, 15/15 |

**The prompt's premise about `DATA_DIR` does not hold in this tree.** It states
`DATA_DIR` resolves relative to the repo root's *parent*. It does not:
`irs_pricer/config.py:31` is `Path(__file__).resolve().parents[2]` → the project
root, and `config.py:9-13` documents this as a deliberate **deviation** from the
frozen source, which did resolve to a sibling `Data/`. Resolved value:
`…\braveworld\data`, `IRS_PRICER_DATA_DIR` unset, directory present with
`irsdata.xlsx` (776,519 B), `bokbaserate.xlsx` (640,795 B), `AS_data.zip`.

Two further clarifications the prompt conflates:

- The silent-`None` risk it describes (`base_rate`/`call_rate` returning `None`
  on a missing file) belongs to the **simulation** path's `DATA_DIR`. The
  **backtest** path — the one MEMO-1 targets — does not read `DATA_DIR` at all.
  It loads through `app/dataset.py`, either `load_dataset_merged()` (MySQL +
  xlsx fallback, what the server does) or `load_dataset(xlsx)` (what the
  profile does).
- **`data/irsdata.xlsx` is uncommitted in the working tree** and was already so
  before this pass. All baselines here are tied to that working copy. This is
  the known morning-bake artefact, not a new condition.

---

## R1 — Tree identity and liveness

**The tree is LIVE. Not superseded, not harvest-only.** No escalation, no
Step-1-only branch.

| | |
|---|---|
| root | `C:\Users\infomax\Desktop\Assistant\Projects_AS\braveworld` |
| branch | `main` |
| HEAD at start | `47122287` — 인트로 커튼 (2026-08-13 11:08:18 +0900) |
| remotes | `origin` swap_monitor · `mirror` D:\Backups\braveworld.git · `dashboard` |
| working tree at start | 1 modified file (`data/irsdata.xlsx`) |

No `HARVEST.md` anywhere in the tree. The only hits for
superseded/retired/deprecated language are in `docs/HANDOFF.md`, and every one
refers to a **prior session** in the pass ledger or a retired *design decision*
— never to the application.

### The vendoring finding, and why it does not change the ruling

`sauron-v2` (sibling tree, branch `master`, 19 commits, HEAD `eabd648` at
**2026-08-13 13:34** — later than braveworld's HEAD) **vendors a full copy of
this backend**, including the two files MEMO-1 targets (`app/engine_port.py`,
`app/valuation_port.py`). Its own `BACKEND.md` settles the direction of the
relationship, in its first two lines:

> **This is a copy. Fixes made here do not reach braveworld, and braveworld's
> fixes do not reach here. Divergence is expected; record it.**

with `Source repo` = braveworld and `Source commit` = `f5de1fa7` (braveworld's
HEAD~2 at the time). Its `serve.ps1` adds: *":8100 IS NEVER BOUND HERE. That
port belongs to braveworld … and the deployed site is served from it."* And its
`PARITY.md` is a **P0b parity checklist against v1**, with a majority of rows
still marked **gap** — v2 has no sidebar, no overview screen, no position
track. v2 is an in-progress rewrite chasing v1; v1 is the shipped product.

Evidence is clear and self-consistent, so the ESCALATE rule does not fire. The
consequence is an open item, not a blocker: **a memo landed here will not reach
sauron-v2**, by that repo's own stated design.

### Concurrent session in this tree — flagged, not resolved

R1's `git status` (13:33) showed one modified file. By 13:51 the tree also had:

```
 M backend/app/payloads.py      (mtime 13:51:13, +12 lines)
?? backend/app/theta.py         (mtime 13:49:03, new)
?? backend/tests/test_theta.py  (new)
 M frontend/src/lib/api.ts · src/ui/columns.ts · src/ui/rows.ts
```

`theta.py`'s docstring carries `[OWNER, 2026-08-13 — "테너별 역캐리 및 헤지비용
바로 눈에 띄게 표시하기 …"]`. **Another session is implementing an owner-requested
feature in this tree right now.** Consequences, handled:

- The commit staged **four explicit paths**. `git add -A` was never run.
  Post-commit `git status` confirms the other session's seven files untouched.
- The post-pin full-suite run **races those edits** and cannot be cleanly
  attributed. See GATE B.

---

## R2 — Uvicorn worker state: **case (c), launcher has no `--workers`**

**The prompt's premise is false for this tree.** There is no `start-backend.ps1`
*in* the repo, and `--workers` appears in no `.ps1`, `.py`, `.md`, `.json`,
`.bat` or `.cmd` file anywhere in it.

The real launcher lives **outside** the repo — a fact recorded, of all places, in
sauron-v2's `serve.ps1` ("v1 passes it on the uvicorn command line from
`C:\Users\infomax\.sauron\start-backend.ps1`, which lives outside the repo and
belongs to braveworld"). Its operative line:

```powershell
& cmd.exe /s /c " ""…\python.exe"" -m uvicorn app.main:app --port 8100 >> ""$log"" 2>&1 "
```

No `--workers`. No `IRS_PRICER_CURVE_CACHE` documentation in its header (the
header covers only the double-start guard and the 5 MB log rotation). The
in-repo launchers (`scripts/gate.ps1:106`, `scripts/refresh.ps1:247`) match.

The running process agrees:

```
PID 5800   python.exe -m uvicorn app.main:app --port 8100     <- braveworld, single worker
PID 22140  python.exe -m uvicorn app.main:app --port 8200     <- sauron-v2's copy
```

`:8000` has **no listener** — the frozen krw-fi-pms is not running, and nothing
in this pass went near it. `:8100` is owned by PID 5800, which this pass did not
restart and did not need to (all measurement was in-process).

---

## R3 — Golden gate inventory, and the finding that decided the pass

### Baseline, recorded before any edit

```
363 passed, 1 skipped, 1 xfailed, 2 warnings in 315.36s
```

The skip is `test_reference_sheet.py` (no sheet in `data/reference/`); the
xfail is `test_validation.py:67`, a strict xfail documenting an accepted
limitation in the frozen bootstrap. Both pre-existing, both unrelated to this
path. 315s is inflated — the perf-baseline doc records 70s idle vs 201s with
servers up, and two uvicorns plus another session's work were competing.

### What pins the `to_irs_trade` → `value_booked_trade` path

| test file | tests | what it pins | kind |
|---|---:|---|---|
| `test_backtest.py` | 30 | DV01 agreement, entry ≈ 0, carry sign, spread neutrality, cash steps | property |
| `test_backtest_validation.py` | 6 | telescoping, payer/receiver mirror, notional linearity | property, ±₩1 |
| `test_backtest_recon.py` | 8 | row identity, aggregation, Friday booking, KRD scope | property |
| `test_backtest_theta.py` | 2 | frozen-market decomposition | property, bp budget |
| `test_backtest_edges.py` | 6 | unpriceable dates, same-day entry/exit | property |
| `test_backtest_magnitude.py` | 3 | valuation/DV01 vs realized move | property |
| `test_backtest_neutrality.py` | 2 | forward-realization zero-P&L path | property |
| `test_valuation_port.py` | 7 | **ported source text** vs frozen repo; units; no look-ahead | source byte-identity |
| `test_engine_port.py` | 7 | **ported source text** vs frozen repo; bootstrap shape | source byte-identity |

**No test pins numeric output.** `grep` for any fixture-backed pin over
`run_backtest`/`book_recon` returns empty; the four JSON fixtures in
`tests/data/` are all simulate-path goldens. The backtest is LIVE-ONLY by design
(`staticPaths.ts:65`), so `test_static_agreement.py` does not reach it.

The two byte-identity tests pin **source text**, re-extracted by `ast` from
`…\Rates Portfolio\krw-fi-pms-backend\irs_pricer\engine`. That directory **is
present**, so they run rather than skip (verified: those two files plus
`test_static_agreement.py` = 34 passed, 0 skipped). They would catch an edit to
a ported body; they cannot catch a cache that returns a wrong schedule.

→ **GATE A rule fires: NO-GO for Step 1.**

### A correction to the prompt's framing, measured

The session prompt's premise implies the path is unguarded. That is too strong,
and the check wins over the prompt in both directions. Two deliberate defects
were injected via throwaway pytest plugins (no repo file modified):

| injected defect | property tests (65) | characterization pin |
|---|---|---|
| memo keyed on `tenor_years` alone (notional/rate/direction/date dropped) | **25 failed** — caught | **caught**, both layers |
| `_cd_fixings` memo that drops the `upto` bound | **all 65 passed** — missed | **caught**, payload layer |

The first says the property net is genuinely strong against crude mis-keying.
The second is why the pin had to exist anyway: dropping that bound leaves
`select_fixing`'s inner no-look-ahead guard in place, so the sampled valuations
still agree — but the **chained roll-down** revaluation then prices with a
fixing "yesterday" did not know. That is precisely the defect class
`backtest.py:446` documents and measures at **₩250,000 over five months**, and
the entire existing suite is blind to it.

The general point stands independent of either result: every property assertion
on this path carries a tolerance (`KRW_TOL = 1.0` won; `STEP_BUDGET_BP = 0.12`;
`ROLL_BUDGET_BP = 0.5`), and the standard MEMO-1 must meet is byte-identity.

---

## R4 — `to_irs_trade` input dependency sweep

### There are TWO `to_irs_trade` implementations. The profile is entirely one of them.

| | backtest path | simulation path |
|---|---|---|
| `VanillaSwap.to_irs_trade` | `app/valuation_port.py:163` | `irs_pricer/engine/instruments.py:23` |
| produces | `app/engine_port.py::IRS_Trade` | `quant_engine.py::IRS_Trade` |
| call sites | `valuation_port.py:253` (`settled_cash_between`), `:286` (`value_booked_trade`) | `pricing.py:11`, `risk.py:29`, `mtm_valuation.py:94,128` |

All 39,804 builds are the **backtest** class. The simulation's copy is a
separate, unmeasured surface — an open item, and out of scope here.

### Can `trade_date` be `None`?

**Not at any live call site.** Every one of the nine constructions —
`backtest.py:301` (`_value_on`), `:329` (`_settled_to`), `:612` (`_leg_swap`),
and six in tests — passes `trade_date=entry_date` explicitly. None passes
`maturity_date`. But the dataclass default **is** `None`
(`trade_date: date | None = None`), so it is reachable by construction, and when
it is `None` both `start_dt` **and** (with `maturity_date` also `None`)
`mat_dt` become functions of `valuation_date` — i.e. genuinely uncacheable on
swap identity.

Under GATE A this rules "key on swap identity alone, plus a runtime assert".
**A deviation is recommended for the follow-on pass, stated here rather than
taken silently:** the house pattern in `curve_cache.py:147` is to *fall through
to the uncached original* on any unkeyable input ("so memoization can never
change behaviour — worst case it stops helping"), not to raise. `to_irs_trade`
with `trade_date=None` is legal, correct, and merely unexercised; an `assert`
would convert a legal input into a 500, and `assert` is stripped under `-O`
besides. Falling through is strictly stronger — it cannot produce a wrong
answer — and matches the precedent. The invariant stays visible via the pin.

### Non-swap inputs `_build_schedule` reads

Globals referenced: `_date`, `_modfol_bd`, `calendar.monthrange`,
`dateutil.relativedelta`. Only `_modfol_bd` reaches outside pure computation —
via `_next_business_day`/`_prev_business_day` → `_is_kr_business_day` →
**`_KR_HOLIDAYS`**.

**`_KR_HOLIDAYS` is NOT frozen at import.** The profiling pass did not mention
it. `holidays.KR(years=range(2016, 2036))` builds 375 entries with
`expand=True`, and the dict **grows on out-of-range lookups** — 375 → **396**
on the very first 10Y build, because a 10Y struck 2026-08-12 matures
**2036-08-10**, past the preload window. Forcing lookups to 2059 grows it to
716. So this is reachable in ordinary operation, not a theoretical concern.

It does **not** belong in the cache key, and the reason is a proof rather than
an assumption: `d not in _KR_HOLIDAYS` populates `d`'s year *before* answering,
so the verdict never depends on what was loaded earlier. Verified directly — a
schedule built cold and the same schedule rebuilt after forcing expansion to
2059 are identical across all 40 pay dates, both accrual vectors, start and
maturity. The dict grows; the function stays pure.

### Object shape

`IRS_Trade` is a **plain class with `__slots__`**, not a dataclass, not frozen.
Eight fields are immutable scalars; **three are mutable containers** —
`pay_dates` (list), `accruals` (list), `_pay_date_set` (set). `VanillaSwap` is
a **mutable** (non-frozen) dataclass.

None of the three consumers writes an attribute (verified by source inspection
of `value_booked_trade`, `settled_cash_between`, `compute_npv`: zero attribute
writes). That is a fact about today, in a repo where — as this pass discovered
first-hand — more than one session edits concurrently. The mutable containers
are why the follow-on pass's immutability guard is a requirement and not a
nicety.

---

## R5 — recon vs backtest attribution

`_build_schedule` calls, 3-position 5-year book:

| path | calls | share |
|---|---:|---:|
| `run_backtest` | 14,376 | 36.1% |
| `book_recon` | 25,428 | **63.9%** |
| total | 39,804 | |

**Confirmed: `_book_recon`'s pre-built swaps are discarded.** It builds
`info["swaps"] = [_leg_swap(leg, entry_date) …]` once per position
(`backtest.py:676`), but `value_booked_trade` calls
`swap.to_irs_trade(curve.valuation_date)` unconditionally on every invocation
(`valuation_port.py:286`). The pre-build therefore saves only the `VanillaSwap`
dataclass allocation, never the schedule — which is the entire cost. This
matches the wall-clock split (recon 9.39 s vs backtest 5.29 s).

The optimization target is **majority-recon**, which the profiling pass left
unattributed.

---

## GATE A — ruling

**NO-GO for Step 1**, on the R3 rule: no test pinned byte-identical output over
the memoized path, so there was no instrument capable of adjudicating the
mandate's own standard. R0 passed, R1 found the tree live and unambiguous, R4
found `trade_date` never `None` at a live site and proved the one mutable
non-swap input answer-preserving — none of which overrides R3. Per the rule, a
characterization pin was written, landed as its own commit, and the pass stops
there; memoization becomes a follow-on pass.

---

## What was changed, and where

Commit **`38325497`** — 4 files, +11,925 lines, additive, test-only.

| file | what |
|---|---|
| `backend/tests/characterization.py` | the fixture: 15 literal quotes, 260 business days from 2024-01-02, deterministic evolution |
| `backend/tests/test_backtest_characterization.py` | 3 tests — self-containment, payload layer, raw float64 layer |
| `backend/tests/regen_characterization.py` | `python -m tests.regen_characterization` |
| `backend/tests/data/backtest_characterization.json` | 271 KB — 260 points, 5 positions, 167 recon rows, 115 raw float64 |

Two design points worth keeping:

**The fixture reads nothing from disk.** The existing synthetic builders
(`tests/synthetic.py`) seed from a real row of `irsdata.xlsx`, which is right for
property tests and wrong for a pin: expected values would change whenever the
morning bake rewrites the workbook, and that workbook is uncommitted right now.
Quotes are literals; the evolution law uses only `+ - * /` and `math.sqrt`.
`sqrt` is the one transcendental IEEE-754 requires to be correctly rounded —
`sin` and `**0.5` route through libm/`pow` and can differ across platforms and
library versions, which would make the pin a false-alarm generator.

**Two layers, neither subsuming the other.** The payload layer compares the
whole `run_backtest` + `book_recon` response, which the engine has already
rounded to the won — so agreement there is agreement at **won granularity**. The
raw layer compares `_value_on`/`_settled_to` at unrounded float64 with `==` and
no tolerance (JSON round-trips float64 exactly via `repr`). The fixings defect
above was caught by the payload layer only, because the raw sample points sit
behind `select_fixing`'s inner guard — evidence that both are needed.

Positions cover 1/2/3 legs, both directions, non-integer tenors (9M, 1.5Y — the
locus of the documented FLOAT-tenor defect, which any key that rounds the tenor
would reproduce), one position maturing in-window, one closed by explicit exit.

---

## GATE B — verification

| check | result |
|---|---|
| pin passes standalone | **3 passed in 11.81 s** |
| fixture deterministic | regenerate → `diff` byte-identical |
| regeneration diff-stable | fixed pre-commit: `write_text` defaulted to CRLF on Windows, git normalises to LF, so every future regen would have diffed as a whole-file change and hidden the numbers that actually moved. Now `newline="\n"`; verified a second regen produces no diff |
| pin catches a crude mis-key | **2 of 3 failed** (both number layers) |
| pin catches the subtle fixings defect the other 65 tests miss | **caught** |
| commit contains exactly the intended paths | verified — `git show --stat 38325497` = the 4 files; other session's 7 files untouched |
| full suite vs the 363/1/1 baseline | **366 passed, 1 skipped, 1 xfailed in 299.60 s** — baseline + exactly this pass's 3 tests, no new failure, no new xfail |

**On attribution.** I flagged this run as contaminated while it was in flight,
and on the evidence that was too cautious — the arithmetic settles it. Baseline
collected 365 (363 + 1 + 1); this run reports 366 + 1 + 1 = 368 = 365 + 3. The
delta is exactly the three tests this pass added, and nothing else entered the
run. That follows from *when* pytest imports: collection ran at ~13:48, so
`app/payloads.py` was imported in its pre-edit state (it was modified at
13:51:13, after import) and `backend/tests/test_theta.py` did not yet exist to
be collected. The other session's work is therefore absent from this result
rather than mixed into it.

The hazard was real even though it did not land: had the edits arrived a few
minutes earlier they would have been imported, and the counts would have moved
for reasons nothing in this pass caused. A gate run on a tree two sessions are
writing to is attributable only by luck of timing, and luck is not a method.

---

## Step 3 — not executed

Step 3 re-profiles after the memo. There is no memo. Deferred to the follow-on
pass along with Steps 1 and 2.

The published baselines stand unchanged and are what that pass should measure
against: **14.92 s** (3-position 5-year, backtest + recon), **5.93 s** /
**6.49 s** / **14.67 s** for the three configurations; `_build_schedule`
19.4 s of a 37.7 s profiled run.

---

## Open items

**1. R2 — uvicorn worker count.** Case (c): no `--workers` anywhere; the live
`:8100` process is single-worker. Not this pass's work. Anyone acting on it
should read `curve_cache.py:79-86` first — that cache is per-process, 65,536
entries, ~22 MB, and the s21 note records 11,661 distinct keys on a real book.
`--workers N` multiplies both the memory and the cold-warmup count, and s18
measured what happens when that cache goes cold: 658,505 real bootstraps, 93% of
a 24-minute wall.

**2. Vectorization estimate — estimate only, not a recommendation.** With
`_build_schedule`'s 19.4 s removed, `df_linear_rate` (1,678,250 calls, 7.0 s
cumulative) becomes the largest remaining item, alongside the 2,632,102 scalar
`np.interp` calls beneath it (6.6 s, of which 2.685 s is the C call and the rest
is per-call Python overhead). Batching those the way `portfolio_krd_day` already
does in this repo — one `np.interp` over the unique payment-date vector instead
of one per cash flow — should recover most of the per-call overhead but none of
the C time: **roughly 4–5 s of the ~18 s post-memo profiled run, ~1.3× on top of
the memo's 1.8×.** Order-of-magnitude, from call counts and measured per-call
cost; it has not been prototyped.

This is deliberately **not** proposed as work. It edits a ported body under an
active byte-identity guard, needs an explicit port exemption, and would require
re-pinning the very fixture this pass just created. Mixing it with the memo
would make a failure unattributable — which is the whole reason the pin exists.

**3. sauron-v2 divergence.** That tree vendors `app/valuation_port.py` and
`app/engine_port.py` by plain file copy from `f5de1fa7`. A memo landed here does
not reach it, by its own `BACKEND.md`. If the memo lands, someone should decide
whether v2 gets it too, and record the answer there.

**4. A real defect in this repo, reported by sauron-v2 and still unfixed here.**
`BACKEND.md` records that `backend/requirements.txt` omits `sqlalchemy` and
`pymysql`, both imported at module scope by `app/mysqldb.py`. This machine has
them, so `:8100` runs; a clean host dies on first import. That session could not
write to this tree. It is still true. Out of scope here, but it should not stay
unrecorded on this side.

**5. Concurrent-session hygiene.** Two sessions edited this tree during this
pass. Nothing was lost, because staging was by explicit path — but the full-suite
gate is unusable while that is true, and `git add -A` in either session would
have swept the other's work into a commit.
