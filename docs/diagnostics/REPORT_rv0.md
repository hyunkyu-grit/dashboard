# REPORT rv0 — RV Analysis, Step 0 confirmation pass

**DIAGNOSE ONLY.** No source file was modified. All SQL was `SELECT` / `SHOW` /
`DESCRIBE` through `backend/app/mysqldb.read_sql`, which refuses anything else
(`backend/app/mysqldb.py:81-98`). `scripts/gate.ps1` was **not** run; the
backend was **not** started or stopped; `:8100` was not touched.

**Working-tree caveat, load-bearing for every citation below.** The tree is
dirty and another session is mid-flight: `git status` shows 20 modified files,
3 deletions (`app/regret.py`, `ui/RegretLab.tsx`, `guards/regret-list.test.ts`)
and 10 untracked (`app/surface.py`, `ui/YieldSurface.tsx`,
`guards/lab-tab.test.ts`, `docs/YIELD_SURFACE.md`, …), on `main` **ahead of
origin by 11**. Line numbers below are the **working tree as read on
2026-08-14**, not HEAD. Where the working tree and HEAD differ materially for
this report, both are stated.

Measurements dated 2026-08-14. `credit_matrix` / `mkt_irs_close` both end
2026-08-13.

---

# 1. Answers

## C1 — Does the Strategy tab exist, and where would a section mount?

### There is no Strategy tab. **PREMISE REJECTED** (see §2, PR-1).

The only occurrence of "Strategy" in the product is `StrategyRegion`
(`frontend/src/ui/EnlargedView.tsx:149-153`), a placeholder that renders the
sentence 전략 도구가 이 자리에 들어올 예정이에요 — and `EnlargedView.tsx` is
**unreferenced dead code**: its whole `?tile` namespace was retired
[OWNER, 2026-08-13] and the file is kept on disk only under the repo's
restoration rule (`frontend/src/ui/App.tsx:469-475`). `docs/DESIGN.md:2230`
still lists "Strategy tooling in the enlarged view (the reserved empty region
stays empty)" as a not-built item.

### The tab set actually rendered today

Source of truth: `frontend/src/ui/tabs.ts`. Navigation is **two layers, both in
the sidebar** — sections on top, and under `Backtest` only, a sub-list.

**Sections** (`tabs.ts:39-53`, rendered by `frontend/src/ui/Sidebar.tsx:122`):

| id | label | glyph | body |
|---|---|---|---|
| `main` | Main | ◍ | 3-column overview (`OverviewColumns`) |
| `backtest` | Backtest | ◫ | the instrument table + preview pane |
| `simulation` | Simulation | ◇ | `sim/ui/SimulationFlow` |
| `setting` | Setting | ◎ | `ui/SettingView` |
| `lab` | Lab | ◈ | working tree: `ui/YieldSurface`; HEAD: `ui/RegretLab` |

`Setting` sits **before** `Lab` deliberately: Lab-is-last is a separate
[OWNER, 2026-08-04] rule about the order of confidence, pinned independently
(`tabs.ts:43-52`, `guards/lab-tab.test.ts:36-48`).

**Backtest sub-list** — `BACKTEST_TABS` (`tabs.ts:102-109`), rendered at
`Sidebar.tsx:144`: `outright`, `spread`, `fly`, `forward`, `vol`
(= `GROUP_TABS`, `tabs.ts:92-98`), then `cashbond` (현금채권), then `assetswap`
(자산스왑).

**The state model.** One `useState<TabId>("all")`
(`frontend/src/ui/App.tsx:334`); the *section* is **derived** from it
(`tabs.ts:55-64`, used at `App.tsx:388`), never held separately — `tabs.ts:14-17`
records why (two states can express "Backtest with no group", which is not a
screen). `lastGroup` is the one extra piece of state (`App.tsx:389`), so
re-entering Backtest returns to the group you last looked at
(`tabs.ts:66-78`).

```
TabId = Group | "all" | "sim" | "lab" | "cashbond" | "assetswap" | "setting"   (tabs.ts:25)
Group = "outright" | "spread" | "fly" | "forward" | "vol"                       (ui/rows.ts:28)
SectionId = "main" | "backtest" | "simulation" | "lab" | "setting"              (tabs.ts:27)
```

Note that `TabId` **already carries non-`Group` members** (`cashbond`,
`assetswap`, `setting`), and `tabs.ts:29-35` states the rule explicitly: a tab
that is not a filter over IRS rows must **not** be added to `Group`, because
`Group` is what `rows.ts:buildRows` reads.

### Is there a notion of *sections within a tab*?

**No.** A tab is one flat surface. Two mounting conventions exist, and they
differ:

1. **Inside the shared table shell** — `sim` and `lab` keep the scroll
   container and swap only the body
   (`frontend/src/ui/InstrumentTable.tsx:378, 383, 604, 639-644`). The shell is
   `<Boxed on={!isOverview && !isSim && !isLab}>`; `filter` is typed `TabId`
   (`InstrumentTable.tsx:296`).
2. **Its own screen, above the loading/error gate** — `cashbond`, `assetswap`
   and `setting` render directly from `App.tsx:643-645`, guarded by
   `ownView` (`App.tsx:357`). `App.tsx:351-356` gives the reason: those screens
   do not depend on the IRS `summary`, so putting them under the IRS gate would
   make them unreachable whenever the IRS backend is down.

The nearest thing to a "section" is `GroupBox` (header + body):
`ui/SettingView.tsx:60` is a single GroupBox; `ui/CashBondView.tsx:201-237` is
one GroupBox around the table plus a chart pane.

### Smallest change that registers a new tab

Adding a **section** (e.g. `strategy`) touches, at minimum:

| file | what |
|---|---|
| `frontend/src/ui/tabs.ts:25` | add the id to `TabId` |
| `frontend/src/ui/tabs.ts:27` | add the id to `SectionId` |
| `frontend/src/ui/tabs.ts:39-53` | add the `SECTIONS` entry (**must not be after `lab`**) |
| `frontend/src/ui/tabs.ts:55-64` | `sectionOf` branch |
| `frontend/src/ui/tabs.ts:69-78` | `tabForSection` branch |
| `frontend/src/ui/App.tsx:357` (`ownView`) **or** `InstrumentTable.tsx:604,639` | pick one of the two mounting conventions above |
| `frontend/src/ui/App.tsx:605` | `showChartType` decides whether the toolbar chart-type control appears in the new section |

`Sidebar.tsx` needs **no** change — it maps `SECTIONS` and `BACKTEST_TABS`
generically (`Sidebar.tsx:122,144`).

### Guards / tests that enumerate the tab list

Two, and both are exact-equality assertions that will fail on any addition:

- `frontend/guards/overview-and-divider.test.ts:314-320` — asserts
  `SECTIONS.map(s => s.id)` is exactly `["main","backtest","simulation","setting","lab"]`.
- `frontend/guards/overview-and-divider.test.ts:322-323` — no `BACKTEST_TABS`
  id may collide with a section id.
- `frontend/guards/overview-and-divider.test.ts:334-344` — `BACKTEST_TABS` is
  exactly `GROUP_TABS + ["cashbond","assetswap"]`.
- `frontend/guards/overview-and-divider.test.ts:346-356` — the
  `sectionOf`/`tabForSection` round trip.
- `frontend/guards/lab-tab.test.ts:36-48` — `lab` must be the **last** section.

Both guards `import { SECTIONS } from "../src/ui/tabs"` rather than scraping
source, so the duplication is a *test* duplication, not a second definition.

### Duplication outside code

- `docs/DESIGN.md:64-72` describes the sidebar as "탭 여덟 개 … 종목군(행을
  거르는 탭 여섯)과 도구(자기 화면을 그리는 탭 둘)". That is **stale** — it
  predates Setting, Cash Bond and 자산스왑. It is prose, not an enumeration a
  guard reads, but it is a second place that would need updating.
- `docs/HANDOFF.md:296` heads the Cash Bond + Setting section.

### URL namespace

