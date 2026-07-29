/* Guard: every path the frontend can request was actually emitted, spelled
 * identically.
 *
 * Static conversion, Pass B/C. This is the test that has to exist because the
 * build host is Windows and Vercel is Linux. A filename whose case differs from
 * the string the frontend builds resolves fine locally and 404s in production —
 * and it 404s for one series out of 196, which is exactly the kind of thing
 * that ships.
 *
 * So: **compared as strings, never by asking the filesystem.** `existsSync` on
 * NTFS answers case-insensitively and would report success for `10y.full.json`
 * when the frontend asks for `10Y.full.json`. The directory is listed once and
 * the comparison is set membership over exact strings.
 *
 * The id set is not hard-coded either — it is built by `buildRows`, the same
 * function the table uses, fed from the emitted payloads. So a new instrument,
 * a renamed forward, or a change to which rows get a `seriesId` all flow
 * through here automatically.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ForwardsPayload, VolatilityPayload, WallSummary } from "../src/lib/api";
import {
  dv01Url,
  IS_STATIC,
  seriesUrl,
  slug,
  type Resolution,
} from "../src/lib/staticPaths";
import { buildRows } from "../src/ui/rows";

const PUBLIC = join(__dirname, "..", "public");
const API = join(PUBLIC, "api");

const RESOLUTIONS: Resolution[] = ["full", "preview", "w", "m"];

/** Every file under public/api, as posix-style paths relative to public/. */
function listEmitted(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${prefix}${e.name}/`);
      else out.add(`${prefix}${e.name}`);
    }
  };
  walk(API, "api/");
  return out;
}

const read = <T,>(rel: string): T =>
  JSON.parse(readFileSync(join(PUBLIC, rel), "utf8")) as T;

// This guard is about the DEPLOYED shape, so it only means anything in static
// mode. Vitest does not load .env.local, so that is the normal case — but an
// exported NEXT_PUBLIC_API_BASE in the shell would silently turn every
// assertion below into a check of live-backend URLs against a file listing,
// which fails confusingly. Say so instead.
if (!IS_STATIC) {
  throw new Error(
    "NEXT_PUBLIC_API_BASE is set, so the URL builders produce live-backend " +
      "URLs and cannot be compared against the emitted file tree. Unset it " +
      "to run this guard.",
  );
}

const emitted = listEmitted();
const summary = read<WallSummary>("api/wall/summary.json");
const forwards = read<ForwardsPayload>("api/forwards.json");
const volatility = read<VolatilityPayload>("api/volatility.json");
const rows = buildRows(summary, forwards, volatility);

/** `/api/x.json` → `api/x.json`, so a URL can be compared to a listing. */
const asKey = (url: string) => decodeURI(url).replace(/^\//, "");

describe("the static build covers every id the app can request", () => {
  it("produced rows to check (the payloads are real)", () => {
    expect(rows.length).toBeGreaterThan(150);
    expect(rows.some((r) => r.group === "vol")).toBe(true);
    expect(rows.some((r) => r.group === "forward")).toBe(true);
  });

  it.each(RESOLUTIONS)("every series has a %s file, spelled exactly", (res) => {
    const missing = rows
      .filter((r) => r.seriesId)
      .map((r) => asKey(seriesUrl(r.seriesId!, res)))
      .filter((k) => !emitted.has(k));
    expect(missing).toEqual([]);
  });

  it("every series has a dv01 file, spelled exactly", () => {
    const missing = rows
      .filter((r) => r.seriesId)
      .map((r) => asKey(dv01Url(r.seriesId!)))
      .filter((k) => !emitted.has(k));
    expect(missing).toEqual([]);
  });

  it("the fixed payloads exist", () => {
    for (const p of [
      "api/wall/summary.json",
      "api/forwards.json",
      "api/volatility.json",
      "api/manifest.json",
    ]) {
      expect(emitted.has(p)).toBe(true);
    }
  });
});

describe("case sensitivity is checked as strings, not by the filesystem", () => {
  it("the comparison would catch a case difference", () => {
    // The guard's own premise: if this set membership were case-insensitive
    // (as existsSync is on NTFS) the whole test would pass vacuously.
    const anyFile = [...emitted].find((f) => /[A-Z]/.test(f))!;
    expect(anyFile).toBeDefined();
    expect(emitted.has(anyFile.toLowerCase())).toBe(false);
  });

  it("ids that differ only by case would map to different paths", () => {
    expect(seriesUrl("10Y", "full")).not.toBe(seriesUrl("10y", "full"));
  });
});

describe("the id → path rule matches the backend's", () => {
  it("maps the colon to a directory", () => {
    expect(slug("vol:1Y")).toBe("vol/1Y");
    expect(asKey(seriesUrl("vol:1Y", "full"))).toBe("api/series/vol/1Y.full.json");
  });

  it("leaves every other id shape alone", () => {
    for (const id of ["1Y", "1.5Y", "1Y-10Y", "2Y-5Y-10Y", "6Mx3M", "4Y6Mx2Y"]) {
      expect(slug(id)).toBe(id);
    }
  });

  it("does not escape the separators it just created", () => {
    // a whole-id encodeURIComponent would turn the mapped `/` back into %2F
    expect(seriesUrl("vol:10Y", "w")).toBe("/api/series/vol/10Y.w.json");
  });

  it("emits nothing the app cannot ask for", () => {
    // the reverse direction: no orphaned files bloating the deployment
    const wanted = new Set<string>([
      "api/wall/summary.json", "api/forwards.json",
      "api/volatility.json", "api/manifest.json",
    ]);
    for (const r of rows) {
      if (!r.seriesId) continue;
      for (const res of RESOLUTIONS) wanted.add(asKey(seriesUrl(r.seriesId, res)));
      wanted.add(asKey(dv01Url(r.seriesId)));
    }
    const orphans = [...emitted].filter((f) => !wanted.has(f));
    expect(orphans).toEqual([]);
  });
});
