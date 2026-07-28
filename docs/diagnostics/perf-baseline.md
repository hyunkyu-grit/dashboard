# Performance baseline — measured before optimising

Stability session, Pass E. **Numbers first.** Everything below was measured on
this machine against the production build (`next build` + `next start` on
:3100) and a warm backend on :8100, before any change was made. Three things
were changed as a result; everything else measured healthy and was left alone,
which is recorded here so a later session does not "optimise" it on a hunch.

## How these were measured

- **Bundle** — clean `.next`, `next build`, then every emitted `.js` under
  `.next/static` sized raw and gzipped (level: optimal), with each chunk
  fingerprinted for the dependency inside it (`TradingView` → lightweight-
  charts, `cmdk-root` → cmdk, `QueryClientProvider` → react-query,
  `__reactFiber` → react-dom). Route attribution comes from the script tags in
  the prerendered `.next/server/app/index.html`.
- **Payloads** — each endpoint fetched server-side, body sized raw and gzipped,
  and the response's `Content-Encoding` recorded.
- **Cold load / tab render / memory** — in Chrome, against the production
  server.

  ⚠ **The automation tab is occluded**, so `requestAnimationFrame`, paint
  timing (`first-contentful-paint`), and LCP never fire — the first attempt at
  an rAF-based measurement hung the CDP call for 45s. This is the same
  occluded-renderer trap recorded in earlier sessions. So the timings below are
  **time-to-DOM-committed**, taken with a `MutationObserver` (microtask-driven,
  unaffected by occlusion) inside a same-origin iframe harness. That is the
  JavaScript work — fetch, parse, build, commit — and it is the part a change
  here can move. It is **not** time-to-pixels; the compositor step is not
  included and cannot be measured from here. A real first-paint number needs a
  visible window and stays with the owner.

---

## 1. Bundle size, split by route

**There is only one route.** `/` and `/_not-found` are the whole app; the list,
the preview, every tab, and the popup are one client tree behind one URL. So
there is nothing to split *between* routes — the entire bundle is the initial
bundle, and everything below loads before the first row appears.

| chunk | raw | gzip | contains |
|---|---:|---:|---|
| `3jlbpi_y6d24r.js` | 440,422 | 143,007 | **lightweight-charts**, cmdk, react-query, app code |
| `089326xzuzez4.js` | 227,534 | 71,000 | react-dom |
| `1ye058-717ful.js` | 144,434 | 38,986 | framework |
| `0cz1d0mv5g_q7.js` | 112,594 | 39,473 | framework |
| `18phzrd628dse.js` | 57,908 | 13,811 | |
| `1qyk2yx9rat1_.js` | 56,725 | 12,184 | |
| `3-7adm3rer99_.js` | 17,554 | 6,134 | next |
| `turbopack-…​.js` | 10,580 | 4,160 | runtime |
| **total** | **1,068,551** | **328,966** | all 8 requested by `/` |

**Largest dependency: `lightweight-charts`**, whose production ESM build is
196 KB raw on disk, inside the largest chunk. It is used in exactly one place —
`wall/DetailChart.tsx`, which renders only inside the popup (§11 confines it
there). A reader who never opens a popup downloads and parses all of it.
`EnlargedView` imported it statically, and `App` imported `EnlargedView`
statically, so it sat on the first-load path.

→ **acted on** (see below).

## 2. Stage-1 summary payload

`/api/wall/summary`, 50 rows (15 outright + 35 derived):

| | raw | gzip |
|---|---:|---:|
| whole payload | **235,122** | **36,143** |

Two separate findings, and the smaller one is not the interesting one.

**a. Nothing is compressed.** Every response leaves the backend with no
`Content-Encoding`. The browser downloads the full 235 KB. Gzip would take the
same bytes to 36,143 — **6.5×**. It affects every endpoint, including the
stage-2 series fetch (103,198 → 17,389).

