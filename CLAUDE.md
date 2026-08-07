# braveworld

**The authoritative design spec is [`docs/DESIGN.md`](docs/DESIGN.md). Read it
first; it outranks anything inferred from code.** This file is a pointer plus
the load-bearing guardrails that must never be violated.

**Continuing work?** Read [`docs/HANDOFF.md`](docs/HANDOFF.md) — current state,
run/gate commands, architecture map, invariants, conventions, and the gotchas
from prior sessions. Update its "Current state" / "Open" sections when you finish.

## Guardrails

- `braveworld` is a NEW, STANDALONE project. It does not replace krw-fi-pms.
  **Nothing in krw-fi-pms may be modified by work in this repo** — that system
  is frozen. Do not read or port its DESIGN.md / Marquee-derived rulings.
- The backend is this repo's own FastAPI service on **:8100**; the frontend on
  **:3100**. The `:3000`/`:8000` ports belong to the frozen krw-fi-pms and
  must stay untouched.
- Code ported from the frozen engine is byte-identical and carries a
  provenance header (`docs/PORT_PROPOSAL.md`, owner-approved). Two ports are
  approved:
  - the **curve side** (bootstrap, discount factors, forwards, CD-IRS
    conventions) — `app/engine_port.py`;
  - the **single-swap valuation core** (VanillaSwap, fixing selection, MtM /
    settled cash) — for the backtest [OWNER, 2026-07-31]. This guardrail
    previously read "no portfolio valuation / MtM / scenario / trade code";
    the owner lifted it for this feature and directed that the frozen code be
    brought over rather than rewritten.
  - the **scenario simulation** — `backend/irs_pricer/` and `frontend/src/sim/`
    [OWNER, 2026-08-07]. It came from simulation_project (:8200/:3200), which
    had itself ported it from krw-fi-pms; the owner directed that it become a
    TAB here rather than a second site. Its four routers are registered on
    this repo's app in `app/main.py`, which stays the single uvicorn entry
    point (`app.main:app`, :8100). simulation_project is left running as the
    comparison copy until the merged surface has been seen working.
  - Still NOT ported: anything DB-backed — **for now**. krw-fi-pms's service
    layer reaches for a SQLAlchemy `Session`, trade/trace repositories and
    booked positions. braveworld reads workbooks; the simulation's own
    pyproject dropped sqlalchemy/pymysql/alembic on the way over for the same
    reason.
    **This is scheduled to change [OWNER, 2026-08-07].** Both halves move onto
    MySQL — the existing `infomax` database at miraebond2.kro.kr:4004 — once
    the middle-office account arrives. krw-fi-pms already has the schema this
    will be built from (`tenor_pillar`, `market_data`, `trade_specification`,
    `npv_pnl_trace`), and `market_data`'s own docstring says it "replaces
    True/Total Data.xlsx + CSV + Call Rate + BOK Base Rate" — the four
    workbooks the simulation reads today, plus this repo's `irsdata.xlsx`,
    all fitting one table. Nothing depends on a database yet and the loaders
    it will replace are left whole, so the seam stays where it is.
    **The one thing that must not be forgotten when it lands:** `app/cache.py`
    keys the disk cache on a HASH OF THE XLSX BYTES. With the source in MySQL
    that key has nothing to hash, and a cache keyed to the wrong data is worse
    than no cache (this project's recurring defect is silent staleness). It
    has to become a table watermark — `MAX(updated_at)` plus a row count.
  - **Nothing in krw-fi-pms may be modified**, and its DESIGN.md / Marquee
    rulings are still not to be read or ported. That part is unchanged.
- **Band 3 is owner-gated (§13).** Do not design or build it without the owner.
- Monochrome-first (§5): every encoding must work in grayscale; hue may layer
  on but nothing depends on it. Channel budget in §5 is fixed.
- Zero raw hex in components — semantic tokens only (lint-guarded). Canvas
  options go through the theme bridge + `assertNoCssVars()`. Never per-element
  `var()` in SVG (it stalled the compositor in Band 2).
- Owner decisions are `[OWNER]`; open items are `[TBD]` — leave extension
  points, do not implement speculatively.

See `docs/DESIGN.md` for the full spec (§0–§13) and `README.md` for run/gate/
backup commands.
