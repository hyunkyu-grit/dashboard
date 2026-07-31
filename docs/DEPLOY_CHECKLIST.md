# Deploy checklist — Sauron on Vercel

Everything in the static conversion that **could** be verified locally was, with
the backend stopped: all five tabs, sorting, screener chips, pinning, the popup
(line / 주봉 / 월봉 charts, DV01 ratio, Pay/Receive diagram, six-basis readout),
matrix mode, the bottom strip, a cold shared `?tile=` link, both themes, and the
staleness badge responding to a hand-edited manifest. Those are not repeated
here.

What follows is only what a **deployed** site can answer. Two of these fail in
production and nowhere else, which is the entire reason this file exists.

---

## Step 0 — run the two-mode gate

```powershell
powershell -File scripts/gate.ps1
```

One command, both modes, exits non-zero if either fails. It refuses to start if
anything is listening on :8100, because mode 1 has to run with the backend
stopped or the agreement suite silently participates instead of skipping.

- [ ] `all gates green in both modes`, exit 0. Expect roughly:
  - mode 1 — backend **166 passed / 19 skipped**, frontend **332 passed / 1
    skipped**, lint 0, build 0
  - mode 2 — agreement **18 passed** (those are 18 of mode 1's 19 skips; the
    19th is the deliberately parked calendar guard)

Two things it handles that a hand-run sequence gets wrong. `pnpm lint` and
`pnpm build` write to stderr, which PowerShell surfaces as a
`NativeCommandError` **even on success** — the script judges by exit code
alone, and nothing is piped, because a pipe hides the exit code and has shipped
a red lint twice. And if a dev server is competing for CPU the backend suite
goes from ~70 s to ~200 s, so any timing taken then is meaningless.

## Before the first deploy — owner actions

- [ ] **Create the git remote.** No credentials exist in the working copy, so
      this cannot be done from here. It must contain the whole repo:
      `frontend/` **including the committed `frontend/public/api/**`**,
      `backend/`, `data/irsdata.xlsx`, `docs/`. The backend and the xlsx are
      not used by the build; they are what makes the next data refresh
      possible.
- [ ] **Keep the D: mirror.** A remote is not a backup —
      `powershell -File scripts/mirror-to-d.ps1` after every commit, as now.
- [ ] **Vercel project → Root Directory = `frontend`.** The repo is not a
      Next.js project at its root. With this unset the build fails immediately
      (no `package.json`), which is the good failure — but set it anyway.
      `frontend/vercel.json` only takes effect with this set.
- [ ] **Set no `NEXT_PUBLIC_*` variables.** In particular do **not** set
      `NEXT_PUBLIC_API_BASE`. Empty means "read the committed JSON tree", which
      is the deployed behaviour; setting it points the browser at a backend
      that will not exist, and because `NEXT_PUBLIC_*` is inlined at build time
      the mistake needs a rebuild to undo.

      Pass H found this had already happened locally: `.env.local` held the
      development override, Next loads that file for `next build` as well as
      `next dev`, and the gated bundle had `http://localhost:8100` compiled
      into it. The override now lives in `.env.development.local`, which
      `next build` cannot see, and `guards/production-env.test.ts` checks both
      the config files and the emitted chunks. If you ever add a Vercel
      environment variable, that guard will not save you — it cannot see the
      dashboard.
### The backtest is the one thing that is NOT static (2026-07-31)

Everything above still holds: the site reads committed JSON and needs no
backend. The backtest is the exception and cannot be made one — its answer
depends on inputs the reader chooses, so there is no file to bake.

- [ ] **Leave `BACKEND_ORIGIN` unset** unless a backend is actually reachable.
      Unset emits no rewrite, `/api/backtest` 404s, and the sheet says a
      backend is needed. Every other surface is unaffected.
- [ ] When a backend does exist, set **`BACKEND_ORIGIN`** (server-side, NOT
      `NEXT_PUBLIC_*`) to its origin. `next.config.ts` proxies
      `/api/backtest` to it, so the browser only ever calls its own origin —
      which keeps `guards/production-env.test.ts` green and removes CORS from
      the picture. The backend's CORS list allows only `localhost:3100`, so a
      direct browser call from the deployed site would be blocked anyway.

