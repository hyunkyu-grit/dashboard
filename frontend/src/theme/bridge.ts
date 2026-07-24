/* Theme bridge — design spec §9.
 *
 * Chart canvases cannot resolve CSS custom properties. This module resolves
 * semantic tokens to concrete color strings via a DOM probe (which also
 * flattens color-mix()), and notifies subscribers when the theme attribute
 * flips so canvas-bound options can be rebuilt and the chart redrawn.
 *
 * Passing a raw `var(...)` string into a canvas option silently paints
 * nothing — a recurring defect class in the predecessor system. Canvas
 * option factories must run their output through assertNoCssVars().
 */

export type SemanticToken =
  | "page"
  | "tile"
  | "popover"
  | "ink"
  | "border"
  | "borderLive";

const TOKEN_VARS: Record<SemanticToken, string> = {
  page: "--bw-page",
  tile: "--bw-tile",
  popover: "--bw-popover",
  ink: "--bw-ink",
  border: "--bw-border",
  borderLive: "--bw-border-live",
};

export type ResolvedTheme = Record<SemanticToken, string>;

/** Resolve every semantic token to a concrete color string (rgb/rgba). */
export function resolveTheme(): ResolvedTheme {
  if (typeof document === "undefined") {
    throw new Error("resolveTheme() is client-only");
  }
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const out = {} as ResolvedTheme;
  try {
    for (const [token, cssVar] of Object.entries(TOKEN_VARS)) {
      probe.style.color = `var(${cssVar})`;
      out[token as SemanticToken] = getComputedStyle(probe).color;
    }
  } finally {
    probe.remove();
  }
  return out;
}

/** Notify `cb` whenever the root data-theme attribute changes. */
export function onThemeChange(cb: () => void): () => void {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

/**
 * Reject canvas-bound option objects that still reference CSS variables.
 * Deep-walks the object; throws on any string containing "var(".
 */
export function assertNoCssVars(options: unknown, path = "options"): void {
  if (typeof options === "string") {
    if (options.includes("var(")) {
      throw new Error(
        `canvas-bound option ${path} contains unresolved CSS var: "${options}"`,
      );
    }
    return;
  }
  if (Array.isArray(options)) {
    options.forEach((v, i) => assertNoCssVars(v, `${path}[${i}]`));
    return;
  }
  if (options !== null && typeof options === "object") {
    for (const [k, v] of Object.entries(options)) {
      assertNoCssVars(v, `${path}.${k}`);
    }
  }
}