- **`?tile=` does not exist.** The enlarged view and its whole `tile` / `type`
  namespace were retired [OWNER, 2026-08-13 — "이제 그러면 크게보기탭을 없애면
  될 듯"] (`App.tsx:469-475`). `frontend/src/ui/urlState.ts:1-15` still
  *describes* two namespaces; that docstring is stale. **PREMISE REJECTED**
  (§2, PR-2).
- **`?bt=` / `?bti=` / `?btf=`** is the surviving overlay namespace
  (`urlState.ts:18`, `App.tsx:452-467, 506-532`). Presence of the `bt` nonce
  *is* the window. Every write goes through `mergeQuery` (`urlState.ts:22-33`)
  and is a **shallow** `window.history.replaceState`, never `router.replace`
  (`App.tsx:449-451`, with the production-only failure it fixes documented at
  `App.tsx:438-448`).
- **Tab state is not in the URL at all.** `App.tsx:334` is plain component
  state; `DESIGN.md:71-72` states the rule ("사이드바는 페이지를 옮기지 않는다
  … URL 도 상태도 바뀌지 않았다"). Consequence: a section is not linkable, and a
  `bt` deep link restores the window over whatever tab the app opens on.
- **`?w=` does not exist in this repo.** (It exists in the separate
  `sauron-v2` tree.)

### Escape hierarchy

Five listeners today. One press must peel one layer; the rule is implemented as
each layer *yielding* when a higher one is up:

| layer | file:line | yields when |
|---|---|---|
| intro curtain | `ui/IntroCurtain.tsx:548-555` | only active while `phase === "up"` |
| command bar | `wall/CommandBar.tsx:62-68` | `stopPropagation()` — nothing below sees it |
| backtest window | `ui/BacktestWindow.tsx:1103-1110` | yields while `?tile` is present |
| simulation result window | `sim/ui/SimulationWindow.tsx:47-53` | **yields to nothing** |
| unpin (App) | `ui/App.tsx:416-422` | yields while `?bt` is present |

Two facts a new participant has to reckon with:

- `BacktestWindow.tsx:1106` reads `params.has("tile")` — a **dead check**, since
  the `tile` namespace was retired. It is inert, not harmful, but it means the
  yield chain currently has one rung that can never fire.
- `SimulationWindow` closes on Escape unconditionally. If an RV overlay were
  opened while the simulation result window is up, both would close on one
  press.
- `ui/CashBondWindow.tsx` has **no** Escape handler at all (`WindowControls`
  × only, `CashBondWindow.tsx:427`), and it is opened from **local component
  state** (`ui/CashBondView.tsx:85` `openId`), not the URL. So the newest
  overlay in the product already declines to join the Escape chain — a section
  that opens its own overlay must decide which of the two precedents it follows,
  and that decision is not currently forced by any guard.

---

## C2 — Carry and roll: does any of this already exist?

**Yes, extensively — in three separate places, with three different
conventions.** The planned RV quantities are closest to `theta_for_bond`, but
are not the same quantity.

### C2.1 Where carry is computed

**(a) `backend/app/theta.py` — IRS "세타" column (carry + rolldown), on today's
curve.** `_unit_theta` (`theta.py:143-165`):

```
k       = forward_par_rate(zc, T, None)          # entry = today's par rate
roll_in = forward_par_rate(zc, T - h, None)      # same curve, shorter tenor
carry   = (cd_decimal - k) * h                   # h = HORIZON_Y = 0.25
roll    = (roll_in - k) * pv01(zc, T - h)
```

- Funding leg = **CD 91일 fixing** (`theta.py:114-115`, `CD_TENOR = "3M"`), i.e.
  the IRS float leg — not a policy rate and not a repo rate.
- Day count: `h` is a year fraction; the block is divided by
  `HORIZON_DAYS = 0.25 × 365` (`theta.py:96-98, 200-201`) to publish a **one-day**
  figure. Computed over a quarter and divided, deliberately — `theta.py:75-95`
  carries the measurement showing a true one-day roll is 6–19× noise.
- Not annualised. Sign convention is **pay-fixed** (`theta.py:20-24, 289`).
- Notional 100억 (`theta.py:102`); `perDv01` is notional-invariant
  (`theta.py:47-48`).

**(b) `backend/app/cashbond.py:755-808` — `theta_for_bond`, the same column for
민평 cash bonds.** This is structurally the closest thing in the repo to
Appendix A:

```
y0     = cm.yield_at(m, bond_type, i, years)                # today, full maturity
y_roll = cm.yield_at(m, bond_type, i, years - HORIZON_Y)    # today's curve, shorter
coupon = y0                                                 # struck at par
d_h, a_h, cp_h, rd_h = price(y_roll, coupon, n, HORIZON_Y)
clean_h = d_h - a_h + rd_h
roll    = (clean_h - 1.0) * NOTIONAL
carry   = (a_h + cp_h) * NOTIONAL
beBp    = cash / dv01_h
```

**(c) `backend/app/backtest.py:457-508` — the position P&L decomposition** (IRS),
and `backend/app/cashbond.py:232-348` — its cash-bond twin.

### C2.2 What the decomposition actually is

**PREMISE PARTLY REJECTED** (§2, PR-3). `손익 = 평가 + 캐리` is the *engine*
identity, and it is exact; but the **reported** decomposition is four buckets,
not two.

`backtest.py:461-480` states the algebra:

```
pnl = (dirty_t − dirty_0) + settled_cash
    = (clean_t − clean_0) + (accrued_t − accrued_0 + cash)
    = (평가 + 롤다운 + 개시)            +          캐리
```

- **캐리** = `accrued − accrued0 + cash` (`backtest.py:482`) — settled + accrued
  net interest, the textbook cash carry.
- **롤다운** = clean-price change from ageing alone, chained step by step on the
  *previous valued date's* curve (`backtest.py:483-494`) — Tuckman's
  unchanged-term-structure revaluation.
- **개시** = the trade-date→effective-date night, carved out
  [OWNER, 2026-08-14] because KRW CD-IRS starts spot, so that night's carry is
  structurally 0 and the whole theta fell into rolldown
  (`backtest.py:392-422`, with the measured numbers at `backtest.py:403-404`).
- **평가** = the remainder (`backtest.py:499`).

Cash Bond is also four, with a different fourth bucket:
평가 / 캐리 / 롤다운 / **조달** (`cashbond.py:35-45`, computed at
`cashbond.py:313-317`). There is no 개시 there because the synthetic bond is
issued on the entry date (`cashbond.py:42-45`).

The frontend display split preserves additivity at the *displayed* precision by
letting carry carry the residual: `ui/krw.ts:57-67` (`splitKrw`) and
`ui/krw.ts:81-87` (`splitCashBondKrw`), pinned by
`frontend/guards/krw-additivity.test.ts:30-59` — which also records that the
engine identity is `|손익 − (평가 + 캐리)| ≤ 1원` across 1,499 revaluation
points.

### C2.3 What the tests pin

- `backend/tests/test_backtest_theta.py:151-175` — with CD frozen, carry
  = `(CD − K) × elapsed`, ACT/365, **accruing from the swap's own start**
  (entry + 1 business day). Tolerance one day of carry.
- `backend/tests/test_backtest_theta.py:97-148` — a frozen market puts the whole
  clean change in 롤다운 and exactly 0 in 평가.
- `backend/tests/test_cashbond.py:415-420` — bond theta carry is exactly one
  day's coupon on the notional (`1e10 × 0.03 / 365`, rel 2e-3).
- `backend/tests/test_cashbond.py:422-432` — **`theta_for_bond` does not
  subtract funding, and does not even accept a funding spec**
  (`assert "spec" not in inspect.signature(...)`).
- `backend/tests/test_cashbond.py:434-438, 440-446` — flat curve ⇒ no rolldown;
  upward curve ⇒ buyer rolls into profit.
- `backend/tests/test_cashbond.py:60-66` — entry price is exactly par to twelve
  decimals.
- `frontend/guards/theta-column.test.ts` — the column header must name its
  normaliser, the browser must do no arithmetic (§16), absence must be an
  em dash.

### C2.4 Is the planned RV carry the same quantity?

**Different quantity. Both must coexist under distinct names.** Three
independent reasons, in decreasing severity:

1. **The funding leg is a different rate.** Planned: `policy rate +
   Σ(MPC Δbp × days remaining after that meeting) / effective days`, i.e. a
   **forward** expected policy path. Existing IRS carry: CD 91일 fixing
   (`theta.py:115`). Existing cash-bond carry: **no funding at all**. Existing
   cash-bond *backtest* funding: `funding.cost_between` on a **realized
   historical** BOK-base-or-call series + spread (`app/funding.py:179-187`).
   None of the three is the planned quantity.
2. **An owner ruling stands directly against subtracting funding in an adjacent
   column.** `cashbond.py:716-728` records [OWNER, 2026-08-14 — "채권에서는 조달
   차감하지 않는 걸로 하기"], together with the external check that this is
   *deliberately* against market practice (`carry = y − r_f`). A test enforces it
   (`test_cashbond.py:422-432`). The planned RV carry subtracts funding. If the
   RV number is called 캐리 and shown near the Cash Bond table's 캐리, two
   columns with the same name will differ by the funding leg — that is the
   reconciliation risk, and it is a naming problem before it is a maths problem.
3. **The horizon is different.** Existing theta is fixed at
   `HORIZON_Y = 0.25` and published as a one-day figure
   (`theta.py:96-98`, `cashbond.py:736`, `cashbond.py:794-797`); the two modules
   deliberately **share the constant** so the two tables can be read side by
   side (`cashbond.py:734-736`). The planned mechanism takes an arbitrary H
   (worked example H = 6 months) and does **not** annualise or per-day it. A
   build that reuses `HORIZON_Y` would silently change both existing columns.

### C2.5 Roll — is it a real revaluation or a display column?

**A real revaluation, in four places.** It is never a display column.

- `theta.py:155-164` — `roll = (roll_in − k) × pv01(zc, T − h)`, a price-based
  revaluation of the shorter swap at today's curve.
- `cashbond.py:784-787` — `roll = (clean_h − 1.0) × NOTIONAL` where `clean_h` is
  the full par-bond price formula evaluated at `y_roll` = today's curve
  interpolated at the **horizon remaining maturity**. This is Appendix A's roll
  line, modulo the horizon length and the clean/dirty split.
- `backtest.py:483-494` and `cashbond.py:280-288` — the chained frozen-curve
  rolldown in the backtests.

The par price formula itself is `cashbond.py:111-160`: `n` coupons per year with
`FREQ = 4`, discounting `(1 + y/4)^(-4τ)`, returning
`(dirty, accrued, coupons paid, principal redeemed)` separately —
`cashbond.py:123-143` records the defect that forced the fourth return value
(holding to maturity showed a loss equal to the principal) and why coupons and
redeemed principal must not be merged (carry read 110억, rolldown −102억).

### C2.6 Modified duration — at sale date or at purchase?

Both exist, in different modules, and the one named "duration" is the wrong one
for this mechanism.

| helper | file:line | evaluated at | units |
|---|---|---|---|
| `pv01(zc, tenor_years)` | `app/dv01.py:31-38` | whatever tenor is passed | par-swap annuity per unit notional |
| `dv01_at(y, coupon, n, elapsed)` | `app/cashbond.py:739-752` | whatever `elapsed` is passed | price per bp, face = 1, central difference ±0.5bp |
| `mod_dur = pvbp * 1e4 / value` | `app/instruments.py:254-259` | **purchase** (`elapsed = 0.0`, full tenor) | modified duration, years |

- `theta._unit_theta` calls `pv01(zc, T − h)` (`theta.py:159`) — the **horizon**
  annuity — and `_block` divides by `a_h_ref` to get `beBp` (`theta.py:203, 213`).
- `theta_for_bond` computes **both**: `dv01` at entry (`cashbond.py:791`, used
  for `perDv01`) and `dv01_h` at the horizon (`cashbond.py:792`, used for
  `beBp` at `cashbond.py:807`).
- The only thing in the repo actually called *modified duration*
  (`instruments.py:259`) is evaluated **at purchase**, and it exists to feed the
  simulation's position payload (`instruments.py:277`), not this screen.

So: a sale-date **DV01** helper exists and is already used for exactly this kind
of break-even. A sale-date **modified duration** does not — `instruments.py:259`
is the formula but with the wrong `elapsed`.

### C2.7 BEP already exists

`beBp` is shipped today on every theta block:

- IRS: `theta.py:210-213` — `beBp = −cash / (a_h_ref × NOTIONAL × BP)`, "how many
  bp must this instrument's **quoted value** move to cancel the theta", in the
  same unit as that row's level cell (rate for outrights, spread for
  spreads/flies).
- Cash bond: `cashbond.py:805-807` — `beBp = cash / dv01_h` (sign flipped
  because the bond side is buy-based, `cashbond.py:730-732`).
- Asset swap: `cashbond.py:707-708` — normalised by the **bond leg's** DV01,
  because par-par makes net DV01 ≈ 0 (`cashbond.py:686-689`).

Appendix A's `BEP(item) = item ÷ sale mod duration × 10000` is the same
construction with a different denominator convention (modified duration in years
vs money DV01) and a different numerator (per-item, not per-total).

There is **no crossover BEP anywhere** — no code computes
`(total_A − total_B) ÷ (durA − durB)`.

---

## C3 — SQL: sector curves

### C3.1 How the backend reaches SQL

Both paths exist; **SQL is primary** and the workbook is a bounded supplement.

- `backend/app/mysqldb.py` — a live SQLAlchemy `QueuePool` connection layer to
  `mysql+pymysql://bondman@miraebond2.kro.kr:4004/sim_portfolio`
  (`mysqldb.py:41-45, 54-74`). Read-only **by code**: `read_sql` accepts only
  `select`/`show`/`describe`/`explain`/`with` (`mysqldb.py:81-98`), and the
  connection is `autocommit=True` so no transaction accumulates.
- `backend/app/dataset.py:410-448` — `load_dataset_sql` reads `mkt_irs_close`;
  `dataset.py:391-407` maps 15 columns → 15 tenors.
- `backend/app/dataset.py:564-620` — `load_dataset_merged` is what is actually
  wired: SQL first, and `data/irsdata.xlsx` supplements **only the expected
  previous business day** — the 1D cell if only that is missing
  (`source = "sql+xlsx-1d"`), the whole day if the day is missing
  (`"sql+xlsx-day"`), full workbook only if SQL is unreadable (`"xlsx"`).
  History never switches source (`dataset.py:451-464`), because 1D is a
  *different series* between the two (80.8% mismatch, max 61.4bp —
  `dataset.py:381-387`).
- `backend/app/main.py:259` — `_dataset = load_dataset_merged()` at **module
  import**. It is a process-lifetime singleton.
- `backend/app/creditmatrix.py:207-217` — `load()` is called **per request**
  (`main.py:470, 488, 549`) and re-fetches when the watermark moves.

That asymmetry matters: within one process lifetime the IRS dataset is frozen
while the 민평 matrix can advance a day. See §5, IF-3.

The workbook path is **not** dead: `scripts/build_static.py`, the tests, and
`scripts/check_mysql.py` still read `data/irsdata.xlsx` (`main.py:242-258`).

The other Excel path *is* dead: `irs_pricer/loaders/credit_matrix.py` reads
`Credit Matrix Data.xlsx`, which does not exist in `data/` (verified:
`data/` holds only `AS_data.zip`, `bokbaserate.xlsx`, `irsdata.xlsx`,
`.cache/`, `reference/`). `creditmatrix.py:7-13` records this and says the
loader is left untouched because the simulation lane still imports it.

### C3.2 The sector 민평 table

**One table: `credit_matrix`.** Measured DDL:

```sql
CREATE TABLE `credit_matrix` (
  `bas_dt` date NOT NULL,
  `bond_type` varchar(4) NOT NULL,
  `rt_3m` double DEFAULT NULL, `rt_6m` … `rt_30y` double DEFAULT NULL,
  PRIMARY KEY (`bas_dt`,`bond_type`)
) ENGINE=InnoDB
```

- **Grain:** one row per **date × sector**, tenors as 13 columns. Not per issue.
  There is no ISIN anywhere in it. `pos_krw_bond` (the per-issue table) has
  **0 rows** — `cashbond.py:26-33` records that the traded bond is a synthetic
  "curve node composite", and names `pos_krw_bond` as the seat for real issues
  when they arrive.
- **Extent:** 19,488 rows = 1,624 dates × 12 sectors, **2020-01-02 →
  2026-08-13**.
- **Units:** percent. `3.777` = 3.777% (`creditmatrix.py:113-114`); divided by
  100 only at the discounting boundary (`creditmatrix.py:248`).

**Sectors present in SQL (12):** `KTB MSB KDB SPB BD CB1 CB2 CB3 CB4 CB5 CARD
OFB`. Every one has all 1,624 dates.

**Sectors the app reads (8)** — `creditmatrix.py:60-69`, and `_fetch` filters
`WHERE bond_type IN (…)` (`creditmatrix.py:154-156`):

| code | label | note |
|---|---|---|
| `KTB` | 국고채 | |
| `MSB` | 통안채 | |
| `KDB` | 산금채 AAA | |
| `SPB` | 공사채 AAA | |
| `BD` | 은행채 AAA | |
| `CB1` | 회사채 AAA | |
| `CARD` | 카드채 AA+ | |
| `OFB` | 캐피탈채 AA- | |

`CB2`–`CB5` (AA+ … A corporates) are in the table and **excluded from the
universe** (`creditmatrix.py:58-59`). The code→label assignment was inferred from
the credit ladder ordering on 2026-08-13, not from a schema comment
(`creditmatrix.py:53-56`) — there are no column or table comments in the DDL.

**한전 and 금융지주 are not in this table.** **PREMISE REJECTED** (§2, PR-4).

**특은채 is not a label in this repo.** **UNVERIFIED** (§4, UV-1).

### C3.3 Tenor coverage

Grid (`creditmatrix.py:79-96`): `3M 6M 9M 1Y 1.5Y 2Y 2.5Y 3Y 5Y 7Y 10Y 20Y 30Y`
(SQL calls the middle two `rt_18m`/`rt_30m`; the repo relabels to its own tenor
vocabulary deliberately).

- **The shortest node is 3M.** There is **nothing shorter than 3M** — no 1M, no
  overnight. Interpolation flat-extrapolates below the first point
  (`creditmatrix.py:260-261`), so any residual maturity under 0.25Y silently
  reads the 3M rate.
- **It reaches well beyond 3Y** — out to 30Y for two sectors.

Measured per-sector coverage after the repo's own two filters (`0 → None`,
`creditmatrix.py:139-148`; then the 50% observation floor,
`creditmatrix.py:98-101, 183-193`):

| sector | tenors that survive | dropped |
|---|---|---|
| KTB, SPB | all 13 (3M…30Y) | — |
| KDB, BD, CB1, CARD, OFB | 12 (3M…20Y) | 30Y (0/1,624 observed) |
| MSB | 8 (3M…3Y) | 5Y, 7Y, 10Y, 20Y, 30Y (all 0/1,624) |

MSB's 2.5Y and 3Y are 1,200/1,624 observed (424 zero days) and are **kept** —
that is what the 50% floor exists to separate (`creditmatrix.py:98-101`).

Asset-swap rows are further restricted to 민평 ∩ IRS grid:
`ASW_TENORS = 3M 6M 9M 1Y 1.5Y 2Y 3Y 5Y 7Y 10Y` (`cashbond.py:72-75`) —
the bond's 2.5Y/20Y/30Y and the IRS's 4Y/6Y/8Y/9Y have no counterpart.

### C3.4 Null and staleness policy

- **Missing is written as `0`, not NULL.** Measured: **zero NULLs** in any cell
  of any sector; every absence is a literal `0.0`. `creditmatrix.py:15-24`
  documents this as the table's defining hazard, and `rate_or_none`
  (`creditmatrix.py:139-148`) converts `0 → None` at parse time so that 0 cannot
  reach the interpolator. `guards/lab-tab.test.ts:108-117` pins the same rule for
  the surface chart ("구멍은 구멍으로 남는다 — 0 으로 채우지 않는다").
- **Gaps are not forward-filled within a day's curve.** `curve_points`
  (`creditmatrix.py:234-249`) omits a tenor missing on that date rather than
  carrying the previous observation, because "그날은 그 만기가 없었다" is
  sometimes true.
- **Most recent date per sector: 2026-08-13 for all twelve.** Measured. There is
  no per-sector drift.
- **There is no staleness gate on 민평.** `_fetch` has no `today` argument and no
  cut; `asof = dates[-1]` (`creditmatrix.py:121-123`). The IRS side's
  전일종가 rule — today's row is dropped because the Infomax export writes live
  11:00 quotes into it (`dataset.py:313-336`) — is **not** applied here. Today
  the two agree by luck; if `credit_matrix` ever lands a same-day row they will
  not. See §3, B-4.
- **Cache key** is `(MAX(bas_dt), COUNT(*))` (`creditmatrix.py:198-201`), the
  watermark substitute CLAUDE.md mandates for the SQL move. Because there is no
  `updated_at` column (confirmed: not in the DDL), a **silent revision of a past
  row is not detectable** — `creditmatrix.py:26-31` marks this [미해결].

### C3.5 Date semantics

The prompt asks for quote date vs application date vs load date, per column.

**`credit_matrix.bas_dt` — one date column, and the schema alone cannot settle
its meaning.** Evidence:

- The DDL carries **no comment**, no `updated_at`, no load-date column. The
  table is `(bas_dt, bond_type)`-keyed; there is nothing else to compare against.
- The repo's own treatment is "the date the curve was quoted": it is used as the
  index into a business-day series, joined date-to-date against
  `mkt_irs_close.irs_date` for asset swaps (`cashbond.py:354-365`), and
  `asof = dates[-1]` is shown to the reader (`cashbond.py:659`).
- **Calendar containment, measured:** 민평 dates ⊂ IRS dates exactly. 0 dates
  are in `credit_matrix` but not in `mkt_irs_close`; 15 dates (since 2020-01-02)
  are IRS-only — `2020-12-31, 2021-12-31, 2022-12-30, 2023-12-29, 2024-12-31,
  2025-06-03, 2025-12-25, 2025-12-31, 2026-01-01, 2026-03-02, 2026-05-01,
  2026-05-05, 2026-05-25, 2026-06-03, 2026-07-17`. This corroborates
  `cashbond.py:355-358` and is consistent with `bas_dt` being a **trading/quote
  date** (the IRS-only set is year-end closes and public holidays, i.e. days
  the 민평 vendor did not publish but the IRS table has a row for).
- Both tables end on the same date (2026-08-13, with today = 2026-08-14), which
  is consistent with "previous business day's close, loaded next morning" — but
  that is inference, not evidence in the data.

**Conclusion: `bas_dt` is most consistent with a quote/observation date, but the
data carries no field that distinguishes it from a load date, so this cannot be
proven from inside the database.** That is a finding, not a detail — see §4,
UV-2.

**`mkt_irs_close.irs_date` — quote date, and the repo says so operationally.**
The 전일종가 rule (`dataset.py:313-336`) exists precisely because a row dated
*today* is not a close: the vendor export refreshes at 11:00 and writes live
quotes into today's row. The cut is applied at the single choke point
(`_finalize`) so summary/curve/backtest/forwards all shift together.

**`bokbaserate.xlsx` — the one place where quote date and load date are both
present, and the load stamp is discarded.** Measured header:

```
row0: 시작 2016-01-01 | 종료 2026-07-16 | Data 개수 99999
row1: 한국:기준금리 | 단위: %
row2: 일자 | 현재가 | 갱신일시 | 갱신일자
row3: 2026-07-16 | 2.75 | '2026-07-16 10:09' | '2026-07-16'
row7: 2026-07-12 | 2.5  | '2026-07-14 15:35' | '2026-07-14'
```

The 2026-07-12 row is stamped as refreshed on 2026-07-14 — the two dates
genuinely differ. **Neither reader uses columns 2 or 3**: `app/policy.py:44-46`
and `irs_pricer/loaders/base_rate.py:41-42` both take column 0 (`일자`) and
column 1 only. So the policy series is keyed on the **in-force date**, and the
load stamp is available but unread.

Note `base_rate.py:4-6` names the columns `"일자"/"종가"/"수정일시"/"적용일자"`,
which is **not** what the file says (`일자/현재가/갱신일시/갱신일자`). Doc drift
only — the loader reads by position, not by name. `app/policy.py:121-125` does
check the name, but only for column 0.

**No CD-series two-business-day offset is recorded in this repo.**
**PREMISE NOT CORROBORATED** (§2, PR-5).

---

## C4 — SQL: policy rate and MPC schedule

### C4.1 Where the policy rate comes from now

**Three separate mechanisms, none of them a SQL table.**

**(a) The chart anchor — `data/bokbaserate.xlsx` via `backend/app/policy.py`.**
Loaded once at import (`main.py:266`), resolved against the dataset's as-of date,
and shipped in the wall summary as `policy` (`main.py:266`,
`payloads.py:79-81`). Shape: `{unit, asof, through, steps[{date, rate}],
latest, warnings}` (`policy.py:189-200`). The carry-forward is **bounded by the
meeting calendar**: if a meeting falls between the workbook's last date and the
dataset's as-of, the step ends early and a warning is recorded
(`policy.py:166-188`) rather than drawing an unverified rate.

**(b) The Cash Bond funding leg — `backend/app/funding.py`.** Introduced
2026-08-14 with the Setting tab. Two selectable bases (`funding.py:9-19`):

| basis | source | measured coverage |
|---|---|---|
| `base` | `data/bokbaserate.xlsx` via `irs_pricer.loaders.base_rate.all_rates` | 3,850 daily rows, **2016-01-01 → 2026-07-16**, latest 2.75% |
| `call` | SQL `mkt_irs_close.call_rate` (`funding.py:101-104`) | 2016-01-04 → 2026-08-13 |

Defaults: `DEFAULT_BASIS = "base"`, `DEFAULT_SPREAD_BP = 10.0`
(`funding.py:45-46`), chosen to match the simulation lane's long-standing
"기준금리 + 10bp". Day count ACT/365 **calendar days** (`funding.py:27-31`).
Outside coverage the nearest endpoint is flat-extended (`funding.py:134-139,
167-176`). Scope is explicitly **Cash Bond only** — `app/backtest.py` does not
import it, so IRS backtest numbers are byte-identical to before
(`funding.py:21-25`).

**(c) The simulation constants — `POLICY_BASE_RATE_KRW` /
`FUNDING_SPREAD_BP` still exist, with these values:**

```python
POLICY_BASE_RATE_KRW = 0.0275   # backend/irs_pricer/services/funding_basis.py:66
FUNDING_SPREAD_BP    = 10       # funding_basis.py:67
FUNDING_RATE_KRW     = 0.0285   # funding_basis.py:68
```

Consumers, complete:

| consumer | file:line |
|---|---|
| re-export shim for the whole simulation family | `irs_pricer/services/simulation/constants.py:15-17` |
| `simulation_service` facade | `irs_pricer/services/simulation_service.py:41-43` |
| orchestrator default funding rate | `irs_pricer/services/simulation/orchestrator.py:16, 70` |
| `base_rate_at` fallback beyond series coverage | `funding_basis.py:96` |
| staleness adjudication | `funding_basis.py:87` |
| provenance payload | `funding_basis.py:114-115` |
| chart funding strip (via `_funding_base`) | `irs_pricer/services/simulation/chart.py:409-459` |
| pinned by test | `backend/tests/test_simulate_s15.py:121-123` |

`funding_basis.py` is **not** used by `app/funding.py` — the two are parallel
implementations of "policy rate + spread" with different sources of truth.
`app/funding.py:43-46` acknowledges the lineage in a comment only.

### C4.2 Is there a table of MPC decision dates?

**No SQL table. Two hand-maintained copies in the repo.**

- `frontend/src/data/calendar.json` is the owner-verified original
  (`app/policy.py:52-57`). Its own note (`calendar.json:2`) states: **2026 only,
  deliberately** — the previous 2016–2025 history was reconstructed from memory,
  about one entry in eight was wrong, and all of it was deleted rather than
  repaired. Entries carry `source` and a load-bearing `verified` flag; an entry
  with `verified: false` renders nowhere and does not count toward staleness.
- `backend/app/policy.py:58-67` — `MPC_DATES`, a second copy, kept because the
  backend must not read the frontend tree at runtime;
  `tests/test_policy.py::test_mpc_dates_match_the_calendar` fails if they
  diverge.

**Coverage: eight 2026 dates only** —
`2026-01-15, 02-26, 04-10, 05-28, 07-16, 08-27, 10-22, 11-26`.

`frontend/guards/calendar.test.ts` fails when the last verified entry is under
60 days away — that failure is the reminder to add the next year
(`calendar.json:2`). Today is 2026-08-14 and the last entry is 2026-11-26, so
that alarm is ~44 days out.

**Realized vs expected:** the calendar carries **decision dates only** — no rate
field at all. Realized changes live separately, as the step corners derived from
the daily workbook (`policy.py:154-163`), which yields 23 change points
2016-01-01 → 2026-07-16 (measured; last six: 2023-01-13 3.50, 2024-10-11 3.25,
2024-11-28 3.00, 2025-02-25 2.75, 2025-05-29 2.50, 2026-07-16 2.75).

There is **no field anywhere for an expected change.**

### C4.3 The per-meeting expected Δbp input

**Classification: a value the user types. The repo has no data for it — but it
already has a typed-input mechanism for exactly this shape, in the simulation.**

- Wire model: `shortEndEvents: { id, date, shiftBp, cdSpreadBp? }[]`
  (`frontend/src/sim/types/simulation-port.ts:53-60`). `shiftBp` is defined as
  "그 날 **기준금리**가 움직이는 폭"; CD's move that day is
  `shiftBp + cdSpreadBp` [트레이더 피드백 4, 2026-08-07].
- The editor is a hand-added row list, defaulting to `shiftBp: "-25"`, with an
  empty date the user fills (`frontend/src/sim/ui/ConfigureStage.tsx:465-562`).
  It is **not** seeded from `calendar.json`.
- Backend: `fundingEvents: list[dict]` +
  `fundingStepping: bool = False` on the request
  (`backend/irs_pricer/api/routers/simulate.py:51, 69`), applied by
  `calc_dynamic_funding_rate(base_rate, funding_events, current_date)`
  (`irs_pricer/services/simulation/daily_valuation.py:228-236`) — a plain
  cumulative step: every event dated ≤ the current date adds `shiftBp / 10000`.

That last function is, to the won, the shape Appendix A's `avg funding` needs —
except that it produces a *rate on a date*, not the *time-average over the
holding period* that the mechanism specifies.

### C4.4 Is there a daily policy-rate series?

**Yes.** `data/bokbaserate.xlsx` carries **one row per calendar day**, repeating
the rate between decisions (`irs_pricer/loaders/base_rate.py:4-8`). Measured:
3,850 rows, 2016-01-01 → 2026-07-16, i.e. exactly daily with no gaps.
`app/funding.py` consumes it as a step ladder integrated once
(`funding.py:147-164`) so an arbitrary interval is an O(log n) difference.

**It ends 2026-07-16 — 29 days before today.** That is not staleness: it is the
date of the last decision, and 2026-08-27 is the next meeting
(`funding.py:16-19` states the reasoning). Both `funding.rate_on` and
`funding._accrued_to` flat-extend past the end.

---

## C5 — Colour: the saturation ramp

### C5.1 Does the ramp exist?

**It exists, and it is already exactly "two hues, magnitude in saturation".**
It is not intent. **PREMISE REJECTED** (§2, PR-6).

`frontend/src/theme/sign-tint.ts:41-51`:

```ts
export function tintFor(value: number, scale: number): string | undefined {
  if (!Number.isFinite(value) || value === 0) return undefined;
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  const frac = Math.min(1, Math.sqrt(Math.abs(value) / scale));
  const mix  = Math.round(MIN_MIX + frac * (MAX_MIX - MIN_MIX));
  const hue  = value > 0 ? "--bw-up" : "--bw-down";
  return `color-mix(in srgb, var(${hue}) ${mix}%, var(--bw-tile))`;
}
```

- **Stops:** `MIN_MIX = 8`, `MAX_MIX = 55` (`sign-tint.ts:29, 34`) — a
  *continuous* ramp, not discrete stops. Response is **√**, not linear
  (`sign-tint.ts:45-47`), because linear lets one outlier flatten the table.
- **Zero is not a direction** — untinted, and `directionVar(0)` returns ink
  (`sign-tint.ts:42, 59`).
- **The mix partner is `--bw-tile`, not `transparent`** — so this genuinely
  desaturates toward the surface rather than fading alpha.
- **The categorical rule that goes with it** (`sign-tint.ts:8-19`): on a tinted
  cell the **text is ink**. Direction-coloured text on a same-sign tint measures
  3.0:1 at 30%, 2.5:1 at 42%, 1.8:1 at 62% — it never clears 4.5:1 at any
  density, so this is a rule, not a tuning knob. `directionVar()` is for
  **untinted** surfaces only.
- **The ceiling's binding constraint is dark-theme ink contrast**
  (`sign-tint.ts:31-34`): 62% measures 5.06:1, 75% breaks at 3.99:1; 55% leaves
  headroom.

Hues (`frontend/src/theme/tokens.css`):

| token | light | dark | `prefers-contrast: more` light / dark |
|---|---|---|---|
| `--bw-up` | `#d92d3c` (:129) | `#f16e77` (:301) | `#a5222e` (:362) / `#f59aa0` (:371) |
| `--bw-down` | `#0064ff` (:130) | `#4c93ff` (:302) | `#004dc4` (:363) / `#83b4ff` (:372) |

The two hex values in the prompt match the light tier exactly.

Consumers of the ramp today: `ui/ReconStack.tsx:326` (KRD heatmap) and
`sim/ui/ResultsTables.tsx:269`; `sim/theme/tint.ts:10` is a re-export shim.

### C5.2 MATRIX_FULL / MATRIX_FLOOR

`frontend/src/ui/tint.ts:24-27`:

```ts
export const MATRIX_FLOOR = 0.06;  // graded tint at pct70
export const MATRIX_FULL  = 0.45;  // graded tint ceiling at pct97
export const PCT_LO = 70;
export const PCT_HI = 97;
```

- **They are alpha, not hue** — `wash()` builds
  `color-mix(in srgb, var(--bw-up|down) ${alpha*100}%, transparent)`
  (`tint.ts:33-37`). Hue is carried separately by `hue(up)` (`tint.ts:29-31`).
  Note the difference from `sign-tint.ts`: this one mixes toward **transparent**,
  the other toward `--bw-tile`.
- **What drives them:** an *own-history percentile* computed server-side, not a
  cross-sectional max — `tint.ts:1-6` records that the cross-sectional version
  lit 96–99% of the forward matrix.
- **Sole consumer:** `frontend/src/wall/ForwardMatrix.tsx:70` via `matrixTint`.
  `MATRIX_FLOOR` has no consumer outside `tint.ts:53`.
- **The change columns carry NO fill** (`tint.ts:8-18`, restated in
  `guards/tint-contrast.test.ts:3-10`): their number is coloured text at full
  strength; the largest fill that keeps it legible (~0.04) is invisible. The
  outlier cue there is `columnCue` — a 3px inset leading-edge rule, off the glyph
  (`tint.ts:39-46`), used at `InstrumentTable.tsx:257` and
  `OverviewColumns.tsx:179`. **"Do NOT re-add a change-column fill"** is written
  twice, in the module and in the guard.

So: a signed-magnitude heatmap would use `tintFor` (ink on tint, mixes to tile),
**not** `matrixTint` (which is the percentile wash for the forward matrix).

### C5.3 Guards a new coloured surface must satisfy

| guard | file | checks | what a signed-magnitude heatmap must do |
|---|---|---|---|
| `no-raw-hex` | `guards/no-raw-hex.test.ts:36-52` | zero `#rrggbb` in `src/**` except `theme/tokens.css`, `theme/kit.css`, `theme/kit.generated.css`; comments stripped, **strings kept** | never type a hex; go through `--bw-up`/`--bw-down` |
| `tint-contrast` | `guards/tint-contrast.test.ts:28-39` | ink over `--bw-up`/`--bw-down` at `MATRIX_FULL` alpha on `--bw-tile` ≥ 4.5:1, in **all four tiers** (light, dark, boost-light, boost-dark) | if a new alpha ceiling is introduced, it needs its own assertion here; reusing `MAX_MIX = 55` inherits `sign-tint.ts`'s own measurement instead |
| `band-hue-contrast` | `guards/band-hue-contrast.test.ts` | usage-split floors — a colour used as **text** needs 4.5:1, a stroke/fill needs 3:1 — across `--bw-tile`, `--bw-page`, `--bw-popover`, in four tiers | if the panel introduces a new surface under direction text, that surface must be added to `SURFACES` |
| `palette` | `guards/palette.test.ts` | (a) no component references a retired hue token — the regex bans `hue-(curve\|vol\|fwd\|outright\|spread)` and `interactive`/`brand`; (b) `--bw-accent` (fill, 2.31:1) may never carry a glyph — use `--bw-accent-fg`; (c) light must keep fill and foreground distinct; (d) label-on-fill contrast | do not invent per-category hues; do not stroke or letter in `bg-accent` |
| `ramp-sync` | `guards/ramp-sync.test.ts:39-67` | `theme/ramp.ts` constants equal the `--bw-ramp-*` / `--bw-rampw-*` / border color-mix values in `tokens.css` | only bites if the panel adds a canvas-bound constant mirroring a CSS var |
| `canvas-var` | `guards/canvas-var.test.ts` | `assertNoCssVars()` rejects unresolved `var(...)` anywhere in a canvas option object | any canvas chart must resolve through `theme/bridge.ts` first; **DOM/SVG must keep using `var()`** (CLAUDE.md: never per-element `var()` in SVG) |
| `range-column` | `guards/range-column.test.ts:35-60` | the 52주 range cell contains **none** of `text-up`, `text-down`, `bg-up`, `bg-down`, `columnCue`, `matrixTint`, `tintStyle`, `--bw-up`, `--bw-down`, `opacity-`, `font-bold`, `font-semibold` — "a level has no direction" | a *level* column in the new panel must stay ink; only *changes* and *P&L* may take direction |
| `guard-hygiene` | `guards/guard-hygiene.test.ts` | new guards must use `guards/_source.ts` (`code`/`stripComments`), so a comment naming a banned token cannot trip its own guard | any new guard must import from `_source`, not read files itself |

Two more that constrain a new *screen* rather than a new colour, and that a
build pass will hit:

- `guards/live-routes-proxied.test.ts:77-103` — every same-origin `/api/...`
  path a client module builds must either be a **static twin**
  (`STATIC_TWINS`, `live-routes-proxied.test.ts:31-42`) or have a rewrite in
  `next.config.ts`. Currently proxied: `/api/backtest`, `/api/simulate`,
  `/api/market-data/*`, `/api/positions*`, `/api/instruments*`,
  `/api/cashbond/*`, `/api/settings/*` (`frontend/next.config.ts:90-108`).
- `guards/theta-column.test.ts:1-19` — the precedent for a new derived numeric
  column: the header must name its normaliser, the browser may format and
  nothing else (§16), and absence must be an em dash rather than an empty cell.

### C5.4 Does any existing surface use hue for a category?

**Yes — one, and it is a documented exception.**

`--bw-case-crisis` (`tokens.css:195` light `#b651c5`, `:318` dark `#c752d8`) is
a **purple**, and it identifies the *crisis* scenario case, which is not a
direction. `tokens.css:190-193` records the decision explicitly [OWNER,
2026-08-10 — "보라색으로 다시 수정하고, 톤 다운"] and the reason: the deep-blue
"heavier bear" reading lasted one session because "a third hue reads faster than
a second blue". `tokens.css:153-155` states outright that §5/§9's
"palette is red/blue/grey plus one orange accent" **no longer holds without
exception**.

Its three siblings are directions wearing category clothing:
`--bw-case-bull` = `--bw-up`'s hex and `--bw-case-bear` = `--bw-down`'s hex, but
**flipped** — on this desk 하락 is good and reads red
(`tokens.css:162-175`). They are literal copies, not `var()` aliases, precisely
so a future change to the direction pair does not drag them along.

Two reference-line tokens also lean on hue for identity, though the file says
they are told apart by lightness/hue *plus the legend*:
`--bw-ref-cd: #8e8e93` (grey) and `--bw-ref-policy: #d92d3c` (the up-red, drawn
extra-translucent so a horizontal reference does not read as a directional mark)
— `tokens.css:141-151`.

And there **was** a per-instrument-group category-hue set —
`hue-curve / hue-vol / hue-fwd / hue-outright / hue-spread`. It is retired and
now actively banned in components by `guards/palette.test.ts` (the `UTIL`/`VAR`
regexes). That is the closest precedent to "hue for a category" and it was
removed.

---

## C6 — Where the numbers would live

§16 (`docs/DESIGN.md:2762-2776`) is unambiguous: *"If a displayed number is the
result of arithmetic on market data, it is produced here [backend] and travels
the wire."* The frontend may do colour mapping, tint alpha, layout, display
rounding, `null`→"—", and ordering by a key the backend supplied — **no
averaging, no bp conversion, no delta, no percentile.** The one exception
(classify in backend, phrase in frontend) has exactly two remaining subjects
(`DESIGN.md:2783-2799`) and neither is a table column.

Recommended ownership, and the seam as it actually exists today:

| quantity | owner | why |
|---|---|---|
| **carry** | a **new** module, e.g. `backend/app/rv.py` | It needs the 민평 matrix (`creditmatrix`), the policy path, and a *forward* funding average. `cashbond.theta_for_bond` cannot host it: a test forbids it from accepting a funding spec (`test_cashbond.py:429-432`), and the horizon constant it uses is shared with `app/theta.py` by design (`cashbond.py:734-736`). |
| **roll** | same new module, **calling `cashbond.price`** | `cashbond.price` (`cashbond.py:111-160`) is already the single price definition on the 민평 side, and it already returns coupons and redeemed principal separately — the split Appendix A's carry/roll boundary needs. Re-implementing the par formula would create the second-convention defect `cashbond.py:742-744` exists to prevent. |
| **sale-date modified duration** | same new module, **calling `cashbond.dv01_at`** | `dv01_at(y, coupon, n, elapsed)` (`cashbond.py:739-752`) already evaluates at an arbitrary elapsed, and `theta_for_bond` already calls it at the horizon (`cashbond.py:792`). Converting DV01 → modified duration is one division by clean price. **Do not reuse `instruments.py:259`** — same formula, `elapsed = 0` (purchase). |
| **per-item BEP** | same new module | `beBp` already exists in three variants (`theta.py:213`, `cashbond.py:807`, `cashbond.py:708`) with two different sign conventions (pay-based vs buy-based). A fourth must state its convention in the payload, the way `thetaBasis` does (`theta.py:283-291`, `cashbond.py:668-672`). |
| **crossover BEP** | same new module | Nothing computes it. It is the only genuinely new formula in the mechanism. |

**`derive.py` is the wrong home.** `backend/app/derive.py:1-5` scopes itself to
"time bases, deltas, spreads/flies, downsampling" and imports only from
`dataset` (`derive.py:13-19`) — it has no access to the 민평 matrix, no notion
of a bond, and no funding. Putting a bond-price/funding calculation there would
make `derive` depend on `creditmatrix` and `funding`, which today it does not.

**The position-P&L code (C2) owns none of it.** `app/backtest.py` and
`app/cashbond.py:232-348` are *path* calculations over a real date range with a
real entry; the RV panel is a *closed form on today's curve* with a hypothetical
entry today. That is the same distinction `theta.py:7-12` already draws to
justify `theta.py` existing separately from `backtest.py` — and it is why theta
can be baked into the static build while the backtest cannot.

**The seam, stated:** the new module should import `price`, `dv01_at`,
`periods_for` and the tenor/sector vocabulary from `cashbond` /
`creditmatrix`, and must **not** import `app/theta.py`'s `HORIZON_Y`
(that constant is co-owned by two shipped columns). It needs a funding function
that neither `app/funding.py` nor `funding_basis.py` currently provides — a
*forward* average over `[start, sale]` given a policy level and a list of
`(meeting date, Δbp)`. `daily_valuation.calc_dynamic_funding_rate:228-236` is
the closest existing shape (rate on a date, not average over a window).

**Delivery path:** an RV endpoint must be either baked
(`backend/app/static_paths.py:154-158` + `backend/scripts/build_static.py` +
`frontend/src/lib/staticPaths.ts` + the `STATIC_TWINS` list in
`guards/live-routes-proxied.test.ts:31-42`) **or** proxied
(`frontend/next.config.ts:88-108`). Because the mechanism takes user input
(H, expected Δbp per meeting, the shift grid), it cannot be a static bake in the
Cash Bond / Setting sense — it will be a live route, and on a `BACKEND_ORIGIN`-less
deploy it 404s by design (`next.config.ts:70`, `live-routes-proxied.test.ts:105-115`).

---

# 2. PREMISE REJECTED

**PR-1 — "Strategy tab → RV Analysis section".** There is no `Strategy` tab and
no `strategy` section. The sections are `main / backtest / simulation / setting
/ lab` (`ui/tabs.ts:39-53`), pinned by exact equality in
`guards/overview-and-divider.test.ts:314-320`. The only "Strategy" in the tree is
`StrategyRegion` inside the retired, unreferenced `ui/EnlargedView.tsx:149-153`.
A new section is a small, well-bounded change (C1), but it is a change — the
mount point does not exist.

**PR-2 — "how `?tile=` (enlarged view) and `?bt=` interact".** `?tile=` does not
exist. The enlarged view and its whole namespace were retired
[OWNER, 2026-08-13] (`ui/App.tsx:469-475`). Only `?bt/?bti/?btf` survives.
`ui/urlState.ts:1-15` still describes two namespaces and is stale;
`ui/BacktestWindow.tsx:1106` still yields Escape to a `tile` parameter that can
never be present.

**PR-3 — "a position P&L feature whose decomposition is 손익 = 평가 + 캐리".**
That is the *engine* identity and it is exact
(`guards/krw-additivity.test.ts:30-41`, worst residual 1원 over 1,499 points).
The **reported** decomposition is four buckets, and the two products' fourth
buckets differ: IRS is 평가 / 캐리 / 롤다운 / **개시** (`backtest.py:461-480,
392-422`), Cash Bond is 평가 / 캐리 / 롤다운 / **조달** (`cashbond.py:35-45`).
A build pass that assumes two buckets will mis-place roll.

**PR-4 — the sector list "국채, 통안, 특은, 은행, 공사, 한전, 카드, 여전,
금융지주".** The repo's universe is eight codes with these labels
(`app/creditmatrix.py:60-69`): 국고채, 통안채, **산금채 AAA**, 공사채 AAA,
은행채 AAA, **회사채 AAA**, 카드채 AA+, **캐피탈채 AA-**. There is **no 한전
and no 금융지주** row — neither in the app universe nor in the SQL table (the
only extra `bond_type` values are `CB2`–`CB5`, corporate rating buckets).
"특은" and "여전" are not literal labels here; 산금채 and 캐피탈채 are the
plausible counterparts but the mapping is not stated in the repo (see UV-1).

**PR-5 — "a known open finding of two sources holding the same vendor CD series
two business days apart".** No such finding exists in this repo. Searched
`docs/**` and the whole tree for CD + offset/시차/이틀/two business days: no
match. The nearest recorded two-source discrepancy is the **1D (call rate)**
series between `data/irsdata.xlsx` and `mkt_irs_close`: 2,105 mismatches out of
2,606 (80.8%), max 61.4bp, adjudicated [OWNER — "무조건 SQL 쪽이 정답임"]
(`app/dataset.py:381-387`, `app/main.py:242-252`). CD (3M) matched 0–1 days out
of 2,616, and the single mismatch is the workbook's last row, which is an
intraday snapshot. The instruction to assume nothing about alignment is still
the right instruction — but the cited evidence for it is not in this repo, and I
did **not** find a two-business-day CD offset here.

**PR-6 — "The colour rule is being extended … saturation encoding magnitude".**
It is not an extension; it already exists and is shipped.
`theme/sign-tint.ts:41-51` is exactly two hues with magnitude in the mix
percentage (√-scaled, 8%→55%, mixed toward `--bw-tile`), with a categorical
rule attached: **text on a tinted cell must be ink**, because direction-coloured
text on same-sign tint never clears 4.5:1 at any density (`sign-tint.ts:14-17`,
measured).

**PR-7 (minor) — "`MATRIX_FULL` / `MATRIX_FLOOR` … hue-bearing or ink-alpha".**
They are neither exactly: they are the **direction hue's own alpha over
transparent** (`ui/tint.ts:33-37`), used only by the forward matrix
(`wall/ForwardMatrix.tsx:70`). The heatmap ramp the RV panel would want is the
other one (`sign-tint.ts`), whose ceiling constant is `MAX_MIX = 55`.

---

# 3. Blockers

Ranked by what stops the build pass earliest.

**B-1 — The expected-Δbp input has no data source, and no owner decision on
where it comes from.** The mechanism needs a per-meeting Δbp. The repo has
meeting *dates* only (2026 only, eight entries, `app/policy.py:58-67` /
`frontend/src/data/calendar.json`), and no expected-change field anywhere. The
simulation solves the same problem by making the user type both date and
`shiftBp`, not seeded from the calendar
(`sim/ui/ConfigureStage.tsx:465-562`). Someone must decide whether RV seeds
its rows from `calendar.json` or asks the user to type them. **This is a design
decision, not a lookup — it cannot be resolved from the repo.**

**B-2 — Naming/convention collision on 캐리.** The RV carry subtracts funding;
the Cash Bond theta column deliberately does not, under a standing owner ruling
with a test that blocks even *passing* a funding spec
(`cashbond.py:716-728`, `test_cashbond.py:422-432`). Two columns named 캐리 that
differ by the funding leg is precisely the recurring defect class this repo
documents. The build pass needs an owner-blessed name for the RV quantity (or an
owner ruling to change the Cash Bond column, which would be a much larger
change).

**B-3 — The Strategy section does not exist** (PR-1). Seven small edits and two
exact-equality guards (C1). Cheap, but it is step zero and it must be done
before anything renders.

**B-4 — 민평 has no 전일종가 cut, and the IRS dataset is a process-lifetime
singleton.** `creditmatrix.load()` re-fetches per request on a watermark
(`creditmatrix.py:207-217`, called at `main.py:470`), while
`_dataset = load_dataset_merged()` runs once at import (`main.py:259`) and
applies the 전일종가 rule (`dataset.py:313-336`). Today both end 2026-08-13, so
nothing is visible. A long-lived process that crosses a data load, or a
`credit_matrix` row landing on the current Seoul date, makes an RV panel and the
IRS tables disagree about "today". The build pass needs to state which as-of it
uses and whether it applies the cut.

**B-5 — The tenor floor.** Appendix A floors the interpolated sale yield at
0.25Y, which matches the 민평 grid's short end exactly (`creditmatrix.py:80`) —
but `interp` flat-extrapolates below the first point
(`creditmatrix.py:260-261`), so anything under 3M silently reads the 3M rate
rather than failing. Separately, both existing theta functions **refuse** to
produce a value when `years − horizon < 0.25`
(`theta.py:310-312`, `cashbond.py:772-773`), whereas the RV mechanism explicitly
wants those maturities (residual m = 0 ⇒ hold to maturity ⇒ carry only). The two
rules must not be conflated; whichever the RV panel adopts must be stated in the
payload.

**B-6 — Delivery path decision.** Live route (proxied, 404s without
`BACKEND_ORIGIN`) vs static bake. Because the mechanism is parameterised by user
input it is almost certainly a live route, which means the deployed site shows
this panel only through the Funnel-backed origin — the same footing as Cash Bond
and Setting today (`next.config.ts:105-108`,
`guards/live-routes-proxied.test.ts:31-42`).

---

# 4. UNVERIFIED

**UV-1 — Which `bond_type` is 특은채?** The repo has `KDB` labelled 산금채 AAA
(`creditmatrix.py:63`). 특수은행채 conventionally covers 산금채 / 중금채 /
수출입은행채, so `KDB` is the plausible target, but the repo never uses the word
특은 and `creditmatrix.py:53-56` states that even the existing code→label map was
inferred from the credit ladder ordering rather than from documentation.
**Settled by:** an owner statement of the intended sector, or vendor
documentation for the `bond_type` codes. Without it the Appendix A worked
example (특은채, H = 6 months, 9m vs 1y crossover at +10.4bp) cannot be aimed at
a specific curve.

**UV-2 — `credit_matrix.bas_dt`: quote date or load date?** The table has one
date column, no comment, and no `updated_at` (verified against the DDL). The
calendar-containment measurement (민평 ⊂ IRS, 15 IRS-only dates that are
year-end closes and holidays) is *consistent with* a quote date, and the repo
treats it as one, but nothing in the schema distinguishes it from a load date.
**Settled by:** access to the loader/ETL that writes `credit_matrix` (it is not
in this repo), a vendor spec, or an `information_schema` comment — none of which
exist here. Note the contrast: `bokbaserate.xlsx` *does* carry both
(`일자` and `갱신일시`/`갱신일자`, measured), and both readers discard the
latter.

**UV-3 — Whether past `credit_matrix` rows are silently revised.** The watermark
`(MAX(bas_dt), COUNT(*))` cannot detect an in-place edit
(`creditmatrix.py:26-31`, already marked [미해결] by the repo). **Settled by:**
either an `updated_at` column upstream, or hashing all 19,488 rows on each
check.

**UV-4 — Whether the four-tier contrast guards would pass a `MAX_MIX = 55`
signed heatmap on whatever surface the RV panel uses.** `sign-tint.ts:31-34`
records measurements on the tile only (dark 62% → 5.06:1, 75% → 3.99:1);
`guards/tint-contrast.test.ts` asserts only the `MATRIX_FULL` case.
**Settled by:** running the guard suite after the panel exists — which needs
`pnpm vitest`, i.e. a build pass, not this one.

**UV-5 — Whether the frontend guard suite and backend tests currently pass.**
Not run: `scripts/gate.ps1` is forbidden by this prompt's rule 2, and the tree is
dirty with another session's uncommitted work (a Lab tenant swap that deletes
`RegretLab` and adds `YieldSurface`). **Settled by:** the other session
finishing and a gate run at a moment when `:8100` is not serving production.

