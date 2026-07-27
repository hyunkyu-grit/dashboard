# Change-log firing — diagnosis (Pass A)

Read-only analysis. No behavior was changed. Numbers are reproducible via
`backend/scripts/changelog_diag.py` against `data/irsdata.xlsx`
(asof 2026-07-24, 2,608 daily rows, 50 series scanned = 15 outrights + 15
spreads + 20 flies).

> Doc-path note: the session prompt refers to `docs/DESIGN.md` as
> authoritative, but that file does not exist — the authoritative spec is
> `CLAUDE.md` at the repo root (same §5/§9/§12/§13 structure). Passes B and D
> require editing `docs/DESIGN.md §12/§9`, so the spec should be canonicalized
> to `docs/DESIGN.md` first. Flagged for the owner; not done in Pass A.

---

## Headline

The log can essentially never be empty because **both** its rules fire on
conditions that are almost always true:

1. **Level-percentile is a STATE, not an event.** The whole KRW curve is at
   multi-year highs, so every belly/long tenor sits at the ≥95th percentile
   and stays lit for weeks or months. This is a persistent condition, not
   something that "happened today."
2. **The move rule is a within-day cross-sectional rank.** It fires when
   `|Δ| ≥ (95th percentile of *today's* |Δ| across the 50 series)`. The top
   5% of any day's moves always exist, so the rule fires ~2–3 series **every
   single day** regardless of whether anything unusual happened — and on a
   parallel-shift day the entire long end ties at the day's cut and fires as a
   block.

Over a 500-day replay the current rule is empty on **1 day out of 500**.

The 22 lines seen on first run represent, at most, **one macro fact** — "the
curve is at decade highs" — plus **one genuinely distinct event**, the 1D
overnight-rate jump (+12.5 bp).

---

## Step 1 — What is firing right now (asof 2026-07-24, basis D-1)

23 series fire under basis D-1. The observed "22 on first run" is exactly the
**22 percentile-level firings** (which are basis-independent); the 23rd is 1D,
which fires move-only and therefore drops out under basis = Now (where deltas
are null). That reconciles the count.

| # | series | kind | rule(s) | pct | Δ D-1 (bp) | band |
|---|--------|------|---------|-----|-----------|------|
| 1 | 8Y | outright | percentile + move | 99.9 | 5.5 | Band 3 (also Band 1 curve) |
| 2 | 9Y | outright | percentile + move | 99.9 | 5.0 | Band 3 (also curve) |
| 3 | 10Y | outright | percentile + move | 99.9 | 5.0 | Band 3 (also curve) |
| 4 | 7Y | outright | percentile + move | 99.8 | 5.0 | Band 3 (also curve) |
| 5 | 6Y | outright | percentile + move | 99.7 | 5.0 | Band 3 (also curve) |
| 6 | 5Y | outright | percentile + move | 99.2 | 5.0 | Band 3 (also curve) |
| 7 | 4Y | outright | percentile + move | 98.7 | 5.0 | Band 3 (also curve) |
| 8 | 1Y/3Y | spread | percentile | 98.2 | 2.0 | Band 3 |
| 9 | 3Y | outright | percentile + move | 98.1 | 5.0 | Band 3 (also curve) |
| 10 | 1Y/1.5Y | spread | percentile | 97.8 | 1.0 | Band 3 |
| 11 | 1Y/2Y | spread | percentile | 97.7 | 1.75 | Band 3 |
| 12 | 1Y/5Y | spread | percentile | 97.4 | 2.0 | Band 3 |
| 13 | 1Y/10Y | spread | percentile | 97.4 | 2.0 | Band 3 |
| 14 | 1Y/1.5Y/2Y | fly | percentile | 97.3 | 0.25 | Band 3 |
| 15 | 1.5Y/2Y | spread | percentile | 96.9 | 0.75 | Band 3 |
| 16 | 1Y/3Y/5Y | fly | percentile | 96.9 | 2.0 | Band 3 |
| 17 | 1Y/2Y/3Y | fly | percentile | 96.8 | 1.5 | Band 3 |
| 18 | 1Y/5Y/10Y | fly | percentile | 96.8 | 2.0 | Band 3 |
| 19 | 2Y | outright | percentile | 96.7 | 4.75 | Band 3 (also curve) |
| 20 | 1.5Y/3Y | spread | percentile | 95.4 | 1.0 | Band 3 |
| 21 | 1.5Y/5Y | spread | percentile | 95.2 | 1.0 | Band 3 |
| 22 | 1.5Y/10Y | spread | percentile | 95.2 | 1.0 | Band 3 |
| 23 | 1D | outright | **move only** | 77.4 | **12.5** | Band 3 (also curve) |

Note the move-rule artifact: seven long-end outrights all show Δ = **exactly
5.0 bp** and fire "move." That is the day's 95th-percentile move value — a
near-parallel +5 bp shift makes the cut, and everything on it fires together.
The move rule is measuring *rank within a correlated set*, not anomaly.

