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
- [ ] **Set no environment variables.** In particular do **not** set
      `NEXT_PUBLIC_API_BASE`. Empty means "read the committed JSON tree", which
      is the deployed behaviour; setting it points the browser at a backend
      that will not exist, and because `NEXT_PUBLIC_*` is inlined at build time
      the mistake needs a rebuild to undo.
- [ ] Confirm the build command is the framework default (`next build`). No
      Python step. Verified locally: the build succeeds with Python removed
      from `PATH` and no `.env.local` present.

## Immediately after the first deploy

### 1. Every series and forward path resolves — **case sensitivity fails here and nowhere else**

The build host is Windows (case-insensitive); Vercel is Linux (case-sensitive).
A filename whose case differs from the string the app builds resolves locally
and 404s in production, for perhaps one instrument out of 196.
`guards/static-paths.test.ts` compares as strings rather than asking the
filesystem, which is the best that can be done locally — but only the deployed
site proves it.

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

- [ ] `curl -sI https://<site>/api/series/10Y.full.json | grep -i cache-control`
      → `public, max-age=0, s-maxage=31536000, must-revalidate`
- [ ] `curl -sI https://<site>/api/manifest.json | grep -i cache-control`
      → `public, max-age=0, must-revalidate` (**no `s-maxage`**)
- [ ] Confirm `immutable` appears on **neither**. This is deliberate and worth
      not "fixing": `immutable` is only safe for content-addressed URLs.
      `/api/series/10Y.full.json` is a *stable* URL whose content changes with
      every data refresh, so `immutable` would leave a returning reader on last
      week's history indefinitely — silent staleness, the exact failure the
      product is built to avoid.
- [ ] After the **second** deploy with new data, hard-check the fix works:
      load the site, then reload without clearing cache, and confirm the
      as-of date in the header advanced. If it did not, the browser is caching
      a data file it should be revalidating.

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