| endpoint | raw | gzip | encoding |
|---|---:|---:|---|
| `/api/wall/summary` | 235,122 | 36,143 | *(none)* |
| `/api/series/10Y?res=full` | 103,198 | 17,389 | *(none)* |
| `/api/forwards` | 50,203 | 7,196 | *(none)* |
| `/api/series/10Y?res=preview` | 9,447 | 1,951 | *(none)* |
| `/api/volatility` | 2,728 | 783 | *(none)* |
| `/api/health` | 156 | 137 | *(none)* |

**b. 92.3% of the payload is a field nobody reads.** Attributing every row byte
to its field:

| field | bytes across 50 rows | share |
|---|---:|---:|
| **`spark`** | **215,368** | **92.3%** |
| `basisValues` | 3,658 | 1.6% |
| `deltas` | 3,219 | 1.4% |
| `range1y` | 2,976 | 1.3% |
| `oneLiner` | 2,009 | 0.9% |
| `sortKey` | 1,026 | 0.4% |
| everything else | 5,026 | 2.2% |

`spark` is 150 `{t, v}` points per row — a ten-year downsampled line, sent for
all 50 rows on first load. It is declared in `lib/api.ts` and **read by no
component**: the only other occurrences in the frontend are two guard fixtures
setting `spark: []`. It is left over from the retired band-card layout, whose
tiles drew a sparkline. The list-first table draws no per-row line, and the
preview/enlarged panes fetch their own history from `/api/series` at stage 2.

Compressing it would have hidden it. Deleting it is the fix, and it is why the
gzip finding is the *second* item here, not the first.

→ **both acted on.**

## 3. Cold load to first row (warm backend)

Time-to-DOM-committed, from navigation start to ≥ 5 instrument rows in the
document, production build:

| run | ms | note |
|---|---:|---|
| 1 | 705 | cold — JS not in HTTP cache |
| 2 | 356 | JS cached |
| 3 | ~350 | JS cached |

Breakdown on the cold run: DOM content loaded at 44 ms, JS finished
downloading at 53 ms, and **the four API responses landed at ~450 ms** — the
wall-clock is dominated by the request, not by rendering. On the warm runs the
same responses land at ~120 ms and rows commit ~230 ms later.

The page issues four requests in parallel at first paint — `/api/health`,
`/api/wall/summary`, `/api/forwards`, `/api/volatility`. That looked like
over-fetching until the row counts were checked: the default 전체 tab renders
197 rows, which is outrights + spreads + forwards + volatility together. All
four responses are needed to draw the first screen, and they are already
parallel. **Healthy — left alone.**

## 4. Time to render the forward tab

Click → last DOM mutation, measured seven times across tab switches:

| tab | rows | settle (ms) |
|---|---:|---:|
| **포워드** | 143 | **123 / 118 / 115** |
| 전체 | 197 | 99 |
| 변동성 | 7 | 37 |
| 스프레드 | 36 | 37 |
| 아웃라이트 | 16 | 38 |

The forward tab is the slowest, as expected — it is the largest table and adds
the ladder chart — but ~120 ms for 143 rows is not a number worth chasing, and
it is stable across repeats (no first-time penalty, so nothing is being
recomputed per visit). **Healthy — left alone.**

## 5. Peak memory

JS heap, after visiting all five tabs and then opening and closing five
popups (each mounting a lightweight-charts instance over ~2,600 daily points):

| point | MB |
|---|---:|
| after the tab sweep | 17.8 |
| across five popup open/close cycles | 13.6 – 17.7 (oscillating) |
| settled, all popups closed | 14.5 |

No monotonic growth across the cycles, and the heap returns to its starting
band. **Healthy — left alone.**

One scare worth recording so it is not re-diagnosed as a leak: after closing a
popup the URL was back at `/` while **7 `<canvas>` elements and the
`.tv-lightweight-charts` container were still in the DOM**, which reads exactly
like an undisposed chart. It is not. The exit animation is driven by
`requestAnimationFrame`, which is paused in an occluded tab, so the element was
waiting to unmount. Forcing one frame (a screenshot) dropped it to **0 charts,
0 canvases, 0 overlay nodes**. The charts do dispose.