**UV-6 — Whether Appendix A's `P(coupon, yield, m)` is a clean or dirty price.**
The repo's equivalent (`cashbond.py:785`) uses **clean + redeemed principal**
(`clean_h = dirty − accrued + redeemed`), which is required for the split to be
non-overlapping with carry. Appendix A does not say. Reading it as dirty would
double-count accrued interest against the `(y − f) × days/365` carry term.
**Settled by:** the owner, or by reproducing the worked example
(9m carry BEP 108.5bp / 1y 54.3bp) against the spreadsheet.

---

# 5. Incidental findings

Noticed, not touched. None was acted on.

**IF-1 — `ui/urlState.ts:1-15` is stale.** It documents a two-namespace URL
(`tile` + `bt`) and the `mergeQuery` invariant that makes them compose. The
`tile` half retired on 2026-08-13. The code below the docstring is correct.

**IF-2 — `ui/BacktestWindow.tsx:1106` reads a dead parameter.**
`new URLSearchParams(window.location.search).has("tile")` can never be true.
Harmless today; it is one rung of the Escape yield chain that no longer fires.

**IF-3 — Two data sources with different refresh lifetimes in one process.**
`_dataset` is loaded once at import (`main.py:259`); `creditmatrix.load()` and
`funding.series_for` are cached with their own invalidation
(`creditmatrix.py:207-217`, `funding.py:116-126`). Nothing currently reconciles
their as-of dates. Related to B-4.