**Prior art, and it is this owner's own.** `krw-fi-pms` ran exactly this
topology — see `Rates Portfolio/deploy-prep/VERCEL_PRECHECK.md`: *"FE deploys
to Vercel; BE stays local as an NSSM service"*, exposed through a Cloudflare
tunnel, with a `next.config` rewrite reading a server-side `BACKEND_URL`.
`deploy-prep/tools/` still holds the hash-verified `nssm.exe` and
`cloudflared.exe`.

The constraint that made that deployment hard does **not** apply here. Vercel's
CDN allows 120 s to first byte on an external rewrite, and krw-fi-pms's
`simulate` ran 106–118 s against it — a 1–13% margin the precheck called
"technically passing on a warm day and operationally reckless", which is why it
needed three lanes. A backtest is **0.6 s for ten years on one position, 3.4 s
for three**, so the plain rewrite lane is not close to the wall.

What it does inherit: **the backend is on a machine, and if that machine is off
the backtest is off.** Nothing else on the site notices.

- [ ] Confirm the build command is the framework default (`next build`). No
      Python step. Verified locally: the build succeeds with Python removed
      from `PATH` and no `.env.local` present.

## Immediately after the first deploy

### 1. Every series and forward path resolves — now a **confirmation**, not first detection

**This changed in Pass H.** The case-sensitivity class is caught locally now,
so reaching this step and finding a 404 would mean the local checks are wrong,
not merely that a file was missed. Two local checks stand behind it:

- **Static.** `guards/static-paths.test.ts` reconciles three descriptions of
  one set — what the client can request (real URL builders over the real row
  model), what is on disk, and what the build declared — as **strings**,
  byte-for-byte including case, in both directions. `existsSync` is never used:
  it answers case-insensitively on NTFS and would pass while production 404s.
  Live: 984 / 984 / 984, all six differences empty.
- **Empirical.** The export was served behind a logging proxy and the built
  site walked: 23 distinct API paths requested, 0 that would 404, 0 non-2xx, 0
  outside the declared set.

Run the walk below anyway. It is cheap, it is the only thing that exercises a
real case-sensitive filesystem, and confirmation is worth having.

- [ ] Open the site and paste this into the browser console. It walks every id
      the app can build and reports anything that is not 200:

```js
const base = location.origin;
const j = async p => (await fetch(base + p)).json();
const [s, f, v] = await Promise.all([
  j('/api/wall/summary.json'), j('/api/forwards.json'), j('/api/volatility.json'),
]);
const ids = [
  ...s.outrights.map(r => r.id), ...s.derived.map(r => r.id),
  ...f.startPoints.filter(p => p.label !== 'ON').flatMap(p =>
    f.tenors.map(t => t.replace('F', '')).filter(t => t !== 'SPOT')
      .map(t => `${p.label}x${t}`)),
  ...v.rows.map(r => r.id),
];
const slug = id => id.replace(/:/g, '/');
const paths = ids.flatMap(id => [
  ...['full', 'preview', 'w', 'm'].map(r => `/api/series/${slug(id)}.${r}.json`),
  `/api/dv01/${slug(id)}.json`,
]);
const bad = [];
for (const p of paths) {
  const r = await fetch(base + p, { method: 'HEAD' });
  if (!r.ok) bad.push([p, r.status]);
}
console.log(`${paths.length} paths checked,`, bad.length, 'bad');
console.table(bad);
```

- [ ] Expect **~980 paths, 0 bad**. Any 404 is almost certainly a case
      mismatch; fix the id→path rule in **both** `backend/app/static_paths.py`
      and `frontend/src/lib/staticPaths.ts`, rebuild, redeploy.
- [ ] Spot-check the `vol:` ids by eye — they are the ones that go through the
      colon→directory mapping: `/api/series/vol/10Y.full.json` must be 200.

### 2. Cache headers arrive as configured, and the manifest is not among the cached

**Revised in Pass F — the policy is now `no-cache` on everything.**

- [ ] `curl -sI https://<site>/api/manifest.json | grep -i cache-control`
      → `no-cache`
