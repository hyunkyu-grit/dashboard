# Static conversion — feasibility

Pass A. Read-only: nothing in the repo changed to produce this. The prototype
lives in a scratch directory and is not committed; its numbers are below and
the two scripts that produced them are described well enough to rebuild.

**Verdict: feasible, with one hazard that must be fixed in Pass B and one
behavioural narrowing the owner should know about.** No item landed in class
(c) — nothing found here can kill the approach.

---

## 1. Purity axis 1 — is every endpoint a pure function of the xlsx?

| endpoint | parameters | verdict |
|---|---|---|
| `/api/wall/summary` | none | pure |
| `/api/forwards` | none | pure |
| `/api/volatility` | none | pure |
| `/api/health` | none | pure **except** freshness — see axis 2 |
| `/api/series/{id}` | `id`, `res=preview\|full`, `interval=w\|m` | selects, does not compute — but see the narrowing below |
| `/api/dv01/{id}` | `id` | dict lookup built at startup; pure |

Nothing computes from user input in the sense that matters — no arbitrary
arithmetic, no free-text expression. `res` and `interval` choose between
precomputed shapes, which is exactly what the brief permits.

**The one narrowing.** `/api/series/{id}` is *more general than the frontend*.
`series_values()` parses legs out of the id, so `1Y-3Y-7Y` or any other
combination of real tenors would compute a spread or fly that no screen offers.
Static files can only exist for an enumerated set, so that generality goes
away. In practice it costs nothing: `App.tsx` resolves `?tile=` **against the
loaded row list**, not by fetching — an id that is not a row never produces a
request, and the stability session's unknown-tile handling already clears it and
says so. So the generality was unreachable from the UI already. It is recorded
because it is a real difference between the live API and the static one, and
because anyone testing by hand-editing a URL will meet it.

## 2. Purity axis 2 — the wall clock

Grepped the whole backend for `date.today`, `datetime.now`, `utcnow`,
`time.time`, `.now()`. **Three production hits, and the load-bearing ones the
brief anticipated are not among them.**

| site | what it does | class |
|---|---|---|
| `staleness.py:59` `today or date.today()` | dataset age in KR business days → `/api/health` freshness | **(b)** — genuinely a "now" question |
| `dataset.py:269` `(dt.date.today() - dates[-1]).days` | "last observation is N days old" **load warning** | **(a)** — build-time diagnostic, never in a payload |
| `tests/test_dataset_validation.py` ×3 | fixtures build recent-looking dates | test-only, irrelevant |

**The four sites the brief expected to be wall-clock-dependent are already
anchored to the data, and this is the single most important finding in Pass A:**

- **WTD/MTD/QTD/YTD boundaries** — `derive.py::basis_dates` computes week,
  month, quarter and year starts from **`dataset.asof`**, the last observation
  date, not from today. Class (a) already; nothing to change.
- **The trailing 252-observation level window** — `ANNUAL_OBS` slices the last
  252 *observations*, not the last 252 days from now. Pure.
- **The ten-year change-percentile window** — `day_move_pct` uses the full
  history. Pure.
- **Forward start dates** — `start_date_for(asof, …)` is ModFol-adjusted off
  `asof`. Pure.

So the freeze-at-build-time failure the brief warns about — the page silently
answering yesterday's question — **cannot occur for any market number.** The
whole payload is a function of the file. Only the freshness badge is a "now"
question, and that is class (b): it moves to the client, which compares the
manifest's last observation date against the reader's own clock. That is
strictly better than today's behaviour, where the *server's* clock decides.

**Nothing in class (c).**

## 3. The id space, and a hazard that fails silently

Enumerated exactly as `ui/rows.ts::buildRows` does, so the set is what the
frontend can actually request:

