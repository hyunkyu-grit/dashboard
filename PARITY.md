# P0b — parity checklist against v1's swap monitor

Derived by reading `braveworld/frontend/src` at `47122287`, not from memory and not
from the session prompts. This is the acceptance criteria for P2.

Status vocabulary: **parity** (works in v2 now) · **gap** (must land in P2) ·
**dropped** (deliberate, with reason) · **deferred** (cannot land this session, with
reason). Nothing is marked parity that has not been seen working.

## Navigation and shell

| # | v1 capability | v2 | note |
|---|---|---|---|
| N1 | Sidebar, 240 px, the product's only navigation | **gap** | v2 has no sidebar at all; groups are chips in a row |
| N2 | Two levels: sections `Main · Backtest · Simulation · Lab`, with five 종목군 nested under Backtest | **gap** | v2 has one flat level |
| N3 | `TabId` is a single value; section is *derived*, never a second state | **parity** | v2 keeps one `group` value |
| N4 | Section click returns to the *last* 종목군, not always 아웃라이트 | **gap** | |
| N5 | Floating toolbar, 52 px, glass | **dropped** | CDS chrome replaces it; v2 has no toolbar yet |
| N6 | App name appears nowhere | **parity** | |

## The table

| # | v1 capability | v2 | note |
|---|---|---|---|
| T1 | One row per instrument across all groups, built by `buildRows` | **parity** | same builder, copied |
| T2 | Columns 종목 · 현재 · [sorted] · 어제 · YTD · MTD · 52주 · 위치 | **gap** | v2 renders 종목 · 현재 · 1D · MTD · YTD · 52주; **위치 (the position track) is missing**, and 52주 shows a bare percentile instead of high/low/mean sub-columns |
| T3 | Column header for 현재 is the **data date**, not the word 현재 | **gap** | v2 shows 현재 |
| T4 | Ladder: columns drop rather than shrink; sorted column never drops; tail-first | **parity** | guarded |
| T5 | Quiet "N columns hidden" indicator, no column picker | **parity** | |
| T6 | Widths from format maxima, `tabular-nums`, one declaration | **parity** | `<colgroup>`; **but see F1 below** |
| T7 | Sort by any change column, |change| descending first | **parity** | |
| T8 | Unmapped sort key → `Infinity`, enumerable, loud | **parity** | guarded |
| T9 | 주요 / 전체 divider inside each tab | **gap** | `Row.key` is carried but nothing renders the divider |
| T10 | Tint ramp on change cells with a floor; below floor untinted | **parity** | |
| T11 | Row hover, selection, keyboard activation (Enter/Space) | **parity** | delegated |
| T12 | Reorder animation on sort (FLIP) | **dropped** | owner ruling: it existed to make a 2.5 s re-sort legible; sorting is now ~26 ms and virtualization replaces the window anyway. **Implementation must be removed, not left dead** |
| T13 | Virtualization | **better than v1** | v1 renders every row; v2 is viewport-bound |

## The 전체 overview

| # | v1 capability | v2 | note |
|---|---|---|---|
| O1 | 전체 is a fixed three-column overview (아웃라이트 · 스프레드 · 포워드), whole surface | **gap** | v2 has no overview screen |
| O2 | One column owns one chart; clicking a tenor draws it in that column only | **gap** | |
| O3 | Each column opens on its own first row | **gap** | |
| O4 | Overview charts use FULL resolution, never `preview` | **gap** | |
| O5 | Butterflies and volatility are deliberately absent from the overview | — | inherits with O1 |

## Detail and preview

| # | v1 capability | v2 | note |
|---|---|---|---|
| D1 | Right pane: curve when idle, preview chart on hover | **gap** | v2 has no preview pane |
| D2 | Enlarged view (`?tile`): full history chart, six-basis readout, DV01 block, reserved strategy region | **deferred** | DV01 is out of scope this session; the rest needs D1 first |
| D3 | Two reference lines on every % chart: CD 91d grey, base rate red translucent, both solid, with legend | **gap** | |
| D4 | Visible-window extremes and background grid | **gap** | |
| D5 | Instrument gloss — subtitle and 2–3 sentence description in the popup | **gap** | `gloss.ts` copied, unused |
| D6 | Pay/Receive schematic | **out of scope** | named out of scope for this session |
| D7 | Forward matrix (§8) for forward instruments | **deferred** | needs the forwards payload wired to a matrix view |

## Screener

| # | v1 capability | v2 | note |
|---|---|---|---|
| S1 | `오늘 많이 움직인 것` — `movePct >= 90` | **gap** | `screener.ts` copied, not wired |
| S2 | `52주 고점권` — `pct >= 90` | **gap** | |
| S3 | `52주 저점권` — `pct <= 10` | **gap** | |
| S4 | `되돌림` — sign reversal across bases | **gap** | |
| S5 | `주요 포워드` — `keyForward === true` | **gap** | |
| S6 | Screener chips stay on one row; full set not exposed | **parity** | the *shape* is right; the predicates above are what is missing |

## Data state, freshness, failure

| # | v1 capability | v2 | note |
|---|---|---|---|
| F1 | Column widths derive from a `ch` probe **in the rendering context** | **gap — must fix first in P2** | v2 measures on a host `div` whose face is not the cell's (8.881 vs 8.813 px). Structurally wrong regardless of the size of the error; P3 multiplies the surface it corrupts |
| F2 | `DataFreshness` chip: `current` / `behind` / `stale` from manifest thresholds, Asia/Seoul | **gap** | `freshness.ts` copied, unused; v2 shows a bare `asof` string |
| F3 | Source chip — `sql` / `sql+xlsx-1d` / `sql+xlsx-day` / `xlsx` | **gap** | |
| F4 | A failure looks different from a wait: `LoadingState` vs `ErrorState`, separate components | **gap** | v2 renders one line of text for both |
| F5 | A failure is retryable in place — a button, not a toast, calling the query's own refetch | **gap** | |
| F6 | `null` → `—`, never 0 | **parity** | via `fmtLevel` |
| F7 | Empty state that teaches rather than "nothing here" | **gap** | |

## URL state

| # | v1 capability | v2 | note |
|---|---|---|---|
| U1 | Tab / selection in the query string | **gap** | v2 holds all state in React |
| U2 | Overlay URLs written with **shallow history** (`replaceState` / `pushState`), never router navigation — the production router-wedge fix | **gap** | inherits with U1; **this rule must be honoured when U1 lands** |
| U3 | Backtest window in its own `bt` namespace | **out of scope** | |

## Out of scope this session (named, so their absence is not a silent drop)

Backtest window · economic calendar · DV01 · Pay/Receive schematics · position P&L ·
deployment · the three-tab merge app · any "system suggests a trade" feature
(scoring, star ratings, good-entry badges, conditional historical distributions —
standing prohibition).

## Summary

| status | count |
|---|---|
| parity | 12 |
| gap (P2 must land) | 24 |
| dropped (deliberate) | 3 |
| deferred | 3 |
| out of scope | 8 |

**v2 is a table, not yet a monitor.** The table itself is at or above parity — it
sorts, ladders, tints, virtualizes and keeps every guarded contract. Everything
around it — overview, preview pane, screener predicates, freshness, failure states,
URL state — is absent, and F1 is a correctness defect that must be fixed before the
universe multiplies the surface it affects.
