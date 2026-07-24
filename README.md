# braveworld

All-day KRW IRS market monitor. Standalone full-stack project; the design
spec (`CLAUDE.md`, being canonicalized to `docs/DESIGN.md`) is authoritative.

- `frontend/` — Next.js (App Router) + TypeScript + Tailwind. Dev on **:3100**.
- `backend/` — FastAPI + the ported curve engine. Dev on **:8100**.
- `data/irsdata.xlsx` — daily KRW IRS closes, 2016 → present.

The `:3000`/`:8000` ports belong to the frozen `krw-fi-pms` system and must
stay untouched.

## Run

```powershell
# backend
cd backend; python -m uvicorn app.main:app --port 8100
# frontend (separate shell)
cd frontend; pnpm install; pnpm next dev --port 3100
```

## Gates

```powershell
cd backend;  python -m pytest tests -q
cd frontend; pnpm vitest run; pnpm lint; pnpm build
```

## Backup / mirror

No private git remote is configured yet (no `gh` CLI, no credentials). Until
one exists, the repo is mirrored to the second drive. Re-run after committing:

```powershell
powershell -File scripts/mirror-to-d.ps1
```

This force-syncs every branch and tag to `D:\Backups\braveworld.git` (a bare
mirror, created on first run). To restore elsewhere:
`git clone D:\Backups\braveworld.git`.