---

## Step 2 — Linear dependence / how many distinct events

The 6 display tenors (1Y, 1.5Y, 2Y, 3Y, 5Y, 10Y) span only **5 independent
spread dimensions**; all 15 spreads and 20 flies are linear combinations of
those tenor levels. Clustering the firing set by shared underlying tenor
(union-find over legs) collapses the 23 lines to **7 components**:

- **1 display-tenor complex (17 series):** every spread/fly plus the 2Y/3Y/5Y/
  10Y outrights, all mutually linked through shared legs. This entire block is
  driven by the same handful of tenor *levels* being at highs — it is **one**
  piece of information expressed 17 ways.
- **5 singleton non-display outrights:** 4Y, 6Y, 7Y, 8Y, 9Y. These are
  interpolation neighbors of the display tenors and carry no independent
  signal — they fire because the long end as a whole is at highs.
- **1 singleton, 1D:** the only genuinely separate event (overnight +12.5 bp).

Only 4 of the 6 display tenors are themselves at percentile extremes
(2Y, 3Y, 5Y, 10Y); 1Y and 1.5Y levels are not, yet spreads against them still
fire — further evidence the spread/fly firings are redundant projections of
the long-end level story.

**Distinct events the 22 percentile lines actually represent: one** — "the KRW
curve sits at multi-year highs across the belly and long end." The 1D move is
a separate, real event on top of that.

---

## Step 3 — Historical replay of the CURRENT rule (last 500 business days)

Firings per day (level-percentile OR within-day move-rank, basis D-1):

| median | p90 | max | zero-firing days | mean |
|--------|-----|-----|------------------|------|
| **7** | **15** | 28 | **1 / 500** | 8.33 |

The log is non-empty on 499 of 500 days and typically carries 7 lines. "A log
that is never empty is not a log."

---

## Step 4 — Candidate rules, same 500-day window

| rule | median | p90 | max | zero days | mean |
|------|--------|-----|-----|-----------|------|
| current (level ∪ move-rank) | 7 | 15 | 28 | 1 | 8.33 |
| (a) transition into/out of band | 1 | 4 | 13 | **219** | 1.34 |
| (b) own-Δ percentile (≥95 of series' own 10y \|Δ\|) | 0 | 7.1 | **40** | 302 | 2.35 |
| (c) (a ∪ b), correlation-collapsed | 1 | **2** | 12 | 153 | 1.27 |

Reading the candidates:

- **(a) transition-only** is quiet (empty 44% of days) and records genuine
  band crossings, but by itself it misses large moves that don't change
  percentile band (e.g. a 20 bp jump while already mid-range).
- **(b) own-Δ percentile** fixes the cross-sectional-rank flaw — it compares
  each series to *its own* change history, so a calm day fires nothing
  (empty 60% of days, median 0). But alone it **bursts on correlated days**:
  max 40, because a big parallel move puts dozens of series simultaneously in
  their own top-5%. Uncollapsed, it re-creates the wall-of-lines problem.
- **(c) (a ∪ b) with collapse** keeps both event types — a band crossing and
  an outsized move relative to the series' own history — and collapses
  correlated firings into one leading line. It tames (b)'s bursts (max 40 → 12)
  while staying frequently empty (153/500 days) and low-volume (p90 = 2).

---

## Step 5 — Recommendation

**Adopt candidate (c): transition-into/out-of-band ∪ own-Δ-percentile, with
correlation collapse.** It is the only candidate that satisfies all four
requirements at once: it is *frequently empty* (a real log — 31% of days
silent vs the current rule's 0.2%), it is *low and stable* (p90 = 2 visible
lines), it *anomaly-scales the move test to each series' own history* instead
of a within-day rank that always fires, and it *collapses correlated firings*
(a parallel-shift day becomes one "long end +5 bp, 연관 N건" line, not 12).
Critically it also honors the state/event split the next pass is built on: the
persistent percentile-extreme *level* stops going in the log at all and stays
where it belongs — weight-600 on the tile — while the log records only what
changed today.

**Cap input for Pass B:** chosen rule (c) has p90 = **2** collapsed leading
lines/day and max = 12 over the replay. A visible cap around that p90 with
older entries scrolling keeps typical days fully visible; the exact constant
is set in Pass B and recorded in `DESIGN §12`.

---

*Rule (c) was confirmed and implemented (`backend/app/events.py`,
owner-confirmed 2026-07-24). The surfacing pass this doc calls "Pass B" was
orphaned when the list-first redesign removed the change-log surface, then
completed in the closing session (part 2, Pass D): `ui/ChangeLog.tsx`, a header
popover with 연관 N건 expansion and click-to-focus. No numeric cap was added —
the rule's p90 = 2 keeps the list short and the popover scrolls on a rare burst
day. See DESIGN §12 / "Settled decisions".*
