# Sauron — state of the project

Updated the final session (after numerical validation, Pass A). Three sections;
the **middle one is the honest boundary** — what a trader must know before
putting weight on any number on screen.

Head at writing: the final-session Pass A commit on `master`, mirrored to
`D:\Backups\braveworld.git` (still the only backup — no git remote).

---

## 1. Works and is verified

Automated gates (BE 60 pass / 1 skip / 1 xfail, FE 57, lint 0, build+tsc clean)
plus, where noted, live browser checks.

**Numerics — internal consistency (new this session, `tests/test_validation.py`):**
- Forward-annuity identity exact to **2.8e-17** → every forward, spread, fly,
  and DV01 is algebraically consistent with the curve's discount factors.
- Discount factors strictly decreasing in (0, 1]; no short-end blowup.
- Every spread/fly agrees with its outright inputs.
- `1D`/`3M` money-market anchors reprice to machine precision.
- 200+ historical dates over year-ends / 설 / 추석 bootstrap with no calendar
  blowup; all dataset dates inside the ported 2016–2035 holiday range.
- DV01-neutral residual ≈ 0; OHLC bucketing; relative-ATR; `d` as a true
  one-observation change; own-history cache invalidation — all tested.
- Conventions read from the code into `docs/CONVENTIONS.md`.

**UI (verified live in prior sessions):** full-bleed shell, responsive panes,
opaque sticky headers, the instrument table (weight structure, screener chips,
한 줄 ladder + curve banner), the popup (crosshair tooltip + stats + last-value,
gloss, DV01 ratio, Pay/Receive diagram, candles, curve heatmap synced to the
chart), blue line + red/blue direction (contrast-guarded), leading-edge outlier
cue. Own-history cache: cold boot 17s → warm 2s.

## 2. Works but is UNVERIFIED — the honest boundary

- **Correctness against the desk's own numbers has never been tested.** The
  checks above prove the curve is *self-consistent*, not that it matches the
  owner's forward-matrix sheet. Pass A2's harness is built and **skipping** —
  drop `data/reference/forward_matrix_YYYY-MM-DD.xlsx` in and it runs. Until
  then, no external validation exists.
- **The bootstrap does not reprice its own par inputs to 1e-8.** A **≤ 0.25bp**
  residual on swap tenors (worst 0.22bp at 3Y; exact at 1D/3M). A displayed
  forward could sit ~0.2bp off a perfectly self-consistent curve. It is a
  bounded fit artefact (sparse-node single-pass bootstrap + CD91 node at
  0.2493y), **not** a convention error, and it is in **frozen** ported code.
  Whether that is acceptable or needs an iterated re-port is the owner's call.
  Details: `docs/diagnostics/curve-validation.md`.
- **Not looked at in a browser** (Pass B, deferred by the A1 stop): dark mode,
  the single-column bottom-sheet fallback, deep-zoom heatmap rebucketing, the
  candle interval step-up, and tint intensity on a calm (non-regime) day. All
  coded and gated; none confirmed by eye.
- **The volatility tab is unreviewed by a user.** 3M reaches a genuine (not
  artefact) 12× relative-ATR; whether the tab is useful is unconfirmed.

## 3. Missing or deferred

- **Stale-data loudness (Pass D) — NOT built, deferred by the A1 stop.**
  `data/irsdata.xlsx` is static; the product would show yesterday's curve as
  today's without warning. Recommend building this next **regardless** of the
  bootstrap decision — it is safety, not cosmetics.
- **Orphaned change log (Pass C) — unresolved.** The events rule is computed on
  every request and rendered nowhere (`docs/diagnostics/changelog-firing.md`
  shows it fires almost daily). Surface it or delete it.
- **Key-forward gauges + matrix tint legend (Pass E) — not built.**
- **No economic calendar; no strategy tooling / P&L / notional entry** (the
  reserved popup region stays empty) — deferred by owner.
- **No git remote** — the D: mirror is the only backup.
- **Bootstrap re-port** — the only real fix for the ≤0.25bp residual; owner's
  call (frozen code).
