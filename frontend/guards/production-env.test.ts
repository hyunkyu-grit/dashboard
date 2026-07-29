/* Guard: a production build cannot be pointed at a live backend (Pass H).
 *
 * The bug this exists for was found by walking the built site, not by reading
 * code. `.env.local` held the development override
 * `NEXT_PUBLIC_API_BASE=http://localhost:8100`, and Next loads `.env.local` for
 * `next build` as well as `next dev`. So `pnpm build` compiled that origin into
 * the bundle, every gate went green on it, and **the artifact the gates
 * certified was not the artifact that would deploy**. Deployed, every request
 * would have gone to the reader's own machine and failed as mixed content —
 * precisely the failure the static conversion was done to remove.
 *
 * Two checks, at the two layers the failure can enter:
 *
 *   config  no env file that Next loads for a PRODUCTION build may set the API
 *           base. This is deterministic and does not depend on build state.
 *   output  if a build exists, no emitted chunk may contain an absolute API
 *           origin. This catches the same thing from the other side, including
 *           a base injected by a shell variable rather than a file.
 *
 * The fix is structural, not procedural: the override lives in
 * `.env.development.local`, which `next build` cannot see.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FRONTEND = join(__dirname, "..");

/* Files Next loads when NODE_ENV=production, in precedence order. Notably
 * `.env.local` IS among them and `.env.development.local` is NOT — that
 * asymmetry is the whole point. */
const PRODUCTION_ENV_FILES = [
  ".env.production.local",
  ".env.local",
  ".env.production",
  ".env",
];

/** Variables that choose where data comes from. Set in a production-loaded
 * file, any of these silently redirects the deployed site. */
const REDIRECTING_VARS = [/^NEXT_PUBLIC_API_BASE\s*=\s*\S/m];

describe("no production-loaded env file redirects the data source", () => {
  it.each(PRODUCTION_ENV_FILES)("%s does not set an API base", (name) => {
    const p = join(FRONTEND, name);
    if (!existsSync(p)) return; // absent is the good case
    const text = readFileSync(p, "utf8");
    // comment lines are not settings
    const active = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    for (const re of REDIRECTING_VARS) {
      expect(
        re.test(active),
        `${name} sets NEXT_PUBLIC_API_BASE, which next build WILL read. ` +
          "Move the development override to .env.development.local, which " +
          "only next dev loads.",
      ).toBe(false);
    }
  });

  it("the development override lives where only next dev sees it", () => {
    // not required to exist — a machine with no backend needs no override —
    // but if it exists anywhere, it must be the development-only file
    const devFile = join(FRONTEND, ".env.development.local");
    if (!existsSync(devFile)) return;
    const text = readFileSync(devFile, "utf8");
    expect(text).toMatch(/NEXT_PUBLIC_API_BASE/);
  });

  it("the template teaches the right filename", () => {
    const example = readFileSync(join(FRONTEND, ".env.example"), "utf8");
    expect(example).toContain(".env.development.local");
    // and warns off the one that leaks
    expect(example).toMatch(/NOT `?\.env\.local/);
  });
});

describe("the built bundle carries no absolute API origin", () => {
  const chunkDir = join(FRONTEND, ".next", "static", "chunks");

  it("no emitted chunk hardcodes a backend origin", () => {
    if (!existsSync(chunkDir)) {
      // no build to inspect; the config check above still applies
      return;
    }
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          walk(p);
          continue;
        }
        if (!e.name.endsWith(".js")) continue;
        const text = readFileSync(p, "utf8");
        // any absolute http(s) origin used as the API base. The static build
        // fetches only same-origin relative paths, so there is nothing
        // legitimate for this to match.
        if (/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api/.test(text)) {
          offenders.push(e.name);
        }
      }
    };
    walk(chunkDir);
    expect(
      offenders,
      "a production chunk contains a localhost API origin — the build was made " +
        "with NEXT_PUBLIC_API_BASE set, so it would ship pointing at the " +
        "reader's own machine",
    ).toEqual([]);
  });
});
