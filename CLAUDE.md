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
  - Still NOT ported: anything DB-backed. krw-fi-pms's service layer reaches
    for a SQLAlchemy `Session`, trade/trace repositories and booked positions.
    braveworld has no database — it reads one xlsx — so the service layer is
    written here and only the engine modules come across.
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
