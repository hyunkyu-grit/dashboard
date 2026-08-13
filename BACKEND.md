# The backend in this repo is a COPY

**This is a copy. Fixes made here do not reach braveworld, and braveworld's fixes
do not reach here. Divergence is expected; record it.**

| | |
|---|---|
| Source repo | `C:\Users\infomax\Desktop\Assistant\Projects_AS\braveworld` |
| Source commit | `f5de1fa74de475d801128b113c0a8060f434129f` |
| Source subject | 선 · 주봉 · 월봉 — 캔들을 팝업 밖으로, 전역 모드 하나로 |
| Copy date | 2026-08-13 |
| Method | plain file copy (`shutil.copytree`), excluding `__pycache__`, `*.pyc`, `.cache`, `.pytest_cache` |
| What was copied | `backend/` (127 files, 1.3 MB) and `data/` (4 entries, 25.4 MB) |

Not a `git worktree`, not a symlink, not a submodule: all three would either write
into braveworld's `.git` or leave v2 depending on that tree being present and intact.

## The one thing that is NOT a copy: the data

The market data is **not** a single workbook, and copying the workbooks does not
give v2 the same data v1 sees.

| Source | What |
|---|---|
| **MySQL** `sim_portfolio.mkt_irs_close` @ `miraebond2.kro.kr:4004` | **primary** source of IRS closes since 2026-08-07 |
| `data/irsdata.xlsx` | fallback workbook (copied, 776,519 B at copy time) |
| `data/bokbaserate.xlsx` | BOK base rate (copied, 640,795 B) |
| `data/` incl. `AS_data.zip`, `reference/` | the simulation's `DATA_DIR` |

The MySQL database is a **shared external dependency, read-only**, reached through
`app/mysqldb.py` (`BW_MYSQL_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_DB`, each with a
hardcoded default in source). v2 and v1 therefore read the **same live rows**.

So the divergence sentence above applies to **code, not to market data**: the code
forks here, the data does not. If v1's SQL loader changes shape and this copy's does
not, the two will disagree about the same rows — that is the failure mode to watch.

## The three v2-local edits

Each is marked in place with a `V2-LOCAL EDIT n of 3` comment.

1. **`backend/app/main.py` — CORS** (the `app.add_middleware(CORSMiddleware, ...)`
   block, `allow_origins`). Added `http://localhost:3200` and `http://127.0.0.1:3200`.
   v1's list was `:3100` only, so v2's frontend was blocked at the preflight.
   The `:3100` origins are kept so this copy stays runnable beside v1.

2. **`backend/requirements.txt` — two missing runtime dependencies.**
   `app/mysqldb.py` imports `sqlalchemy` at module scope and builds a
   `mysql+pymysql://` URL, but neither `sqlalchemy` nor `pymysql` was listed.
   v1 runs because the developer machine already has both; a clean host dies on
   the first import. **This is a real defect in braveworld and it is NOT fixed
   there** — this session may not write to that tree. It is reported in
   `REPORT_v2.md` instead.

3. **`backend/serve.ps1` — new file, binds `:8200`.**
   The port was never in the source. v1 passes it on the uvicorn command line from
   `C:\Users\infomax\.sauron\start-backend.ps1`, which lives outside the repo. So
   "bind :8200" is a launcher, not a source edit. **`:8100` is never bound here.**

### The cache directory needed no edit

The prompt called for pointing the cache inside `sauron-v2/`. It already is:
`app/cache.py` derives it as `Path(__file__).resolve().parent.parent / ".cache"`,
so in this copy it resolves to `sauron-v2/backend/.cache`. The same is true of
every other path in the backend — `POLICY_PATH` and `irs_pricer.config.DATA_DIR`
are both `__file__`-relative and land inside `sauron-v2/` by construction.
Verified, not assumed.

## The ported engine is frozen

The bootstrap / discount-factor / forward / CD-IRS code arrived in v1 under a
provenance header marked do-not-modify. **That marking carries into v2 unchanged.**
The known bootstrap residual (up to ~0.25bp on swap tenors, worst at 3Y) is accepted
and documented; it is not a v2 defect and not this session's to chase. If a number
looks wrong, report it — do not fix it here.

## Running it

```powershell
powershell -ExecutionPolicy Bypass -File backend\serve.ps1   # :8200
```

Never run braveworld's `gate.ps1` while v2 is working: its mode 1 demands `:8100`
be free, and its known orphan-uvicorn defect can leave a stray process holding a
port that neither app can then reclaim.
