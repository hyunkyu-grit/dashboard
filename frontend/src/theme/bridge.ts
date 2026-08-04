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

/** Resolve a single CSS custom property to a concrete color string via a DOM
 * probe (also flattens color-mix()). Client-only. */
function resolveVar(cssVar: string): string {
  if (typeof document === "undefined") {
    throw new Error("theme resolution is client-only");
  }
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${cssVar})`;
  document.body.appendChild(probe);
  try {
    return getComputedStyle(probe).color;
  } finally {
    probe.remove();
  }
}

/** Resolve every semantic token to a concrete color string (rgb/rgba). */
export function resolveTheme(): ResolvedTheme {
  const out = {} as ResolvedTheme;
  for (const [token, cssVar] of Object.entries(TOKEN_VARS)) {
    out[token as SemanticToken] = resolveVar(cssVar);
  }
  return out;
}

/* The band sub-palette resolvers (resolveBandHue) and the navy lockup resolver
 * (resolveBrand) were removed with the palette cut — nothing referenced them and
 * the palette is red/blue/grey now. The sub-palette stays defined-but-unused in
 * tokens.css only. */

/** Resolve the chart-stroke color to hex for canvas (§9). Plain line charts are
 * blue as of Session 16 (§ Pass E). */
export function resolveLine(): string {
  return resolveVar("--bw-line");
}

/** Resolve a direction colour (red up / blue down) to hex for canvas — candle
 * bodies use the 상승 빨강 / 하락 파랑 convention, not the line blue (§9/§G). */
export function resolveDirection(up: boolean): string {
  return resolveVar(up ? "--bw-up" : "--bw-down");
}

/** Resolve the ink (foreground) colour for canvas. */
export function resolveInk(): string {
  return resolveVar("--bw-ink");
}

/** Resolve a reference-line hue for canvas [OWNER, 2026-08-04 — "CD랑
 * 기준금리에 톤 안 깨면서 색"]. The dash pattern stays the encoding (§5 —
 * grayscale still reads); the muted hue is a layer that lets the eye tell
 * the two references apart, and apart from the blue instrument line,
 * without the legend. One resolver per reference so a call site cannot
 * swap them silently. */
export function resolveRefCd(): string {
  return resolveVar("--bw-ref-cd");
}
export function resolveRefPolicy(): string {
  return resolveVar("--bw-ref-policy");
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