**IF-4 — `mysqldb.py:113-116` and `dataset.py:436-437` both assert
`mkt_irs_close` has no primary key.** `DESCRIBE mkt_irs_close` shows
`irs_date … PRI`. The duplicate-date check at `dataset.py:438-443` is therefore
belt-and-braces rather than the only defence. (The `updated_at` half of that
comment is still correct — there is no such column.)

**IF-5 — `irs_pricer/loaders/base_rate.py:4-6` names the workbook columns
`일자 / 종가 / 수정일시 / 적용일자`.** Measured header row is
`일자 / 현재가 / 갱신일시 / 갱신일자`. The loader reads by position so nothing
breaks; `app/policy.py:121-125` validates only column 0's name.

**IF-6 — `docs/DESIGN.md:64-72` describes an eight-tab sidebar** split into
"종목군 여섯 + 도구 둘". The current shape is five sections with seven
sub-tabs under Backtest. Prose, not an enumeration a guard reads.

**IF-7 — `mkt_irs_close` carries rows on Korean public holidays**
(2026-01-01, 2026-05-01, 2026-05-05, 2026-05-25, 2026-06-03, 2026-03-02 among
the 15 IRS-only dates). `credit_matrix` does not. Not a defect on its face — the
IRS table may legitimately carry a carried-forward close — but it means
"business day" is defined differently by the two sources, and the asset-swap
join drops those days by construction (`cashbond.py:354-365`).

