/* Guard: the committed data tree is never served from cache without
 * revalidating (Pass F).
 *
 * The failure this prevents is TEARING, and it is worth stating precisely
 * because the wrong policy looks like the obviously right one. These URLs are
 * stable while their contents change on every data refresh. Give an artifact
 * any positive `max-age` and there is a window where the reader holds a fresh
 * `manifest.json` and a stale `series/10Y.full.json`: the header prints today's
 * as-of date over last week's line. Nothing errors. It is the same
 * silent-wrong-numbers class this project keeps meeting, arriving through a
 * hosting setting.
 *
 * `stale-while-revalidate` is not a compromise here — it serves the stale copy
 * on first paint, which is the paint that matters.
 *
 * **The scope is derived, never listed.** The guard reads the real config,
 * takes whatever rules it finds, and expands them against the actual files in
 * `public/api`. A hand-written list of paths is precisely the bug: it would
 * pass while the one artifact nobody thought of went uncovered.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig, { DATA_CACHE_CONTROL } from "../next.config";

const FRONTEND = join(__dirname, "..");
const API_DIR = join(FRONTEND, "public", "api");

/** Every emitted artifact, as the request path a client would use. */
function emittedPaths(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${prefix}${e.name}/`);
      else out.push(`${prefix}${e.name}`);
    }
  };
  walk(API_DIR, "/api/");
  return out;
}

/** Turn a Next `source` pattern into a matcher. Only the forms this config
 * uses are supported, and an unrecognised form THROWS rather than silently
 * matching nothing — a guard that quietly stops covering things is worse than
 * no guard at all. */
function matcher(source: string): (p: string) => boolean {
  const wildcard = /^(.*?)\/:[A-Za-z]+\*$/.exec(source);
  if (wildcard) {
    const prefix = `${wildcard[1]}/`;
    return (p) => p.startsWith(prefix);
  }
  if (!source.includes(":") && !source.includes("*")) {
    return (p) => p === source;
  }
  throw new Error(
    `cache-policy guard cannot interpret the source pattern "${source}" — ` +
      "teach it the new form rather than leaving those paths unchecked",
  );
}

const BANNED = [/\bimmutable\b/, /\bstale-while-revalidate\b/];

/** The largest positive max-age or s-maxage in a Cache-Control value, or null
 * when every age present is zero.
 *
 * Note the spelling: the shared-cache directive is `s-maxage`, with no hyphen
 * between "max" and "age", while the private one is `max-age`, with one. A
 * regex written as `(?:s-)?max-age` looks right and silently misses every
 * `s-maxage` — which is exactly the directive the replaced policy used to hold
 * artifacts at the edge for a year. The self-test below caught this. */
function positiveMaxAge(value: string): number | null {
  let worst: number | null = null;
  for (const m of value.matchAll(/\b(?:s-maxage|max-age)\s*=\s*(\d+)/gi)) {
    const n = Number(m[1]);
    if (n > 0 && (worst === null || n > worst)) worst = n;
  }
  return worst;
}

const cacheControlOf = (rule: { headers: { key: string; value: string }[] }) =>
  rule.headers.filter((h) => h.key.toLowerCase() === "cache-control");

describe("cache policy for the committed data tree", () => {
  it("the config declares header rules at all", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    expect((await nextConfig.headers!()).length).toBeGreaterThan(0);
  });

  it("every rule that reaches an artifact revalidates", async () => {
    const rules = await nextConfig.headers!();
    const paths = emittedPaths();
    expect(paths.length).toBeGreaterThan(900);

    for (const rule of rules) {
      const covers = matcher(rule.source);
      const hit = paths.filter(covers);
      if (hit.length === 0) continue; // a rule aimed at something else
      for (const h of cacheControlOf(rule)) {
        for (const banned of BANNED) {
          expect(
            banned.test(h.value),
            `"${rule.source}" serves ${hit.length} artifacts as "${h.value}" — ` +
              `${banned.source} lets a fresh manifest sit beside stale data`,
          ).toBe(false);
        }
        expect(
          positiveMaxAge(h.value),
          `"${rule.source}" serves ${hit.length} artifacts as "${h.value}"; ` +
            "any positive age opens the tearing window",
        ).toBeNull();
      }
    }
  });

  it("EVERY emitted artifact is covered by some rule — no gaps", async () => {
    // the direction that catches the real bug: a rule that is correct but does
    // not reach the file nobody remembered
    const rules = await nextConfig.headers!();
    const matchers = rules.map((r) => matcher(r.source));
    const uncovered = emittedPaths().filter((p) => !matchers.some((m) => m(p)));
    expect(uncovered).toEqual([]);
  });

  it("the manifest specifically is covered and revalidating", async () => {
    const rules = await nextConfig.headers!();
    const applying = rules.filter((r) => matcher(r.source)("/api/manifest.json"));
    expect(applying.length).toBeGreaterThan(0);
    for (const r of applying) {
      for (const h of cacheControlOf(r)) {
        expect(positiveMaxAge(h.value)).toBeNull();
        expect(h.value).toContain("no-cache");
      }
    }
  });

  it("vercel.json does not carry a second, competing policy", () => {
    // it did until this pass, and `next start` ignored it entirely, so the
    // local and deployed policies could not be compared
    const vercel = JSON.parse(
      readFileSync(join(FRONTEND, "vercel.json"), "utf8"),
    );
    expect(vercel.headers ?? []).toEqual([]);
  });
});

describe("the guard's own machinery", () => {
  it("the policy constant is no-cache, not a positive age", () => {
    expect(DATA_CACHE_CONTROL).toBe("no-cache");
    expect(positiveMaxAge(DATA_CACHE_CONTROL)).toBeNull();
  });

  it("the age reader catches every spelling that would actually be written", () => {
    expect(positiveMaxAge("public, max-age=31536000, immutable")).toBe(31536000);
    expect(positiveMaxAge("public, max-age=0, s-maxage=31536000")).toBe(31536000);
    expect(positiveMaxAge("max-age=1")).toBe(1);
    expect(positiveMaxAge("public, max-age=0, must-revalidate")).toBeNull();
    expect(positiveMaxAge("no-cache")).toBeNull();
  });

  it("refuses to interpret a pattern it does not understand", () => {
    // silent non-matching is the failure mode this exists to avoid
    expect(() => matcher("/api/(.*)")).toThrow(/cannot interpret/);
    expect(matcher("/api/:path*")("/api/series/vol/1Y.full.json")).toBe(true);
    expect(matcher("/api/:path*")("/other/x.json")).toBe(false);
    expect(matcher("/api/manifest.json")("/api/manifest.json")).toBe(true);
  });

  it("would have failed against the policy this pass replaced", () => {
    // the two rules that were in vercel.json at HEAD 141a883
    const old = "public, max-age=0, s-maxage=31536000, must-revalidate";
    expect(positiveMaxAge(old)).toBe(31536000);
    expect(BANNED.some((b) => b.test("public, max-age=31536000, immutable"))).toBe(true);
  });
});