- [ ] `curl -sI https://<site>/api/series/10Y.full.json | grep -i cache-control`
      → `no-cache`
- [ ] `curl -sI https://<site>/api/series/vol/10Y.full.json` → `no-cache`
      (the colon-mapped path, served from a subdirectory)
- [ ] Confirm **neither** `immutable` nor `stale-while-revalidate` nor any
      positive `max-age`/`s-maxage` appears anywhere. All three admit a window
      in which the reader holds a fresh manifest and a stale series — the
      header prints today's as-of date over last week's line, and nothing
      errors. `swr` is not a compromise: it serves the stale copy on first
      paint, the one paint that matters.
- [ ] Send a conditional request and confirm the cost of this is small:
      `curl -sI -H 'If-None-Match: <etag>' https://<site>/api/series/10Y.full.json`
      → **304**, empty body. Measured locally at 0 bytes.
- [ ] After the **second** deploy with new data: load the site, then reload
      **without** clearing cache, and confirm the as-of date advanced. If it
      did not, something upstream is caching past the header.

The headers come from `frontend/next.config.ts`, not `vercel.json` — Next
applies them to `public/` under both `next start` and Vercel, so the local and
deployed policies cannot diverge. `vercel.json` deliberately carries no
`headers` block; `guards/cache-policy.test.ts` fails if one reappears.

### 3. The deployment sits inside Vercel's limits

Measured locally: **984 files, ~31 MB raw**, largest single file 0.106 MB.
Against the published limits (retrieved 2026-07-29): static uploads 100 MB
(Hobby) / 1 GB (Pro); 15,000 source files; 45-minute build.

- [ ] Build log shows a completed deploy well inside the 45-minute wall
      (expect seconds — `next build` alone was ~5 s locally).
- [ ] Deployment size reported by Vercel is in the tens of MB, not hundreds. If
      it is much larger, check that Root Directory is `frontend` — otherwise
      `data/irsdata.xlsx` and `backend/` are being uploaded too.
- [ ] `frontend/vercel.json` has exactly **two** `headers` entries. Vercel
      counts every header/rewrite/redirect rule against a 2,048-route limit, so
      cache policy must stay pattern-based and never per-file.

### 4. First-load transfer, measured against the local figure

Local baseline from the stability session (`docs/diagnostics/perf-baseline.md`):
initial JS **235,867 bytes transferred**, and the stage-1 summary **3,487 bytes
gzipped** from the FastAPI backend.

- [ ] DevTools → Network → disable cache → reload. Record the transferred total
      and compare:
  - [ ] Initial JS should be ~236 KB, matching local. A large difference means
        the production build differs from the local one.
  - [ ] `/api/wall/summary.json` is 19,747 bytes raw; **Vercel compresses
        static assets itself**, so expect roughly 3–4 KB on the wire. If it
        arrives uncompressed at ~20 KB, check that `Content-Encoding` is
        present — the backend's own gzip middleware is now development-only and
        does nothing here.
  - [ ] `/api/forwards.json` and `/api/volatility.json` likewise compressed.
- [ ] Confirm **no request goes to `localhost:8100`**. One would mean
      `NEXT_PUBLIC_API_BASE` was set at build time; it would also fail as mixed
      content, which is what started this whole conversion.

### 5. Freshness reads the reader's clock

- [ ] The header shows the as-of date and, since `data/irsdata.xlsx` currently
      ends 2026-07-24, a staleness chip whose business-day count matches what
      you would count yourself. It is computed in the browser from
      `api/manifest.json`, so it should advance day to day **without a
      redeploy** — check again the following day.
- [ ] The ladder in the manifest covers 400 business days (~18 months). Past
      that the badge clamps and stays "stale", which is correct but imprecise;
      it is not a concern while the data is refreshed at all.

---

## Not covered, and why

- **Frame rate, paint timing, the narrow single-column layout, OS-level
  `prefers-reduced-motion`.** These need a real screen; the automation
  environment here cannot produce honest numbers and has cost three sessions
  trying. Owner's, on a real browser.
- **Whether the deployed site is fast enough on a real network.** The local
  figures are localhost figures.