**IF-8 — `guards/calendar.test.ts` fires in ~44 days.** The last verified
calendar entry is 2026-11-26 and the guard fails when the last one is under 60
days away (`frontend/src/data/calendar.json:2`). Today is 2026-08-14; the
threshold is crossed on 2026-09-27. Unrelated to this work, but it will surface
as a red guard in a future gate run.

**IF-9 — `frontend/src/ui/EnlargedView.tsx` and `frontend/src/wall/DetailChart.tsx`
are unreferenced but kept on disk** under the restoration rule
(`App.tsx:472-475`). `EnlargedView` is where the `StrategyRegion` placeholder
lives. If the RV panel is meant to be the thing that placeholder was reserving,
that history is worth reading before designing the mount.

---

## Appendix — method

Read-only SQL, three probes, all through `app.mysqldb.read_sql`:
`SHOW TABLES`, `SHOW CREATE TABLE credit_matrix`, `DESCRIBE credit_matrix`,
`DESCRIBE mkt_irs_close`, `DESCRIBE mkt_bond_curve|mkt_irs_curve|mkt_futures_curve|pos_krw_bond`,
plus aggregate `SELECT`s for extent, per-sector row counts, per-tenor NULL/zero
counts, distinct-date sets, and six sample rows. Workbook inspection was
`openpyxl` read-only on `data/bokbaserate.xlsx` (header rows + `all_rates()`
coverage). Probe scripts were written to the session scratchpad, not to the
repo.

No file in the repository was modified by this pass except this report.
