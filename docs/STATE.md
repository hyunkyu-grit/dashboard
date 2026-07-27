# Sauron — state of the project

Updated at the end of the closing session, part 2 (Passes A–F). Three sections;
the **middle one is the honest boundary** — what a trader must know before
putting weight on any number on screen. A fourth short section records **known
and accepted** limitations (settled — neither verified-good nor open).

Head at writing: the closing-session-2 Pass F commit on `master`, mirrored to
`D:\Backups\braveworld.git` (still the only backup — no git remote).

---

## 1. Works and is verified

Automated gates (**BE 68 pass / 1 skip / 1 xfail, FE 54, lint 0, build+tsc
clean**) plus, where noted, live browser checks.

**Numerics — internal consistency (`tests/test_validation.py`):**
- Forward-annuity identity exact to **2.8e-17** → every forward, spread, fly,
  and DV01 is algebraically consistent with the curve's discount factors.
- Discount factors strictly decreasing in (0, 1]; no short-end blowup.
- Every spread/fly agrees with its outright inputs.
- `1D`/`3M` money-market anchors reprice to machine precision.
- 200+ historical dates over year-ends / 설 / 추석 bootstrap with no calendar
  blowup; all dataset dates inside the ported 2016–2035 holiday range.
- DV01-neutral residual ≈ 0; OHLC bucketing; relative-ATR; `d` as a true
  one-observation change; own-history cache invalidation — all tested.
- Dataset freshness (business-day age, `tests/test_staleness.py`) and the
  key-forward 10y level range (`tests/test_forward_history.py`) tested.
- Conventions read from the code into `docs/CONVENTIONS.md`.

**UI (verified live in prior sessions):** full-bleed shell, responsive panes,
opaque sticky headers, the instrument table (weight structure, screener chips,
한 줄 ladder + curve banner), the popup (crosshair tooltip + stats + last-value,
gloss, DV01 ratio, Pay/Receive diagram, candles, curve heatmap synced to the
chart), blue line + red/blue direction (contrast-guarded), leading-edge outlier
cue. Own-history cache: cold boot 17s → warm 2s.

**UI (verified live THIS session — Pass B, first browser look):**
- **Dark mode across every surface** — table, popup line + candles, forward
  matrix tint, curve heatmap, banner, chips, gauges: contrast clean; theme
  persists across reload.
- **Single-column bottom-sheet fallback** below 1520px.
- **Deep-zoom heatmap rebucketing** (cells widen into fewer buckets on zoom).
- **Candles never comb** at any zoom; the interval is user-chosen (선/주봉/월봉,
  labelled) — there is no auto step-up to misfire.
- **Quiet-day tint reads as calm, not faint.** The tint is an own-history
  percentile with an untinted floor below pct70, so a calm day goes clean
  (numbers still shown), not a uniform wash.

**UI (built + verified live THIS session — Passes C/D/E):**
- **Stale-data loudness (Pass C).** `/api/health` reports freshness; the header
  scales loudness with age (quiet / visible chip / red-outlined chip in words).
- **Change-log popover (Pass D).** Header popover reading the events rule, with
  reason chips, 연관 N건 expansion, and click-to-focus (jump to the
  instrument's tab, pin, pan).
- **Key-forward gauges (Pass E1).** Per-row 10y min→max track with marker +
  percentile, accent at the tails.
- **Tint legend (Pass E2).** Shared diverging-swatch key under the matrix and
  the popup heatmap.

## 2. Works but is UNVERIFIED — the honest boundary

- **Correctness against the desk's own numbers has never been tested.** The
  checks above prove the curve is *self-consistent*, not that it matches the
  owner's forward-matrix sheet. Pass A2's harness is built and **skipping** —
  drop `data/reference/forward_matrix_YYYY-MM-DD.xlsx` in and it runs. Until
  then, **no number has been checked against anything outside this repo.** This
  is the single most important open item.
- **The volatility tab is unreviewed by a user.** 3M reaches a genuine (not
  artefact) 12× relative-ATR; whether the tab is useful is unconfirmed.

## 2b. Known and accepted (settled — neither open nor a defect)

- **The ≤0.25bp bootstrap round-trip residual — OWNER-ACCEPTED (closing session,
  part 2).** The bootstrap does not reprice its own par inputs to 1e-8: exact at
  1D/3M, worst **0.22bp at 3Y**, from a single-pass sparse-node bootstrap + the
  CD91 node at 0.2493y. It is a fit artefact in **frozen** ported code, not a
  convention error. The owner decided **not** to re-port it. What this means for
  reading the screen:
  - **Change columns** (the product's main content) are **barely affected** —
    the residual varies slowly with curve shape and largely cancels in a
    difference of two curves.
  - **A level read for pricing carries the full ~0.25bp.** Displayed forwards
    are shown to 4dp; that precision exceeds a level's absolute accuracy (good
    for comparing cells within one snapshot, not for quoting).
  - **Relationships are exact** (annuity identity 1e-17): spreads, flies, DV01
    ratio unaffected.
  - The strict `xfail` is kept as documentation of the accepted limitation.
  - `engine_port.py` is byte-identical to krw-fi-pms @570a2ff, so **that system
    carries the identical residual** — recorded so it is not re-diagnosed;
    fixing it there is not this repo's call. Detail:
    `docs/CONVENTIONS.md`, `docs/diagnostics/curve-validation.md`.

## 3. Missing or deferred

- **Run Pass A2** — the only external check of correctness; harness ready,
  waiting on the owner's forward-matrix sheet in `data/reference/`. (Mirror of
  §2's boundary item, stated here as the action.)
- **Data feed.** Refresh is manual (documented in the README); the app now says
  when the file is stale (Pass C) but nothing fetches a new close. An automated
  feed is an owner decision, out of scope here.
- **No economic calendar; no strategy tooling / P&L / notional entry** (the
  reserved popup region stays empty) — deferred by owner.
- **No git remote** — the D: mirror is the only backup.