---

## What was changed, and the arithmetic behind each

1. **`spark` removed from the stage-1 payload.** 235,122 → ~20 KB raw. Dead
   data, not slow data: no component ever read it. `downsample()` existed only
   to build it and went with it (`downsample_triples()`, which serves
   `res=preview`, stays).
2. **Gzip on the backend.** Every endpoint, ~6× on the ones that matter, one
   middleware. Still worth it after (1): the stage-2 series fetch is 103 KB and
   is what the reader waits on when opening a popup.
3. **`lightweight-charts` loaded lazily.** It is popup-only by design (§11) but
   was on the first-load path. Now behind `next/dynamic`, so it is fetched when
   a popup first opens, with the ordinary loading state while it arrives.

Measured healthy and deliberately untouched: the four parallel stage-1
requests, tab render times, forward-tab render, heap behaviour and chart
disposal.

## After

Re-measured the same way, same machine, rebuilt frontend, restarted backend.
**On-the-wire** bytes are the true compressed response, read with automatic
decompression disabled — `Invoke-WebRequest`'s `RawContentLength` reports the
*decompressed* length and will tell you nothing changed.

### Bytes

| | before | after |
|---|---:|---:|
| `/api/wall/summary` raw JSON | 235,122 | **19,747** |
| `/api/wall/summary` on the wire | 235,122 | **3,487** |
| `/api/series/10Y?res=full` on the wire | 103,198 | 16,765 |
| `/api/forwards` on the wire | 50,203 | 6,855 |
| `/api/volatility` on the wire | 2,728 | 766 |
| `/api/health` on the wire | 156 | 156 *(under `minimum_size`)* |
| initial JS, raw | 1,068,551 | 901,151 |
| initial JS, gzipped sum | 328,966 | 275,113 |
| initial JS actually transferred | 289,521 | **235,867** |
| largest initial chunk (gzip) | 143,007 | 79,670 |

The stage-1 payload is **67× smaller on the wire** — most of that is deleting
`spark`, the rest is compression. lightweight-charts is now its own chunk,
171,284 raw / 55,711 transferred, **not requested by `/`**: resource timing
shows it fetched for the first time at the first popup open, taking **10 ms**.
That is what deferring it costs.

### Time and memory

| | before | after |
|---|---|---|
| load to the full 197-row table, cold | 705 ms | 605 ms |
| …warm (4 further runs) | ~356 ms | 364 / 396 / 309 / 369 ms |
| forward tab settle | 115–123 ms | 108–170 ms |
| peak heap over the same sweep | 17.8 MB | 17.7 MB |

**Read this honestly: the warm load did not get faster, and it was never going
to.** It is backend response time plus committing 197 rows — on the warm runs
the API responses land at ~150 ms and the table commits ~200 ms later, and
neither number is made of bytes on the wire. The byte work shows up in three
places that are real but are not warm wall-clock: the cold path (705 → 605 ms),
the transfer itself (a reader on anything slower than localhost pays 235 KB
less on every refresh of the summary alone), and the first popup, which now
fetches 56 KB it used to have but which everyone else no longer downloads.

Forward-tab settle and peak heap moved inside their noise bands, which is the
expected result: nothing in this pass touched rendering or retention.

### A measurement that lied, recorded so it is not repeated

Timing the first popup by polling `document.querySelectorAll('canvas')` in a
`setTimeout` loop returned **2002 ms** for the first open and **1 ms** for
every open after. Both are artefacts of the occluded tab: background timers are
clamped to ~1 s, so 2002 ms is two ticks of the polling floor rather than a
measurement; and the 1 ms readings are the *previous* popup's canvases, still
in the DOM because its rAF-driven exit animation had not run. The resource-
timing entry (10 ms, fetched once) is the number that survives scrutiny. Prefer
the performance timeline over DOM polling whenever the tab may be occluded.

