/* Shared source reading for the guards (stability session, Pass D).
 *
 * Most guards in here work by scanning source text for a token that must be
 * present or must be absent. The absent case has a recurring, embarrassing
 * failure: a guard bans a thing, someone writes a COMMENT explaining why the
 * thing was removed, and the comment trips the guard. It has happened four
 * times across sessions — pane-still, carry-copy, calendar, bottom-strip —
 * and each time it was fixed locally with a hand-rolled regex pair, so the
 * fifth guard started the cycle again.
 *
 * String literals are the same trap one step along: a banned identifier that
 * appears inside a label, a URL, or a test fixture string is not a use of it.
 *
 * So: one reader, two strengths, used by every guard.
 *
 *   code(path)        comments gone, string literals intact
 *   identifiers(path) comments AND string contents gone
 *
 * Pick `identifiers` when the banned thing is a piece of CODE (an import, a
 * hook, a component). Pick `code` when the banned thing is a VALUE that would
 * legitimately live in a string (a raw hex, a class name, a Korean phrase) —
 * there, a string occurrence IS the violation.
 *
 * Whitespace is preserved position-for-position: what is removed becomes
 * spaces and newlines, so line numbers still line up with the real file.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const SRC = join(__dirname, "..", "src");

/** File text, untouched. For assertions that are ABOUT the prose. */
export function raw(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/** One pass: drops comments, and optionally the contents of string and
 * template literals. Written as a scanner rather than a regex pair because
 * `// ` inside a URL and a quote inside a comment both defeat the regexes. */
function scan(text: string, dropStrings: boolean): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      // newlines survive so line numbers still match the real file
      out += text
        .slice(i, stop)
        .split("\n")
        .map(blank)
        .join("\n");
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      let body = "";
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") {
          body += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        body += text[i];
        i++;
      }
      out += dropStrings
        ? body
            .split("\n")
            .map((l) => blank(l))
            .join("\n")
        : body;
      if (i < text.length) out += text[i];
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export const stripComments = (text: string): string => scan(text, false);
export const stripAll = (text: string): string => scan(text, true);

/** Comments removed; string literals kept. The default. */
export function code(rel: string): string {
  return stripComments(raw(rel));
}

/** Comments AND string contents removed. For banned identifiers. */
export function identifiers(rel: string): string {
  return stripAll(raw(rel));
}

/** CSS has only block comments, and no string literals worth the trouble. */
export function css(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every .ts/.tsx under `rel`, as [repo-relative path, code] pairs. */
export function walk(
  rel: string,
  mode: "code" | "identifiers" = "code",
): [string, string][] {
  const out: [string, string][] = [];
  const visit = (dir: string, prefix: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        visit(p, `${prefix}${f}/`);
        continue;
      }
      if (!f.endsWith(".ts") && !f.endsWith(".tsx")) continue;
      const text = readFileSync(p, "utf8");
      out.push([
        `${prefix}${f}`,
        mode === "identifiers" ? stripAll(text) : stripComments(text),
      ]);
    }
  };
  visit(join(SRC, rel), "");
  return out;
}
