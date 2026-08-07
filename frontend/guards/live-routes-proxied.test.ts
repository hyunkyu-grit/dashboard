/* Guard: every LIVE endpoint the browser calls must have a rewrite.
 *
 * The failure this exists for actually happened (2026-08-07, the simulation
 * merge). `next.config.ts` proxied exactly one route, `/api/backtest`, because
 * that was the only live one when it was written. The simulation then arrived
 * with four more and worked perfectly — in DEV, where
 * `.env.development.local` sets NEXT_PUBLIC_API_BASE to an absolute
 * `localhost:8100` and no rewrite is consulted at all.
 *
 * Deployed, API_BASE is "" by design (staticPaths.ts) so every one of those
 * calls goes same-origin and needs a rule. There was none, so the whole tab
 * would have 404'd on a site that looked correct on the developer's machine.
 * No test covered it: the guards read source text, and the sim's own tests mock
 * fetch. This is the check that would have caught it.
 *
 * The rule pinned here is the PAIRING, not a list of paths: whatever the
 * client-side API modules ask for at a same-origin path, the config must
 * forward. A new endpoint added to api-client.ts fails here until it is.
 */

import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { code } from "./_source";

/** The modules that issue same-origin `/api/...` requests from the browser. */
const CLIENTS = ["sim/lib/api-client.ts", "sim/api/simulation-api.ts", "lib/staticPaths.ts"];

/** Paths the deployed site serves as COMMITTED JSON — no backend, no rewrite.
 * These are the static twins build_static.py writes under public/api/**. */
const STATIC_TWINS = [
  "/api/health",
  // the literal in staticPaths is "/api/manifest.json"; the path matcher above
  // stops at the dot, so the twin is written the way it is READ
  "/api/manifest",
  "/api/wall/summary",
  "/api/series/",
  "/api/forwards",
  "/api/dv01/",
  "/api/volatility",
];

/** Every `/api/...` literal the client modules build a request from. */
function requestedPaths(): string[] {
  const found = new Set<string>();
  for (const rel of CLIENTS) {
    const text = code(rel);
    for (const m of text.matchAll(/["'`]\s*(\/api\/[a-z0-9\-/]*)/gi)) {
      found.add(m[1].replace(/\/$/, ""));
    }
  }
  return [...found].sort();
}

async function rewriteSources(): Promise<string[]> {
  // BACKEND_ORIGIN unset emits NO rules at all (the local default, documented
  // in next.config). Set one so the list is the real one.
  const prev = process.env.BACKEND_ORIGIN;
  process.env.BACKEND_ORIGIN = "http://backend.test";
  try {
    const rules = await nextConfig.rewrites!();
    return (Array.isArray(rules) ? rules : []).map((r) => r.source);
  } finally {
    if (prev === undefined) delete process.env.BACKEND_ORIGIN;
    else process.env.BACKEND_ORIGIN = prev;
  }
}

/** Does `source` (which may carry `:path*`) cover this concrete path? */
function covers(source: string, path: string): boolean {
  if (source === path) return true;
  const prefix = source.replace(/\/:[a-z]+\*?$/i, "");
  return source.includes(":") && (path === prefix || path.startsWith(prefix + "/"));
}

describe("every live endpoint is reachable on the deployed site", () => {
  it("finds the paths the client asks for", () => {
    // if this collapses the rest of the file proves nothing
    expect(requestedPaths().length).toBeGreaterThanOrEqual(6);
  });

  it("no same-origin request is left without a rewrite", async () => {
    const sources = await rewriteSources();
    const orphans = requestedPaths()
      .filter((p) => !STATIC_TWINS.some((s) => p.startsWith(s.replace(/\/$/, ""))))
      .filter((p) => !sources.some((s) => covers(s, p)));
    expect(orphans).toEqual([]);
  });

  it("the simulation's four are named explicitly", async () => {
    // the ones that were missing; spelled out so a refactor of the matcher
    // above cannot make this pass vacuously
    const sources = await rewriteSources();
    for (const p of [
      "/api/simulate",
      "/api/market-data/range",
      "/api/market-data/2026-07-16",
      "/api/positions",
    ]) {
      expect(sources.some((s) => covers(s, p)), p).toBe(true);
    }
  });

  it("unset BACKEND_ORIGIN still emits nothing", async () => {
    // the local default: no rules, /api/* 404s, and the UI says a backend is
    // needed rather than drawing an empty answer
    const prev = process.env.BACKEND_ORIGIN;
    delete process.env.BACKEND_ORIGIN;
    try {
      expect(await nextConfig.rewrites!()).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.BACKEND_ORIGIN = prev;
    }
  });

  it("credit-curve is NOT proxied — its workbook is gone", async () => {
    const sources = await rewriteSources();
    expect(sources.some((s) => s.includes("credit-curve"))).toBe(false);
    // ...and nothing in the client asks for it any more, which is what makes
    // the absence correct rather than an oversight
    expect(requestedPaths().some((p) => p.includes("credit-curve"))).toBe(false);
  });
});
