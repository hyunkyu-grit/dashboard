# Failure modes — what actually breaks

Diagnosis run 2026-07-28 (stability session, Pass A). Every failure path in
this product was unexercised: the backend had always been up, warm, and fed a
well-formed file. This records what the **user sees**, not what the console
says.

Three categories, worst last:

| | meaning |
|---|---|
| **LOUD** | refuses to start / says something true and specific |
| **SILENT** | proceeds; the screen looks normal but something is missing |
| **PLAUSIBLE-WRONG** | proceeds and shows numbers that are confidently incorrect |

---

## 1. Client — every backend failure looks identical

**The single worst finding.** Backend down, backend slow, a 500, and a 200
with a truncated body all present as the *same* screen: the header, and
`불러오는 중입니다` in the middle. It never resolves.

| case | what the user sees | verdict |
|---|---|---|
| backend not running | `불러오는 중입니다` — measured still showing at 24s and again at 81s | **SILENT** |
| endpoint 500 (`/api/forwards`) | same permanent loading screen | **SILENT** |
| 200 with truncated JSON (`/api/wall/summary`) | same permanent loading screen | **SILENT** |
| slow endpoint (5s on `/api/health`) | header freshness chip simply appears late; no indication anything was slow | SILENT (benign) |

Measured with the real backend stopped, then with a mock on :8100 serving a
5s-delayed `/api/health`, a 500 on `/api/forwards`, and a deliberately
truncated body on `/api/wall/summary`.

Notes:
- `ERROR_SENTENCE` ("불러오지 못했어요…") exists in `ui/copy.ts` and is wired
  to `isError` on the summary query, but **was never reached** in any of these
  runs. A direct `fetch` from the page fails in ~2.4s and the client is
  configured `retry: 2`, so an error state was expected around 10s. It did not
  appear at 24s or 81s.
- Even if it had appeared, it is a bare sentence: **no retry affordance**, so
  the only recovery is a manual page reload.
- The bottom strip does not render at all while `summary` is undefined, so the
  anchors vanish rather than degrading.
- The verification tab was `visibilityState: hidden` throughout (an
  environment constraint recorded in earlier sessions). That can affect
  background timers, so treat the exact timings as indicative — but the
  *outcome*, a screen that never tells you anything is wrong, reproduced on
  every run.

**Also client-side:** a hand-edited `?tile=series:NOPE9Y` renders the normal
screen with the bogus parameter still in the URL and no sheet and no message —
**SILENT**.

---

## 2. Data file — the likeliest real failure

`data/irsdata.xlsx` is hand-updated, so this is where breakage will actually
come from. Tested against a synthetic workbook built to the real sheet's
layout (metadata row, merged-label row, field row, dates descending), one
mutation at a time.

| mutation | result | verdict |
|---|---|---|
| text where a number belongs (`"n/a"`) | `ValueError: could not convert string to float` — refuses to start | **LOUD** ✅ |
| blank cell mid-series | loads; value becomes `None` | SILENT |
| **duplicated date** | loads; 60 rows / 59 unique dates | **PLAUSIBLE-WRONG** |
| **decimal slip** (`4135.0` for `4.135`) | loads; no complaint at all | **PLAUSIBLE-WRONG** |
| **negative rate** (`-99.0`) | loads; no complaint at all | **PLAUSIBLE-WRONG** |
| one business day missing | loads; max gap 4d | SILENT |
| 30 business days missing | loads; max gap 45d | SILENT |
| **two rows swapped** (out of order) | loads; max gap 17d, series silently misordered | **PLAUSIBLE-WRONG** |

Why the last group is dangerous rather than merely wrong:

- **Duplicated / out-of-order dates** break `value_at`, which is a `bisect` on
  an assumed-ascending unique list. Basis lookups (D-1/WTD/MTD/QTD/YTD) then
  read the wrong row, so every change column is quietly wrong while the levels
  look fine.
- The loader decides ascending-vs-descending from `dates[0] < dates[-1]`
  alone, so a mid-file swap survives that check untouched.
- **A decimal slip is invisible.** Nothing bounds the values, so `4135%` flows
  into the curve bootstrap and every derived number — percentile, spread, fly,
  forward, DV01 — is computed from it.
- Gaps shift what "yesterday" means without saying so.

---

## 3. Startup cache — already correct

`.cache/*.json` corruption, as if the process died mid-write:

| case | result | verdict |
|---|---|---|
| truncated JSON | recomputes, logs `WARNING [cache] forwards: unreadable (...)` | **LOUD** ✅ |
| valid JSON, missing `payload` key | recomputes with the same warning | **LOUD** ✅ |
| empty (0-byte) file | recomputes with the same warning | **LOUD** ✅ |

No change needed; a regression test is worth having.

---

## 4. Concurrency — duplicated work

Two simultaneous requests for the same **uncached** forward series compute it
twice: 5,216 bootstraps where one pass is 2,608, ~3.7s wall. Results are
identical, so this is waste rather than incorrectness — but it is waste
proportional to the number of simultaneous readers, and `forward_history` has
no lock around its cache fill.

---

## What this points at

1. The client must distinguish "loading", "failed", and "failed and here is
   how to retry" — today it says "loading" for all three, forever.
2. The loader must refuse a file it cannot trust, and must name the row and
   column so the person fixing a spreadsheet can find it.
3. Failures inside a region (a thrown guard) must be contained to that region.
