# Color density & 한 줄 replay — Session 15 Pass E2 / C2

**Status: diagnostic. The colour-intensity normalization is NOT implemented —
the owner picks the scale from these numbers (like the Session-11 change-log
rule). The 한 줄 ladder (Pass C2) IS implemented, using the threshold this
replay recommends.**

Reproduce: `cd backend && PYTHONIOENCODING=utf-8 python scripts/color_density.py`
(reads `data/irsdata.xlsx` through the app modules; changes no runtime code).
Numbers below are from 2608 closes, the last **500 business days** replayed,
over the **50 table series** (15 outrights + 15 spreads + 20 flies).

Forwards are excluded from the 500-day replay: a historical forward change needs
a per-date curve bootstrap per cell (168 × 2608), far too heavy for a
diagnostic. The forward matrix is characterised from the current single-day grid
instead — which is exactly the "how many of 168 cells tint today" question.

Per §16 this needs one thing from the backend when the owner approves a scale: a
**normalized magnitude per cell** (own-history percentile of |change|), computed
server-side. It is not built yet.

---

## 1. Change columns — how many cells reach full saturation per day

The waste today is that hue is spent on **sign**, which `+`/`−` already carry.
Hue should carry *worth looking at*. Candidate normalizations, D-1 column:

| Candidate | median | p90 | max | quiet days |
|---|---|---|---|---|
| (a) own-history z ≥ 3.0 | 0 | 1 | 36 | 88.2% |
| (a) own-history z ≥ 2.5 | 0 | 2 | 36 | 81.2% |
| (b) own-history pct ≥ 97 | **0** | **3** | 38 | **77.4%** |
| (b) own-history pct ≥ 95 | 0 | 7 | 40 | 60.4% |
| (b) own-history pct ≥ 90 | 2 | 18 | 43 | 31.4% |
| (c) cross-sectional top-3 | 3 | 3 | 3 | **0.0%** |
| (c) cross-sectional top-5 | 5 | 5 | 5 | 0.0% |

**(c) is disqualified by its own numbers**, exactly as the change-log's original
move rule was: it names winners every single day (0% quiet), so a "hot" cell
means nothing — there is always one. **(a) and (b) both leave most days quiet**
and let genuine outliers stand out; (b) percentile is preferred because it is
rank-based and not thrown by the fat tails a z-score chases. At **pct ≥ 97**,
77% of days have *no* saturated D-1 cell and a typical busy day lights ~3 — the
intended "two or three highlighted cells" state.

## 2. Forward matrix — the worse offender

Current grid (168 cells) normalizes each cell's tint against the **grid-max of
that same day** (cross-sectional — candidate c). Snapshot today:

| threshold | share of 168 cells tinted |
|---|---|
| \|d1\| > 0.03·gridMax | 98.8% |
| \|d1\| > 0.10·gridMax | 98.8% |
| \|d1\| > 0.25·gridMax | 95.8% |
| \|d1\| > 0.50·gridMax | 8.3% |

grid max |d1| = 12.50 bp, median |d1| = 5.03 bp. On any day where the curve
moves together (the common case), every cell is a large fraction of the day's
max, so **the whole grid tints and conveys only "everything moved"** — the
candidate-(c) failure again, now over 168 cells.

**The tint scale and the text scale must share ONE normalization, and it must be
own-history (b), not cross-sectional grid-max.** Each forward cell keeps its own
distribution of daily changes; a cell tints only when *its own* move is
unusual. The grid does not need a separate scale — it needs the same
own-history scale the columns get.

## 3. YTD, stated plainly

The concern was that every tenor being up ~100 bp on the year would leave YTD
permanently saturated. **Under own-history normalization it does not.** Each
column's saturation at pct ≥ 97 (change vs a same-horizon own history):

| column (~horizon) | median | p90 | max | quiet days |
|---|---|---|---|---|
| d1 (~1d)   | 0 | 3 | 38 | 77.4% |
| wtd (~5d)  | 0 | 1 | 34 | 86.6% |
| mtd (~21d) | 0 | 0 | 26 | 93.0% |
| qtd (~63d) | 0 | 1 | 13 | 88.8% |
| ytd (~126d)| 0 | 1 | 21 | **88.6%** |

The year's +100 bp is *not* extreme against the same series' own 126-day moves —
the 2022–23 hiking cycle produced larger ones — so YTD is quiet 88.6% of days.
An honest own-history scale does **not** leave YTD lit; the fear was based on a
cross-sectional intuition, and cross-sectional is the scale we are rejecting.

## 4. Proposed alpha mapping (for the owner to approve)

- Normalization: **own-history percentile of |change|**, per series, per column,
  computed server-side (§16). Same scale for the forward matrix tint.
- Floor at **pct 70** → the minimum visible alpha; below 70 renders near-ink
  (effectively untinted). Full saturation at **pct 97**. Linear in between.
- The floor alpha must still clear text contrast (≥4.5:1 for the coloured
  numbers after Pass E1) — never a barely-there wash. A cell either reads as a
  real tint or as ink; nothing in between mumbles.
- Sign stays in hue (red up / blue down); alpha is magnitude only.

Result on a typical day: ~2–3 lit cells per column, most of the grid ink — the
eye lands on the few moves that matter.

## 5. 한 줄 ladder (Pass C2) — recommended thresholds

Same question, another channel. Ladder, first rung that applies:

1. today's move in the top N% of the series' **own** daily moves → `일간 변동 상위 N%`
2. else level percentile extreme → `백분위 N`
3. else stands out vs neighbours (solo direction among outrights) → `단독 상승`/`단독 하락`
4. else empty

Speaking rows/day (of 50), sweeping rung-1 move-pct and rung-2 level band:

| config | median | p90 | max | quiet days |
|---|---|---|---|---|
| rung1 ≥ 98, level-band 10% | 9 | 26 | 45 | 3.6% |
| rung1 ≥ 98, level-band 5% | 3 | 15 | 38 | 9.8% |
| rung1 ≥ 97, level-band 5% | **3** | 16 | 40 | 9.4% |
| rung1 ≥ 98, level-band 3% | 2 | 10 | 37 | 18.4% |

Isolated at the recommended cut: rung 1 alone (move-pct ≥ 97) is median 0 / p90
1 / quiet 86% — the rare "event" days; rung 2 (band 5%) carries the typical
count. **The old ≥90/≤10 band (band 10%) is the over-firer** — median 9 — because
in the current near-highs regime a fifth of every level distribution counts as
"extreme". Tightening to a 5% band drops it to a median of 3.

**Recommended: rung-1 move-pct ≥ 97 (top 3%), rung-2 level band 5% (pct ≥ 95 or
≤ 5), rung-3 solo direction.** Median 3 speaking rows, target 3–6. The p90 spikes
(15–16) are honest: on a day when the whole curve sits at a decade extreme, many
rows genuinely qualify for rung 2 — that is true, not noise.

### Why the column is empty today (the C2 diagnosis)

The current `classify_one_liner` has only two rungs: level percentile extreme
(≥90/≤10) and a retracement (a sign flip between adjacent bases, both ≥0.5 bp).
It is **not the restatement check over-firing** — the thresholds are simply
rarely met and the most common useful signal is absent:

- the retracement rung needs a sign flip, which almost never happens in a
  trending tape (everything up together), so it stays silent;
- there is **no rung for "this move is big for THIS series"** — `+5 bp` is an
  ordinary day for `10Y` and an event for `3M`, and nothing said which. That is
  rung 1, and it did not exist. It is the single most valuable addition.

Retracement is dropped; the ladder above replaces it.
