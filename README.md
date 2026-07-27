# braveworld

All-day KRW IRS market monitor. Standalone full-stack project; the design
spec (`CLAUDE.md`, being canonicalized to `docs/DESIGN.md`) is authoritative.

- `frontend/` — Next.js (App Router) + TypeScript + Tailwind. Dev on **:3100**.
- `backend/` — FastAPI + the ported curve engine. Dev on **:8100**.
- `data/irsdata.xlsx` — daily KRW IRS closes, 2016 → present.

The `:3000`/`:8000` ports belong to the frozen `krw-fi-pms` system and must
stay untouched.

## Data refresh — currently manual

`data/irsdata.xlsx` is a **static snapshot**. Nothing in this repo fetches or
schedules a new close; getting tomorrow's data in is a manual step, and no
automated feed exists yet (that is an owner decision, out of scope here).

To refresh: replace `data/irsdata.xlsx` with a newer export in the same layout
(same sheet/columns; the loader keys off the SHA-256 of the file, so any change
is picked up) and **restart the backend** — the dataset, curves, and the
own-history caches are all built once at startup, so a running server will not
notice a new file until it restarts.

Because the file is static, the app measures its own staleness so it never shows
an old curve as if it were today's: `/api/health` reports `freshness` (the
dataset's latest date and its age in KR business days), and the header states it
— quiet when same-day, a visible chip one business day behind, and a red
"최신 커브가 아닐 수 있습니다" chip beyond that. If you see that chip, the file needs
refreshing.

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
