# braveworld

**The authoritative design spec is [`docs/DESIGN.md`](docs/DESIGN.md). Read it
first; it outranks anything inferred from code.** This file is a pointer plus
the load-bearing guardrails that must never be violated.

## Guardrails

- `braveworld` is a NEW, STANDALONE project. It does not replace krw-fi-pms.
  **Nothing in krw-fi-pms may be modified by work in this repo** — that system
  is frozen. Do not read or port its DESIGN.md / Marquee-derived rulings.
- The backend is this repo's own FastAPI service on **:8100**; the frontend on
  **:3100**. The `:3000`/`:8000` ports belong to the frozen krw-fi-pms and
  must stay untouched.
- Only the curve-side engine (bootstrap, discount factors, forwards, CD-IRS
  conventions) is ported from the frozen engine, byte-identical with a
  provenance header (`docs/PORT_PROPOSAL.md`, owner-approved). No portfolio
  valuation / MtM / scenario / trade code.
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
