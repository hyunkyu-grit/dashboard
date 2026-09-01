# The backend in this repo is a COPY

**This is a copy. Fixes made here do not reach braveworld, and braveworld's fixes
do not reach here. Divergence is expected; record it.**

| | |
|---|---|
| Source repo | `C:\Users\infomax\Projects\apps\braveworld` |
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
| **ECOS** `722Y001/D/0101000` via `app/ecos.py` (`ECOS_API_KEY`) | **primary** source of the BOK base rate — funding since 2026-08-20, the policy step since 2026-09-01 |
| `data/bokbaserate.xlsx` | base-rate **fallback** only (copied, 640,795 B) — read when ECOS has no key, no network and no cache; `policy_step` says so in `warnings` |
| `data/` incl. `AS_data.zip`, `reference/` | the simulation's `DATA_DIR` |

The MySQL database is a **shared external dependency, read-only**, reached through
`app/mysqldb.py` (`BW_MYSQL_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_DB`, each with a
hardcoded default in source). v2 and v1 therefore read the **same live rows**.

So the divergence sentence above applies to **code, not to market data**: the code
forks here, the data does not. If v1's SQL loader changes shape and this copy's does
not, the two will disagree about the same rows — that is the failure mode to watch.

## The five v2-local edits

Each is marked in place with a `V2-LOCAL EDIT n of 5` comment. Edits 4–5 landed
2026-08-14 and are both about the same thing: **v1 keeps its Next app under
`frontend/`, v2's IS the repo root.** Every path that assumed otherwise was
silently dead.

4. **`backend/scripts/build_static.py` — `OUT_ROOT`.** `frontend/public` →
   `public`. It was writing to a directory nothing serves.
5. **`backend/tests/test_build_static.py` — `_baked_manifest()`.** Same path
   fix, plus: SKIP when no tree has been baked. Those two tests check that a
   COMMITTED tree has not gone stale, and v2 has never baked one — they had
   failed with `FileNotFoundError` since the copy was taken.

   Two neighbours moved with them and are **not** numbered because they are the
   same edit: `tests/test_static_agreement.py` (`frontend/public` → `public`,
   and `:8100` → **`:8200`** — it was pointed at v1's backend, so on this copy
   it always skipped; fixing the port woke it into 20 failures that all said
   "no tree", and it now skips on that too), and `app/policy.py::CALENDAR_JSON`
   (`frontend/src/data` → `src/data`; the file does not exist here yet and the
   function returns None, which is its documented behaviour).

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

## Forward-ports FROM braveworld since the copy

The copy was taken at `f5de1fa7`. Anything v1 committed after that is not here
until it is brought over deliberately, and each one is recorded below.

### 1. 세타 — `app/theta.py` (2026-08-14)

v1 added it the same afternoon this copy was taken, in three commits
(`ef98badc` → `d3886fd1` → `41705cba`). Brought over as:

| File | How |
|---|---|
| `backend/app/theta.py` | **byte-identical copy** (md5 `923fc298…`, 296 lines) |
| `backend/tests/test_theta.py` | byte-identical copy (15 tests, all pass here) |
| `backend/app/payloads.py` | v1's two hunks applied verbatim — `payloads.py` is now **byte-identical to v1's** |
| `backend/app/cache.py` | `SCHEMA_VERSION` 7 → **8**, v2-local |

The schema bump is not optional and is not v1's: the same source rows now
produce a **different payload** (`row.theta`, `summary.thetaBasis`). Without it a
v7 cache keeps serving theta-less summaries and the screen draws a column of em
dashes with no error anywhere — this repo's recurring silent-staleness failure.

**v1 did NOT bump it** (braveworld is still at `SCHEMA_VERSION = 7`; checked
2026-08-14). It gets away with it because its key also carries the source-data
hash and the as-of date, so the next morning's bake misses the old entry anyway —
but any host that re-reads the SAME day's data from a pre-theta cache serves the
column empty. That is a latent v1 defect, reported here and **not** fixed there
(this tree may not write to braveworld). It is also why the two `cache.py` files
now differ: this is a deliberate divergence, not drift.

Every convention behind the numbers is in `theta.py`'s own docstring. Nothing was
re-derived on the frontend (§16): `perDv01` and `beBp` arrive finished.

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
powershell -ExecutionPolicy Bypass -File backend\serve.ps1          # 공개 서비스용
powershell -ExecutionPolicy Bypass -File backend\serve.ps1 -Local   # 개발·테스트용
```

`-Local` 은 2026-08-20 배포 준비에서 생겼다. 배포되면 :8200 이 Tailscale Funnel
로 공개되고, 그때부터 "포트가 열려 있다" 는 사실은 **내가 띄운 개발 백엔드**일
수도 **사람들이 쓰고 있는 라이브 서비스**일 수도 있다. v1 은 그 구별을 못 해서
라이브에 대고 테스트를 돌렸다.

`-Local` 로 뜬 프로세스만 `backend/.cache/dev-backend.json` 에 자기 PID 를
남기고(`app/dev_marker.py`), 백엔드 테스트는 그 쪽지의 PID 가 실제로 그 포트를
듣고 있을 때만 진행한다(`tests/_live_backend.py`). 아니면 **skip 이 아니라
수집 단계 에러**로 거절한다. 테스트가 말을 걸 주소는 `SAURON_TEST_BASE` 로
바꾼다 — 하드코딩된 포트는 더 이상 없다.

### 환경변수

| 이름 | 읽는 곳 | 없으면 |
|---|---|---|
| `BW_MYSQL_HOST/PORT/USER/PASSWORD/DB` | `app/mysqldb.py` | SQL 을 읽는 순간 `MissingCredentials` 로 죽는다. 기본값 없음 (2026-08-20) |
| `ECOS_API_KEY` | `app/ecos.py` | 조달 기준의 **기준금리**를 못 가져온다 → base 가 실패, 화면은 콜금리로 안내. 기본값 없음 (2026-08-20) |
| `SAURON_ALLOWED_ORIGINS` | `app/cors.py` | 로컬 개발 오리진만 허용 |
| `SAURON_ALLOWED_ORIGIN_REGEX` | `app/cors.py` | `rateslab` 프로젝트의 vercel.app 프리뷰 패턴 |
| `SAURON_DEV_LOCAL` | `app/dev_marker.py` | 쪽지를 안 남긴다(=공개 서비스로 취급) |
| `SAURON_TEST_BASE` | `tests/_live_backend.py` | `http://127.0.0.1:8200` |

Never run braveworld's `gate.ps1` while v2 is working: its mode 1 demands `:8100`
be free, and its known orphan-uvicorn defect can leave a stray process holding a
port that neither app can then reclaim.