| group | count | note |
|---|---:|---|
| outrights | 15 | every tenor in the file (the brief's estimate of 6 was low) |
| derived | 35 | 15 spreads + 20 flies |
| forwards | 140 | 20 start points (ON excluded — it is spot) × 7 tenors (SPOT excluded — it is the outright) |
| volatility | 6 | `vol:<tenor>` |
| **total** | **196** | |

Each series needs four history artefacts (`full`, `preview`, weekly candles,
monthly candles) plus one dv01 → **983 files** including the three top-level
payloads.

### ⚠ `vol:` ids contain a colon, and on Windows that fails silently

The brief said to confirm rather than assume that ids round-trip. They do not.

- `encodeURIComponent("vol:1Y")` → `vol%3A1Y`, so the fetch URL and any
  literal filename already disagree.
- On NTFS a colon is the **alternate-data-stream separator**. Writing
  `series/vol:1Y.json` does not create that file and does not raise: it creates
  a **zero-byte file named `vol`** and hangs the content off it as a stream.
  The prototype wrote 761 files plus one `vol` carrying **24 streams** — every
  one of the 6 volatility series × 4 forms, gone, with a clean exit code.

That is the worst failure shape this project keeps meeting: not an error, a
plausible-looking success. Pass B must map ids to filenames explicitly rather
than interpolating them, and must fail loudly on any id that does not
round-trip. `1.5Y` and `vol:1.5Y` also carry dots, which interact with a
`.preview.json` / `.w.json` suffix convention — a reason to prefer an explicit
mapping over string concatenation there too.

Everything else is clean: `1Y-10Y`, `2Y-5Y-10Y`, `6Mx3M`, `4Y6Mx2Y` are all
URL-safe and filesystem-safe unchanged.

## 4. Cost of the full precompute

Stated before measuring, so a wrong number would be visible: ~200 series over
~2,600 observations, tens of MB raw, single-digit MB gzipped, build in minutes.

**Measured** (dev servers stopped; xlsx = 2,608 dates):

| bucket | files | raw | gzip | largest file |
|---|---:|---:|---:|---:|
| `series_full` | 196 | 20.58 MB | 3.90 MB | 0.106 MB |
| `candles_w` | 196 | 6.62 MB | 1.56 MB | 0.035 MB |
| `series_preview` | 196 | 1.88 MB | 0.43 MB | 0.010 MB |
| `candles_m` | 196 | 1.54 MB | 0.41 MB | 0.008 MB |
| `dv01` | 196 | 0.02 MB | 0.02 MB | ~0 |
| `forwards` | 1 | 0.05 MB | 0.01 MB | 0.050 MB |
| `summary` | 1 | 0.02 MB | 0.00 MB | 0.020 MB |
| `volatility` | 1 | 0.003 MB | 0.00 MB | 0.003 MB |
| **total** | **983** | **30.71 MB** | **6.32 MB** | **0.106 MB** |

**Per-series histories are 30.62 MB raw (99.7%) and 6.29 MB gzipped (99.6%).
Everything else is 0.09 MB.** Which answers the trimming question: there is
nothing to trim *except* history, the totals sit well inside every limit
(§5), so nothing needs trimming. Do not be tempted to drop the candle files and
aggregate in the browser — §16 forbids the browser aggregating a series, and
the saving would be 8 MB raw against a 100 MB ceiling.

### Build time — one order of magnitude *better* than predicted

| stage | seconds |
|---|---:|
| load xlsx | 1.0 |
| all historical curves, **one bootstrap per date** | 1.5 |
| forwards payload, cold (168 cells × own-history percentile) | 12.9 |
| all 983 artefacts | 17.3 |
| **total, cold** | **≈ 35 s** |

Predicted "minutes"; measured 35 seconds. The brief says to stop and report on
an order-of-magnitude miss, so: **this one is favourable and explained, not a
wrong number.** Two reasons. The historical-curve pass is 1.5 s, not the ~13 s
`forwards.py` claims in a comment written earlier — that comment is now stale.
And the brief's own instruction is what buys the rest: `forward_history()`
bootstraps the entire 10 y *per series*, measured at **1.58 s each**, so the
naive loop over 140 forwards would take **3.7 minutes** for the forwards alone.
Repricing off one shared pass folds all 196 series into 17.3 s.

**That shortcut was verified, not assumed.** Sampling six forwards across the
grid (`2Yx1Y`, `6Mx3M`, `5Yx5Y`, `1Yx1Y`, `3Mx3M`, `4Y6Mx2Y`), the shared-curve
values are **bit-identical** to `forward_history()`'s own bootstrap — same
length, `max|diff| = 0.0000000000`. Fast *and* wrong is the failure this
project has met repeatedly; this one is fast and identical.

## 5. Where the output sits against Vercel's limits

Looked up, not assumed (`vercel.com/docs/limits`, retrieved 2026-07-29):

| limit | value | us | headroom |
|---|---|---|---|
| Static file uploads (CLI deploy) | **100 MB** Hobby / 1 GB Pro | 30.71 MB | 3.3× on the *free* tier |
| Files per CLI deployment | **15,000** source files | 983 data + ~50 source | 14× |
| Build output files | no hard cap; slow above ~100,000 | ~1,000 | 100× |
| Build time | **45 min** | `next build` ≈ 5 s (no Python) | trivial |
| Routes per deployment | **2,048** | rewrites/headers only | keep `vercel.json` rules few |

Two notes the table does not carry. The 100 MB figure governs **CLI** deploys;
a git-backed deploy ships through the repository instead, so the operative
constraint there is the repo — the largest single file is 0.106 MB, far below
any host's per-file warning threshold. And "routes" counts every `headers`,
`rewrites` and `redirects` entry in `vercel.json`, so Pass D should express
cache policy as a couple of pattern rules, never per-file.

**Repo growth.** The 30.71 MB lands in git once. Thereafter a daily update
appends one observation to each of 196 histories. This is precisely why Pass B
must write one observation per line: as line appends, git's delta compression
makes each daily commit a few KB; as single-line blobs, every one of the 983
files rewrites whole and each update costs the full 30 MB again — about 7.5 GB
a year against a few MB. The line structure is the difference between the two.

## 6. What Pass B has to carry out of this

1. **Map ids to filenames explicitly and fail loudly on any that do not
   round-trip.** `vol:` is the live case; the failure is silent on Windows.
2. Settle the `.json` suffix convention against ids that contain dots
   (`1.5Y`, `vol:1.5Y`) and write it into `DESIGN.md`.
3. Reuse `_historical_curves` — never `forward_history()` in a loop.
4. One observation per line.
5. `allow_nan=False` on the serializer. Stated precisely, because the clean
   run is easy to misread: the prototype serialized all 983 files with
   `allow_nan=False` and **nothing tripped it**, which establishes that no
   non-finite float exists anywhere in today's output. That is not the same as
   the risk being absent. Two separate things are going on with gaps, and Pass
   B must not conflate them:
   - **Gaps in a history are currently *omitted*, not nulled.** Both the live
     `/api/series` and the prototype filter `if v is not None` before building
     points, so a missing observation produces no point at all. The static
     build must keep that — it is the live behaviour, and changing it would be
     a payload change smuggled in under a hosting change.
   - **Nulls elsewhere are ordinary and already correct** — `deltas`,
     `basisValues`, `range1y` and `movePct` all carry `None` legitimately and
     serialize as `null`.

   So the guard is against a *future* non-finite value (a divide-by-zero in a
   ratio or percentile reaching the serializer), which is why `allow_nan=False`
   goes in even though it currently never fires. The test should assert the
   serializer rejects a planted `float("nan")`, and separately that a
   known-gap date — early-2016 tenors, or the 11-day 2017 gap the loader warns
   about — comes out as an absent point rather than a `NaN` or a `null`.
